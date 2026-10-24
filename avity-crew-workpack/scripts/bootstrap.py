#!/usr/bin/env python3
"""Ajoute des relais de lecture sans écraser les consignes du dépôt.

Plan sans mutation par défaut ; --apply écrit les blocs et sauvegarde les
fichiers préexistants. Python 3.9+, aucune dépendance ni opération réseau.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import uuid

START = "<!-- AVITY_CREW_WORKPACK:BEGIN -->"
END = "<!-- AVITY_CREW_WORKPACK:END -->"
IGNORE_START = "# AVITY_CREW_WORKPACK:BEGIN"
IGNORE_END = "# AVITY_CREW_WORKPACK:END"


class BootstrapError(Exception):
    pass


def splice(original, block, start, end):
    starts, ends = original.count(start), original.count(end)
    if (starts, ends) == (0, 0):
        return original + ("\n\n" if original and not original.endswith("\n\n") else "") + block + "\n"
    if (starts, ends) != (1, 1) or original.index(start) > original.index(end):
        raise BootstrapError("Marqueurs existants incomplets ou dupliqués ; vérifier le fichier avant de modifier.")
    a, b = original.index(start), original.index(end) + len(end)
    return original[:a] + block + original[b:]


def make_plan(repo, pack):
    repo, pack = repo.resolve(), pack.resolve()
    if not repo.is_dir() or not pack.is_dir():
        raise BootstrapError("Le dépôt et le dossier de travail doivent exister.")
    try:
        relative = pack.relative_to(repo).as_posix()
    except ValueError:
        raise BootstrapError("Placer le dossier de travail à l'intérieur du dépôt cible.")
    if relative == ".":
        raise BootstrapError("Conserver un sous-dossier dédié pour le workpack.")
    if not (pack / "agent.md").is_file() or not (pack / "COORDINATION.md").is_file():
        raise BootstrapError("Le workpack doit contenir agent.md et COORDINATION.md.")
    # Escape Markdown paths while preserving a usable native path for the user.
    if any(char in relative for char in ("\n", "\r", "\x00", "(", ")", "[", "]")):
        raise BootstrapError("Utiliser un nom de dossier sans caractères de syntaxe Markdown.")
    link_path = relative.replace(" ", "%20")
    body = (
        "## Construction d'Avity Crew\n\n"
        "Pour le chantier Avity Crew, lire les consignes canoniques "
        f"[agent.md]({link_path}/agent.md), puis "
        f"[COORDINATION.md]({link_path}/COORDINATION.md) et le lot attribué.\n"
        "Le dossier contient le cahier de construction et les modèles du futur produit. "
        "Il complète les instructions déjà applicables sans les remplacer.\n"
        "Tous les agents utilisent la même copie canonique du registre de chantier.\n"
        f"Point de départ : [{relative}/START_HERE.md]({link_path}/START_HERE.md)."
    )
    block = START + "\n" + body + "\n" + END
    ignore = IGNORE_START + "\n" + "\n".join([
        "/" + relative + "/coordination/STATE.json",
        "/" + relative + "/coordination/.coordination.lock",
        "/" + relative + "/coordination/.state-*.tmp",
        "/" + relative + "/coordination/bootstrap-backups/",
        "/" + relative + "/scripts/__pycache__/",
    ]) + "\n" + IGNORE_END
    plan = []
    for name in ("AGENTS.md", "CLAUDE.md", "agent.md", ".gitignore"):
        target = repo / name
        if target.is_symlink():
            raise BootstrapError("Refus de remplacer un lien symbolique : " + str(target))
        if target.exists() and not target.is_file():
            raise BootstrapError("La cible n'est pas un fichier : " + str(target))
        raw = target.read_bytes() if target.exists() else None
        try:
            original = raw.decode("utf-8") if raw is not None else ""
        except UnicodeDecodeError:
            raise BootstrapError("Fichier non UTF-8 à traiter explicitement : " + str(target))
        markers = (IGNORE_START, IGNORE_END) if name == ".gitignore" else (START, END)
        result = splice(original, ignore if name == ".gitignore" else block, *markers)
        updated = result.encode("utf-8")
        plan.append({
            "path": target, "old": raw, "new": updated,
            "mode": stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o644,
            "action": "unchanged" if raw == updated else ("create" if raw is None else "append_or_update_block"),
        })
    return repo, pack, plan


def atomic_write(path, content, mode):
    fd, temp_path = tempfile.mkstemp(prefix=".avitycrew-instructions-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def apply_plan(pack, plan):
    changed = [item for item in plan if item["action"] != "unchanged"]
    if not changed:
        return None
    # Recheck every input before any write to avoid overwriting a concurrent edit.
    for item in plan:
        path = item["path"]
        if path.is_symlink():
            raise BootstrapError("Cible devenue un lien symbolique : " + str(path))
        current = path.read_bytes() if path.exists() else None
        if current != item["old"]:
            raise BootstrapError("Fichier modifié depuis le plan : " + str(path))
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir = pack / "coordination" / "bootstrap-backups" / (stamp + "-" + uuid.uuid4().hex[:10])
    backup_dir.mkdir(parents=True, mode=0o700)
    inventory = []
    for item in changed:
        old = item["old"]
        if old is not None:
            backup = backup_dir / item["path"].name
            backup.write_bytes(old)
            backup.chmod(0o600)
        inventory.append({
            "path": str(item["path"]), "existed": old is not None,
            "before_sha256": hashlib.sha256(old).hexdigest() if old is not None else None,
            "after_sha256": hashlib.sha256(item["new"]).hexdigest(),
        })
    (backup_dir / "manifest.json").write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for item in changed:
        # Check again immediately before publication. This is a cooperative local
        # helper, not a transaction against arbitrary external file writers.
        path = item["path"]
        current = path.read_bytes() if path.exists() else None
        if path.is_symlink() or current != item["old"]:
            raise BootstrapError("Écriture concurrente détectée ; conserver les sauvegardes : " + str(backup_dir))
        atomic_write(path, item["new"], item["mode"])
    return backup_dir


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd(), help="Racine du dépôt cible.")
    parser.add_argument("--pack", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="Dossier canonique du workpack, à l'intérieur du dépôt.")
    parser.add_argument("--apply", action="store_true", help="Appliquer le plan ; sinon afficher seulement les cibles.")
    args = parser.parse_args(argv)
    try:
        repo, pack, plan = make_plan(args.repo, args.pack)
        backup = apply_plan(pack, plan) if args.apply else None
        print(json.dumps({
            "ok": True, "applied": args.apply, "repo": str(repo), "workpack": str(pack),
            "changes": [{"path": str(item["path"]), "action": item["action"]} for item in plan],
            "backup_dir": str(backup) if backup else None,
        }, ensure_ascii=False, indent=2))
        return 0
    except (BootstrapError, OSError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

