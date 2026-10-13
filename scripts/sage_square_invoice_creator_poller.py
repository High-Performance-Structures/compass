#!/usr/bin/env python3
"""Read-only Sage checks for Square payments, reported to Compass.

1. Who originally created each Sage AR invoice (for payment alerts and reminders).
2. Whether each Square receipt has been entered in Sage yet (stops reminders).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from decimal import Decimal

from sage_square_invoice_bridge import connect_sage
from square_auth_monitor import NoRedirects

TARGET = "/api/integrations/sage/square-invoice-creators"
MAX_BYTES = 64 * 1024


def request_compass(base_url: str, secret: str, method: str, payload=None):
    origin = urllib.parse.urlsplit(base_url)
    if (origin.scheme != "https" or not origin.netloc or origin.username or origin.password
            or origin.path not in ("", "/") or origin.query or origin.fragment or len(secret) < 16):
        raise ValueError("Invalid Compass origin or reporting credential")
    body = "" if payload is None else json.dumps(payload, separators=(",", ":"))
    timestamp = str(int(time.time()))
    signature = hmac.new(secret.encode(), f"{timestamp}.{method}.{TARGET}.{body}".encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(base_url.rstrip("/") + TARGET, method=method,
        data=body.encode() if method == "POST" else None, headers={
            "Accept": "application/json", "Content-Type": "application/json",
            "User-Agent": "Compass-Sage-Invoice-Creator-Poller/1.0",
            "X-Compass-Timestamp": timestamp, "X-Compass-Signature": "sha256=" + signature,
        })
    with urllib.request.build_opener(NoRedirects()).open(request, timeout=10) as response:
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("Oversized Compass response")
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError("Invalid Compass response")
        return result


def read_creators(connection, requests: list[dict]) -> list[dict]:
    if len(requests) > 10:
        raise ValueError("Invalid lookup batch")
    for item in requests:
        if (not isinstance(item, dict) or set(item) != {"operationId", "sageInvoiceId", "invoiceNumber", "sageJobShortName"}
                or not all(isinstance(value, str) and 0 < len(value) <= 100 for value in item.values())
                or re.fullmatch(r"[1-9]\d{0,14}", item["sageInvoiceId"]) is None):
            raise ValueError("Invalid lookup identity")
    if not requests:
        return []
    cursor = connection.cursor(as_dict=True)
    try:
        # One bounded SELECT, parameterized IDs. insusr is the original inserting
        # employee; updusr may instead be the integration or accounting operator.
        placeholders = ",".join("%s" for _ in requests)
        cursor.execute(f"""SELECT i.recnum, i.invnum, j.shtnme, i.insusr
            FROM dbo.acrinv i JOIN dbo.actrec j ON j.recnum = i.jobnum
            WHERE i.recnum IN ({placeholders})""", tuple(int(item["sageInvoiceId"]) for item in requests))
        rows = {str(row["recnum"]): row for row in cursor.fetchall()}
    finally:
        cursor.close()
    results = []
    for item in requests:
        row = rows.get(item["sageInvoiceId"])
        if (row is None or str(row["invnum"]).strip() != item["invoiceNumber"]
                or str(row["shtnme"]).strip().upper() != item["sageJobShortName"].upper()):
            raise ValueError("Sage invoice source identity conflict")
        username = str(row["insusr"]).strip() if row["insusr"] is not None else ""
        results.append({**item, "creatorUsername": username or None})
    return results


RECEIPT_KEYS = {"operationId", "sageInvoiceId", "invoiceNumber", "amountCents", "paymentCompletedAt"}
# A receipt entered by hand is usually dated on or after the Square payment,
# occasionally a few days before (deposit date vs. payment date).
RECEIPT_EARLIEST_DAYS = 10


def parse_payment_date(value: str) -> dt.date:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(dt.timezone(dt.timedelta(hours=-7))).date()


def read_receipts(connection, checks: list[dict]) -> list[dict]:
    """Looks for each Square payment among the invoice's Sage receipts (acrpmt).

    Entered when a receipt for exactly the Square amount is on that invoice, or
    the invoice is paid in full. Read-only; never writes to Sage.
    """
    if len(checks) > 20:
        raise ValueError("Invalid receipt batch")
    for item in checks:
        if (not isinstance(item, dict) or set(item) != RECEIPT_KEYS
                or not isinstance(item["sageInvoiceId"], str) or re.fullmatch(r"[1-9]\d{0,14}", item["sageInvoiceId"]) is None
                or not isinstance(item["invoiceNumber"], str) or not 0 < len(item["invoiceNumber"]) <= 100
                or not isinstance(item["amountCents"], int) or isinstance(item["amountCents"], bool) or item["amountCents"] <= 0
                or not isinstance(item["operationId"], str) or not isinstance(item["paymentCompletedAt"], str)):
            raise ValueError("Invalid receipt identity")
        parse_payment_date(item["paymentCompletedAt"])
    if not checks:
        return []
    ids = tuple(sorted({int(item["sageInvoiceId"]) for item in checks}))
    placeholders = ",".join("%s" for _ in ids)
    cursor = connection.cursor(as_dict=True)
    try:
        cursor.execute(f"SELECT recnum, invnum, invbal, amtpad FROM dbo.acrinv WHERE recnum IN ({placeholders})", ids)
        invoices = {str(row["recnum"]): row for row in cursor.fetchall()}
        cursor.execute(f"""SELECT recnum, _idnum, chknum, chkdte, amount
            FROM dbo.acrpmt WHERE recnum IN ({placeholders})""", ids)
        payments = cursor.fetchall()
    finally:
        cursor.close()
    results = []
    for item in checks:
        invoice = invoices.get(item["sageInvoiceId"])
        base = {"kind": "receipt", "operationId": item["operationId"], "sageInvoiceId": item["sageInvoiceId"]}
        if invoice is None or str(invoice["invnum"]).strip() != item["invoiceNumber"]:
            # Wrong or missing invoice: say nothing rather than guess.
            continue
        amount = (Decimal(item["amountCents"]) / 100).quantize(Decimal("0.01"))
        earliest = parse_payment_date(item["paymentCompletedAt"]) - dt.timedelta(days=RECEIPT_EARLIEST_DAYS)
        match = next((row for row in payments if str(row["recnum"]) == item["sageInvoiceId"]
            and row["amount"] is not None and Decimal(row["amount"]).quantize(Decimal("0.01")) == amount
            and row["chkdte"] is not None and as_date(row["chkdte"]) >= earliest), None)
        if match is not None:
            number = str(match["chknum"] or "").strip() or f"Receipt {as_date(match['chkdte']).isoformat()}"
            results.append({**base, "entered": True, "sageRecordId": str(match["_idnum"]), "sageRecordNumber": number[:100],
                "matchReason": f"Sage receipt of ${amount} dated {as_date(match['chkdte']).isoformat()}"})
        elif invoice["invbal"] is not None and Decimal(invoice["invbal"]) == 0 and Decimal(invoice["amtpad"] or 0) >= amount:
            results.append({**base, "entered": True, "sageRecordId": item["sageInvoiceId"], "sageRecordNumber": item["invoiceNumber"][:100],
                "matchReason": "Sage invoice is paid in full"})
        else:
            results.append({**base, "entered": False, "sageRecordId": None, "sageRecordNumber": None, "matchReason": None})
    return results


def as_date(value) -> dt.date:
    return value.date() if isinstance(value, dt.datetime) else value


def stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    # Signet secret exec does not inherit systemd's environment. Pass the public
    # origin explicitly; only credentials come from the protected secret broker.
    parser.add_argument("--compass-base-url", required=True)
    args = parser.parse_args(argv)
    count = 0
    try:
        secret = os.environ.get("JARVIS_BRIDGE_SECONDARY_SECRET", "")
        work = request_compass(args.compass_base_url, secret, "GET")
        pending = work.get("requests")
        checks = work.get("receiptChecks", [])
        if not isinstance(pending, list) or not isinstance(checks, list):
            raise ValueError("Invalid pending lookup response")
        if pending or checks:
            connection = connect_sage()
            try:
                observations = read_creators(connection, pending) + read_receipts(connection, checks)
            finally:
                connection.close()
            for observation in observations:
                # Stamp each report immediately before signing, not before the SQL
                # read, so a slow Sage query does not make every result stale.
                observation["checkedAt"] = stamp()
                result = request_compass(args.compass_base_url, secret, "POST", observation)
                if result.get("success") is not True:
                    raise ValueError("Compass did not acknowledge lookup")
                count += 1
        print(json.dumps({"status": "ok", "reported": count}))
        return 0
    except Exception:
        # Never emit database/provider bodies, employee identities, or secrets.
        print(json.dumps({"status": "failed", "reported": count, "error": "Invoice creator lookup/report failed"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
