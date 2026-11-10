#!/usr/bin/env python3
"""Read-only Sage 100 Contractor cost code reader for Compass.

Asks Compass whether a cost code read is due (hourly, or right away after
someone presses "Refresh from Sage" in Settings), reads Sage's complete cost
code list (dbo.cstcde record number and name) when it is, and sends it to
Compass, which adds, updates and inactivates its catalog rows to match. SQL
credentials and the Compass HMAC secret are injected by Signet. The process
runs one SELECT statement and never writes to Sage.

Connection and signing helpers follow the prime change order reader.
"""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any, Mapping, Sequence


DEFAULT_COMPASS_BASE_URL = "https://compass.openrangeconstruction.ltd"
DEFAULT_SAGE_SERVER = "100.100.201.24"
DEFAULT_SAGE_PORT = 14330
DEFAULT_SAGE_DATABASE = "High Performance Structures Inc"
DEFAULT_SAGE_USERNAME = "hps_jarvis_readonly"
REQUESTS_TARGET = "/api/integrations/sage/cost-codes/requests"
RESULTS_TARGET = "/api/integrations/sage/cost-codes/results"
LOCK_PATH = Path("/tmp/compass-sage-cost-code-reader.lock")
# Compass accepts up to 5,000 codes in one snapshot; Sage has about 1,200.
MAX_CODES = 5000


class ReaderError(RuntimeError):
    pass


class CompassHttpError(ReaderError):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"Compass returned HTTP {status}: {detail}")
        self.status = status


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def record_number(value: Any) -> str:
    """Sage record numbers come back as int or Decimal("1310000.0")."""
    if value is None:
        return ""
    amount = value if isinstance(value, Decimal) else Decimal(str(value))
    return str(int(amount)) if amount == amount.to_integral_value() else str(amount.normalize())


