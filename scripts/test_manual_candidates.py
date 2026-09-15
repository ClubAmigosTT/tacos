import unittest

from import_manual_taco_candidates import (
    address_compatibility,
    compact_name,
    out_of_scope_hint,
    parse_review_count,
    taco_relevance,
)


class ManualCandidateTests(unittest.TestCase):
    def test_normalizes_generic_name_words(self):
        self.assertEqual(compact_name("Taquería Los Güeros"), "los gueros")

    def test_parses_review_counts(self):
        self.assertEqual(parse_review_count("(2.1 K)"), 2100)
        self.assertEqual(parse_review_count("(44 k)"), 44000)
        self.assertIsNone(parse_review_count("No hay opiniones."))

    def test_address_requires_more_than_a_common_word(self):
        self.assertGreaterEqual(address_compatibility("Av. Revolución 722", "avenida revolución 722, Roma"), 0.9)
        self.assertLess(address_compatibility("Av. Revolución", "Av. Insurgentes"), 0.7)

    def test_relevance_prioritizes_taco_name(self):
        score, level = taco_relevance("Tacos Don Pepe", "Restaurante", "", "tacos")
        self.assertGreaterEqual(score, 4)
        self.assertEqual(level, "strong")

    def test_flags_explicit_out_of_scope_city(self):
        self.assertEqual(out_of_scope_hint("Monterrey, N.L."), "monterrey")
        self.assertEqual(out_of_scope_hint("Av. Revolución 722"), "")


if __name__ == "__main__":
    unittest.main()
