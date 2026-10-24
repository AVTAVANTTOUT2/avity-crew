#!/usr/bin/env python3
"""Coordination du chantier Avity Crew, indépendante du futur produit.

Python 3.9+, bibliothèque standard ; macOS, Linux et WSL. Toutes les
mutations sont sérialisées puis publiées atomiquement dans STATE.json.
Les rapports sont déclaratifs : cet outil contrôle leur forme, pas leur vérité.
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager

try:
    import fcntl
except ImportError:
    fcntl = None


class CoordinationError(Exception):
    pass


def need(condition, message):
    if not condition:
        raise CoordinationError(message)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def ident(value, label="identifiant"):
    need(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", value)
         and ".." not in value, "%s invalide" % label)
    return value


def text(value, label):
    need(isinstance(value, str) and 0 < len(value.strip()) <= 20000,
         "%s doit être un texte non vide (20 000 caractères maximum)" % label)
    return value


def ref(value):
    text(value, "référence")
    path = PurePosixPath(value)
    need(not path.is_absolute() and ".." not in path.parts and "\\" not in value
         and not re.match(r"^[A-Za-z]:", value) and "\x00" not in value,
         "référence attendue relative au projet, sans traversée de répertoire")
    return value


def revision(value):
    need(isinstance(value, str) and re.fullmatch(r"(?:git:[a-f0-9]{40}(?:[a-f0-9]{24})?|sha256:[a-f0-9]{64})", value),
         "revision attendue : git:<SHA complet 40/64 caractères> ou sha256:<64 caractères>")


def read_json(path):
    path = Path(path)
    need(path.is_file(), "fichier introuvable : %s" % path)
    need(path.stat().st_size <= 8 * 1024 * 1024, "JSON trop volumineux (maximum 8 Mio)")
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise CoordinationError("JSON illisible : %s (%s)" % (path, exc))
    need(isinstance(result, dict), "le document JSON doit être un objet")
    return result


def load_backlog(root):
    data = read_json(root / "coordination/lots.json")
    need(data.get("schema_version") == 1 and isinstance(data.get("lots"), list)
         and data["lots"], "backlog incompatible ou vide")
    lots = {}
    for item in data["lots"]:
        need(isinstance(item, dict), "lot invalide")
        key = ident(item.get("id"), "lot")
        need(key not in lots, "lot dupliqué : " + key)
        text(item.get("title"), "titre du lot")
        ref(item.get("file"))
        deps = item.get("depends_on")
        need(isinstance(deps, list) and all(isinstance(x, str) for x in deps),
             "depends_on doit être une liste d'identifiants")
        lots[key] = item
    visited, pending = set(), set()
    def visit(key):
        need(key in lots, "dépendance inconnue : " + key)
        need(key not in pending, "cycle de dépendances : " + key)
        if key in visited:
            return
        pending.add(key)
        for dependency in lots[key]["depends_on"]:
            visit(dependency)
        pending.remove(key)
        visited.add(key)
    for key in lots:
        visit(key)
    encoded = json.dumps(data, sort_keys=True, ensure_ascii=False).encode()
    return data, lots, hashlib.sha256(encoded).hexdigest()


def fresh_state(backlog, digest):
    return {"schema_version": 1, "project": backlog.get("project", "Avity Crew"),
            "backlog_sha256": digest, "revision": 0, "updated_at": now(),
            "tasks": {x["id"]: {"status": "todo", "owner": None, "attempt": 0,
                "token": None, "heartbeat_at": None, "lease_minutes": 120,
                "handoff_id": None, "blocker": None, "accepted_revision": None,
                "accepted_review_id": None} for x in backlog["lots"]},
            "events": [], "notes": {}, "handoffs": {}, "reviews": {}}


@contextmanager
def locked_state(root):
    need(fcntl is not None, "utiliser macOS, Linux ou WSL (flock requis)")
    directory = root / "coordination"
    need(directory.is_dir(), "répertoire coordination absent")
    with (directory / ".coordination.lock").open("a+", encoding="utf-8") as lock:
        deadline = time.monotonic() + 10
        while True:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                need(time.monotonic() < deadline, "coordination occupée ; réessayer sans supprimer le verrou")
                time.sleep(0.05)
        try:
            backlog, lots, digest = load_backlog(root)
            path = directory / "STATE.json"
            state = read_json(path) if path.exists() else fresh_state(backlog, digest)
            need(state.get("schema_version") == 1 and state.get("backlog_sha256") == digest,
                 "STATE.json incompatible avec lots.json ; migration explicite nécessaire")
            validate_state(state, lots)
            yield state, lots, path
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def save(state, path, lots):
    state["revision"] += 1
    state["updated_at"] = now()
    validate_state(state, lots)
    raw = json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    fd, temporary = tempfile.mkstemp(prefix=".state-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def event(state, kind, lot=None, actor=None, **data):
    item = {"id": uuid.uuid4().hex, "at": now(), "kind": kind,
            "lot": lot, "actor": actor, **data}
    state["events"].append(item)
    return item


def own(task, args):
    ident(args.agent, "agent")
    need(task["owner"] == args.agent and task["token"] == args.token
         and task["token"] is not None, "propriétaire ou jeton périmé/invalide")


def dependencies_ready(state, lots, key):
    missing = [x for x in lots[key]["depends_on"] if state["tasks"][x]["status"] != "accepted"]
    need(not missing, "dépendances non acceptées : " + ", ".join(missing))


def activate(task, agent, lease_minutes):
    need(1 <= lease_minutes <= 1440, "lease-minutes doit être entre 1 et 1440")
    task.update(status="in_progress", owner=ident(agent, "agent"),
                attempt=task["attempt"] + 1, token=uuid.uuid4().hex,
                heartbeat_at=now(), lease_minutes=lease_minutes,
                handoff_id=None, blocker=None)


def checks(items):
    need(isinstance(items, list) and items, "au moins une vérification est requise")
    for item in items:
        need(isinstance(item, dict), "vérification invalide")
        for field in ("name", "command"):
            text(item.get(field), "vérification." + field)
        need(item.get("kind") in {"unit", "integration", "e2e", "live", "doc_validation", "packaging"},
             "type de vérification inconnu")
        need(type(item.get("exit_code")) is int, "exit_code doit être un entier observé")
        ref(item.get("evidence_ref"))
        revision(item.get("revision"))
        if item["kind"] == "live":
            need(item.get("provider") in {"claude", "codex"}, "provider live attendu : claude ou codex")


def validate_handoff(report):
    text(report.get("summary"), "summary")
    revision(report.get("revision"))
    artifacts = report.get("artifacts")
    need(isinstance(artifacts, list) and artifacts, "au moins un artefact est requis")
    for artifact in artifacts:
        need(isinstance(artifact, dict), "artefact invalide")
        if "commit" in artifact:
            need(bool(re.fullmatch(r"[a-f0-9]{40}(?:[a-f0-9]{24})?", str(artifact["commit"]))),
                 "SHA de commit incomplet")
        else:
            ref(artifact.get("ref"))
            need(bool(re.fullmatch(r"[a-f0-9]{64}", str(artifact.get("sha256", "")))),
                 "sha256 d'artefact obligatoire")
    checks(report.get("tests"))
    need(all(item["revision"] == report["revision"] for item in report["tests"]),
         "chaque vérification de livraison doit viser sa révision source")
    for field in ("limitations", "next_steps"):
        need(isinstance(report.get(field), list) and all(isinstance(x, str) for x in report[field]),
             field + " doit être une liste (vide autorisée)")
    need(report.get("live_verification") in {"not_applicable", "unverified", "passed"},
         "live_verification attendu : not_applicable, unverified ou passed")


def validate_review(report, handoff, lot, accept):
    need(report.get("handoff_id") == handoff["id"], "la revue doit viser la passation courante")
    need(report.get("source_revision") == handoff["report"]["revision"],
         "la révision source ne correspond pas à la livraison")
    text(report.get("summary"), "summary")
    need(isinstance(report.get("findings"), list) and all(isinstance(x, str) for x in report["findings"]),
         "findings doit être une liste de textes")
    for finding in report["findings"]:
        text(finding, "anomalie motivée")
    need(report.get("outcome") == ("accepted" if accept else "changes_requested"),
         "outcome incompatible avec la décision de revue")
    if not accept:
        need(report["findings"], "un refus exige des anomalies motivées")
    scope = report.get("verification_scope")
    if accept or "verification_scope" in report:
        need(scope in {"combined_code", "documentation"},
             "verification_scope attendu : combined_code ou documentation")
    tested = report.get("tested_revision")
    if accept or "tested_revision" in report:
        revision(tested)
        if scope == "documentation":
            need(tested == report["source_revision"], "la revue documentaire doit viser l'artefact livré")
    if "integration" in report or (accept and scope == "combined_code"):
        integration = report.get("integration")
        need(isinstance(integration, dict) and scope == "combined_code",
             "preuve d'intégration requise et réservée à combined_code")
        revision(tested)
        revision(integration.get("base_revision"))
        need(integration.get("source_revision") == report["source_revision"]
             and integration.get("candidate_revision") == tested,
             "preuve d'intégration incohérente avec la source ou le candidat testé")
        ref(integration.get("evidence_ref"))
    review_checks = report.get("checks", [])
    need(isinstance(review_checks, list), "checks doit être une liste")
    if accept or review_checks:
        checks(review_checks)
    for item in review_checks:
        need(item["revision"] == (tested or report["source_revision"]),
             "chaque preuve de revue doit porter sur la révision testée")
    if "evidence_refs" in report:
        need(isinstance(report["evidence_refs"], list), "evidence_refs doit être une liste")
        for evidence in report["evidence_refs"]:
            ref(evidence)
    if accept:
        need(not report["findings"],
             "acceptation : outcome accepted et aucune anomalie restante")
        need(all(x["exit_code"] == 0 for x in report["checks"]),
             "une vérification de revue a échoué")
        need(all(x["exit_code"] == 0 for x in handoff["report"]["tests"]),
             "une vérification de livraison a échoué ; nouvelle livraison requise")
        need(not handoff["report"]["limitations"] and not handoff["report"]["next_steps"],
             "lot incomplet : traiter limitations/next_steps avant acceptation")
        if report["verification_scope"] == "documentation":
            need(all(x["kind"] == "doc_validation" for x in report["checks"]),
                 "une revue documentation ne contient que des validations documentaires")
        if lot in {"L11", "L12"}:
            live = {x.get("provider") for x in report["checks"] if x["kind"] == "live" and x["exit_code"] == 0}
            need(report["verification_scope"] == "combined_code" and live == {"claude", "codex"}
                 and handoff["report"]["live_verification"] == "passed",
                 "L11/L12 : preuves réelles Claude ET Codex requises sur la révision livrée")


def timestamp(value, label):
    text(value, label)
    parsed = dt.datetime.fromisoformat(value)
    need(parsed.tzinfo is not None and parsed.utcoffset() is not None,
         label + " doit indiquer son fuseau horaire")


def validate_state(state, lots):
    """Refuser un état incohérent avant lecture/déblocage, puis avant écriture."""
    need(isinstance(state.get("tasks"), dict) and set(state["tasks"]) == set(lots),
         "liste des tâches incohérente")
    need(all(isinstance(task, dict) for task in state["tasks"].values()), "entrée de tâche invalide")
    for field in ("notes", "handoffs", "reviews"):
        need(isinstance(state.get(field), dict), "état corrompu : " + field)
    events = state.get("events")
    need(isinstance(events, list) and type(state.get("revision")) is int
         and state["revision"] == len(events), "journal ou révision d'état incohérent")
    timestamp(state.get("updated_at"), "updated_at")
    text(state.get("project"), "project")
    for field, prefix in (("notes", "note"), ("handoffs", "handoff"), ("reviews", "review")):
        for record_id, record in state[field].items():
            need(isinstance(record, dict) and record.get("id") == record_id
                 and re.fullmatch(prefix + r"-[a-f0-9]{32}", record_id), "identifiant d'enregistrement incohérent")
            need(record.get("lot") in lots, "enregistrement associé à un lot inconnu")
            ident(record.get("author"), "auteur enregistré")
            timestamp(record.get("at"), "date d'enregistrement")
            if field == "notes":
                text(record.get("message"), "note")
                need(record.get("kind") in {"progress", "finding", "question", "proposal", "decision"},
                     "type de note inconnu")
            elif field == "handoffs":
                need(type(record.get("attempt")) is int and record["attempt"] >= 1,
                     "tentative de passation invalide")
                need(isinstance(record.get("report"), dict), "rapport de passation invalide")
                validate_handoff(record["report"])
            else:
                report = record.get("report")
                need(isinstance(report, dict), "rapport de revue invalide")
                handoff = state["handoffs"].get(report.get("handoff_id"))
                need(handoff is not None and handoff["lot"] == record["lot"], "revue sans passation correspondante")
                need(record["author"] != handoff["author"], "revue enregistrée par l'auteur de la livraison")
                need(report.get("outcome") in {"accepted", "changes_requested"}, "décision de revue inconnue")
                validate_review(report, handoff, record["lot"], report["outcome"] == "accepted")
    event_ids, transitions, claims = set(), {}, {}
    kinds = {"initialized", "claim", "reassign", "heartbeat", "block", "resume", "submit", "note", "accept", "reject"}
    for item in events:
        need(isinstance(item, dict) and isinstance(item.get("id"), str)
             and re.fullmatch(r"[a-f0-9]{32}", item["id"]) and item["id"] not in event_ids,
             "événement invalide ou dupliqué")
        event_ids.add(item["id"])
        timestamp(item.get("at"), "date d'événement")
        kind, key = item.get("kind"), item.get("lot")
        need(kind in kinds, "type d'événement inconnu")
        if kind == "initialized":
            need(key is None and item.get("actor") is None, "initialisation incohérente")
            continue
        need(key in lots, "événement associé à un lot inconnu")
        ident(item.get("actor"), "acteur enregistré")
        if kind not in {"heartbeat", "note"}:
            transitions[key] = item
        if kind in {"claim", "reassign"}:
            need(type(item.get("attempt")) is int and item["attempt"] >= 1, "tentative d'événement invalide")
            claims[key] = item
            if kind == "reassign":
                need(item.get("previous_worker_stopped") is True, "réattribution sans attestation d'arrêt")
                ident(item.get("by"), "coordinateur enregistré")
                text(item.get("reason"), "raison de réattribution")
        field = {"note": "notes", "submit": "handoffs", "accept": "reviews", "reject": "reviews"}.get(kind)
        if field:
            id_field = {"notes": "note_id", "handoffs": "handoff_id", "reviews": "review_id"}[field]
            record = state[field].get(item.get(id_field))
            need(record is not None and record["lot"] == key and record["author"] == item["actor"],
                 "événement sans enregistrement correspondant")
            if field == "reviews":
                need(record["report"]["handoff_id"] == item.get("handoff_id")
                     and record["report"]["outcome"] == ("accepted" if kind == "accept" else "changes_requested"),
                     "événement et décision de revue incohérents")
    required = {"status", "owner", "attempt", "token", "heartbeat_at", "lease_minutes", "handoff_id",
                "blocker", "accepted_revision", "accepted_review_id"}
    allowed_last = {"in_progress": {"claim", "reassign", "resume", "reject"}, "blocked": {"block"},
                    "in_review": {"submit"}, "accepted": {"accept"}}
    for key, task in state["tasks"].items():
        need(isinstance(task, dict) and required <= task.keys(), "champs de tâche manquants : " + key)
        stage = task["status"]
        need(stage in {"todo", *allowed_last}, "statut inconnu : " + key)
        need(type(task["attempt"]) is int and task["attempt"] >= 0
             and type(task["lease_minutes"]) is int and 1 <= task["lease_minutes"] <= 1440,
             "tentative ou seuil d'alerte invalide : " + key)
        if stage == "todo":
            need(task["attempt"] == 0 and key not in transitions
                 and all(task[x] is None for x in required - {"status", "attempt", "lease_minutes"}),
                 "lot todo incohérent : " + key)
            continue
        ident(task["owner"], "propriétaire enregistré")
        timestamp(task["heartbeat_at"], "heartbeat_at")
        claim = claims.get(key, {})
        last = transitions.get(key, {})
        need(task["attempt"] >= 1 and claim.get("attempt") == task["attempt"]
             and claim.get("actor") == task["owner"] and last.get("kind") in allowed_last[stage],
             "statut, propriétaire ou tentative sans événement cohérent : " + key)
        need(all(state["tasks"][x].get("status") == "accepted" for x in lots[key]["depends_on"]),
             "lot actif avec dépendance non acceptée : " + key)
        if stage == "blocked":
            text(task["blocker"], "motif de blocage")
        else:
            need(task["blocker"] is None, "motif de blocage incompatible avec le statut")
        handoff = state["handoffs"].get(task["handoff_id"])
        if task["handoff_id"] is not None:
            need(handoff is not None and handoff["lot"] == key and handoff["author"] == task["owner"]
                 and handoff["attempt"] == task["attempt"], "passation étrangère à la tentative : " + key)
        if stage in {"in_review", "accepted"}:
            need(handoff is not None and last.get("handoff_id") == handoff["id"],
                 "statut sans passation courante : " + key)
        if stage == "accepted":
            review = state["reviews"].get(task["accepted_review_id"])
            need(task["token"] is None and review is not None and review["lot"] == key
                 and review["report"]["outcome"] == "accepted"
                 and review["report"]["handoff_id"] == task["handoff_id"]
                 and review["report"]["tested_revision"] == task["accepted_revision"]
                 and last.get("review_id") == review["id"], "acceptation sans revue et preuves cohérentes : " + key)
        else:
            need(isinstance(task["token"], str) and re.fullmatch(r"[a-f0-9]{32}", task["token"])
                 and task["accepted_revision"] is None and task["accepted_review_id"] is None,
                 "jeton ou champs d'acceptation incohérents : " + key)


def status(state, lots, selected=None):
    keys = [selected] if selected else list(lots)
    result = {"project": state["project"], "revision": state["revision"], "tasks": []}
    for key in keys:
        task = state["tasks"][key]
        item = {k: v for k, v in task.items() if k != "token"}
        heartbeat = task.get("heartbeat_at")
        age = ((dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(heartbeat)).total_seconds()
               if heartbeat else 0)
        item.update(id=key, title=lots[key]["title"], depends_on=lots[key]["depends_on"],
                    heartbeat_overdue=bool(heartbeat and task["status"] in {"in_progress", "blocked"}
                                           and age > task["lease_minutes"] * 60))
        result["tasks"].append(item)
    if selected:
        for field in ("notes", "handoffs", "reviews"):
            result[field] = [x for x in state[field].values() if x["lot"] == selected]
        result["events"] = [x for x in state["events"] if x["lot"] == selected]
    return result


def execute(args):
    root = Path(args.root).expanduser().resolve(strict=True)
    with locked_state(root) as (state, lots, path):
        key = getattr(args, "lot", None)
        if key:
            ident(key, "lot")
            need(key in lots, "lot inconnu : " + key)
        if args.command == "status":
            return status(state, lots, key)
        if args.command == "init":
            if not path.exists():
                event(state, "initialized")
                save(state, path, lots)
            return {"state": str(path), "revision": state["revision"]}
        task = state["tasks"][key]
        output = {}
        if args.command in {"claim", "reassign"}:
            dependencies_ready(state, lots, key)
            if args.command == "claim":
                need(task["status"] == "todo", "lot déjà pris ; utiliser status puis la procédure de reprise")
            else:
                need(task["status"] in {"in_progress", "blocked", "in_review"}, "lot non réattribuable")
                need(args.previous_worker_stopped, "attester l'arrêt du précédent exécutant avec --previous-worker-stopped")
                ident(args.by, "coordinateur")
                text(args.reason, "raison de réattribution")
            previous = {k: task[k] for k in ("owner", "attempt", "status", "handoff_id")}
            activate(task, args.agent, args.lease_minutes)
            event(state, args.command, key, args.agent, previous=previous,
                  by=getattr(args, "by", None), reason=getattr(args, "reason", None),
                  previous_worker_stopped=getattr(args, "previous_worker_stopped", False), attempt=task["attempt"])
            output = {"lot": key, "owner": task["owner"], "attempt": task["attempt"], "token": task["token"]}
        elif args.command in {"heartbeat", "block", "resume", "submit"}:
            own(task, args)
            if args.command == "resume":
                need(task["status"] == "blocked", "resume exige un lot bloqué")
                dependencies_ready(state, lots, key)
                text(args.reason, "raison de reprise")
                task.update(status="in_progress", blocker=None)
            elif args.command == "block":
                need(task["status"] in {"in_progress", "blocked"}, "lot non bloquable")
                task.update(status="blocked", blocker=text(args.reason, "raison du blocage"))
            elif args.command == "submit":
                need(task["status"] == "in_progress", "submit exige un lot en cours")
                report = read_json(args.report)
                validate_handoff(report)
                record_id = "handoff-" + uuid.uuid4().hex
                state["handoffs"][record_id] = {"id": record_id, "at": now(), "lot": key,
                    "author": args.agent, "attempt": task["attempt"], "report": copy.deepcopy(report)}
                task.update(status="in_review", handoff_id=record_id)
                output["handoff_id"] = record_id
            else:
                need(task["status"] in {"in_progress", "blocked", "in_review"}, "lot sans exécutant actif")
            task["heartbeat_at"] = now()
            event(state, args.command, key, args.agent, attempt=task["attempt"],
                  reason=getattr(args, "reason", None), handoff_id=output.get("handoff_id"))
        elif args.command == "note":
            ident(args.agent, "agent")
            record_id = "note-" + uuid.uuid4().hex
            state["notes"][record_id] = {"id": record_id, "at": now(), "lot": key,
                "author": args.agent, "kind": args.kind, "message": text(args.message, "message")}
            event(state, "note", key, args.agent, note_id=record_id)
            output["note_id"] = record_id
        elif args.command in {"accept", "reject"}:
            need(task["status"] == "in_review", "revue impossible : lot non soumis")
            ident(args.reviewer, "relecteur")
            handoff = state["handoffs"][task["handoff_id"]]
            need(args.reviewer != handoff["author"], "le relecteur doit être différent de l'auteur")
            report = read_json(args.report)
            validate_review(report, handoff, key, args.command == "accept")
            record_id = "review-" + uuid.uuid4().hex
            state["reviews"][record_id] = {"id": record_id, "at": now(), "lot": key,
                "author": args.reviewer, "report": copy.deepcopy(report)}
            task["status"] = "accepted" if args.command == "accept" else "in_progress"
            if args.command == "accept":
                task["token"] = None
                task["accepted_revision"] = report["tested_revision"]
                task["accepted_review_id"] = record_id
            event(state, args.command, key, args.reviewer, review_id=record_id, handoff_id=handoff["id"])
            output["review_id"] = record_id
        save(state, path, lots)
        return {"lot": key, "status": task["status"], "state_revision": state["revision"], **output}


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", default=str(Path(__file__).resolve().parents[1]),
                   help="racine CANONIQUE du dossier de travail (même chemin pour tous les agents)")
    commands = p.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="initialiser l'état sans accepter aucun lot")
    s = commands.add_parser("status", help="état ; ajouter un lot pour ses notes, passations et revues")
    s.add_argument("lot", nargs="?")
    for name in ("claim", "reassign", "heartbeat", "block", "resume", "note", "submit", "accept", "reject"):
        s = commands.add_parser(name)
        s.add_argument("lot")
        if name in {"accept", "reject"}:
            s.add_argument("--reviewer", required=True)
        else:
            s.add_argument("--agent", required=True)
        if name in {"heartbeat", "block", "resume", "submit"}:
            s.add_argument("--token", required=True, help="jeton retourné par claim/reassign")
        if name in {"claim", "reassign"}:
            s.add_argument("--lease-minutes", type=int, default=120,
                           help="seuil d'alerte d'absence de nouvelles ; aucune réattribution automatique")
        if name in {"block", "resume", "reassign"}:
            s.add_argument("--reason", required=True)
        if name == "reassign":
            s.add_argument("--by", required=True)
            s.add_argument("--previous-worker-stopped", action="store_true")
        if name == "note":
            s.add_argument("--message", required=True)
            s.add_argument("--kind", choices=["progress", "finding", "question", "proposal", "decision"], default="progress")
        if name in {"submit", "accept", "reject"}:
            s.add_argument("--report", required=True, help="JSON UTF-8 réel ; les exemples contiennent des champs à remplir")
    return p


def main():
    try:
        result = execute(parser().parse_args())
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (CoordinationError, OSError, KeyError, TypeError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
