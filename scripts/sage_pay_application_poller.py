#!/usr/bin/env python3
"""Read-only Sage 100 Contractor pay-application poller for Compass.

SQL credentials and the Compass HMAC secret are injected by Signet. The
process never sends SQL credentials to Compass and never writes to Sage.
"""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


DEFAULT_COMPASS_BASE_URL = "https://compass.openrangeconstruction.ltd"
DEFAULT_SAGE_SERVER = "100.100.201.24"
DEFAULT_SAGE_PORT = 14330
DEFAULT_SAGE_DATABASE = "High Performance Structures Inc"
DEFAULT_SAGE_USERNAME = "hps_jarvis_readonly"
REQUESTS_TARGET = "/api/integrations/sage/pay-applications/requests?limit=10"
RESULTS_TARGET = "/api/integrations/sage/pay-applications/results"
LOCK_PATH = Path("/tmp/compass-sage-pay-application-poller.lock")
SNAPSHOT_MAPPING_VERSION = "v2"


CSI_DIVISIONS = {
    "00": "Procurement and Contracting Requirements",
    "01": "General Requirements",
    "02": "Existing Conditions",
    "03": "Concrete",
    "04": "Masonry",
    "05": "Metals",
    "06": "Wood, Plastics, and Composites",
    "07": "Thermal and Moisture Protection",
    "08": "Openings",
    "09": "Finishes",
    "10": "Specialties",
    "11": "Equipment",
    "12": "Furnishings",
    "13": "Special Construction",
    "14": "Conveying Equipment",
    "21": "Fire Suppression",
    "22": "Plumbing",
    "23": "Heating, Ventilating, and Air Conditioning",
    "25": "Integrated Automation",
    "26": "Electrical",
    "27": "Communications",
    "28": "Electronic Safety and Security",
    "31": "Earthwork",
    "32": "Exterior Improvements",
    "33": "Utilities",
    "34": "Transportation",
    "35": "Waterway and Marine Construction",
    "40": "Process Integration",
    "41": "Material Processing and Handling Equipment",
    "42": "Process Heating, Cooling, and Drying Equipment",
    "43": "Process Gas and Liquid Handling, Purification, and Storage Equipment",
    "44": "Pollution and Waste Control Equipment",
    "45": "Industry-Specific Manufacturing Equipment",
    "46": "Water and Wastewater Equipment",
    "48": "Electrical Power Generation",
}


class PollerError(RuntimeError):
    pass


@dataclass(frozen=True)
class PollRequest:
    run_id: str
    project_id: str
    sage_job_id: str | None
    sage_job_number: str | None
    claim_token: str


def text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def money(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return round(float(value), 2)
    return round(float(value), 2)


def iso_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    normalized = text(value)
    if normalized is None:
        return None
    return normalized[:10]


def iso_timestamp(value: Any) -> str:
    if isinstance(value, dt.datetime):
        timestamp = value
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=dt.timezone.utc)
        return timestamp.isoformat()
    if isinstance(value, dt.date):
        return dt.datetime.combine(
            value, dt.time.min, tzinfo=dt.timezone.utc
        ).isoformat()
    normalized = text(value)
    return normalized or "unknown"


def division_code(line: Mapping[str, Any]) -> str:
    for field in ("dscrpt", "cdenme"):
        description = text(line.get(field)) or ""
        match = re.match(r"^(\d{2})(?:\s|$)", description)
        if match:
            return match.group(1)

    for field in ("divnum", "master_divnum"):
        raw = line.get(field)
        if raw is None:
            continue
        try:
            number = int(Decimal(str(raw)))
            if number == 100:
                return "00"
            if 0 <= number <= 99:
                return f"{number:02d}"
        except (ValueError, TypeError, ArithmeticError):
            pass

    cost_code = text(line.get("cstcde")) or ""
    digits = "".join(character for character in cost_code if character.isdigit())
    return digits[:2] if len(digits) >= 2 else "00"


def normalized_cost_code(value: Any) -> str:
    if isinstance(value, Decimal):
        return format(value, "f")
    return text(value) or "Unassigned"


