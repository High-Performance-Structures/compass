import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sage_employee_reader import ReaderError, build_snapshot, fetch_employees, parse_due  # noqa: E402

GUID_A = "0F8FAD5B-D9CB-469F-A165-70867728950E"
GUID_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7"


class FakeCursor:
    def __init__(self) -> None:
        self.queries: list[str] = []

    def execute(self, query: str, params: tuple = ()) -> None:
        self.queries.append(query)

    def fetchall(self) -> list:
        return [{"recnum": Decimal("12.0"), "_idnum": GUID_A, "fstnme": "Sam", "lstnme": "Sample",
                 "e_mail": " Sam@Example.test ", "status": 1, "inactv": 0}]


class SageEmployeeReaderTest(unittest.TestCase):
    def test_reads_with_one_select_and_no_pay_columns(self) -> None:
        cursor = FakeCursor()
        fetch_employees(cursor)
        self.assertEqual(len(cursor.queries), 1)
        query = cursor.queries[0].strip().upper()
        self.assertTrue(query.startswith("SELECT"))
        for column in ("PAYRTE", "SOCSEC", "ADDR"):
            self.assertNotIn(column, query)

    def test_snapshot_normalizes_ids_emails_and_status(self) -> None:
        snapshot = build_snapshot(
            [
                {"recnum": Decimal("12.0"), "_idnum": GUID_A, "fstnme": "Sam ", "lstnme": "Sample",
                 "e_mail": " Sam@Example.test ", "status": 1, "inactv": 0},
                {"recnum": 12, "_idnum": GUID_B, "fstnme": "Dup", "lstnme": "Number", "e_mail": None, "status": 1, "inactv": 0},
                {"recnum": 13, "_idnum": GUID_B, "fstnme": "", "lstnme": None, "e_mail": "", "status": Decimal("2"), "inactv": 1},
                {"recnum": 14, "_idnum": None, "fstnme": "No", "lstnme": "Guid", "e_mail": None, "status": 1, "inactv": 0},
            ],
            "2026-11-10T00:00:00+00:00",
        )
        self.assertEqual(
            snapshot["employees"],
            [
                {"sageRecordId": GUID_A.lower(), "sageEmployeeNumber": "12", "firstName": "Sam", "lastName": "Sample",
                 "email": "sam@example.test", "status": 1, "inactive": False},
                {"sageRecordId": GUID_B, "sageEmployeeNumber": "13", "firstName": None, "lastName": None,
                 "email": None, "status": 2, "inactive": True},
            ],
        )

    def test_empty_read_is_an_error(self) -> None:
        with self.assertRaises(ReaderError):
            build_snapshot([], "2026-11-10T00:00:00+00:00")

    def test_due_answer_is_validated(self) -> None:
        self.assertTrue(parse_due({"due": True, "reason": "interval"}))
        with self.assertRaises(ReaderError):
            parse_due({"due": "yes"})


if __name__ == "__main__":
    unittest.main()
