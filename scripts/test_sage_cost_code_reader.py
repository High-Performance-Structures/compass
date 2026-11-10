import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sage_cost_code_reader import ReaderError, build_snapshot, fetch_cost_codes, parse_due  # noqa: E402


class FakeCursor:
    def __init__(self) -> None:
        self.queries: list[str] = []

    def execute(self, query: str, params: tuple = ()) -> None:
        self.queries.append(query)

    def fetchall(self) -> list:
        return [{"recnum": Decimal("9300115.0"), "cdenme": "09 30 01.15 - Tub/Shower "}]


class SageCostCodeReaderTest(unittest.TestCase):
    def test_reads_with_one_select(self) -> None:
        cursor = FakeCursor()
        rows = fetch_cost_codes(cursor)
        self.assertEqual(len(cursor.queries), 1)
        self.assertTrue(cursor.queries[0].strip().upper().startswith("SELECT"))
        self.assertEqual(rows[0]["cdenme"], "09 30 01.15 - Tub/Shower ")

    def test_snapshot_sends_record_numbers_and_names_once(self) -> None:
        snapshot = build_snapshot(
            [
                {"recnum": Decimal("9300115.0"), "cdenme": "09 30 01.15 - Tub/Shower "},
                {"recnum": 9300115.0, "cdenme": "duplicate"},
                {"recnum": 34, "cdenme": "Company Overhead"},
                {"recnum": None, "cdenme": "no number"},
            ],
            "2026-11-10T00:00:00+00:00",
        )
        self.assertEqual(
            snapshot["costCodes"],
            [
                {"recordNumber": "9300115", "name": "09 30 01.15 - Tub/Shower"},
                {"recordNumber": "34", "name": "Company Overhead"},
            ],
        )

    def test_empty_read_is_an_error(self) -> None:
        with self.assertRaises(ReaderError):
            build_snapshot([], "2026-11-10T00:00:00+00:00")

    def test_due_answer_is_validated(self) -> None:
        self.assertTrue(parse_due({"due": True, "reason": "interval"}))
        self.assertFalse(parse_due({"due": False}))
        with self.assertRaises(ReaderError):
            parse_due({"due": "yes"})


if __name__ == "__main__":
    unittest.main()
