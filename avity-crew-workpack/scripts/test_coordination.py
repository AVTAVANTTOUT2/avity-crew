#!/usr/bin/env python3
"""Tests isolés du registre de CHANTIER ; aucune IA ni application n'est testée."""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("coordination.py").resolve()
REVISION = "git:" + "a" * 40


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="avity crew test ")
        self.root = Path(self.temporary.name)
        (self.root / "coordination").mkdir()
        lots = [
            {"id": "L00", "title": "Audit", "file": "lots/L00.md", "depends_on": [], "scope": ["docs"]},
            {"id": "L01", "title": "Socle", "file": "lots/L01.md", "depends_on": ["L00"], "scope": ["core"]},
            {"id": "L11", "title": "Recette", "file": "lots/L11.md", "depends_on": ["L01"], "scope": ["tests"]},
            {"id": "L12", "title": "Distribution", "file": "lots/L12.md", "depends_on": ["L11"], "scope": ["packaging"]},
        ]
        self.write("coordination/lots.json", {"schema_version": 1, "project": "Test isolé", "lots": lots})

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, relative, data):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return path

    def call(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root), *args],
                                text=True, capture_output=True, timeout=20)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        return json.loads(result.stderr)

    def state(self):
        return json.loads((self.root / "coordination/STATE.json").read_text())

    def claim(self, lot="L00", agent="worker-1"):
        return self.call("claim", lot, "--agent", agent)["token"]

    def check(self, kind="unit", provider=None):
        result = {"name": "Vérification de fixture uniquement", "command": "fixture-command",
                  "kind": kind, "exit_code": 0, "evidence_ref": "validation/fixture.log",
                  "revision": REVISION}
        if provider:
            result["provider"] = provider
        return result

    def handoff(self):
        return {"summary": "Livraison synthétique pour le test du registre.", "revision": REVISION,
                "artifacts": [{"commit": "a" * 40}], "tests": [self.check()],
                "limitations": [], "next_steps": [], "live_verification": "unverified"}

    def submit(self, lot="L00", agent="worker-1", token=None, report=None):
        report_file = self.write("input-handoff.json", report or self.handoff())
        return self.call("submit", lot, "--agent", agent, "--token", token,
                         "--report", str(report_file))["handoff_id"]

    def review(self, handoff_id):
        return {"handoff_id": handoff_id, "outcome": "accepted", "source_revision": REVISION,
                "tested_revision": REVISION,
                "verification_scope": "combined_code", "summary": "Revue de fixture.",
                "findings": [], "checks": [self.check()],
                "integration": {"base_revision": "git:" + "b" * 40,
                                "source_revision": REVISION, "candidate_revision": REVISION,
                                "evidence_ref": "validation/fixture-integration.log"}}

    def accept(self, lot="L00", reviewer="reviewer-1", report=None):
        report_file = self.write("input-review.json", report)
        return self.call("accept", lot, "--reviewer", reviewer, "--report", str(report_file))

    def complete(self, lot, agent="worker-1"):
        token = self.claim(lot, agent)
        handoff_id = self.submit(lot, agent, token)
        self.accept(lot, report=self.review(handoff_id))

    def test_status_does_not_create_state_and_paths_with_spaces_work(self):
        result = self.call("status")
        self.assertTrue(all(x["status"] == "todo" for x in result["tasks"]))
        self.assertFalse((self.root / "coordination/STATE.json").exists())

    def test_dependencies_gate_claim_and_accepted_delivery_unlocks_next(self):
        self.assertIn("dépendances", self.call("claim", "L01", "--agent", "worker-1", ok=False)["error"])
        self.complete("L00")
        self.claim("L01")
        self.assertEqual(self.state()["tasks"]["L01"]["status"], "in_progress")

    def test_concurrent_claim_has_exactly_one_winner(self):
        def invoke(index):
            return subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root),
                                   "claim", "L00", "--agent", "worker-%s" % index],
                                  text=True, capture_output=True, timeout=20)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(invoke, range(8)))
        self.assertEqual(sum(x.returncode == 0 for x in results), 1)
        self.assertEqual(len([x for x in self.state()["events"] if x["kind"] == "claim"]), 1)
        self.assertEqual(self.state()["tasks"]["L00"]["attempt"], 1)

    def test_stale_token_rejected_after_explicit_reassignment(self):
        old_token = self.claim()
        self.call("reassign", "L00", "--agent", "worker-2", "--by", "coordinator",
                  "--reason", "Ancien processus arrêté", ok=False)
        result = self.call("reassign", "L00", "--agent", "worker-2", "--by", "coordinator",
                           "--reason", "Ancien processus arrêté", "--previous-worker-stopped")
        self.assertEqual(result["attempt"], 2)
        self.call("heartbeat", "L00", "--agent", "worker-1", "--token", old_token, ok=False)
        self.call("heartbeat", "L00", "--agent", "worker-2", "--token", result["token"])

    def test_overdue_heartbeat_never_reassigns_automatically(self):
        token = self.claim()
        state = self.state()
        state["tasks"]["L00"]["heartbeat_at"] = "2000-01-01T00:00:00+00:00"
        self.write("coordination/STATE.json", state)
        result = self.call("status", "L00")
        self.assertTrue(result["tasks"][0]["heartbeat_overdue"])
        self.assertEqual(self.state()["tasks"]["L00"]["token"], token)
        self.call("claim", "L00", "--agent", "worker-2", ok=False)

    def test_invalid_report_and_path_traversal_do_not_mutate_state(self):
        token = self.claim()
        before = (self.root / "coordination/STATE.json").read_bytes()
        report = self.handoff()
        report["tests"][0]["evidence_ref"] = "../../outside.log"
        path = self.write("invalid.json", report)
        self.call("submit", "L00", "--agent", "worker-1", "--token", token,
                  "--report", str(path), ok=False)
        self.call("note", "L00", "--agent", "../escape", "--message", "Interdit", ok=False)
        self.call("claim", "../../L00", "--agent", "worker-2", ok=False)
        self.assertEqual(before, (self.root / "coordination/STATE.json").read_bytes())
        self.assertEqual(self.state()["handoffs"], {})

    def test_review_must_be_independent_and_target_exact_revision(self):
        token = self.claim()
        handoff_id = self.submit(token=token)
        report = self.review(handoff_id)
        path = self.write("review.json", report)
        self.call("accept", "L00", "--reviewer", "worker-1", "--report", str(path), ok=False)
        report["tested_revision"] = "git:" + "b" * 40
        path = self.write("review.json", report)
        self.call("accept", "L00", "--reviewer", "reviewer-1", "--report", str(path), ok=False)
        self.assertEqual(self.state()["tasks"]["L00"]["status"], "in_review")
        self.accept(report=self.review(handoff_id))
        self.call("heartbeat", "L00", "--agent", "worker-1", "--token", token, ok=False)
        self.call("accept", "L00", "--reviewer", "reviewer-1", "--report", str(path), ok=False)

    def test_failed_checks_and_open_work_prevent_acceptance(self):
        token = self.claim()
        report = self.handoff()
        report["limitations"] = ["Scénario non terminé"]
        handoff_id = self.submit(token=token, report=report)
        path = self.write("review.json", self.review(handoff_id))
        self.call("accept", "L00", "--reviewer", "reviewer-1", "--report", str(path), ok=False)
        self.assertEqual(self.state()["tasks"]["L00"]["status"], "in_review")

    def test_failed_source_check_prevents_acceptance_even_with_green_review(self):
        token = self.claim()
        report = self.handoff()
        report["tests"][0]["exit_code"] = 1
        handoff_id = self.submit(token=token, report=report)
        path = self.write("review.json", self.review(handoff_id))
        self.call("accept", "L00", "--reviewer", "reviewer-1", "--report", str(path), ok=False)

    def test_source_checks_cannot_reference_another_revision(self):
        token = self.claim()
        report = self.handoff()
        report["tests"][0]["revision"] = "git:" + "d" * 40
        path = self.write("handoff.json", report)
        self.call("submit", "L00", "--agent", "worker-1", "--token", token,
                  "--report", str(path), ok=False)
        self.assertEqual(self.state()["tasks"]["L00"]["status"], "in_progress")

    def test_combined_candidate_can_differ_only_with_consistent_provenance(self):
        token = self.claim()
        handoff_id = self.submit(token=token)
        review = self.review(handoff_id)
        candidate = "git:" + "c" * 40
        review["tested_revision"] = candidate
        review["checks"][0]["revision"] = candidate
        path = self.write("review.json", review)
        self.call("accept", "L00", "--reviewer", "reviewer-1", "--report", str(path), ok=False)
        review["integration"]["candidate_revision"] = candidate
        self.accept(report=review)
        self.assertEqual(self.state()["tasks"]["L00"]["accepted_revision"], candidate)

    def test_block_resume_and_rejected_delivery_preserve_history(self):
        token = self.claim()
        self.call("block", "L00", "--agent", "worker-1", "--token", token, "--reason", "Question métier")
        self.call("resume", "L00", "--agent", "worker-1", "--token", token, "--reason", "Réponse reçue")
        handoff_id = self.submit(token=token)
        report = self.review(handoff_id)
        report.update(outcome="changes_requested", findings=["Correction nécessaire"])
        path = self.write("review.json", report)
        self.call("reject", "L00", "--reviewer", "reviewer-1", "--report", str(path))
        new_id = self.submit(token=token)
        self.assertNotEqual(handoff_id, new_id)
        state = self.state()
        self.assertEqual(len(state["handoffs"]), 2)
        self.assertEqual(len(state["reviews"]), 1)

    def test_rejection_before_merge_candidate_requires_only_source_and_findings(self):
        token = self.claim()
        handoff_id = self.submit(token=token)
        review = {"handoff_id": handoff_id, "source_revision": REVISION,
                  "outcome": "changes_requested", "summary": "Conflit avant création du candidat.",
                  "findings": ["Résoudre le conflit de fusion dans le contrat partagé."],
                  "evidence_refs": ["validation/merge-conflict.log"]}
        path = self.write("reject-before-candidate.json", review)
        self.call("reject", "L00", "--reviewer", "reviewer-1", "--report", str(path))
        task = self.call("status", "L00")["tasks"][0]
        self.assertEqual(task["status"], "in_progress")
        self.assertEqual(self.state()["tasks"]["L00"]["token"], token)
        self.assertEqual(len(self.state()["reviews"]), 1)

    def test_rejection_validates_optional_proofs_and_current_source(self):
        token = self.claim()
        handoff_id = self.submit(token=token)
        review = {"handoff_id": handoff_id, "source_revision": REVISION,
                  "outcome": "changes_requested", "summary": "Conflit à traiter.",
                  "findings": ["Résoudre le conflit."], "evidence_refs": ["../outside.log"]}
        before = (self.root / "coordination/STATE.json").read_bytes()
        for invalid in (review, {**review, "evidence_refs": [], "source_revision": "git:" + "f" * 40},
                        {**review, "evidence_refs": [], "checks": [{"name": "preuve incomplète"}]}):
            path = self.write("bad-review.json", invalid)
            self.call("reject", "L00", "--reviewer", "reviewer-1", "--report", str(path), ok=False)
            self.assertEqual(before, (self.root / "coordination/STATE.json").read_bytes())

    def test_notes_are_unique_persistent_and_not_shell_commands(self):
        self.call("note", "L00", "--agent", "reader", "--message", "$(touch ATTACK) `touch ATTACK` éà")
        self.call("note", "L00", "--agent", "reader", "--message", "Deuxième note")
        result = self.call("status", "L00")
        self.assertEqual(len(result["notes"]), 2)
        self.assertFalse((self.root / "ATTACK").exists())
        self.assertNotEqual(result["notes"][0]["id"], result["notes"][1]["id"])

    def test_final_lots_require_both_provider_live_evidence(self):
        self.complete("L00")
        self.complete("L01")
        token = self.claim("L11")
        report = self.handoff()
        report["live_verification"] = "passed"
        handoff_id = self.submit("L11", token=token, report=report)
        review = self.review(handoff_id)
        path = self.write("review.json", review)
        self.call("accept", "L11", "--reviewer", "reviewer-1", "--report", str(path), ok=False)
        # Ces preuves sont synthétiques dans un test du validateur ; elles ne
        # représentent pas des appels réels à Claude ou Codex.
        review["checks"] = [self.check("live", "claude"), self.check("live", "codex")]
        self.accept("L11", report=review)
        self.claim("L12")

    def test_corrupt_state_is_not_replaced(self):
        self.call("init")
        path = self.root / "coordination/STATE.json"
        path.write_text("{broken", encoding="utf-8")
        self.call("note", "L00", "--agent", "reader", "--message", "test", ok=False)
        self.assertEqual(path.read_text(), "{broken")

    def test_forged_accepted_task_cannot_unlock_dependency(self):
        self.call("init")
        state = self.state()
        state["tasks"]["L00"]["status"] = "accepted"
        path = self.write("coordination/STATE.json", state)
        before = path.read_bytes()
        self.call("claim", "L01", "--agent", "worker-2", ok=False)
        self.assertEqual(before, path.read_bytes())

    def test_in_review_requires_current_attempt_and_author(self):
        token = self.claim()
        handoff_id = self.submit(token=token)
        original = self.state()
        for field, value in (("attempt", 2), ("author", "other-worker")):
            with self.subTest(field=field):
                mutated = json.loads(json.dumps(original))
                mutated["handoffs"][handoff_id][field] = value
                path = self.write("coordination/STATE.json", mutated)
                before = path.read_bytes()
                self.call("status", "L00", ok=False)
                self.call("note", "L00", "--agent", "reader", "--message", "test", ok=False)
                self.assertEqual(before, path.read_bytes())

    def test_accepted_requires_matching_review_and_candidate_revision(self):
        self.complete("L00")
        original = self.state()
        variants = []
        for field, value in (("accepted_review_id", None), ("accepted_revision", "git:" + "f" * 40),
                             ("handoff_id", None)):
            mutated = json.loads(json.dumps(original))
            mutated["tasks"]["L00"][field] = value
            variants.append(mutated)
        without_reviews = json.loads(json.dumps(original))
        without_reviews["reviews"] = {}
        variants.append(without_reviews)
        for index, mutated in enumerate(variants):
            with self.subTest(index=index):
                path = self.write("coordination/STATE.json", mutated)
                before = path.read_bytes()
                self.call("claim", "L01", "--agent", "worker-2", ok=False)
                self.assertEqual(before, path.read_bytes())


if __name__ == "__main__":
    unittest.main(verbosity=2)
