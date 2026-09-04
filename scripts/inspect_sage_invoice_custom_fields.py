#!/usr/bin/env python3
"""Read-only discovery for Sage A/R invoice custom-field storage."""

from __future__ import annotations

import argparse
import json
from typing import Any, Sequence

from sage_square_invoice_bridge import BridgeError, connect_sage


def candidate_columns(connection: Any) -> list[dict[str, Any]]:
    cursor = connection.cursor(as_dict=True)
    cursor.execute(
        """
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND (
            LOWER(TABLE_NAME) LIKE 'acri%'
            OR LOWER(TABLE_NAME) LIKE 'ariv%'
          )
        ORDER BY TABLE_NAME, ORDINAL_POSITION
        """
    )
    return list(cursor.fetchall())


def email_columns(connection: Any) -> list[dict[str, Any]]:
    cursor = connection.cursor(as_dict=True)
    cursor.execute(
        """
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND (
            LOWER(COLUMN_NAME) LIKE '%mail%'
            OR LOWER(COLUMN_NAME) LIKE '%email%'
          )
        ORDER BY TABLE_NAME, ORDINAL_POSITION
        """
    )
    return list(cursor.fetchall())


def customer_contact_columns(connection: Any) -> list[dict[str, Any]]:
    cursor = connection.cursor(as_dict=True)
    cursor.execute(
        """
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME IN ('reccln', 'clncnt')
        ORDER BY TABLE_NAME, ORDINAL_POSITION
        """
    )
    return list(cursor.fetchall())


def invoice_fields(connection: Any, invoice_id: int) -> dict[str, Any]:
    cursor = connection.cursor(as_dict=True)
    cursor.execute(
        """
        SELECT i.recnum, i.invnum, i.invdte, i.jobnum, i.dscrpt,
               i.usrdf1, i.usrdf2, i.ntetxt, i.invttl, i.invbal,
               j.jobnme, j.shtnme, c.recnum AS clnnum, c.clnnme,
               c.e_mail, c.email2, c.email3
        FROM dbo.acrinv i
        LEFT JOIN dbo.actrec j ON j.recnum = i.jobnum
        LEFT JOIN dbo.reccln c ON c.recnum = j.clnnum
        WHERE i.recnum = %s
        """,
        (invoice_id,),
    )
    row = cursor.fetchone()
    if row is None:
        raise BridgeError(f"Sage invoice {invoice_id} was not found")
    return row


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-columns", action="store_true")
    parser.add_argument("--list-email-columns", action="store_true")
    parser.add_argument("--list-customer-contact-columns", action="store_true")
    parser.add_argument("--invoice-id", type=int)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if (
        not args.list_columns
        and not args.list_email_columns
        and not args.list_customer_contact_columns
        and args.invoice_id is None
    ):
        raise BridgeError(
            "a metadata listing option or --invoice-id is required"
        )
    connection = connect_sage()
    try:
        if args.list_columns:
            value = {"columns": candidate_columns(connection)}
        elif args.list_email_columns:
            value = {"columns": email_columns(connection)}
        elif args.list_customer_contact_columns:
            value = {"columns": customer_contact_columns(connection)}
        else:
            value = {"invoice": invoice_fields(connection, args.invoice_id)}
    finally:
        connection.close()
    print(json.dumps(value, indent=2, default=str))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BridgeError as error:
        print(json.dumps({"error": str(error)}))
        raise SystemExit(1)
