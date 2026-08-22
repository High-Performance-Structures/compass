#!/usr/bin/env python3
"""Execute bounded Compass lifecycle requests from the private bridge queue."""

from __future__ import annotations

import hashlib
import hmac
import importlib
import importlib.util
import json
import logging
import os
import re
import signal
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

MAX_RESPONSE_BYTES = 64 * 1024
MAX_REQUEST_BYTES = 64 * 1024
MAX_EVENT_BATCH = 20
RETRY_AFTER_SECONDS = 30
PULL_TARGET = (
    "/api/integrations/jarvis/events"
    "?limit=20&eventType=feedback.lifecycle_requested"
)
HEALTH_TARGET = "/api/integrations/jarvis/health"
EVENT_TYPE = "feedback.lifecycle_requested"
LOGGER = logging.getLogger("compass-jarvis-feedback-lifecycle-executor")
RUNNING = True

UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
GITHUB_ISSUE_PATTERN = re.compile(
    r"^https://github\.com/[^/\s]+/[^/\s]+/issues/[1-9][0-9]*(?:/)?$"
)
GITHUB_PULL_REQUEST_PATTERN = re.compile(
    r"^https://github\.com/[^/\s]+/[^/\s]+/pull/[1-9][0-9]*(?:/)?$"
)
ALLOWED_STATUSES = frozenset(
    {
        "new",
        "triaged",
        "needs_info",
        "planned",
        "in_progress",
        "testing",
        "deployed",
        "closed",
    }
)
ALLOWED_KINDS = frozenset({"bug", "question", "general", "assistance"})
ALLOWED_PRIORITIES = frozenset({"low", "normal", "high", "urgent"})
ALLOWED_PAYLOAD_KEYS = frozenset(
    {
        "schemaVersion",
        "itemId",
        "kind",
        "status",
        "message",
        "priority",
        "githubIssueUrl",
        "draftPullRequestUrl",
        "idempotencyKey",
    }
)
HELPER_PAYLOAD_KEYS = frozenset(ALLOWED_PAYLOAD_KEYS - {"schemaVersion", "kind"})


class InvalidLifecycleRequest(ValueError):
    """A request is malformed or outside the non-feature contract."""


class RetryableExecutionError(RuntimeError):
    """The private runtime should leave the event eligible for retry."""


class TerminalExecutionError(RuntimeError):
    """The request must remain visible as a terminal failure."""


def _load_lifecycle_helper() -> Any:
    """Load the co-installed constrained helper, with a fixed repo fallback."""
    try:
        module = importlib.import_module("compass_feedback_bridge")
        return module.request_feedback_status
    except ImportError:
        helper_path = (
            Path(__file__).resolve().parents[1]
            / "skills/compass-feedback-desk/scripts/compass_feedback_bridge.py"
        )
        spec = importlib.util.spec_from_file_location(
            "compass_feedback_bridge",
            helper_path,
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("Constrained lifecycle helper is unavailable")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.request_feedback_status


request_feedback_status: Callable[[object], dict[str, object]] = (
    _load_lifecycle_helper()
)


def stop_running(_signum: int, _frame: Any) -> None:
    global RUNNING
    RUNNING = False


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def signature(
    secret: str,
    timestamp: str,
    method: str,
    target: str,
    body: bytes,
) -> str:
    prefix = f"{timestamp}.{method.upper()}.{target}.".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), prefix + body, hashlib.sha256)
    return f"sha256={digest.hexdigest()}"


def validate_runtime_origin() -> None:
    configured = os.environ.get("COMPASS_BASE_URL", "").rstrip("/")
    if configured != "https://compass.openrangeconstruction.ltd":
        raise InvalidLifecycleRequest(
            "Lifecycle executor requires the production Compass origin"
        )
    parsed = urllib.parse.urlsplit(configured)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "compass.openrangeconstruction.ltd"
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise InvalidLifecycleRequest("Lifecycle executor origin is invalid")


def lifecycle_target(item_id: object) -> str:
    if not isinstance(item_id, str) or UUID_PATTERN.fullmatch(item_id) is None:
        raise InvalidLifecycleRequest("itemId must be a UUID")
    return (
        "/api/integrations/jarvis/feedback/"
        f"{urllib.parse.quote(item_id, safe='')}/status"
    )


def _is_retryable_http_error(error: urllib.error.HTTPError) -> bool:
    return error.code in {408, 425, 429} or error.code >= 500


