#!/usr/bin/env python3
"""Emit only actionable Compass Feedback Desk bridge-health alerts."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

APPROVED_REPO_ROOT = Path("/Users/martine/dev/compass")
REPO_ROOT_ENVIRONMENT_VARIABLE = "COMPASS_REPO_ROOT"
EXPECTED_RESULT_SET_COUNT = 5
SQL = """
SELECT status, COUNT(*) AS count
FROM feedback_desk_items
GROUP BY status
ORDER BY status;

SELECT
  CASE WHEN assigned_to_user_id IS NULL THEN 'unassigned' ELSE 'assigned' END AS owner,
  COUNT(*) AS count
FROM feedback_desk_items
WHERE status NOT IN ('deployed', 'closed')
GROUP BY owner
ORDER BY owner;

SELECT
  CASE WHEN sla_target_at < datetime('now') THEN 'overdue' ELSE 'within_sla_or_unset' END AS sla,
  COUNT(*) AS count
FROM feedback_desk_items
WHERE status NOT IN ('deployed', 'closed')
GROUP BY sla
ORDER BY sla;

SELECT status, COUNT(*) AS count
FROM jarvis_bridge_events
WHERE status IN ('pending', 'processing', 'failed')
GROUP BY status
ORDER BY status;

SELECT service_name, status, last_heartbeat_at, consecutive_failures
FROM feedback_service_health
ORDER BY service_name;
"""
MAX_QUERY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 1.0
QUERY_TIMEOUT_SECONDS = 90
STALE_AFTER_SECONDS = {
    "feedback-reconciler": 15 * 60,
    "jarvis-agent-poller": 2 * 60,
    "jarvis-feedback-notifier": 2 * 60,
}
HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
ALERT_STATE_PATH = HERMES_HOME / "state" / "compass-feedback-watchdog.json"
DESKTOP_NOTIFICATION_TITLE = "Hermes — Compass Feedback Desk"


class QueryFailure(RuntimeError):
    """A terminal query failure with no provider output attached."""

    def __init__(self, category: str, exit_status: int | None) -> None:
        self.category = category
        self.exit_status = exit_status
        status = str(exit_status) if exit_status is not None else "unavailable"
        super().__init__(
            f"query failed (category={category}, exit_status={status})"
        )


def normalize_imessage_recipient(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    recipient = value.strip()
    if re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient):
        return recipient
    digits = re.sub(r"\D", "", recipient)
    if len(digits) == 10 and digits[0] in "23456789":
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1") and digits[1] in "23456789":
        return "+" + digits
    return None


def alert_state_changed(previous: str | None, current: str | None) -> bool:
    return previous != current


def should_send_imessage(state_changed: bool, message: str | None) -> bool:
    return state_changed and message is not None


def last_alert_state() -> str | None:
    try:
        payload = json.loads(ALERT_STATE_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    value = payload.get("message") if isinstance(payload, dict) else None
    return value if isinstance(value, str) else None


def configured_imessage_recipient() -> str | None:
    try:
        result = subprocess.run(
            ["hermes", "config", "get", "compass_feedback_alerts.imessage_recipient"],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    return normalize_imessage_recipient(result.stdout)


def send_imessage_alert(message: str) -> None:
    recipient = configured_imessage_recipient()
    if recipient is None:
        return
    try:
        result = subprocess.run(
            ["imsg", "send", "--to", recipient, "--text", message, "--service", "imessage"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except OSError:
        print("imessage_notification_failed: process_start", file=sys.stderr)
        return
    if result.returncode != 0:
        print(
            f"imessage_notification_failed: process_exit:{result.returncode}",
            file=sys.stderr,
        )


def notify_desktop_when_changed(message: str | None) -> bool:
    previous = last_alert_state()
    if not alert_state_changed(previous, message):
        return False
    ALERT_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    ALERT_STATE_PATH.write_text(json.dumps({"message": message}, sort_keys=True))
    if message is None:
        return True
    try:
        subprocess.run(
            [
                "osascript",
                "-e",
                "on run argv\ndisplay notification (item 1 of argv) with title (item 2 of argv)\nend run",
                message,
                DESKTOP_NOTIFICATION_TITLE,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except OSError:
        print("desktop_notification_failed: process_start", file=sys.stderr)
    return True


def validate_repo_root(candidate: Path) -> Path:
    if not candidate.is_absolute():
        raise QueryFailure("repository_root_invalid", None)
    try:
        root = candidate.resolve(strict=True)
    except (OSError, RuntimeError):
        raise QueryFailure("repository_root_unavailable", None) from None
    if not root.is_dir():
        raise QueryFailure("repository_root_unavailable", None)
    if not (root / "package.json").is_file():
        raise QueryFailure("repository_root_invalid", None)
    if not (root / "node_modules/.bin/wrangler").is_file():
        raise QueryFailure("wrangler_unavailable", None)
    return root


def resolve_repo_root(
    script_path: Path = Path(__file__),
    environ: Mapping[str, str] | None = None,
) -> Path:
    """Resolve the approved checkout independently of the installed script path."""
    environment = os.environ if environ is None else environ
    configured_root = environment.get(REPO_ROOT_ENVIRONMENT_VARIABLE)
    candidate = Path(configured_root).expanduser() if configured_root else APPROVED_REPO_ROOT
    del script_path
    return validate_repo_root(candidate)


def query_command(repo_root: Path | None = None) -> list[str]:
    root = validate_repo_root(repo_root) if repo_root is not None else resolve_repo_root()
    return [
        str(root / "node_modules/.bin/wrangler"),
        "d1",
        "execute",
        "compass-db",
        "--remote",
        "--json",
        "--command",
        SQL,
    ]


def query_failure_from_result(returncode: int) -> QueryFailure:
    return QueryFailure("process_exit", returncode)


def parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def is_count(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def is_non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def is_count_row(row: object, key: str, allowed: frozenset[str] | None = None) -> bool:
    if not isinstance(row, dict):
        return False
    value = row.get(key)
    return (
        is_non_empty_string(value)
        and (allowed is None or value in allowed)
        and is_count(row.get("count"))
    )


def is_valid_result_set(item: object, index: int) -> bool:
    if not isinstance(item, dict) or item.get("success") is not True:
        return False
    result_rows = item.get("results")
    if not isinstance(result_rows, list):
        return False
    if index == 0:
        return all(is_count_row(row, "status") for row in result_rows)
    if index == 1:
        return all(
            is_count_row(row, "owner", frozenset({"assigned", "unassigned"}))
            for row in result_rows
        )
    if index == 2:
        return all(
            is_count_row(row, "sla", frozenset({"overdue", "within_sla_or_unset"}))
            for row in result_rows
        )
    if index == 3:
        return all(
            is_count_row(row, "status", frozenset({"pending", "processing", "failed"}))
            for row in result_rows
        )
    if index == 4:
        for row in result_rows:
            if not isinstance(row, dict):
                return False
            if not is_non_empty_string(row.get("service_name")):
                return False
            if not is_non_empty_string(row.get("status")):
                return False
            heartbeat = row.get("last_heartbeat_at")
            if heartbeat is not None and parse_timestamp(heartbeat) is None:
                return False
            if not is_count(row.get("consecutive_failures")):
                return False
        return True
    return False


def validate_query_payload(payload: object) -> list[dict[str, Any]] | None:
    if not isinstance(payload, list) or len(payload) != EXPECTED_RESULT_SET_COUNT:
        return None
    if not all(is_valid_result_set(item, index) for index, item in enumerate(payload)):
        return None
    return payload


def run_query(
    runner: Callable[..., Any] = subprocess.run,
    sleep: Callable[[float], None] = time.sleep,
    repo_root: Path | None = None,
) -> list[dict[str, Any]]:
    root = validate_repo_root(repo_root) if repo_root is not None else resolve_repo_root()
    command = query_command(root)
    for attempt in range(MAX_QUERY_ATTEMPTS):
        try:
            result = runner(
                command,
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
                timeout=QUERY_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            failure = QueryFailure("timeout", None)
        except OSError:
            failure = QueryFailure("process_start", None)
        else:
            if result.returncode != 0:
                failure = query_failure_from_result(result.returncode)
            else:
                try:
                    payload = json.loads(result.stdout)
                except json.JSONDecodeError:
                    failure = QueryFailure("malformed_json", result.returncode)
                else:
                    validated_payload = validate_query_payload(payload)
                    if validated_payload is not None:
                        return validated_payload
                    failure = QueryFailure("unexpected_response", result.returncode)
        if attempt == MAX_QUERY_ATTEMPTS - 1:
            raise failure
        sleep(RETRY_BACKOFF_SECONDS * (2**attempt))
    raise AssertionError("query retry loop did not terminate")


def rows(payload: list[dict[str, Any]], index: int) -> list[dict[str, Any]]:
    if index < 0 or index >= len(payload):
        raise QueryFailure("unexpected_response", None)
    value = payload[index].get("results")
    if not isinstance(value, list):
        raise QueryFailure("unexpected_response", None)
    return value


def count_by(rows_to_count: list[dict[str, Any]], key: str) -> dict[str, int]:
    return {
        str(row[key]): row["count"]
        for row in rows_to_count
        if is_count_row(row, key)
    }


def build_alerts(
    payload: list[dict[str, Any]],
    now: datetime | None = None,
) -> list[str]:
    alerts: list[str] = []
    owner = count_by(rows(payload, 1), "owner")
    unassigned = owner.get("unassigned", 0)
    if unassigned:
        alerts.append(f"{unassigned} open request(s) are unassigned")

    sla = count_by(rows(payload, 2), "sla")
    overdue = sla.get("overdue", 0)
    if overdue:
        alerts.insert(0, f"{overdue} open request(s) are overdue")

    queue = count_by(rows(payload, 3), "status")
    failed = queue.get("failed", 0)
    if failed:
        alerts.append(f"{failed} failed bridge event(s)")
    pending = queue.get("pending", 0)
    processing = queue.get("processing", 0)
    if pending or processing:
        alerts.append(f"bridge queue pending={pending}, processing={processing}")

    observed_at = now or datetime.now(timezone.utc)
    for service in rows(payload, 4):
        name = str(service["service_name"])
        status = str(service["status"])
        heartbeat = parse_timestamp(service.get("last_heartbeat_at"))
        stale_after = STALE_AFTER_SECONDS.get(name, 2 * 60)
        stale = heartbeat is None or (
            observed_at - heartbeat
        ).total_seconds() > stale_after
        failures = service["consecutive_failures"]
        if status != "healthy" or stale or failures > 0:
            reason = status
            if stale:
                reason += ", stale heartbeat"
            if failures > 0:
                reason += f", consecutive failures={failures}"
            alerts.append(f"{name}: {reason}")
    return alerts


def main() -> int:
    try:
        payload = run_query()
        alerts = build_alerts(payload)
    except QueryFailure as error:
        message = (
            "ALERT: Compass Feedback Desk monitor query failed "
            f"(category={error.category}, exit_status="
            f"{error.exit_status if error.exit_status is not None else 'unavailable'})"
        )
        state_changed = notify_desktop_when_changed(message)
        if state_changed and message is not None:
            send_imessage_alert(message)
        print(message)
        return 1

    message = (
        "ALERT: Compass Feedback Desk needs attention — " + "; ".join(alerts)
        if alerts
        else None
    )
    state_changed = notify_desktop_when_changed(message)
    if state_changed and message is not None:
        send_imessage_alert(message)
    if message:
        print(message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