def build_snapshot(
    request: PollRequest,
    header: Mapping[str, Any],
    lines: Sequence[Mapping[str, Any]],
    captured_at: str,
) -> dict[str, Any]:
    if not lines:
        raise PollerError("The Sage pay application has no G703 lines")

    header_updated = iso_timestamp(header.get("upddte"))
    line_updated = max(iso_timestamp(line.get("upddte")) for line in lines)
    source_application_id = f"sage-aiafrm:{header['recnum']}"
    source_revision = (
        f"mapping={SNAPSHOT_MAPPING_VERSION};header={header_updated};"
        f"lines={line_updated};count={len(lines)}"
    )

    normalized_lines: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        code = division_code(line)
        normalized_lines.append(
            {
                "sourceLineId": f"sage-aialin:{line['recnum']}:{line['linnum']}",
                "costCode": normalized_cost_code(line.get("cstcde")),
                "csiDivision": code,
                "csiDivisionName": CSI_DIVISIONS.get(code, f"Division {code}"),
                "description": text(line.get("dscrpt"))
                or text(line.get("cdenme"))
                or "Sage G703 line",
                "originalEstimate": money(line.get("schamt")),
                "priorChanges": money(line.get("chgamt")),
                "currentChanges": 0.0,
                "totalChanges": money(line.get("chgamt")),
                "adjustedEstimate": money(line.get("newcon")),
                "previousWorkCompleted": money(line.get("prvbll")),
                "currentWorkCompleted": money(line.get("curbll")),
                "storedMaterials": money(line.get("strmat")),
                "totalCompletedStoredToDate": money(line.get("ttlcmp")),
                "retainageHeld": money(line.get("retamt")),
                "balanceToFinish": money(line.get("balfin")),
                "sortOrder": index,
            }
        )

    # Sage's ttlern field is not populated on the live AIA headers even when
    # the G703 has completed work. Derive the AIA "total earned less
    # retainage" from the populated header totals so the value is both
    # auditable and consistent with the line-level reconciliation.
    total_completed_stored = money(header.get("cmpttl"))
    retainage_held = money(header.get("ttlret"))
    total_earned_less_retainage = round(
        total_completed_stored - retainage_held, 2
    )

    return {
        "runId": request.run_id,
        "claimToken": request.claim_token,
        "capturedAt": captured_at,
        "header": {
            "sourceApplicationId": source_application_id,
            "sourceRevision": source_revision,
            "sageJobId": text(header.get("sage_job_id")),
            "sageJobNumber": text(header.get("jobnum")),
            "applicationNumber": text(header.get("appnum"))
            or text(header.get("recnum"))
            or "Unknown",
            "periodTo": iso_date(header.get("period")),
            "status": text(header.get("status")) or "unknown",
            "originalContractSum": money(header.get("schttl")),
            "netChanges": money(header.get("chgttl")),
            "contractSumToDate": money(header.get("conttl")),
            "totalCompletedStoredToDate": total_completed_stored,
            "retainageHeld": retainage_held,
            "totalEarnedLessRetainage": total_earned_less_retainage,
            "previousCertificates": money(header.get("prvbil")),
            "currentPaymentDue": money(header.get("crtdue")),
            "balanceToFinish": money(header.get("balfin")),
        },
        "lines": normalized_lines,
    }


