import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sage_square_invoice_bridge import (
    BridgeError,
    SageInvoice,
    SageInvoiceLine,
    SquareClient,
    build_square_invoice,
    build_square_order,
    recipient_email,
    route_square_location,
    sage_tax_amount,
    validate_existing_square_invoice,
    validate_invoice,
    validate_square_order_total,
)


def example_invoice() -> SageInvoice:
    return SageInvoice(
        sage_invoice_id=1625,
        invoice_number="H-403-4378 Deck Ren.",
        invoice_date="2026-08-24",
        due_date="2026-09-04",
        sage_job_id=685,
        sage_customer_id=411,
        sage_customer_name="Example Client",
        sage_customer_email="client@example.com",
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

    def test_discounted_invoice_fails_closed(self) -> None:
        invoice = example_invoice()
        invalid = SageInvoice(
            **{
                **invoice.__dict__,
                "total": Decimal("6901.99"),
            }
        )
        with self.assertRaisesRegex(BridgeError, "exceeds"):
            validate_invoice(invalid)

    def test_sage_tax_is_applied_as_an_order_level_tax(self) -> None:
        invoice = example_invoice()
        taxed = SageInvoice(
            **{
                **invoice.__dict__,
                "total": Decimal("7468.00"),
                "balance": Decimal("7468.00"),
            }
        )
        validate_invoice(taxed)
        self.assertEqual(sage_tax_amount(taxed), Decimal("566.00"))
        payload = build_square_order(taxed, "location-hps", "customer-1")
        self.assertEqual(
            payload["order"]["taxes"],
            [
                {
                    "uid": "sage-sales-tax",
                    "name": "Sage sales tax",
                    "type": "ADDITIVE",
                    "percentage": "8.200522",
                    "scope": "ORDER",
                }
            ],
        )

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

    def test_square_order_total_must_match_before_invoice_creation(self) -> None:
        invoice = example_invoice()
        validate_square_order_total(
            {"total_money": {"amount": 690200, "currency": "USD"}}, invoice
        )
        with self.assertRaisesRegex(BridgeError, "total"):
            validate_square_order_total(
                {"total_money": {"amount": 690199, "currency": "USD"}}, invoice
            )

    def test_recipient_defaults_to_sage_and_rejects_conflicting_override(self) -> None:
        invoice = example_invoice()
        self.assertEqual(recipient_email(invoice, None), "client@example.com")
        self.assertEqual(
            recipient_email(invoice, "CLIENT@example.com"), "client@example.com"
        )
        with self.assertRaisesRegex(BridgeError, "does not match"):
            recipient_email(invoice, "other@example.com")

    def test_missing_square_customer_can_be_created_idempotently(self) -> None:
        client = RecordingSquareClient(
            [
                {
                    "customer": {
                        "id": "customer-1",
                        "email_address": "client@example.com",
                    }
                },
            ]
        )
        customer = client.create_customer(
            "client@example.com", 411, "Example Client"
        )
        self.assertEqual(customer["id"], "customer-1")
        self.assertEqual(client.calls[0][0:2], ("POST", "/v2/customers"))
        self.assertEqual(
            client.calls[0][2]["idempotency_key"],
            "sage-client-411-square-customer-v1",
        )
        self.assertEqual(client.calls[0][2]["reference_id"], "sage-client:411")

    def test_customer_lookup_returns_none_when_email_is_missing(self) -> None:
        client = RecordingSquareClient([{"customers": []}])
        self.assertIsNone(client.customer_by_email("client@example.com"))

    def test_customer_creation_requires_a_real_sage_customer_id(self) -> None:
        client = RecordingSquareClient([])
        with self.assertRaisesRegex(BridgeError, "valid Sage customer ID"):
            client.create_customer("client@example.com", 0, "Example Client")
        self.assertEqual(client.calls, [])


class RecordingSquareClient(SquareClient):
    def __init__(self, responses: list[dict[str, object]]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, object]] = []

    def request(
        self, method: str, path: str, body: object = None
    ) -> dict[str, object]:
        self.calls.append((method, path, body))
        return self.responses.pop(0)


if __name__ == "__main__":
    unittest.main()
