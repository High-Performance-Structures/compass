import datetime as dt
import hashlib
import hmac
import sys
import unittest
from decimal import Decimal
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sage_pay_application_poller import (
    CompassHttpError,
    PollerError,
    PollRequest,
    build_snapshot,
    build_tax_catalog_snapshot,
    parse_poll_requests,
    resolve_sage_job,
    signed_json_request_with_fallback,
    signature,
    sync_tax_catalog_safely,
)


class SagePayApplicationPollerTests(unittest.TestCase):
    def test_build_tax_catalog_snapshot_preserves_sage_rate_precision(self) -> None:
        snapshot = build_tax_catalog_snapshot(
            [
                {
                    "recnum": 70206,
                    "dstnme": "07-0206 Boulder County Combined",
                    "sumrte": Decimal("5.1850"),
                }
            ],
            "2026-08-25T18:00:00+00:00",
        )

        self.assertEqual(snapshot["complete"], True)
        self.assertEqual(snapshot["taxDistricts"][0]["code"], "70206")
        self.assertEqual(snapshot["taxDistricts"][0]["ratePercent"], 5.185)

    def test_tax_catalog_failure_is_contained(self) -> None:
        with mock.patch(
            "sage_pay_application_poller.sync_tax_catalog",
            side_effect=PollerError("catalog unavailable"),
        ):
            count, error = sync_tax_catalog_safely(
                "https://compass.example", ["a" * 32]
            )

        self.assertIsNone(count)
        self.assertEqual(error, "catalog unavailable")

    def test_unexpected_tax_catalog_failure_is_contained_and_sanitized(self) -> None:
        with mock.patch(
            "sage_pay_application_poller.sync_tax_catalog",
            side_effect=ValueError("sensitive driver detail"),
        ):
            count, error = sync_tax_catalog_safely(
                "https://compass.example", ["a" * 32]
            )

        self.assertIsNone(count)
        self.assertEqual(error, "Tax catalog sync failed: ValueError")

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
        self.assertTrue(snapshot["header"]["sourceRevision"].startswith("mapping=v4;"))
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
        # Not invoiced in Sage yet.
        self.assertIsNone(snapshot["header"]["invoiceNumber"])

        invoiced = build_snapshot(
            request, {**header, "invnum": " X-100-PR03 "}, lines, "2026-07-01T18:00:00+00:00"
        )
        self.assertEqual(invoiced["header"]["invoiceNumber"], "X-100-PR03")
        # No posted AR invoice and no tax district on an open application.
        self.assertIsNone(snapshot["header"]["invoice"])
        self.assertIsNone(snapshot["header"]["taxDistrict"])
        self.assertFalse(snapshot["lines"][0]["taxable"])

    def test_build_snapshot_carries_posted_invoice_and_taxable_flags(self) -> None:
        request = PollRequest(
            run_id="11111111-1111-4111-8111-111111111111",
            project_id="project-1",
            sage_job_id="620",
            sage_job_number="620",
            claim_token="22222222-2222-4222-8222-222222222222",
        )
        header = {
            "recnum": 21,
            "jobnum": 620,
            "sage_job_id": "job-guid",
            "appnum": 9,
            "period": dt.date(2026, 10, 31),
            "status": 3,
            "schttl": Decimal("1000.00"),
            "chgttl": Decimal("0.00"),
            "conttl": Decimal("1000.00"),
            "cmpttl": Decimal("500.00"),
            "ttlret": Decimal("0.00"),
            "ttlern": Decimal("0.00"),
            "prvbil": Decimal("400.00"),
            "crtdue": Decimal("100.00"),
            "balfin": Decimal("500.00"),
            "upddte": dt.datetime(2026, 11, 1, 9, 0),
            "taxdst": 640001,
            "dstnme": "Example Combined",
            "sumrte": Decimal("8.1500"),
            "slstax": Decimal("8.15"),
            "invttl": Decimal("108.15"),
            "invoice_recnum": 1700,
            "invnum": "X-100-PR09",
            "invoice_invdte": dt.date(2026, 10, 31),
            "invoice_status": 1,
            "invoice_taxdst": 640001,
            "invoice_dstnme": "Example Combined",
            "invoice_sumrte": Decimal("8.1500"),
            "invoice_taxabl": Decimal("100.00"),
            "invoice_nontax": Decimal("0.00"),
            "invoice_slstax": Decimal("8.15"),
            "invoice_retain": Decimal("0.00"),
            "invoice_invttl": Decimal("108.15"),
            "invoice_upddte": dt.datetime(2026, 11, 1, 9, 5),
        }
        line = {
            "recnum": 21,
            "linnum": 1,
            "divnum": 6,
            "master_divnum": 6,
            "cstcde": Decimal("61000.000"),
            "cdenme": "Rough Carpentry",
            "dscrpt": "06 Framing",
            "schamt": Decimal("1000.00"),
            "chgamt": Decimal("0.00"),
            "newcon": Decimal("1000.00"),
            "prvbll": Decimal("400.00"),
            "curbll": Decimal("100.00"),
            "strmat": Decimal("0.00"),
            "ttlcmp": Decimal("500.00"),
            "retamt": Decimal("0.00"),
            "balfin": Decimal("500.00"),
            "upddte": dt.datetime(2026, 11, 1, 9, 0),
            "taxabl": "Y",
        }
        invoice_lines = [
            {"linnum": 1, "dscrpt": "Progress billing", "cstcde": None, "extprc": Decimal("100.00"), "hldamt": Decimal("0.00"), "taxabl": "Y"}
        ]

        snapshot = build_snapshot(
            request, header, [line], "2026-11-01T18:00:00+00:00", invoice_lines
        )

        self.assertTrue(snapshot["lines"][0]["taxable"])
        self.assertEqual(snapshot["header"]["status"], "3")
        self.assertEqual(
            snapshot["header"]["taxDistrict"],
            {"code": "640001", "name": "Example Combined", "ratePercent": 8.15},
        )
        self.assertEqual(snapshot["header"]["invoiceTotal"], 108.15)
        invoice = snapshot["header"]["invoice"]
        self.assertEqual(invoice["sourceInvoiceId"], "sage-acrinv:1700")
        self.assertEqual(invoice["invoiceNumber"], "X-100-PR09")
        self.assertEqual(invoice["invoiceDate"], "2026-10-31")
        self.assertEqual(invoice["salesTax"], 8.15)
        self.assertEqual(invoice["total"], 108.15)
        self.assertEqual(invoice["taxDistrict"]["code"], "640001")
        self.assertEqual(
            invoice["lines"],
            [{"lineNumber": 1, "description": "Progress billing", "costCode": None, "amount": 100.0, "retention": 0.0, "taxable": True}],
        )
        # Posting and the invoice are part of the source revision.
        self.assertIn(";status=3;invoice=2026-11-01T09:05:00+00:00", snapshot["header"]["sourceRevision"])
        unposted = build_snapshot(
            request, {**header, "status": 2, "invoice_recnum": None}, [line], "2026-11-01T18:00:00+00:00"
        )
        self.assertNotEqual(unposted["header"]["sourceRevision"], snapshot["header"]["sourceRevision"])
        self.assertIsNone(unposted["header"]["invoice"])

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

    def test_shared_secret_fallback_only_runs_after_unauthorized(self) -> None:
        with mock.patch(
            "sage_pay_application_poller.signed_json_request",
            side_effect=[CompassHttpError(401, "invalid"), {"requests": []}],
        ) as request:
            payload = signed_json_request_with_fallback(
                "https://compass.example",
                ["dedicated", "shared"],
                "GET",
                "/requests",
            )

        self.assertEqual(payload, {"requests": []})
        self.assertEqual(request.call_count, 2)

    def test_shared_secret_fallback_does_not_mask_server_errors(self) -> None:
        with mock.patch(
            "sage_pay_application_poller.signed_json_request",
            side_effect=CompassHttpError(500, "failed"),
        ) as request:
            with self.assertRaises(CompassHttpError):
                signed_json_request_with_fallback(
                    "https://compass.example",
                    ["dedicated", "shared"],
                    "GET",
                    "/requests",
                )

        self.assertEqual(request.call_count, 1)


if __name__ == "__main__":
    unittest.main()