def signature(secret: str, timestamp: str, request_id: str, method: str, target: str, raw_body: str) -> str:
    payload = f"{timestamp}.{request_id}.{method.upper()}.{target}.{raw_body}"
    digest = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def signed_json_request(
    base_url: str, secret: str, method: str, target: str, body: Mapping[str, Any] | None = None, timeout: int = 30
) -> Any:
    raw_body = "" if body is None else json.dumps(body, separators=(",", ":"))
    timestamp = str(int(time.time()))
    request_id = str(uuid.uuid4())
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 Compass-Sage-Bridge/1.0",
        "X-Compass-Timestamp": timestamp,
        "X-Compass-Request-Id": request_id,
        "X-Compass-Signature": signature(secret, timestamp, request_id, method, target, raw_body),
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = raw_body.encode("utf-8")
    request = urllib.request.Request(f"{base_url.rstrip('/')}{target}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1000]
        raise CompassHttpError(error.code, detail) from error
    except urllib.error.URLError as error:
        raise ReaderError(f"Compass request failed: {error.reason}") from error


def signed_json_request_with_fallback(
    base_url: str, secrets: Sequence[str], method: str, target: str, body: Mapping[str, Any] | None = None, timeout: int = 30
) -> Any:
    for index, secret in enumerate(secrets):
        try:
            return signed_json_request(base_url, secret, method, target, body, timeout)
        except CompassHttpError as error:
            if error.status != 401 or index == len(secrets) - 1:
                raise
    raise ReaderError("No Sage bridge secret is available")


def parse_due(payload: Any) -> bool:
    if not isinstance(payload, Mapping) or not isinstance(payload.get("due"), bool):
        raise ReaderError("Compass returned an invalid due answer")
    return bool(payload["due"])


def fetch_cost_codes(cursor: Any) -> list[dict[str, Any]]:
    """SELECT only: every cost code's record number and name."""
    cursor.execute(
        """
        SELECT recnum, cdenme
        FROM dbo.cstcde WITH (NOLOCK)
        ORDER BY recnum
        """
    )
    return [dict(row) for row in cursor.fetchall()]


def build_snapshot(rows: Sequence[Mapping[str, Any]], captured_at: str) -> dict[str, Any]:
    codes: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        number = record_number(row.get("recnum"))
        if not number.isdigit() or number in seen:
            continue
        seen.add(number)
        codes.append({"recordNumber": number, "name": text(row.get("cdenme"))[:200]})
    if not codes:
        raise ReaderError("Sage returned no cost codes")
    if len(codes) > MAX_CODES:
        raise ReaderError(f"Sage returned {len(codes)} cost codes, more than Compass accepts")
    return {"capturedAt": captured_at, "costCodes": codes}


def read_once(base_url: str, secrets: Sequence[str], force: bool = False) -> dict[str, Any]:
    due = force or parse_due(signed_json_request_with_fallback(base_url, secrets, "GET", REQUESTS_TARGET))
    if not due:
        return {"due": False}
    connection = connect_sage()
    try:
        rows = fetch_cost_codes(connection.cursor(as_dict=True))
    finally:
        connection.close()
    snapshot = build_snapshot(rows, dt.datetime.now(dt.timezone.utc).isoformat())
    result = signed_json_request_with_fallback(base_url, secrets, "POST", RESULTS_TARGET, snapshot, timeout=90)
    summary = {key: result.get(key) for key in ("inserted", "updated", "inactivated", "unchanged", "skipped")} if isinstance(result, Mapping) else {}
    return {"due": True, "costCodes": len(snapshot["costCodes"]), **summary}


def connect_sage() -> Any:
    try:
        import pymssql
    except ImportError as error:
        raise ReaderError("pymssql is not installed") from error
    password = os.environ.get("HPS_SAGE_SQL_PASSWORD", "").strip()
    if not password:
        raise ReaderError("HPS_SAGE_SQL_PASSWORD is not available")
    try:
        return pymssql.connect(
            server=os.environ.get("HPS_SAGE_SQL_SERVER", DEFAULT_SAGE_SERVER),
            port=int(os.environ.get("HPS_SAGE_SQL_PORT", str(DEFAULT_SAGE_PORT))),
            user=os.environ.get("HPS_SAGE_SQL_USERNAME", DEFAULT_SAGE_USERNAME),
            password=password,
            database=os.environ.get("HPS_SAGE_SQL_DATABASE", DEFAULT_SAGE_DATABASE),
            # Sage's login trigger recognizes the established Jarvis read-only
            # application identity and the broken-bar separator.
            appname="Sage100Contractor¦JarvisCompassPayAppRO",
            login_timeout=15,
            timeout=120,
            autocommit=True,
        )
    except Exception as error:
        raise ReaderError(f"Sage SQL connection failed: {type(error).__name__}") from error


def acquire_lock() -> Any:
    lock = LOCK_PATH.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        lock.close()
        raise ReaderError("Another Sage cost code reader is active") from error
    return lock


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Check once and exit")
    parser.add_argument("--force", action="store_true", help="Read Sage even if Compass says it is not due")
    args = parser.parse_args()
    base_url = os.environ.get("COMPASS_BASE_URL", DEFAULT_COMPASS_BASE_URL).strip()
    secrets = list(
        dict.fromkeys(
            value
            for value in (
                os.environ.get("SAGE_PAY_APPLICATION_BRIDGE_SECRET", "").strip(),
                os.environ.get("SAGE_BRIDGE_SECRET", "").strip(),
            )
            if len(value) >= 32
        )
    )
    if not secrets:
        raise ReaderError("SAGE_PAY_APPLICATION_BRIDGE_SECRET is not available or is too short")
    lock = acquire_lock()
    try:
        while True:
            result = read_once(base_url, secrets, force=args.force)
            print(json.dumps({"status": "ok", **result, "at": dt.datetime.now(dt.timezone.utc).isoformat()}), flush=True)
            if args.once:
                return 0
            time.sleep(300)
    finally:
        lock.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReaderError as error:
        print(json.dumps({"status": "error", "error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error
