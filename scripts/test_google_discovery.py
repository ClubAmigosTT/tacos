"""Offline regressions; never send Google requests."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("discovery", Path(__file__).with_name("discover-google-place-ids.py"))
d = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = d
spec.loader.exec_module(d)


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        d.upgrade_database(self.db)
        self.cell = d.Cell("cdmx", 19, -100, 19.12, -99.88)
        self.args = SimpleNamespace(max_requests=1, max_plan_requests=10, max_queries=None,
                                    compare=False, request_timeout=1, request_delay=0,
                                    min_grid_step=.015, region="cdmx")
        d.enqueue(self.db, "plan", self.cell, "tacos", 0)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def run_pages(self, pages):
        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "fake"}), patch.object(
                d, "response_json_with_retries", side_effect=pages) as request:
            result = d.run(self.db, self.args, "plan", [], {})
        return result, request

    def test_resumes_second_page_and_preserves_ids(self):
        self.run_pages([({"places": [{"id": "one"}], "nextPageToken": "page2"}, None, 1)])
        _, request = self.run_pages([({"places": [{"id": "two"}]}, None, 1)])
        self.assertEqual(request.call_args.args[4], "page2")
        row = self.db.execute("SELECT * FROM google_queries_v2").fetchone()
        self.assertEqual((row["pages"], row["requests"], row["status"]), (2, 2, "completed"))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM google_place_candidates").fetchone()[0], 2)
        self.assertEqual(self.db.execute("SELECT match_status FROM google_place_candidates LIMIT 1").fetchone()[0], "unverified")

    def test_saturation_creates_four_children(self):
        self.args.max_requests = 3
        pages = [({"places": [{"id": f"p{page}-{i}"} for i in range(20)],
                   **({"nextPageToken": str(page+1)} if page < 2 else {})}, None, 1)
                 for page in range(3)]
        self.run_pages(pages)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM google_queries_v2 WHERE depth=1").fetchone()[0], 4)
        self.assertEqual(self.db.execute("SELECT status FROM google_queries_v2 WHERE depth=0").fetchone()[0], "split")

    def test_minimum_cell_remains_saturated(self):
        self.args.min_grid_step = .12
        self.db.execute("UPDATE google_queries_v2 SET pages=2,results=40")
        self.db.commit()
        self.run_pages([({"places": [{"id": str(i)} for i in range(20)]}, None, 1)])
        self.assertEqual(self.db.execute("SELECT status FROM google_queries_v2").fetchone()[0], "saturated")

    def test_plan_budget_and_failed_attempts(self):
        self.args.max_plan_requests = 1
        result, request = self.run_pages([(None, "HTTP 429", 1)])
        self.assertEqual(result, 1)
        self.assertEqual(request.call_count, 1)
        _, request = self.run_pages([])
        self.assertEqual(request.call_count, 0)

    def test_expired_token_restarts_cell(self):
        self.db.execute("UPDATE google_queries_v2 SET page_token='expired',pages=1,results=20")
        self.db.commit()
        self.run_pages([(None, "HTTP 400", 1)])
        row = d.choose_query(self.db, "plan")
        self.assertEqual(row["pages"], 0)
        self.assertIsNone(row["page_token"])

    def test_running_job_is_recovered_and_priority_is_not_alphabetic(self):
        self.db.execute("UPDATE google_queries_v2 SET status='running'")
        d.enqueue(self.db, "plan", self.cell, "barbacoa", 5)
        d.enqueue(self.db, "another", self.cell, "taquería", 0)
        self.assertEqual(d.choose_query(self.db, "plan")["term"], "tacos")

    def test_ids_only_field_mask(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return b'{"places":[]}'
        with patch.object(d.urllib.request, "urlopen", return_value=Response()) as call:
            d.google_search("fake", "tacos", self.cell, False, None, 1)
        self.assertEqual(call.call_args.args[0].get_header("X-goog-fieldmask"), "places.id,nextPageToken")

    def test_matching_unpublished_and_ambiguous_stalls(self):
        branch = d.Branch("denue-1", "Tacos Aurora", "Mercado 10", 19.4, -99.15, "cdmx", "needs_review")
        place = {"displayName": {"text": "Taqueria Aurora"}, "formattedAddress": "Mercado 10",
                 "location": {"latitude": 19.4, "longitude": -99.15}}
        self.assertEqual(d.reconcile_place(place, "cdmx", d.build_spatial_index([branch])).status, "matched_unpublished")
        other = d.Branch("denue-2", "Tacos Aurora", "Mercado 10", 19.4, -99.15, "cdmx")
        self.assertEqual(d.reconcile_place(place, "cdmx", d.build_spatial_index([branch, other])).status, "review")
        place["displayName"]["text"] = "Tacos"
        self.assertEqual(d.reconcile_place(place, "cdmx", d.build_spatial_index([branch])).status, "review")

    def test_new_comparison_can_correct_old_match(self):
        d.save_candidate(self.db, "one", "cdmx", "cdmx", "tacos", d.Match("matched", "b", .9, "old"), d.utc_now())
        d.save_candidate(self.db, "one", "cdmx", "cdmx", "tacos", d.Match("review", None, None, "ambiguous"), d.utc_now())
        d.save_candidate(self.db, "one", "cdmx", "cdmx", "tacos", d.Match("unverified", None, None, "ids_only"), d.utc_now())
        self.assertEqual(self.db.execute("SELECT match_status FROM google_place_candidates").fetchone()[0], "review")

    def test_thin_polygon_intersection(self):
        self.assertTrue(d.segment_intersects_box((-2, .1), (2, .1), -1, -1, 1, 1))
        self.assertFalse(d.segment_intersects_box((-2, 2), (2, 2), -1, -1, 1, 1))

    def test_legacy_missing_not_exported_as_current(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(**{name: str(Path(folder)/filename) for name, filename in
                (("output_json","report.json"),("output_csv","report.csv"),
                 ("missing_ids","missing.txt"),("review_ids","review.txt"))})
            d.save_candidate(self.db, "old-id", "cdmx", "cdmx", "tacos", d.Match("missing", None, None, "old"), d.utc_now())
            self.db.execute("UPDATE google_place_candidates SET comparison_version=1")
            d.report(self.db, args, "plan", [])
            self.assertEqual(Path(args.missing_ids).read_text(), "")
            self.assertEqual(json.loads(Path(args.output_json).read_text())["counts"], {"unverified": 1})


if __name__ == "__main__":
    unittest.main()
