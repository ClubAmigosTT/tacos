import unittest

from publish_manual_candidates import candidate_is_publishable, to_catalog_row


class ManualPublicationTests(unittest.TestCase):
    def test_requires_high_confidence_geocode_and_taco_signal(self):
        candidate = {
            "candidate_id": "manual-example",
            "name": "Los Tacos",
            "category": "Tacos",
            "status": "missing_candidate",
            "relevance": "strong",
            "geocode_status": "geocoded",
            "geocode_score": 0.99,
            "geocode_name_score": 1.0,
            "geocode_address_score": 0.98,
            "latitude": 19.4,
            "longitude": -99.16,
            "address": "Av. Reforma 10",
        }
        self.assertEqual(candidate_is_publishable(candidate)[0], True)

    def test_holds_address_only_coordinates(self):
        candidate = {
            "name": "Los Tacos",
            "category": "Tacos",
            "status": "missing_candidate",
            "relevance": "strong",
            "geocode_status": "address_only_review",
            "latitude": 19.4,
            "longitude": -99.16,
            "address": "Av. Reforma 10",
        }
        self.assertEqual(candidate_is_publishable(candidate)[0], False)

    def test_does_not_publish_generic_restaurant_without_taco_signal(self):
        candidate = {
            "name": "La Coyoacana",
            "category": "Mexicana",
            "status": "missing_candidate",
            "relevance": "strong",
            "geocode_status": "geocoded",
            "geocode_score": 0.99,
            "geocode_name_score": 1.0,
            "geocode_address_score": 0.98,
            "latitude": 19.4,
            "longitude": -99.16,
            "address": "Higuera 14",
        }
        self.assertEqual(candidate_is_publishable(candidate)[0], False)

    def test_catalog_row_omits_external_rating_and_photos(self):
        row = to_catalog_row({
            "candidate_id": "manual-example",
            "name": "Los Tacos",
            "source_area": "Coyoacán",
            "address": "Av. Reforma 10",
            "latitude": 19.4,
            "longitude": -99.16,
            "category": "Tacos",
        }, "2026-09-15T00:00:00+00:00")
        self.assertEqual(row["rating"], 0)
        self.assertEqual(row["reviewCount"], 0)
        self.assertEqual(row["image"], "")
        self.assertEqual(row["hoursKnown"], False)
        self.assertEqual(row["id"], "manual-example")


if __name__ == "__main__":
    unittest.main()
