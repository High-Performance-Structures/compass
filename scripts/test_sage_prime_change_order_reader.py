import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sage_prime_change_order_reader import (  # noqa: E402
    ReaderError,
    build_snapshot,
    cents,
    fetch_change_orders,
    parse_jobs,
    record_number,
)


class FakeCursor:
    def __init__(self) -> None:
        self.queries: list[str] = []
        self.results = [[{"recnum": 1}], [{"recnum": 1, "linnum": 1}]]

    def execute(self, query: str, params: tuple) -> None:
        self.queries.append(query)

    def fetchall(self) -> list:
        return self.results.pop(0)


class SagePrimeChangeOrderReaderTests(unittest.TestCase):
    def test_amounts_and_record_numbers(self) -> None:
        self.assertEqual(cents(Decimal("331.29")), 33129)
        self.assertEqual(cents(Decimal("-12.505")), -1251)
        self.assertEqual(record_number(Decimal("1310000.0")), "1310000")
        self.assertEqual(record_number(48), "48")

    def test_parse_jobs_rejects_bad_job_numbers(self) -> None:
        self.assertEqual(parse_jobs({"jobs": [{"projectId": "p1", "sageJobNumber": "722"}]}), [{"projectId": "p1", "sageJobNumber": "722"}])
        with self.assertRaises(ReaderError):
            parse_jobs({"jobs": [{"projectId": "p1", "sageJobNumber": "72a"}]})

    def test_snapshot_groups_lines_under_their_change_order_and_job(self) -> None:
        snapshot = build_snapshot(
            [{"projectId": "p1", "sageJobNumber": "100"}, {"projectId": "p2", "sageJobNumber": "200"}],
            [{"recnum": 7, "chgnum": "V-001", "chgdte": "2026-01-02", "jobnum": 100, "dscrpt": "V-001 Example", "status": 1, "appamt": Decimal("10.50"), "aprdte": None}],
            [{"recnum": 7, "linnum": 1, "dscrpt": "Line", "aprprc": Decimal("10.50"), "cstcde": Decimal("1310000.0"), "csttyp": 5}],
            "2026-01-03T00:00:00+00:00",
        )
        first, second = snapshot["jobs"]
        self.assertEqual(first["changeOrders"][0]["sageRecordId"], "7")
        self.assertEqual(first["changeOrders"][0]["approvedAmountCents"], 1050)
        self.assertEqual(first["changeOrders"][0]["lines"][0]["costCode"], "1310000")
        self.assertEqual(second["changeOrders"], [])

    def test_reader_only_selects(self) -> None:
        cursor = FakeCursor()
        fetch_change_orders(cursor, [100])
        for query in cursor.queries:
            self.assertTrue(query.strip().upper().startswith("SELECT"))
            for word in ("INSERT", "UPDATE", "DELETE", "MERGE", "EXEC"):
                self.assertNotIn(word, query.upper())


if __name__ == "__main__":
    unittest.main()
