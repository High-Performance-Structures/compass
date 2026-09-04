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


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-columns", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.list_columns:
        raise BridgeError("--list-columns is required")
    connection = connect_sage()
    try:
        rows = candidate_columns(connection)
    finally:
        connection.close()
    print(json.dumps({"columns": rows}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BridgeError as error:
        print(json.dumps({"error": str(error)}))
        raise SystemExit(1)
