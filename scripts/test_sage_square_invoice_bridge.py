import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sage_square_invoice_bridge import (
    BridgeError,
    SageInvoice,
    SageInvoiceLine,
    build_square_invoice,
    build_square_order,
    route_square_location,
    validate_existing_square_invoice,
    validate_invoice,
)


def example_invoice() -> SageInvoice:
    return SageInvoice(
        sage_invoice_id=1625,
        invoice_number="H-403-4378 Deck Ren.",
        invoice_date="2026-08-24",
        due_date="2026-09-04",
        sage_job_id=685,
        job_name="H-403-4378 CR 102 - Stockbridge Sunroom",
        job_short_name="H-403-4378",
        sage_department=None,
        status=1,
        total=Decimal("6902.00"),
        balance=Decimal("6902.00"),
        lines=(
            SageInvoiceLine(1, "Conduit", "Patio Renovation", Decimal("1"), Decimal("470.00")),
            SageInvoiceLine(2, "Remaining work", "Patio Renovation", Decimal("1"), Decimal("6432.00")),
        ),
    )


class SageSquareInvoiceBridgeTests(unittest.TestCase):
    def test_routes_all_department_prefixes(self) -> None:
        cases = {
            "H-100": ("H", "HPS"),
            "O-100": ("O", "ORC"),
            "N-100": ("N", "Nu-Tech"),
            "D-100": ("D", "ORC"),
        }
        for job, expected in cases.items():
            with self.subTest(job=job):
                self.assertEqual(route_square_location(job, job, None), expected)

    def test_known_sage_department_conflict_fails_closed(self) -> None:
        with self.assertRaisesRegex(BridgeError, "conflicts"):
            route_square_location("H-403-4378", "H-403-4378", "1")

    def test_unknown_job_prefix_fails_closed(self) -> None:
        with self.assertRaisesRegex(BridgeError, "must begin"):
            route_square_location("403-4378", "Stockbridge", None)

    def test_invoice_total_must_equal_line_total(self) -> None:
        invoice = example_invoice()
        invalid = SageInvoice(
            **{
                **invoice.__dict__,
                "total": Decimal("6901.99"),
            }
        )
        with self.assertRaisesRegex(BridgeError, "does not match"):
            validate_invoice(invalid)

    def test_square_payloads_are_idempotent_and_auditable(self) -> None:
        invoice = example_invoice()
        order = build_square_order(invoice, "location-hps", "customer-1")
        self.assertEqual(order["idempotency_key"], "sage-ar-order-1625")
        self.assertEqual(order["order"]["reference_id"], "sage-ar-invoice:1625")
        self.assertEqual(order["order"]["line_items"][0]["base_price_money"]["amount"], 47000)

        payload = build_square_invoice(
            invoice, "location-hps", "order-1", "customer-1"
        )
        self.assertEqual(payload["idempotency_key"], "sage-ar-invoice-1625")
        self.assertEqual(payload["invoice"]["delivery_method"], "EMAIL")
        self.assertEqual(payload["invoice"]["payment_requests"][0]["due_date"], "2026-09-04")
        self.assertEqual(payload["invoice"]["custom_fields"][1]["value"], "1625")

    def test_existing_square_draft_must_match_route_recipient_and_total(self) -> None:
        invoice = example_invoice()
        draft = {
            "location_id": "location-hps",
            "invoice_number": invoice.invoice_number[:20],
            "primary_recipient": {"customer_id": "customer-1"},
            "payment_requests": [
                {"computed_amount_money": {"amount": 690200, "currency": "USD"}}
            ],
        }
        validate_existing_square_invoice(
            draft, invoice, "location-hps", "customer-1"
        )
        draft["payment_requests"][0]["computed_amount_money"]["amount"] = 690199
        with self.assertRaisesRegex(BridgeError, "total"):
            validate_existing_square_invoice(
                draft, invoice, "location-hps", "customer-1"
            )


if __name__ == "__main__":
    unittest.main()
