#!/usr/bin/env python3
"""Vérifie le dossier, ses liens, le backlog et les exemples JSON.

Bibliothèque standard uniquement. Le validateur de schéma implémente et audite
le sous-ensemble utilisé dans ce dossier, pas tout JSON Schema. Ne remplace pas
le validateur de production à choisir en L01.
"""
import argparse
import copy
import datetime as dt
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote


class Invalid(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Invalid(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Clé JSON dupliquée : " + key)
        result[key] = value
    return result


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)


KEYWORDS = {
    "$schema", "$id", "$defs", "$ref", "title", "description", "$comment",
    "type", "const", "enum", "required", "properties", "additionalProperties",
    "items", "minItems", "maxItems", "minLength", "maxLength", "pattern",
    "minimum", "maximum", "format", "anyOf", "oneOf", "allOf", "if", "then", "else",
}
TYPES = {"object", "array", "string", "integer", "number", "boolean", "null"}


def resolve(reference, document):
    require(reference.startswith("#/"), "Référence de schéma non locale non prise en charge : " + reference)
    current = document
    for token in reference[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        require(isinstance(current, dict) and token in current, "Référence de schéma introuvable : " + reference)
        current = current[token]
    return current


def audit_schema(schema, document, path="$"):
    if isinstance(schema, bool):
        return
    require(isinstance(schema, dict), path + " : schéma objet requis")
    require(set(schema) <= KEYWORDS, path + " : mot-clé non pris en charge " + str(set(schema) - KEYWORDS))
    if "$ref" in schema:
        resolve(schema["$ref"], document)
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        require(set(types) <= TYPES, path + " : type inconnu")
    if "pattern" in schema:
        re.compile(schema["pattern"])
    for field in ("properties", "$defs"):
        for key, child in schema.get(field, {}).items():
            audit_schema(child, document, path + "/" + field + "/" + key)
    for field in ("items", "additionalProperties", "if", "then", "else"):
        if field in schema and not isinstance(schema[field], bool):
            audit_schema(schema[field], document, path + "/" + field)
    for field in ("oneOf", "anyOf", "allOf"):
        if field in schema:
            require(isinstance(schema[field], list) and bool(schema[field]), path + " : liste de schémas vide")
            for index, child in enumerate(schema[field]):
                audit_schema(child, document, path + "/" + field + "/" + str(index))


def type_matches(value, kind):
    if kind == "null":
        return value is None
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, {"object": dict, "array": list, "string": str}[kind])


def valid(value, schema, document):
    try:
        validate(value, schema, document)
        return True
    except Invalid:
        return False


def validate(value, schema, document, path="$"):
    if isinstance(schema, bool):
        require(schema, path + " : schéma interdit")
        return
    if "$ref" in schema:
        validate(value, resolve(schema["$ref"], document), document, path)
    if "const" in schema:
        require(value == schema["const"] and type(value) is type(schema["const"]), path + " : constante incorrecte")
    if "enum" in schema:
        require(any(value == item and type(value) is type(item) for item in schema["enum"]), path + " : enum incorrect")
    if "type" in schema:
        kinds = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        require(any(type_matches(value, kind) for kind in kinds), path + " : type incorrect")
    for kind in ("anyOf", "oneOf"):
        if kind in schema:
            count = sum(valid(value, child, document) for child in schema[kind])
            require(count >= 1 if kind == "anyOf" else count == 1, path + " : " + kind + " non satisfait")
    for child in schema.get("allOf", []):
        validate(value, child, document, path)
    if "if" in schema:
        branch = "then" if valid(value, schema["if"], document) else "else"
        if branch in schema:
            validate(value, schema[branch], document, path)
    if isinstance(value, dict):
        for key in schema.get("required", []):
            require(key in value, path + " : champ requis absent " + key)
        properties = schema.get("properties", {})
        for key, item in value.items():
            if key in properties:
                validate(item, properties[key], document, path + "." + key)
            elif "additionalProperties" in schema:
                validate(item, schema["additionalProperties"], document, path + "." + key)
    if isinstance(value, list):
        require(len(value) >= schema.get("minItems", 0), path + " : tableau trop court")
        require(len(value) <= schema.get("maxItems", len(value)), path + " : tableau trop long")
        if "items" in schema:
            for index, item in enumerate(value):
                validate(item, schema["items"], document, path + "[" + str(index) + "]")
    if isinstance(value, str):
        require(len(value) >= schema.get("minLength", 0), path + " : chaîne trop courte")
        require(len(value) <= schema.get("maxLength", len(value)), path + " : chaîne trop longue")
        if "pattern" in schema:
            require(re.search(schema["pattern"], value) is not None, path + " : motif incorrect")
        if "format" in schema:
            require(schema["format"] == "date-time", path + " : format non pris en charge")
            try:
                parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                require(parsed.tzinfo is not None, path + " : fuseau horaire absent")
            except ValueError:
                raise Invalid(path + " : date invalide")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        require(value >= schema.get("minimum", value), path + " : valeur inférieure au minimum")
        require(value <= schema.get("maximum", value), path + " : valeur supérieure au maximum")


def check_pack(root):
    required = [
        "README.md", "START_HERE.md", "agent.md", "AGENTS.md", "CLAUDE.md",
        "CHANGELOG.md", "COORDINATION.md", "ROADMAP.md",
        "docs/PRODUCT.md", "docs/ARCHITECTURE.md", "docs/DATA_MODEL.md",
        "docs/CONTEXT.md", "docs/ORCHESTRATION.md", "docs/PROVIDERS.md",
        "docs/CLI.md", "docs/ACCEPTANCE.md", "docs/TRACEABILITY.md", "docs/SOURCES.md",
        "coordination/lots.json", "scripts/coordination.py", "scripts/bootstrap.py",
        "scripts/test_coordination.py", "scripts/test_bootstrap.py",
        "schemas/runtime.schema.json", "schemas/project-config.schema.json",
    ]
    for name in required:
        require((root / name).is_file(), "Fichier manquant : " + name)
    files = [path for path in root.rglob("*") if path.is_file()
             and "__pycache__" not in path.parts and not path.name.startswith(".")]
    json_count = 0
    for path in files:
        if path.suffix == ".json":
            read_json(path)
            json_count += 1
    link_count = 0
    for path in (item for item in files if item.suffix == ".md"):
        value = path.read_text(encoding="utf-8")
        for match in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", value):
            target = match.group(1).strip().split(" ", 1)[0]
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target = unquote(target.split("#", 1)[0])
            if not target:
                continue
            resolved = (path.parent / target).resolve()
            require(resolved.exists(), str(path.relative_to(root)) + " : lien absent " + target)
            link_count += 1
    backlog = read_json(root / "coordination/lots.json")
    lots = backlog["lots"]
    index = {item["id"]: item for item in lots}
    require(len(index) == len(lots) == 13, "Treize lots distincts attendus")
    require(set(index) == {"L%02d" % number for number in range(13)}, "IDs de lots incorrects")
    visited, pending = set(), set()
    def visit(key):
        require(key in index, "Dépendance inconnue " + key)
        require(key not in pending, "Cycle de dépendances " + key)
        if key in visited:
            return
        pending.add(key)
        for dependency in index[key]["depends_on"]:
            visit(dependency)
        pending.remove(key)
        visited.add(key)
    criteria = []
    for lot in lots:
        visit(lot["id"])
        path = root / lot["file"]
        require(path.is_file(), "Fiche de lot absente : " + lot["file"])
        text = path.read_text(encoding="utf-8")
        # Definitions are numbered/bulleted entries; repeated prose references do
        # not count as a second acceptance criterion.
        found = re.findall(r"AC-L\d{2}-\d{2}", text)
        criteria.extend(sorted(set(found)))
    require(len(criteria) == len(set(criteria)), "Critère d'acceptation présent dans plusieurs fiches")
    trace = (root / "docs/TRACEABILITY.md").read_text(encoding="utf-8")
    for number in range(1, 17):
        require(re.search(r"\bR%02d\b" % number, trace) is not None, "Exigence manquante R%02d" % number)
    for criterion in re.findall(r"AC-L\d{2}-\d{2}", trace):
        require(criterion in criteria, "Critère de traçabilité inconnu " + criterion)
    variable_doc = (root / "prompts/VARIABLES.md").read_text(encoding="utf-8")
    variables = set(re.findall(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}", variable_doc))
    prompts = [p for p in (root / "prompts").glob("*.md") if p.name != "VARIABLES.md"]
    for path in prompts:
        used = set(re.findall(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}", path.read_text(encoding="utf-8")))
        require(used <= variables, path.name + " : variables non enregistrées " + str(used - variables))
    runtime = read_json(root / "schemas/runtime.schema.json")
    config = read_json(root / "schemas/project-config.schema.json")
    audit_schema(runtime, runtime)
    audit_schema(config, config)
    examples = {
        "task.example.json": "TaskSpec", "context.example.json": "ContextBundle",
        "handoff.example.json": "Handoff", "event.example.json": "CrewEvent",
        "tool-call.example.json": "ToolCall",
    }
    for name, definition in examples.items():
        validate(read_json(root / "examples" / name), runtime["$defs"][definition], runtime, name)
    validate(read_json(root / "examples/project-config.example.json"), config, config, "config")
    # Negative probes ensure the pack validator does not quietly accept common
    # invalid configurations or fake manual command requirements.
    sample = read_json(root / "examples/handoff.example.json")["verifications"][0]
    manual = copy.deepcopy(sample)
    manual.update(execution="manual", command=None, result="not_run")
    validate(manual, runtime["$defs"]["Verification"], runtime)
    bad = copy.deepcopy(manual)
    bad["execution"] = "automated"
    require(not valid(bad, runtime["$defs"]["Verification"], runtime), "Une commande automatisée ne peut être null")
    bad_config = read_json(root / "examples/project-config.example.json")
    bad_config["max_active_agents"] = 0
    require(not valid(bad_config, config, config), "Concurrence nulle acceptée")
    bad_task = read_json(root / "examples/task.example.json")
    bad_task["base_revision"] = "no_git"
    require(not valid(bad_task, runtime["$defs"]["TaskSpec"], runtime), "Révision JSON no_git acceptée à tort")
    return {
        "ok": True, "scope": "workpack_only", "product_implemented": False,
        "lots": len(lots), "acceptance_criteria": len(criteria),
        "requirements": 16, "prompt_templates": len(prompts),
        "json_files_checked": json_count, "local_links_checked": link_count,
        "runtime_examples_checked": len(examples) + 1,
        "negative_schema_probes": 3,
        "note": "Vérification structurelle du dossier ; aucun fournisseur réel ni logiciel Avity Crew exécuté.",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    try:
        result = check_pack(args.root.resolve())
    except (Invalid, ValueError, OSError, KeyError, TypeError, re.error) as exc:
        result = {"ok": False, "scope": "workpack_only", "error": str(exc)}
    result["checked_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output, encoding="utf-8")
    print(output, end="")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

