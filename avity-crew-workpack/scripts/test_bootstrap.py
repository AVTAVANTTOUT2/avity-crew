#!/usr/bin/env python3
"""Tests du helper de préparation, uniquement dans des dossiers temporaires."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("bootstrap.py")
spec = importlib.util.spec_from_file_location("crew_bootstrap", SCRIPT)
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name) / "projet avec espaces"
        self.pack = self.repo / "avity-crew-workpack"
        self.pack.mkdir(parents=True)
        (self.pack / "agent.md").write_text("Consignes", encoding="utf-8")
        (self.pack / "COORDINATION.md").write_text("Coordination", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def plan(self):
        return boot.make_plan(self.repo, self.pack)[2]

    def test_plan_does_not_write_root(self):
        self.plan()
        self.assertFalse((self.repo / "AGENTS.md").exists())
        self.assertFalse((self.pack / "coordination").exists())

    def test_preserves_existing_and_is_idempotent(self):
        original = "# Instructions existantes\nConserver les choix utilisateur.\n"
        (self.repo / "AGENTS.md").write_text(original, encoding="utf-8")
        backup = boot.apply_plan(self.pack, self.plan())
        actual = (self.repo / "AGENTS.md").read_text(encoding="utf-8")
        self.assertTrue(actual.startswith(original))
        self.assertEqual(actual.count(boot.START), 1)
        self.assertEqual((backup / "AGENTS.md").read_text(encoding="utf-8"), original)
        plan = self.plan()
        self.assertTrue(all(item["action"] == "unchanged" for item in plan))
        self.assertIsNone(boot.apply_plan(self.pack, plan))

    def test_malformed_marker_refuses_before_any_mutation(self):
        (self.repo / "CLAUDE.md").write_text(boot.START + "\nfragment", encoding="utf-8")
        with self.assertRaises(boot.BootstrapError):
            self.plan()
        self.assertFalse((self.repo / "AGENTS.md").exists())

    def test_symlink_target_refused(self):
        external = Path(self.temp.name) / "external.md"
        external.write_text("à préserver", encoding="utf-8")
        (self.repo / "AGENTS.md").symlink_to(external)
        with self.assertRaises(boot.BootstrapError):
            self.plan()
        self.assertEqual(external.read_text(encoding="utf-8"), "à préserver")

    def test_outside_pack_refused(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        with self.assertRaises(boot.BootstrapError):
            boot.make_plan(self.repo, outside)

    def test_concurrent_change_refused(self):
        plan = self.plan()
        (self.repo / "AGENTS.md").write_text("Autre travail", encoding="utf-8")
        with self.assertRaises(boot.BootstrapError):
            boot.apply_plan(self.pack, plan)
        self.assertFalse((self.repo / "CLAUDE.md").exists())
        self.assertEqual((self.repo / "AGENTS.md").read_text(encoding="utf-8"), "Autre travail")

    def test_gitignore_preserved(self):
        (self.repo / ".gitignore").write_text("node_modules/\n.env\n", encoding="utf-8")
        boot.apply_plan(self.pack, self.plan())
        value = (self.repo / ".gitignore").read_text(encoding="utf-8")
        self.assertTrue(value.startswith("node_modules/\n.env\n"))
        self.assertIn("/avity-crew-workpack/coordination/STATE.json", value)

    def test_multiple_markers_refused(self):
        (self.repo / "agent.md").write_text(
            boot.START + boot.END + boot.START + boot.END, encoding="utf-8")
        with self.assertRaises(boot.BootstrapError):
            self.plan()


if __name__ == "__main__":
    unittest.main(verbosity=2)

