from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sage_square_invoice_poller import (
    existing_invoice_customer,
    is_square_ready,
    open_invoice_ids,
    process_invoice,
)
from sage_square_invoice_bridge import BridgeError
from test_sage_square_invoice_bridge import example_invoice


class SageSquareInvoicePollerTests(unittest.TestCase):
    def test_open_invoice_ids_are_bounded_and_ordered(self) -> None:
        connection = RecordingConnection(
            [{"recnum": 1627}, {"recnum": 1628}, {"recnum": 1629}]
        )
        self.assertEqual(open_invoice_ids(connection, 1627, 2), (1627, 1628))
        self.assertEqual(
            connection.cursor_value.params, (2, 1627, "SQUARE:READY")
        )

    def test_preview_never_creates_a_missing_customer(self) -> None:
        square = RecordingSquare(existing=None, customer=None)
        result = process_invoice(square, ready_invoice(), auto_publish=False)
        self.assertEqual(result["action"], "would_create_customer_and_publish")
        self.assertEqual(square.writes, [])

    def test_auto_publish_creates_customer_draft_and_publishes(self) -> None:
        square = RecordingSquare(existing=None, customer=None)
        result = process_invoice(square, ready_invoice(), auto_publish=True)
        self.assertEqual(result["action"], "published")
        self.assertEqual(square.writes, ["customer", "draft", "publish"])

    def test_existing_published_invoice_is_idempotent(self) -> None:
        existing = square_invoice("UNPAID")
        square = RecordingSquare(
            existing=existing,
            customer={"id": "customer-1", "email_address": "client@example.com"},
        )
        result = process_invoice(square, ready_invoice(), auto_publish=True)
        self.assertEqual(result["action"], "already_published")
        self.assertEqual(square.writes, [])

    def test_existing_invoice_with_wrong_recipient_email_fails_closed(self) -> None:
        existing = square_invoice("DRAFT")
        square = RecordingSquare(
            existing=existing,
            customer={"id": "customer-1", "email_address": "wrong@example.com"},
        )
        with self.assertRaisesRegex(BridgeError, "does not match Sage"):
            process_invoice(square, ready_invoice(), auto_publish=True)
        self.assertEqual(square.writes, [])

    def test_existing_invoice_customer_is_retrieved_from_recipient(self) -> None:
        square = RecordingSquare(existing=None, customer={"id": "customer-1"})
        customer = existing_invoice_customer(square, square_invoice("DRAFT"))
        self.assertEqual(customer["id"], "customer-1")

    def test_invoice_1627_is_skipped_without_square_ready(self) -> None:
        invoice = replace(example_invoice(), sage_invoice_id=1627)
        square = RecordingSquare(existing=None, customer=None)
        result = process_invoice(square, invoice, auto_publish=True)
        self.assertEqual(result["action"], "skipped_not_square_ready")
        self.assertEqual(square.reads, [])
        self.assertEqual(square.writes, [])

    def test_square_ready_requires_the_exact_sage_status(self) -> None:
        self.assertTrue(is_square_ready(ready_invoice()))
        self.assertFalse(
            is_square_ready(replace(example_invoice(), square_status="SquareReady"))
        )
        self.assertFalse(
            is_square_ready(replace(example_invoice(), square_status="SQUARE:HOLD"))
        )

    def test_primary_email_allows_processing_when_general_email_is_blank(self) -> None:
        invoice = replace(
            ready_invoice(),
            sage_customer_email="primary@example.com",
            sage_customer_general_email=None,
            sage_customer_primary_email="primary@example.com",
        )
        square = RecordingSquare(
            existing=None,
            customer={"id": "customer-1", "email_address": "primary@example.com"},
        )
        result = process_invoice(square, invoice, auto_publish=False)
        self.assertEqual(result["action"], "preview")
        self.assertEqual(result["sagePrimaryEmail"], "primary@example.com")


def square_invoice(status: str) -> dict[str, object]:
    invoice = ready_invoice()
    return {
        "id": "invoice-1",
        "version": 1,
        "status": status,
        "location_id": "location-hps",
        "invoice_number": invoice.invoice_number[:20],
        "primary_recipient": {"customer_id": "customer-1"},
        "payment_requests": [
            {"computed_amount_money": {"amount": 690200, "currency": "USD"}}
        ],
    }


def ready_invoice():
    return replace(example_invoice(), square_status="SQUARE:READY")


class RecordingCursor:
    def __init__(self, rows: list[dict[str, int]]) -> None:
        self.rows = rows
        self.params: tuple[object, ...] | None = None

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.params = params

    def fetchall(self) -> list[dict[str, int]]:
        if self.params is None or not isinstance(self.params[0], int):
            return self.rows
        return self.rows[: self.params[0]]


class RecordingConnection:
    def __init__(self, rows: list[dict[str, int]]) -> None:
        self.cursor_value = RecordingCursor(rows)

    def cursor(self, as_dict: bool = False) -> RecordingCursor:
        return self.cursor_value


class RecordingSquare:
    def __init__(
        self,
        existing: dict[str, object] | None,
        customer: dict[str, object] | None,
    ) -> None:
        self.existing = existing
        self.customer = customer
        self.reads: list[str] = []
        self.writes: list[str] = []

    def location_id(self, location_name: str) -> str:
        self.reads.append("location")
        return "location-hps"

    def matching_invoice(self, invoice: object, location_id: str) -> dict[str, object] | None:
        self.reads.append("invoices")
        return self.existing

    def customer_by_email(self, email: str) -> dict[str, object] | None:
        self.reads.append("customer_email")
        return self.customer

    def customer_by_id(self, customer_id: str) -> dict[str, object]:
        self.reads.append("customer_id")
        return self.customer or {"id": customer_id}

    def create_customer(
        self, email: str, sage_customer_id: int, sage_customer_name: str
    ) -> dict[str, object]:
        self.writes.append("customer")
        self.customer = {
            "id": "customer-1",
            "email_address": email,
            "company_name": sage_customer_name,
        }
        return self.customer

    def create_draft(
        self, invoice: object, location_id: str, customer_id: str
    ) -> dict[str, object]:
        self.writes.append("draft")
        self.existing = square_invoice("DRAFT")
        return self.existing

    def publish(
        self, invoice: dict[str, object], sage_invoice_id: int
    ) -> dict[str, object]:
        self.writes.append("publish")
        return square_invoice("UNPAID")


if __name__ == "__main__":
    unittest.main()
