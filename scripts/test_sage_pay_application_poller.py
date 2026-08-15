import datetime as dt
import hashlib
import hmac
import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sage_pay_application_poller import (
    PollRequest,
    build_snapshot,
    parse_poll_requests,
    resolve_sage_job,
    signature,
)


class SagePayApplicationPollerTests(unittest.TestCase):
    def test_signature_matches_compass_contract(self) -> None:
        actual = signature(
            "a" * 32,
            "1720000000",
            "00000000-0000-4000-8000-000000000000",
            "GET",
            "/api/example?limit=10",
            "",
        )
        payload = (
            "1720000000.00000000-0000-4000-8000-000000000000."
            "GET./api/example?limit=10."
        )
        expected = hmac.new(
            ("a" * 32).encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        self.assertEqual(actual, f"sha256={expected}")

    def test_build_snapshot_maps_native_aia_fields(self) -> None:
        request = PollRequest(
            run_id="11111111-1111-4111-8111-111111111111",
            project_id="project-1",
            sage_job_id="620",
            sage_job_number="O-170-2684",
            claim_token="22222222-2222-4222-8222-222222222222",
        )
        header = {
            "recnum": 13,
            "jobnum": 620,
            "sage_job_id": "78021b5e-5342-f111-a841-bccd992bc5d1",
            "appnum": 3,
            "period": dt.date(2026, 6, 30),
            "status": 5,
            "schttl": Decimal("100.00"),
            "chgttl": Decimal("10.00"),
            "conttl": Decimal("110.00"),
            "cmpttl": Decimal("70.00"),
            "ttlret": Decimal("5.00"),
            # Sage leaves this field empty/zero on live AIA headers.
            "ttlern": Decimal("0.00"),
            "prvbil": Decimal("20.00"),
            "crtdue": Decimal("45.00"),
            "balfin": Decimal("45.00"),
            "upddte": dt.datetime(2026, 7, 1, 12, 0),
        }
        lines = [
            {
                "recnum": 13,
                "linnum": 1,
                "divnum": None,
                "master_divnum": 3,
                "cstcde": Decimal("31200000.000"),
                "cdenme": "Concrete",
                "dscrpt": "Foundations",
                "schamt": Decimal("100.00"),
                "chgamt": Decimal("10.00"),
                "newcon": Decimal("110.00"),
                "prvbll": Decimal("20.00"),
                "curbll": Decimal("50.00"),
                "strmat": Decimal("0.00"),
                "ttlcmp": Decimal("70.00"),
                "retamt": Decimal("5.00"),
                "balfin": Decimal("45.00"),
                "upddte": dt.datetime(2026, 7, 1, 12, 1),
            }
        ]

        snapshot = build_snapshot(
            request, header, lines, "2026-07-01T18:00:00+00:00"
        )

        self.assertEqual(snapshot["header"]["sourceApplicationId"], "sage-aiafrm:13")
        self.assertTrue(snapshot["header"]["sourceRevision"].startswith("mapping=v2;"))
        self.assertEqual(
            snapshot["header"]["sageJobId"],
            "78021b5e-5342-f111-a841-bccd992bc5d1",
        )
        self.assertEqual(snapshot["header"]["sageJobNumber"], "620")
        self.assertEqual(snapshot["header"]["totalEarnedLessRetainage"], 65.0)
        self.assertEqual(snapshot["header"]["currentPaymentDue"], 45.0)
        self.assertEqual(snapshot["lines"][0]["csiDivision"], "03")
        self.assertEqual(snapshot["lines"][0]["totalChanges"], 10.0)
        self.assertEqual(snapshot["lines"][0]["retainageHeld"], 5.0)

    def test_buildertrend_style_special_cost_codes_use_description_division(self) -> None:
        request = PollRequest(
            run_id="11111111-1111-4111-8111-111111111111",
            project_id="project-1",
            sage_job_id="620",
            sage_job_number="O-170-2684",
            claim_token="22222222-2222-4222-8222-222222222222",
        )
        header = {
            "recnum": 13,
            "jobnum": 620,
            "sage_job_id": 2630,
            "appnum": 3,
            "period": dt.date(2026, 6, 30),
            "status": 5,
            "schttl": 300,
            "chgttl": 0,
            "conttl": 300,
            "cmpttl": 0,
            "ttlret": 0,
            "ttlern": 0,
            "prvbil": 0,
            "crtdue": 0,
            "balfin": 300,
            "upddte": dt.datetime(2026, 7, 1, 12, 0),
        }
        lines = [
            {
                "recnum": 13,
                "linnum": 1,
                "divnum": None,
                "master_divnum": 100,
                "cstcde": Decimal("11.000"),
                "cdenme": "00 31 21.19 - Photographic Information",
                "dscrpt": "00 31 21.19 - Photographic Information",
                "schamt": 300,
                "chgamt": 0,
                "newcon": 300,
                "prvbll": 0,
                "curbll": 0,
                "strmat": 0,
                "ttlcmp": 0,
                "retamt": 0,
                "balfin": 300,
                "upddte": dt.datetime(2026, 7, 1, 12, 1),
            }
        ]

        snapshot = build_snapshot(
            request, header, lines, "2026-07-01T18:00:00+00:00"
        )
        self.assertEqual(snapshot["lines"][0]["csiDivision"], "00")

    def test_parse_requests_rejects_incomplete_claims(self) -> None:
        with self.assertRaisesRegex(Exception, "incomplete"):
            parse_poll_requests({"requests": [{"id": "run-only"}]})

    def test_sage_job_number_is_the_aia_job_key(self) -> None:
        request = PollRequest(
            run_id="11111111-1111-4111-8111-111111111111",
            project_id="project-1",
            sage_job_id="2630",
            sage_job_number="620",
            claim_token="22222222-2222-4222-8222-222222222222",
        )
        self.assertEqual(resolve_sage_job(request), 620)


if __name__ == "__main__":
    unittest.main()