def signature(
    secret: str,
    timestamp: str,
    request_id: str,
    method: str,
    target: str,
    raw_body: str,
) -> str:
    payload = f"{timestamp}.{request_id}.{method.upper()}.{target}.{raw_body}"
    digest = hmac.new(
        secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"sha256={digest}"


def signed_json_request(
    base_url: str,
    secret: str,
    method: str,
    target: str,
    body: Mapping[str, Any] | None = None,
    timeout: int = 30,
) -> Any:
    raw_body = "" if body is None else json.dumps(body, separators=(",", ":"))
    timestamp = str(int(time.time()))
    request_id = str(uuid.uuid4())
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 Compass-Sage-Bridge/1.0",
        "X-Compass-Timestamp": timestamp,
        "X-Compass-Request-Id": request_id,
        "X-Compass-Signature": signature(
            secret, timestamp, request_id, method, target, raw_body
        ),
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = raw_body.encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{target}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1000]
        raise PollerError(f"Compass returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise PollerError(f"Compass request failed: {error.reason}") from error


def parse_poll_requests(payload: Any) -> list[PollRequest]:
    if not isinstance(payload, Mapping):
        raise PollerError("Compass returned an invalid poll response")
    raw_requests = payload.get("requests")
    if not isinstance(raw_requests, list):
        raise PollerError("Compass poll response is missing requests")

    requests: list[PollRequest] = []
    for raw in raw_requests:
        if not isinstance(raw, Mapping):
            raise PollerError("Compass returned an invalid sync request")
        run_id = text(raw.get("id"))
        project_id = text(raw.get("projectId"))
        claim_token = text(raw.get("claimToken"))
        if run_id is None or project_id is None or claim_token is None:
            raise PollerError("Compass returned an incomplete sync request")
        requests.append(
            PollRequest(
                run_id=run_id,
                project_id=project_id,
                sage_job_id=text(raw.get("sageJobId")),
                sage_job_number=text(raw.get("sageJobNumber")),
                claim_token=claim_token,
            )
        )
    return requests


def resolve_sage_job(request: PollRequest) -> int:
    # Compass stores Sage's stable row identity in sage_job_id and the numeric
    # actrec.recnum used by AIA tables in sage_job_number.
    for candidate in (request.sage_job_number, request.sage_job_id):
        if candidate is None:
            continue
        try:
            return int(Decimal(candidate))
        except (ValueError, TypeError, ArithmeticError):
            continue
    raise PollerError(
        f"Project {request.project_id} does not have a numeric Sage job mapping"
    )


def fetch_latest_application(cursor: Any, sage_job: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    cursor.execute(
        """
        SELECT TOP 1
          application.recnum, application.jobnum, job._idnum AS sage_job_id,
          application.appnum, application.period, application.status,
          application.schttl, application.chgttl, application.conttl,
          application.cmpttl, application.ttlret, application.ttlern,
          application.prvbil, application.crtdue, application.balfin,
          application.upddte
        FROM dbo.aiafrm application
        JOIN dbo.actrec job ON job.recnum=application.jobnum
        WHERE application.jobnum=%s
        ORDER BY application.period DESC, application.appnum DESC,
          application.recnum DESC
        """,
        (sage_job,),
    )
    header = cursor.fetchone()
    if not header:
        raise PollerError(f"No Sage pay application exists for job {sage_job}")
    cursor.execute(
        """
        SELECT
          line.recnum, line.linnum, line.divnum, line.cstcde,
          cost_code.cdenme, cost_code.divnum AS master_divnum, line.dscrpt,
          line.schamt, line.chgamt,
          line.newcon, line.prvbll, line.curbll, line.strmat, line.ttlcmp,
          line.retamt, line.balfin, line.upddte
        FROM dbo.aialin line
        LEFT JOIN dbo.cstcde cost_code ON cost_code.recnum=line.cstcde
        WHERE line.recnum=%s
        ORDER BY line.linnum
        """,
        (header["recnum"],),
    )
    return dict(header), [dict(line) for line in cursor.fetchall()]


def connect_sage() -> Any:
    try:
        import pymssql
    except ImportError as error:
        raise PollerError("pymssql is not installed") from error

    password = os.environ.get("HPS_SAGE_SQL_PASSWORD", "").strip()
    if not password:
        raise PollerError("HPS_SAGE_SQL_PASSWORD is not available")
    try:
        return pymssql.connect(
            server=os.environ.get("HPS_SAGE_SQL_SERVER", DEFAULT_SAGE_SERVER),
            port=int(os.environ.get("HPS_SAGE_SQL_PORT", str(DEFAULT_SAGE_PORT))),
            user=os.environ.get("HPS_SAGE_SQL_USERNAME", DEFAULT_SAGE_USERNAME),
            password=password,
            database=os.environ.get(
                "HPS_SAGE_SQL_DATABASE", DEFAULT_SAGE_DATABASE
            ),
            # Sage's login trigger recognizes the established Jarvis read-only
            # application identity and the broken-bar separator.
            appname="Sage100Contractor¦JarvisCompassPayAppRO",
            login_timeout=15,
            timeout=120,
            autocommit=True,
        )
    except Exception as error:
        raise PollerError(
            f"Sage SQL connection failed: {type(error).__name__}"
        ) from error


def process_requests(requests: Iterable[PollRequest], base_url: str, secret: str) -> int:
    processed = 0
    connection = connect_sage()
    try:
        cursor = connection.cursor(as_dict=True)
        for request in requests:
            sage_job = resolve_sage_job(request)
            header, lines = fetch_latest_application(cursor, sage_job)
            captured_at = dt.datetime.now(dt.timezone.utc).isoformat()
            snapshot = build_snapshot(request, header, lines, captured_at)
            signed_json_request(
                base_url, secret, "POST", RESULTS_TARGET, snapshot, timeout=45
            )
            processed += 1
    finally:
        connection.close()
    return processed


def poll_once(base_url: str, secret: str) -> tuple[int, int]:
    payload = signed_json_request(
        base_url, secret, "GET", REQUESTS_TARGET, timeout=30
    )
    requests = parse_poll_requests(payload)
    if not requests:
        return 0, 0
    processed = process_requests(requests, base_url, secret)
    return len(requests), processed


def acquire_lock() -> Any:
    lock = LOCK_PATH.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        lock.close()
        raise PollerError("Another Sage pay-application poller is active") from error
    return lock


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Poll once and exit")
    args = parser.parse_args()

    base_url = os.environ.get("COMPASS_BASE_URL", DEFAULT_COMPASS_BASE_URL).strip()
    secret = os.environ.get("SAGE_BRIDGE_SECRET", "").strip()
    if len(secret) < 32:
        raise PollerError("SAGE_BRIDGE_SECRET is not available or is too short")

    lock = acquire_lock()
    try:
        while True:
            requested, processed = poll_once(base_url, secret)
            print(
                json.dumps(
                    {
                        "status": "ok",
                        "requested": requested,
                        "processed": processed,
                        "at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    }
                ),
                flush=True,
            )
            if args.once:
                return 0
            time.sleep(30)
    finally:
        lock.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PollerError as error:
        print(json.dumps({"status": "error", "error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error
