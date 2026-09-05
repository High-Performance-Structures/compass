#!/usr/bin/env python3
"""Poll new open Sage invoices and safely publish exact matches to Square."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Mapping, Sequence

from sage_square_invoice_bridge import (
    BridgeError,
    SQUARE_PRODUCTION_ORIGIN,
    SQUARE_SANDBOX_ORIGIN,
    SageInvoice,
    SquareClient,
    connect_sage,
    load_sage_invoice,
    public_summary,
    recipient_email,
    route_square_location,
    text,
    validate_existing_square_invoice,
)


PUBLISHED_STATUSES = {"SCHEDULED", "UNPAID", "PARTIALLY_PAID", "PAID"}
SQUARE_READY_STATUS = "SQUARE:READY"


def open_invoice_ids(
    connection: Any, minimum_sage_invoice_id: int, limit: int
) -> tuple[int, ...]:
    cursor = connection.cursor(as_dict=True)
    cursor.execute(
        """
        SELECT TOP (%s) recnum
        FROM dbo.acrinv
        WHERE recnum >= %s
          AND status = 1
          AND invbal > 0
          AND LTRIM(RTRIM(usrdf1)) = %s
        ORDER BY recnum
        """,
        (limit, minimum_sage_invoice_id, SQUARE_READY_STATUS),
    )
    values: list[int] = []
    for row in cursor.fetchall():
        invoice_id = int(row.get("recnum") or 0)
        if invoice_id > 0:
            values.append(invoice_id)
    return tuple(values)


def invoice_context(invoice: SageInvoice) -> dict[str, Any]:
    return {
        "sageInvoiceId": invoice.sage_invoice_id,
        "invoiceNumber": invoice.invoice_number,
        "jobNumber": invoice.job_short_name,
        "sageCustomerId": invoice.sage_customer_id,
        "sageCustomerName": invoice.sage_customer_name,
        "sageCustomerEmail": invoice.sage_customer_email,
        "sageGeneralEmail": invoice.sage_customer_general_email,
        "sagePrimaryEmail": invoice.sage_customer_primary_email,
        "squareStatus": invoice.square_status,
        "total": f"{invoice.total:.2f}",
        "balance": f"{invoice.balance:.2f}",
    }


def is_square_ready(invoice: SageInvoice) -> bool:
    return text(invoice.square_status) == SQUARE_READY_STATUS


def existing_invoice_customer(
    square: SquareClient, square_invoice: Mapping[str, Any]
) -> dict[str, Any]:
    recipient = square_invoice.get("primary_recipient")
    if not isinstance(recipient, dict):
        raise BridgeError("Matching Square invoice is missing its recipient")
    customer_id = recipient.get("customer_id")
    if not isinstance(customer_id, str):
        raise BridgeError("Matching Square invoice recipient is missing its customer ID")
    return square.customer_by_id(customer_id)


def process_invoice(
    square: SquareClient,
    invoice: SageInvoice,
    auto_publish: bool,
) -> dict[str, Any]:
    # The Sage Square Status field is the accounting operator's authorization.
    # Check it before even reading Square so another status has no external effect.
    if not is_square_ready(invoice):
        return {**invoice_context(invoice), "action": "skipped_not_square_ready"}

    prefix, location_name = route_square_location(
        invoice.job_short_name, invoice.job_name, invoice.sage_department
    )
    email = recipient_email(invoice, None)
    location_id = square.location_id(location_name)
    # Check the Sage source marker before any customer write so retries never
    # create an orphan or duplicate customer.
    existing = square.matching_invoice(invoice, location_id)
    customer_created = False

    if existing is not None:
        customer = existing_invoice_customer(square, existing)
        square_email = text(customer.get("email_address"))
        if square_email is None or square_email.lower() != email:
            raise BridgeError(
                "Matching Square invoice recipient email does not match Sage"
            )
    else:
        customer = square.customer_by_email(email)
        if customer is None:
            if not auto_publish:
                return {
                    **invoice_context(invoice),
                    "action": "would_create_customer_and_publish",
                    "squareLocation": location_name,
                    "recipientEmail": email,
                    "squareInvoice": None,
                }
            customer = square.create_customer(
                email,
                invoice.sage_customer_id,
                invoice.sage_customer_name,
            )
            customer_created = True

    customer_id = customer.get("id")
    if not isinstance(customer_id, str):
        raise BridgeError("Square customer is missing its ID")

    if existing is not None:
        validate_existing_square_invoice(existing, invoice, location_id, customer_id)

    action = "preview"
    result = existing
    if auto_publish:
        if existing is None:
            result = square.create_draft(invoice, location_id, customer_id)
            validate_existing_square_invoice(
                result, invoice, location_id, customer_id
            )
            existing = result
        status = existing.get("status")
        if status == "DRAFT":
            result = square.publish(existing, invoice.sage_invoice_id)
            action = "published"
        elif status in PUBLISHED_STATUSES:
            action = "already_published"
        else:
            raise BridgeError(f"Square invoice cannot be published from status {status}")
    elif existing is not None:
        action = "existing"

    return public_summary(
        invoice,
        prefix,
        location_name,
        location_id,
        customer,
        customer_created,
        result,
        action,
    )


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Run one bounded poll")
    parser.add_argument(
        "--minimum-sage-invoice-id",
        type=int,
        default=int(os.environ.get("SAGE_SQUARE_INVOICE_MIN_ID", "0")),
        help="Fail-closed production cutoff; older Sage records are never considered",
    )
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument(
        "--environment", choices=("production", "sandbox"), default="sandbox"
    )
    parser.add_argument(
        "--auto-publish",
        action="store_true",
        help="Create missing customers/drafts and publish verified invoices",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if not args.once:
        raise BridgeError("--once is required; scheduling belongs to systemd")
    if args.minimum_sage_invoice_id <= 0:
        raise BridgeError("A positive --minimum-sage-invoice-id is required")
    if args.limit <= 0 or args.limit > 200:
        raise BridgeError("--limit must be between 1 and 200")

    token_name = (
        "HPS_SQUARE_PRODUCTION_ACCESS_TOKEN"
        if args.environment == "production"
        else "HPS_SQUARE_SANDBOX_ACCESS_TOKEN"
    )
    access_token = text(os.environ.get(token_name))
    if access_token is None:
        raise BridgeError(f"{token_name} is required")
    origin = (
        SQUARE_PRODUCTION_ORIGIN
        if args.environment == "production"
        else SQUARE_SANDBOX_ORIGIN
    )
    square = SquareClient(access_token, origin)

    sage = connect_sage()
    try:
        invoice_ids = open_invoice_ids(
            sage, args.minimum_sage_invoice_id, args.limit
        )
        results: list[dict[str, Any]] = []
        failed = False
        for invoice_id in invoice_ids:
            invoice: SageInvoice | None = None
            try:
                invoice = load_sage_invoice(sage, invoice_id)
                results.append(process_invoice(square, invoice, args.auto_publish))
            except BridgeError as error:
                failed = True
                context = (
                    invoice_context(invoice)
                    if invoice is not None
                    else {"sageInvoiceId": invoice_id}
                )
                results.append({**context, "action": "error", "error": str(error)})
    finally:
        sage.close()

    print(
        json.dumps(
            {
                "mode": "auto_publish" if args.auto_publish else "preview",
                "requiredSquareStatus": SQUARE_READY_STATUS,
                "minimumSageInvoiceId": args.minimum_sage_invoice_id,
                "candidateCount": len(invoice_ids),
                "results": results,
            },
            indent=2,
        )
    )
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BridgeError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