def _is_retryable_bridge_error(error: BaseException) -> bool:
    if isinstance(error, urllib.error.HTTPError):
        return _is_retryable_http_error(error)
    cause = error.__cause__
    if isinstance(cause, urllib.error.HTTPError):
        return _is_retryable_http_error(cause)
    return isinstance(error, (TimeoutError, urllib.error.URLError))


def validate_lifecycle_payload(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise InvalidLifecycleRequest("Lifecycle request must be an object")
    if set(payload) - ALLOWED_PAYLOAD_KEYS:
        raise InvalidLifecycleRequest("Lifecycle request contains unsupported fields")
    if payload.get("schemaVersion") != 1:
        raise InvalidLifecycleRequest("Unsupported lifecycle request schema")
    kind = payload.get("kind")
    if not isinstance(kind, str) or kind not in ALLOWED_KINDS:
        raise InvalidLifecycleRequest("Only approved non-feature requests are supported")
    status = payload.get("status")
    if not isinstance(status, str) or status not in ALLOWED_STATUSES:
        raise InvalidLifecycleRequest("Lifecycle status is not allowed")
    idempotency_key = payload.get("idempotencyKey")
    if (
        not isinstance(idempotency_key, str)
        or IDEMPOTENCY_KEY_PATTERN.fullmatch(idempotency_key) is None
    ):
        raise InvalidLifecycleRequest("idempotencyKey is invalid")

    message = payload.get("message")
    if message is not None and (
        not isinstance(message, str) or not message.strip() or len(message) > 2_000
    ):
        raise InvalidLifecycleRequest("message is invalid")
    priority = payload.get("priority")
    if priority is not None and (
        not isinstance(priority, str) or priority not in ALLOWED_PRIORITIES
    ):
        raise InvalidLifecycleRequest("priority is invalid")
    for key, pattern in (
        ("githubIssueUrl", GITHUB_ISSUE_PATTERN),
        ("draftPullRequestUrl", GITHUB_PULL_REQUEST_PATTERN),
    ):
        value = payload.get(key)
        if value is not None and (
            not isinstance(value, str)
            or len(value) > 2_048
            or pattern.fullmatch(value) is None
        ):
            raise InvalidLifecycleRequest(f"{key} is invalid")

    lifecycle_target(payload.get("itemId"))
    normalized = dict(payload)
    encoded = json.dumps(normalized, separators=(",", ":"), ensure_ascii=False)
    if len(encoded.encode("utf-8")) > MAX_REQUEST_BYTES:
        raise InvalidLifecycleRequest("Lifecycle request is too large")
    return normalized


def _allowed_target(target: str) -> bool:
    if target == PULL_TARGET or target == HEALTH_TARGET:
        return True
    return bool(
        re.fullmatch(
            r"/api/integrations/jarvis/events/"
            r"[0-9a-fA-F-]{36}/ack",
            target,
        )
    )


def compass_request(
    method: str,
    target: str,
    payload: dict[str, object] | None = None,
) -> Any:
    if not _allowed_target(target):
        raise InvalidLifecycleRequest("Bridge target is not allowlisted")
    base_url = required_env("COMPASS_BASE_URL").rstrip("/")
    secret = required_env("JARVIS_BRIDGE_SECRET")
    validate_runtime_origin()
    body = (
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if payload is not None
        else b""
    )
    timestamp = str(int(time.time()))
    request = urllib.request.Request(
        f"{base_url}{target}",
        data=body if body else None,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json" if body else "",
            "User-Agent": "Compass-Jarvis-Feedback-Lifecycle-Executor/1.0",
            "X-Compass-Timestamp": timestamp,
            "X-Compass-Signature": signature(secret, timestamp, method, target, body),
        },
        method=method,
    )
    # urllib's default opener follows redirects. This executor never does.
    opener = urllib.request.build_opener(_NoRedirectHandler())
    try:
        with opener.open(request, timeout=30) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise TerminalExecutionError("Compass response exceeded the allowed size")
    except urllib.error.HTTPError as error:
        if _is_retryable_http_error(error):
            raise RetryableExecutionError("Compass temporarily rejected the request") from error
        raise TerminalExecutionError("Compass rejected the bridge request") from error
    except (TimeoutError, urllib.error.URLError) as error:
        raise RetryableExecutionError("Compass bridge request failed") from error
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise TerminalExecutionError("Compass returned invalid JSON") from error


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: object,
        code: int,
        msg: str,
        headers: object,
        newurl: str,
    ) -> None:
        return None


