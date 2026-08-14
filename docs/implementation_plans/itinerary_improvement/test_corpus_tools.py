import inspect
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import corpus_tools as tools


def valid_location() -> dict:
    return {"location_id": "loc_test", "name": "Test", "location_type": "city", "priority": 50}


def valid_block(**overrides) -> dict:
    block = {
        "block_id": "blk_test",
        "location_id": "loc_test",
        "zone_id": "z_test",
        "role": "anchor",
        "title": "Test block",
        "interest_weights": {dimension: 5 for dimension in tools.DIMENSIONS},
        "duration_typical": 60,
        "energy_cost": 2,
        "time_fit": {},
        "source": "curated",
        "verified_venue": True,
    }
    block.update(overrides)
    return block


class CorpusToolsTests(unittest.TestCase):
    def make_corpus(self, locations=None, blocks=None, groups=None):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        for name, value in (
            ("locations.json", locations if locations is not None else [valid_location()]),
            ("blocks.json", blocks if blocks is not None else [valid_block()]),
            ("groups.json", groups if groups is not None else []),
        ):
            (root / name).write_text(json.dumps(value), encoding="utf-8")
        return temp, root

    def test_duplicate_ids_are_rejected_instead_of_silently_overwritten(self):
        temp, root = self.make_corpus(blocks=[valid_block(), valid_block(title="Duplicate")])
        with temp, self.assertRaisesRegex(tools.CorpusLoadError, "duplicate block_id"):
            tools.load_corpus(root)

    def test_oversized_file_is_rejected_before_json_decode(self):
        temp, root = self.make_corpus()
        with temp, patch.object(tools, "MAX_FILE_BYTES", 4):
            with self.assertRaisesRegex(tools.CorpusLoadError, "exceeds"):
                tools.load_corpus(root)

    def test_missing_required_corpus_file_is_not_treated_as_empty_clean_data(self):
        temp, root = self.make_corpus()
        with temp:
            (root / "groups.json").unlink()
            with self.assertRaisesRegex(tools.CorpusLoadError, "required file not found"):
                tools.load_corpus(root)

    def test_cross_location_reference_is_an_audit_error(self):
        temp, root = self.make_corpus(blocks=[valid_block(location_id="loc_missing")])
        with temp:
            findings, errors = tools.audit(root)
        self.assertGreater(errors, 0)
        self.assertTrue(any("unknown location" in finding.message for finding in findings))

    def test_promotion_is_read_only_and_requires_evidence(self):
        draft = valid_block(
            source="llm_draft",
            verified_venue=True,
            verification_source="provider:place_123",
            verified_at="2026-01-01",
            reviewed_by="reviewer_123",
        )
        temp, root = self.make_corpus(blocks=[draft])
        with temp:
            before = (root / "blocks.json").read_bytes()
            promotable, blockers = tools.promote(root, ["blk_test"])
            after = (root / "blocks.json").read_bytes()
        self.assertEqual(promotable, ["blk_test"])
        self.assertFalse(any(f.severity == "error" for f in blockers))
        self.assertEqual(before, after)
        self.assertNotIn("force", inspect.signature(tools.promote).parameters)

    def test_plan_manifest_includes_bounded_usage_estimate(self):
        locations = {"loc_test": tools.Location(**valid_location())}
        jobs = tools.plan_jobs(locations, {}, {}, {"loc_test": 100})
        manifest = jobs[0].to_dict()
        self.assertEqual(manifest["kind"], "cold_start")
        self.assertEqual(manifest["estimated_max_usage"], tools.JOB_ESTIMATES["cold_start"])

    def test_demand_rejects_non_finite_values(self):
        with tempfile.TemporaryDirectory() as temp_name:
            path = Path(temp_name) / "demand.json"
            path.write_text('{"loc_test": 1e999}', encoding="utf-8")
            with self.assertRaisesRegex(tools.CorpusLoadError, "outside"):
                tools.load_demand(path)

    def test_checked_in_fixture_keeps_its_expected_qa_failures(self):
        findings, errors = tools.audit(Path(__file__).resolve().parent)
        messages = {finding.message for finding in findings if finding.severity == "error"}
        self.assertGreaterEqual(errors, 1)
        self.assertTrue(any("nightlife>=7" in message for message in messages))
        self.assertTrue(any("members share dominant" in message for message in messages))
        self.assertTrue(any("live members" in message for message in messages))


if __name__ == "__main__":
    unittest.main()
