#!/usr/bin/env python3
"""Create and publish Square invoices from read-only Sage A/R invoices.

The command is intentionally two-phase. Preview is the default and never
writes to Square. ``--create-draft`` creates an order and draft invoice, while
``--publish`` only publishes a previously-created matching draft.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Mapping, Sequence


DEFAULT_SAGE_SERVER = "100.100.201.24"
DEFAULT_SAGE_PORT = 14330
DEFAULT_SAGE_DATABASE = "High Performance Structures Inc"
DEFAULT_SAGE_USERNAME = "hps_jarvis_readonly"
SAGE_SQL_APP_NAME = "Sage100Contractor¦JarvisCompassPayAppRO"
SQUARE_API_VERSION = "2026-08-19"
SQUARE_PRODUCTION_ORIGIN = "https://connect.squareup.com"
SQUARE_SANDBOX_ORIGIN = "https://connect.squareupsandbox.com"

PREFIX_TO_LOCATION_NAME = {
    "H": "HPS",
    "O": "ORC",
    "N": "Nu-Tech",
    "D": "ORC",
}

# Historical populated Sage values. Most active Sage jobs currently leave
# dptmnt blank, so the job prefix remains authoritative.
KNOWN_SAGE_DEPARTMENT_PREFIX = {
    "1": "N",
    "4": "O",
    "5": "D",
}


class BridgeError(RuntimeError):
    pass


@dataclass(frozen=True)
class SageInvoiceLine:
    line_number: int
    name: str
    description: str | None
    quantity: Decimal
    amount: Decimal


@dataclass(frozen=True)
class SageInvoice:
    sage_invoice_id: int
    invoice_number: str
    invoice_date: str
    due_date: str
    sage_job_id: int
    job_name: str
    job_short_name: str
    sage_department: str | None
    status: int
    total: Decimal
    balance: Decimal
    lines: tuple[SageInvoiceLine, ...]


def text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def iso_date(value: Any) -> str:
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    normalized = text(value)
    if normalized is None:
        raise BridgeError("Sage invoice is missing a required date")
    return normalized[:10]


def decimal_money(value: Any) -> Decimal:
    try:
        return Decimal(str(value or "0")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
    except Exception as error:
        raise BridgeError("Sage invoice contains an invalid monetary value") from error


def square_cents(value: Decimal) -> int:
    return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def square_quantity(value: Decimal) -> str:
    normalized = value.normalize()
    rendered = format(normalized, "f")
    return rendered if rendered != "-0" else "0"


def clean_line_text(value: Any) -> str | None:
    normalized = text(value)
    if normalized is None:
        return None
    return " ".join(normalized.replace("|", " ").split())


def job_prefix(job_short_name: str, job_name: str) -> str:
    for candidate in (job_short_name, job_name):
        match = re.match(r"^\s*([A-Za-z])(?:-|\s|$)", candidate)
        if match:
            prefix = match.group(1).upper()
            if prefix in PREFIX_TO_LOCATION_NAME:
                return prefix
    raise BridgeError(
        "Sage job name must begin with H-, O-, N-, or D- before it can route to Square"
    )


def route_square_location(
    job_short_name: str,
    job_name: str,
    sage_department: str | None,
) -> tuple[str, str]:
    prefix = job_prefix(job_short_name, job_name)
    normalized_department = text(sage_department)
    known_prefix = (
        KNOWN_SAGE_DEPARTMENT_PREFIX.get(normalized_department)
        if normalized_department is not None
        else None
    )
    if known_prefix is not None and known_prefix != prefix:
        raise BridgeError(
            f"Sage department {normalized_department} conflicts with job prefix {prefix}"
        )
    return prefix, PREFIX_TO_LOCATION_NAME[prefix]


def build_square_order(invoice: SageInvoice, location_id: str, customer_id: str) -> dict[str, Any]:
    line_items = [
        {
            "name": line.name[:512],
            # Sage extprc is the authoritative extended line amount. Use one
            # Square unit so fractional Sage quantities cannot introduce a
            # cent-rounding difference in the invoice total.
            "quantity": "1",
            "base_price_money": {
                "amount": square_cents(line.amount),
                "currency": "USD",
            },
            **(
                {
                    "note": (
                        f"{line.description}; Sage quantity {square_quantity(line.quantity)}"
                        if line.quantity != 1
                        else line.description
                    )[:500]
                }
                if line.description is not None and line.description != line.name
                else {}
            ),
        }
        for line in invoice.lines
    ]
    return {
        "idempotency_key": f"sage-ar-order-{invoice.sage_invoice_id}",
        "order": {
            "location_id": location_id,
            "customer_id": customer_id,
            "reference_id": f"sage-ar-invoice:{invoice.sage_invoice_id}",
            "line_items": line_items,
        },
    }


def build_square_invoice(
    invoice: SageInvoice,
    location_id: str,
    order_id: str,
    customer_id: str,
) -> dict[str, Any]:
    return {
        "idempotency_key": f"sage-ar-invoice-{invoice.sage_invoice_id}",
        "invoice": {
            "location_id": location_id,
            "order_id": order_id,
            "primary_recipient": {"customer_id": customer_id},
            "payment_requests": [
                {
                    "request_type": "BALANCE",
                    "due_date": invoice.due_date,
                    "tipping_enabled": False,
                }
            ],
            "accepted_payment_methods": {
                "card": True,
                "square_gift_card": False,
                "bank_account": False,
                "buy_now_pay_later": False,
                "cash_app_pay": False,
            },
            "delivery_method": "EMAIL",
            "invoice_number": invoice.invoice_number[:20],
            "title": invoice.job_short_name[:100],
            "description": (
                f"Sage invoice {invoice.invoice_number}. "
                f"Source record {invoice.sage_invoice_id}."
            )[:65536],
            "sale_or_service_date": invoice.invoice_date,
            "custom_fields": [
                {
                    "label": "Sage Job",
                    "value": invoice.job_short_name[:255],
                    "placement": "ABOVE_LINE_ITEMS",
                },
                {
                    "label": "Sage Record",
                    "value": str(invoice.sage_invoice_id),
                    "placement": "BELOW_LINE_ITEMS",
                },
            ],
        },
    }


def validate_invoice(invoice: SageInvoice) -> None:
    if invoice.status != 1:
        raise BridgeError(
            f"Sage invoice {invoice.sage_invoice_id} is not open (status {invoice.status})"
        )
    if invoice.total <= 0 or invoice.balance <= 0:
        raise BridgeError("Sage invoice must have a positive total and open balance")
    if not invoice.lines:
        raise BridgeError("Sage invoice has no billable line items")
    line_total = sum((line.amount for line in invoice.lines), Decimal("0.00"))
    if line_total.quantize(Decimal("0.01")) != invoice.total:
        raise BridgeError(
            f"Sage line total {line_total:.2f} does not match invoice total {invoice.total:.2f}"
        )


def load_sage_invoice(connection: Any, sage_invoice_id: int) -> SageInvoice:
    cursor = connection.cursor(as_dict=True)
    cursor.execute(
        """
        SELECT i.recnum, i.invnum, i.invdte, i.duedte, i.jobnum, i.status,
               i.invttl, i.invbal, j.jobnme, j.shtnme, j.dptmnt
        FROM dbo.acrinv i
        LEFT JOIN dbo.actrec j ON j.recnum = i.jobnum
        WHERE i.recnum = %s
        """,
        (sage_invoice_id,),
    )
    row = cursor.fetchone()
    if row is None:
        raise BridgeError(f"Sage invoice {sage_invoice_id} was not found")

    cursor.execute(
        """
        SELECT linnum, dscrpt, ntetxt, linqty, extprc
        FROM dbo.arivln
        WHERE recnum = %s
        ORDER BY linnum
        """,
        (sage_invoice_id,),
    )
    lines: list[SageInvoiceLine] = []
    for line in cursor.fetchall():
        amount = decimal_money(line.get("extprc"))
        if amount == 0:
            continue
        quantity = Decimal(str(line.get("linqty") or "1"))
        if quantity <= 0:
            raise BridgeError("Sage invoice contains a non-positive line quantity")
        note = clean_line_text(line.get("ntetxt"))
        category = clean_line_text(line.get("dscrpt"))
        lines.append(
            SageInvoiceLine(
                line_number=int(line.get("linnum") or len(lines) + 1),
                name=note or category or f"Sage line {len(lines) + 1}",
                description=category,
                quantity=quantity,
                amount=amount,
            )
        )

    invoice = SageInvoice(
        sage_invoice_id=sage_invoice_id,
        invoice_number=text(row.get("invnum")) or str(sage_invoice_id),
        invoice_date=iso_date(row.get("invdte")),
        due_date=iso_date(row.get("duedte")),
        sage_job_id=int(row.get("jobnum") or 0),
        job_name=text(row.get("jobnme")) or "",
        job_short_name=text(row.get("shtnme")) or text(row.get("jobnme")) or "",
        sage_department=text(row.get("dptmnt")),
        status=int(row.get("status") or 0),
        total=decimal_money(row.get("invttl")),
        balance=decimal_money(row.get("invbal")),
        lines=tuple(lines),
    )
    validate_invoice(invoice)
    return invoice


class SquareClient:
    def __init__(self, access_token: str, origin: str) -> None:
        self._access_token = access_token
        self._origin = origin.rstrip("/")

    def request(
        self,
        method: str,
        path: str,
        body: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        raw_body = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            f"{self._origin}{path}",
            data=raw_body,
            method=method,
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Square-Version": SQUARE_API_VERSION,
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                value = json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:2000]
            raise BridgeError(f"Square returned HTTP {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            raise BridgeError(f"Square request failed: {error.reason}") from error
        if not isinstance(value, dict):
            raise BridgeError("Square returned an invalid response")
        return value

    def location_id(self, location_name: str) -> str:
        value = self.request("GET", "/v2/locations")
        matches = [
            location
            for location in value.get("locations", [])
            if isinstance(location, dict)
            and location.get("name") == location_name
            and location.get("status") == "ACTIVE"
        ]
        if len(matches) != 1 or not isinstance(matches[0].get("id"), str):
            raise BridgeError(
                f"Expected exactly one active Square location named {location_name}"
            )
        return matches[0]["id"]

    def customer_by_email(self, email: str) -> dict[str, Any]:
        value = self.request(
            "POST",
            "/v2/customers/search",
            {
                "query": {
                    "filter": {"email_address": {"exact": email.strip().lower()}}
                },
                "limit": 10,
            },
        )
        customers = [
            customer
            for customer in value.get("customers", [])
            if isinstance(customer, dict)
            and text(customer.get("email_address")) is not None
            and str(customer["email_address"]).lower() == email.strip().lower()
        ]
        if len(customers) != 1:
            raise BridgeError(
                f"Expected exactly one Square customer with email {email}; found {len(customers)}"
            )
        return customers[0]

    def invoices_for_location(self, location_id: str) -> list[dict[str, Any]]:
        invoices: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            query = {"location_id": location_id, "limit": "200"}
            if cursor is not None:
                query["cursor"] = cursor
            path = f"/v2/invoices?{urllib.parse.urlencode(query)}"
            value = self.request("GET", path)
            invoices.extend(
                invoice
                for invoice in value.get("invoices", [])
                if isinstance(invoice, dict)
            )
            cursor = value.get("cursor") if isinstance(value.get("cursor"), str) else None
            if cursor is None:
                return invoices

    def matching_invoice(
        self, invoice: SageInvoice, location_id: str
    ) -> dict[str, Any] | None:
        marker = f"Source record {invoice.sage_invoice_id}."
        invoices = self.invoices_for_location(location_id)
        marker_matches = [
            candidate
            for candidate in invoices
            if marker in str(candidate.get("description") or "")
        ]
        if len(marker_matches) > 1:
            raise BridgeError("Multiple Square invoices match this Sage invoice")
        if marker_matches:
            return marker_matches[0]
        number_matches = [
            candidate
            for candidate in invoices
            if candidate.get("invoice_number") == invoice.invoice_number[:20]
        ]
        if number_matches:
            raise BridgeError(
                "Square already contains this invoice number without the Sage bridge marker"
            )
        return None

    def create_draft(
        self,
        invoice: SageInvoice,
        location_id: str,
        customer_id: str,
    ) -> dict[str, Any]:
        order_value = self.request(
            "POST", "/v2/orders", build_square_order(invoice, location_id, customer_id)
        )
        order = order_value.get("order")
        if not isinstance(order, dict) or not isinstance(order.get("id"), str):
            raise BridgeError("Square did not return the created order")
        invoice_value = self.request(
            "POST",
            "/v2/invoices",
            build_square_invoice(invoice, location_id, order["id"], customer_id),
        )
        created = invoice_value.get("invoice")
        if not isinstance(created, dict) or not isinstance(created.get("id"), str):
            raise BridgeError("Square did not return the created draft invoice")
        return created

    def publish(self, invoice: Mapping[str, Any], sage_invoice_id: int) -> dict[str, Any]:
        invoice_id = invoice.get("id")
        version = invoice.get("version")
        if not isinstance(invoice_id, str) or not isinstance(version, int):
            raise BridgeError("Matching Square draft is missing its ID or version")
        value = self.request(
            "POST",
            f"/v2/invoices/{urllib.parse.quote(invoice_id, safe='')}/publish",
            {
                "version": version,
                "idempotency_key": f"sage-ar-publish-{sage_invoice_id}",
            },
        )
        published = value.get("invoice")
        if not isinstance(published, dict):
            raise BridgeError("Square did not return the published invoice")
        return published


def validate_existing_square_invoice(
    square_invoice: Mapping[str, Any],
    sage_invoice: SageInvoice,
    location_id: str,
    customer_id: str,
) -> None:
    if square_invoice.get("location_id") != location_id:
        raise BridgeError("Square draft location no longer matches the Sage route")
    if square_invoice.get("invoice_number") != sage_invoice.invoice_number[:20]:
        raise BridgeError("Square draft invoice number no longer matches Sage")
    recipient = square_invoice.get("primary_recipient")
    if not isinstance(recipient, dict) or recipient.get("customer_id") != customer_id:
        raise BridgeError("Square draft recipient no longer matches the confirmed customer")
    requests = square_invoice.get("payment_requests")
    if not isinstance(requests, list) or len(requests) != 1:
        raise BridgeError("Square draft payment schedule no longer matches the bridge")
    computed = requests[0].get("computed_amount_money")
    if not isinstance(computed, dict) or computed.get("amount") != square_cents(
        sage_invoice.total
    ):
        raise BridgeError("Square draft total no longer matches the current Sage invoice")


def connect_sage() -> Any:
    try:
        import pymssql
    except ImportError as error:
        raise BridgeError("pymssql is required on the private Sage bridge host") from error
    password = text(os.environ.get("HPS_SAGE_SQL_PASSWORD"))
    if password is None:
        raise BridgeError("HPS_SAGE_SQL_PASSWORD is required")
    return pymssql.connect(
        server=os.environ.get("HPS_SAGE_HOST", DEFAULT_SAGE_SERVER),
        port=int(os.environ.get("HPS_SAGE_SQL_PORT", str(DEFAULT_SAGE_PORT))),
        user=os.environ.get("HPS_SAGE_SQL_USERNAME", DEFAULT_SAGE_USERNAME),
        password=password,
        database=os.environ.get("HPS_SAGE_DATABASE", DEFAULT_SAGE_DATABASE),
        appname=SAGE_SQL_APP_NAME,
        login_timeout=15,
        timeout=60,
        autocommit=True,
    )


def public_summary(
    invoice: SageInvoice,
    prefix: str,
    location_name: str,
    location_id: str,
    customer: Mapping[str, Any],
    square_invoice: Mapping[str, Any] | None,
    action: str,
) -> dict[str, Any]:
    return {
        "action": action,
        "sageInvoiceId": invoice.sage_invoice_id,
        "invoiceNumber": invoice.invoice_number,
        "sageJobId": invoice.sage_job_id,
        "jobNumber": invoice.job_short_name,
        "departmentPrefix": prefix,
        "squareLocation": location_name,
        "squareLocationId": location_id,
        "recipient": {
            "id": customer.get("id"),
            "name": " ".join(
                part
                for part in (
                    text(customer.get("given_name")),
                    text(customer.get("family_name")),
                )
                if part is not None
            ),
            "email": customer.get("email_address"),
        },
        "invoiceDate": invoice.invoice_date,
        "dueDate": invoice.due_date,
        "total": f"{invoice.total:.2f}",
        "balance": f"{invoice.balance:.2f}",
        "lineCount": len(invoice.lines),
        "squareInvoice": (
            {
                "id": square_invoice.get("id"),
                "status": square_invoice.get("status"),
                "publicUrl": square_invoice.get("public_url"),
            }
            if square_invoice is not None
            else None
        ),
    }


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sage-invoice-id", required=True, type=int)
    parser.add_argument("--recipient-email", required=True)
    parser.add_argument(
        "--environment", choices=("production", "sandbox"), default="sandbox"
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--create-draft", action="store_true")
    mode.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--confirm-invoice-number",
        help="Required for Square writes; must exactly match Sage",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    token_name = (
        "HPS_SQUARE_PRODUCTION_ACCESS_TOKEN"
        if args.environment == "production"
        else "HPS_SQUARE_SANDBOX_ACCESS_TOKEN"
    )
    access_token = text(os.environ.get(token_name))
    if access_token is None:
        raise BridgeError(f"{token_name} is required")

    sage = connect_sage()
    try:
        invoice = load_sage_invoice(sage, args.sage_invoice_id)
    finally:
        sage.close()

    prefix, location_name = route_square_location(
        invoice.job_short_name, invoice.job_name, invoice.sage_department
    )
    origin = (
        SQUARE_PRODUCTION_ORIGIN
        if args.environment == "production"
        else SQUARE_SANDBOX_ORIGIN
    )
    square = SquareClient(access_token, origin)
    location_id = square.location_id(location_name)
    customer = square.customer_by_email(args.recipient_email)
    customer_id = customer.get("id")
    if not isinstance(customer_id, str):
        raise BridgeError("Square customer is missing its ID")
    existing = square.matching_invoice(invoice, location_id)
    if existing is not None:
        validate_existing_square_invoice(
            existing, invoice, location_id, customer_id
        )

    write_requested = args.create_draft or args.publish
    if write_requested and args.confirm_invoice_number != invoice.invoice_number:
        raise BridgeError(
            "--confirm-invoice-number must exactly match the current Sage invoice number"
        )

    action = "preview"
    result = existing
    if args.create_draft:
        if existing is not None:
            action = "existing"
        else:
            result = square.create_draft(invoice, location_id, customer_id)
            validate_existing_square_invoice(
                result, invoice, location_id, customer_id
            )
            action = "draft_created"
    elif args.publish:
        if existing is None:
            raise BridgeError("Create and verify the Square draft before publishing")
        status = existing.get("status")
        if status == "DRAFT":
            result = square.publish(existing, invoice.sage_invoice_id)
            action = "published"
        elif status in {"SCHEDULED", "UNPAID", "PARTIALLY_PAID", "PAID"}:
            action = "already_published"
        else:
            raise BridgeError(f"Square invoice cannot be published from status {status}")

    print(
        json.dumps(
            public_summary(
                invoice,
                prefix,
                location_name,
                location_id,
                customer,
                result,
                action,
            ),
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BridgeError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