def redact_result(response: object) -> dict[str, object]:
    if not isinstance(response, dict):
        return {"success": False, "error": "compass_rejected_feedback_status"}
    if response.get("success") is not True:
        return {"success": False, "error": "compass_rejected_feedback_status"}
    result: dict[str, object] = {"success": True}
    for key in (
        "duplicate",
        "feedbackDeskItemId",
        "status",
        "notifiedUserCount",
        "requesterUpdateQueued",
    ):
        if key in response:
            result[key] = response[key]
    return result


def execute_lifecycle(payload: object) -> dict[str, object]:
    normalized = validate_lifecycle_payload(payload)
    helper_payload = {
        key: value
        for key, value in normalized.items()
        if key in HELPER_PAYLOAD_KEYS
    }
    try:
        response = request_feedback_status(helper_payload)
    except urllib.error.HTTPError as error:
        if _is_retryable_http_error(error):
            raise RetryableExecutionError("Lifecycle endpoint is temporarily unavailable") from error
        raise TerminalExecutionError("Lifecycle endpoint rejected the request") from error
    except (TimeoutError, urllib.error.URLError) as error:
        raise RetryableExecutionError("Lifecycle endpoint is temporarily unavailable") from error
    except ValueError as error:
        raise TerminalExecutionError("Lifecycle endpoint rejected the request") from error
    except RuntimeError as error:
        if _is_retryable_bridge_error(error):
            raise RetryableExecutionError("Lifecycle endpoint is temporarily unavailable") from error
        raise TerminalExecutionError("Lifecycle endpoint rejected the request") from error
    return redact_result(response)


def acknowledge(event_id: str, body: dict[str, object]) -> None:
    if UUID_PATTERN.fullmatch(event_id) is None:
        raise InvalidLifecycleRequest("Bridge event ID is invalid")
    escaped_id = urllib.parse.quote(event_id, safe="")
    compass_request("POST", f"/api/integrations/jarvis/events/{escaped_id}/ack", body)


def handle_event(event: dict[str, object]) -> None:
    event_id = event.get("id")
    payload = event.get("payload")
    if (
        not isinstance(event_id, str)
        or event.get("eventType") != EVENT_TYPE
        or event.get("source") != "feedback-desk"
    ):
        if isinstance(event_id, str):
            acknowledge(event_id, {"status": "failed", "error": "invalid_lifecycle_request"})
        return
    try:
        result = execute_lifecycle(payload)
    except InvalidLifecycleRequest:
        acknowledge(event_id, {"status": "failed", "error": "invalid_lifecycle_request"})
        return
    except RetryableExecutionError:
        acknowledge(
            event_id,
            {
                "status": "failed",
                "error": "lifecycle_endpoint_temporarily_unavailable",
                "retryAfterSeconds": RETRY_AFTER_SECONDS,
            },
        )
        return
    except TerminalExecutionError:
        acknowledge(event_id, {"status": "failed", "error": "lifecycle_execution_failed"})
        return

    if result.get("success") is not True:
        acknowledge(event_id, {"status": "failed", "error": "compass_rejected_feedback_status"})
        return
    acknowledge(event_id, {"status": "completed", "result": result})


def heartbeat(status: str, error: str | None = None) -> bool:
    try:
        compass_request(
            "POST",
            HEALTH_TARGET,
            {
                "serviceName": "jarvis-feedback-lifecycle-executor",
                "status": status,
                "error": error[:2000] if error else None,
            },
        )
        return True
    except Exception:
        LOGGER.warning("Could not record lifecycle executor heartbeat", exc_info=True)
        return False


def run_once() -> None:
    response = compass_request("GET", PULL_TARGET)
    events = response.get("events") if isinstance(response, dict) else None
    if not isinstance(events, list):
        raise TerminalExecutionError("Compass queue response is invalid")
    heartbeat("healthy")
    for event in events:
        if isinstance(event, dict):
            handle_event(event)


def run() -> None:
    poll_seconds = max(0.5, float(os.environ.get("COMPASS_FEEDBACK_LIFECYCLE_POLL_SECONDS", "2")))
    while RUNNING:
        try:
            run_once()
            time.sleep(poll_seconds)
        except RetryableExecutionError:
            heartbeat("failed", "lifecycle queue temporarily unavailable")
            time.sleep(5)
        except Exception:
            heartbeat("failed", "lifecycle queue execution failed")
            LOGGER.exception("Lifecycle queue cycle failed")
            time.sleep(5)


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    signal.signal(signal.SIGTERM, stop_running)
    signal.signal(signal.SIGINT, stop_running)
    required_env("COMPASS_BASE_URL")
    required_env("JARVIS_BRIDGE_SECRET")
    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
