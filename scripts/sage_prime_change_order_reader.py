#!/usr/bin/env python3
"""Read-only Sage 100 Contractor prime change order and proposal reader for Compass.

Asks Compass which linked Sage jobs have approved change orders or accepted
estimates, reads those jobs' prime change orders (dbo.prmchg, lines in
dbo.pmcgln) and proposal lines (dbo.prplin), and sends Compass a snapshot so
each change order shows "In Sage", "Not in Sage" or "Differs" and an
estimate is never added as a second proposal. SQL credentials and the Compass HMAC secret are injected by
Signet. The process runs SELECT statements only and never writes to Sage.

Kept separate from the pay-application poller (which another feature owns);
the connection and signing helpers follow that poller's established pattern.
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
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Mapping, Sequence


DEFAULT_COMPASS_BASE_URL = "https://compass.openrangeconstruction.ltd"
DEFAULT_SAGE_SERVER = "100.100.201.24"
DEFAULT_SAGE_PORT = 14330
DEFAULT_SAGE_DATABASE = "High Performance Structures Inc"
DEFAULT_SAGE_USERNAME = "hps_jarvis_readonly"
REQUESTS_TARGET = "/api/integrations/sage/prime-change-orders/requests"
RESULTS_TARGET = "/api/integrations/sage/prime-change-orders/results"
LOCK_PATH = Path("/tmp/compass-sage-prime-change-order-reader.lock")
# Jobs per SQL IN list and per snapshot post (Compass accepts up to 300).
JOB_CHUNK = 50


class ReaderError(RuntimeError):
    pass


class CompassHttpError(ReaderError):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"Compass returned HTTP {status}: {detail}")
        self.status = status


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def cents(value: Any) -> int:
    if value is None:
        return 0
    amount = value if isinstance(value, Decimal) else Decimal(str(value))
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def iso_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (dt.date, dt.datetime)):
        return value.strftime("%Y-%m-%d")
    raw = text(value)[:10]
    return raw if len(raw) == 10 and raw[4] == "-" and raw[7] == "-" else None


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


def parse_jobs(payload: Any) -> list[dict[str, str]]:
    if not isinstance(payload, Mapping) or not isinstance(payload.get("jobs"), list):
        raise ReaderError("Compass returned an invalid job list")
    jobs: list[dict[str, str]] = []
    for item in payload["jobs"]:
        if not isinstance(item, Mapping):
            raise ReaderError("Compass returned an invalid job")
        project_id = text(item.get("projectId"))
        job_number = text(item.get("sageJobNumber"))
        if not project_id or not job_number.isdigit():
            raise ReaderError("Compass returned an incomplete job")
        jobs.append({"projectId": project_id, "sageJobNumber": job_number})
    return jobs


def fetch_change_orders(cursor: Any, job_numbers: Sequence[int]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """SELECT only: prime change orders and their lines for these Sage jobs."""
    if not job_numbers:
        return [], []
    placeholders = ", ".join(["%d"] * len(job_numbers))
    cursor.execute(
        f"""
        SELECT recnum, chgnum, chgdte, jobnum, dscrpt, status, appamt, aprdte
        FROM dbo.prmchg WITH (NOLOCK)
        WHERE jobnum IN ({placeholders})
        ORDER BY jobnum, recnum
        """,
        tuple(job_numbers),
    )
    headers = [dict(row) for row in cursor.fetchall()]
    cursor.execute(
        f"""
        SELECT l.recnum, l.linnum, l.dscrpt, l.aprprc, l.cstcde, l.csttyp
        FROM dbo.pmcgln l WITH (NOLOCK)
        JOIN dbo.prmchg c WITH (NOLOCK) ON c.recnum = l.recnum
        WHERE c.jobnum IN ({placeholders})
        ORDER BY l.recnum, l.linnum
        """,
        tuple(job_numbers),
    )
    lines = [dict(row) for row in cursor.fetchall()]
    return headers, lines


def fetch_proposal_lines(cursor: Any, job_numbers: Sequence[int]) -> list[dict[str, Any]]:
    """SELECT only: proposal lines for these Sage jobs (a proposal is keyed by job)."""
    if not job_numbers:
        return []
    placeholders = ", ".join(["%d"] * len(job_numbers))
    cursor.execute(
        f"""
        SELECT recnum, linnum, cstcde, dscrpt, ttlprp
        FROM dbo.prplin WITH (NOLOCK)
        WHERE recnum IN ({placeholders})
        ORDER BY recnum, phsnum, linnum
        """,
        tuple(job_numbers),
    )
    return [dict(row) for row in cursor.fetchall()]


def build_snapshot(
    jobs: Sequence[Mapping[str, str]],
    headers: Sequence[Mapping[str, Any]],
    lines: Sequence[Mapping[str, Any]],
    captured_at: str,
    proposal_lines: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    proposals_by_job: dict[str, list[dict[str, Any]]] = {}
    for line in proposal_lines:
        proposals_by_job.setdefault(record_number(line.get("recnum")), []).append(
            {
                "lineNumber": int(line.get("linnum") or 0),
                "costCode": record_number(line.get("cstcde")) or None,
                "description": text(line.get("dscrpt"))[:200],
                "totalCents": cents(line.get("ttlprp")),
            }
        )
    lines_by_order: dict[str, list[dict[str, Any]]] = {}
    for line in lines:
        lines_by_order.setdefault(record_number(line.get("recnum")), []).append(
            {
                "lineNumber": int(line.get("linnum") or 0),
                "description": text(line.get("dscrpt"))[:200],
                "costCode": record_number(line.get("cstcde")) or None,
                "costType": int(line["csttyp"]) if line.get("csttyp") is not None else None,
                "approvedAmountCents": cents(line.get("aprprc")),
            }
        )
    orders_by_job: dict[str, list[dict[str, Any]]] = {}
    for header in headers:
        recnum = record_number(header.get("recnum"))
        orders_by_job.setdefault(record_number(header.get("jobnum")), []).append(
            {
                "sageRecordId": recnum,
                "changeOrderNumber": text(header.get("chgnum"))[:40],
                "changeOrderDate": iso_date(header.get("chgdte")),
                "description": text(header.get("dscrpt"))[:200],
                "sageStatusNumber": int(header["status"]) if header.get("status") is not None else None,
                "approvedAmountCents": cents(header.get("appamt")),
                "approvedDate": iso_date(header.get("aprdte")),
                "lines": lines_by_order.get(recnum, []),
            }
        )
    return {
        "capturedAt": captured_at,
        "jobs": [
            {
                "projectId": job["projectId"],
                "sageJobNumber": job["sageJobNumber"],
                "changeOrders": orders_by_job.get(job["sageJobNumber"], []),
                "proposal": {"lines": proposals_by_job.get(job["sageJobNumber"], [])},
            }
            for job in jobs
        ],
    }


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


def read_once(base_url: str, secrets: Sequence[str]) -> dict[str, int]:
    jobs = parse_jobs(signed_json_request_with_fallback(base_url, secrets, "GET", REQUESTS_TARGET))
    if not jobs:
        return {"jobs": 0, "changeOrders": 0}
    total = 0
    connection = connect_sage()
    try:
        cursor = connection.cursor(as_dict=True)
        for start in range(0, len(jobs), JOB_CHUNK):
            chunk = jobs[start : start + JOB_CHUNK]
            numbers = sorted({int(job["sageJobNumber"]) for job in chunk})
            headers, lines = fetch_change_orders(cursor, numbers)
            proposal_lines = fetch_proposal_lines(cursor, numbers)
            snapshot = build_snapshot(chunk, headers, lines, dt.datetime.now(dt.timezone.utc).isoformat(), proposal_lines)
            signed_json_request_with_fallback(base_url, secrets, "POST", RESULTS_TARGET, snapshot, timeout=45)
            total += len(headers)
    finally:
        connection.close()
    return {"jobs": len(jobs), "changeOrders": total}


def acquire_lock() -> Any:
    lock = LOCK_PATH.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        lock.close()
        raise ReaderError("Another Sage prime change order reader is active") from error
    return lock


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Read once and exit")
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
            result = read_once(base_url, secrets)
            print(json.dumps({"status": "ok", **result, "at": dt.datetime.now(dt.timezone.utc).isoformat()}), flush=True)
            if args.once:
                return 0
            time.sleep(600)
    finally:
        lock.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReaderError as error:
        print(json.dumps({"status": "error", "error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error
