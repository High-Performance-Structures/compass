#!/usr/bin/env python3
"""Read original Sage AR invoice creators and report signed notification metadata."""

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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    # Signet secret exec does not inherit systemd's environment. Pass the public
    # origin explicitly; only credentials come from the protected secret broker.
    parser.add_argument("--compass-base-url", required=True)
    args = parser.parse_args(argv)
    count = 0
    try:
        secret = os.environ.get("JARVIS_BRIDGE_SECONDARY_SECRET", "")
        pending = request_compass(args.compass_base_url, secret, "GET").get("requests")
        if not isinstance(pending, list):
            raise ValueError("Invalid pending lookup response")
        if pending:
            connection = connect_sage()
            try:
                observations = read_creators(connection, pending)
            finally:
                connection.close()
            for observation in observations:
                # Stamp each report immediately before signing, not before the SQL
                # read, so a slow Sage query does not make every result stale.
                observation["checkedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
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
