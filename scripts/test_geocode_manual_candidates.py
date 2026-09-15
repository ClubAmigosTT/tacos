import unittest

from geocode_manual_candidates import useful_address


class ManualGeocodeTests(unittest.TestCase):
    def test_requires_street_and_number(self):
        self.assertTrue(useful_address("Av. Revolución 722"))
        self.assertTrue(useful_address("Pilares 27-Loc C"))

    def test_rejects_incomplete_addresses(self):
        self.assertFalse(useful_address("Parque"))
        self.assertFalse(useful_address("Av San Nicolás"))
        self.assertFalse(useful_address("C. 10"))


if __name__ == "__main__":
    unittest.main()
