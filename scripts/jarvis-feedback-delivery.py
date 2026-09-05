#!/usr/bin/env python3
"""Create accountable Compass delivery graphs for confirmed bug events."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import signal
import subprocess
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
EVENT_TYPE = "feedback.delivery_requested"
COMPASS_ORIGIN = "https://compass.openrangeconstruction.ltd"
PULL_TARGET = (
    "/api/integrations/jarvis/events"
    "?limit=20&eventType=feedback.delivery_requested"
)
HEALTH_TARGET = "/api/integrations/jarvis/health"
LOGGER = logging.getLogger("compass-jarvis-feedback-delivery")
RUNNING = True

UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")


class InvalidDeliveryRequest(ValueError):
    """The event is malformed or outside the bug-only contract."""


class RetryableDeliveryError(RuntimeError):
    """The event should be returned to the durable queue for retry."""


class TerminalDeliveryError(RuntimeError):
    """The event should remain visible as a terminal failure."""


DeliveryGraph = dict[str, str]
TaskRunner = Callable[[dict[str, object]], str]


def stop_running(_signum: int, _frame: Any) -> None:
    global RUNNING
    RUNNING = False


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def validate_runtime_origin() -> str:
    configured = required_env("COMPASS_BASE_URL")
    parsed = urllib.parse.urlsplit(configured)
    if (
        configured != COMPASS_ORIGIN
        or parsed.scheme != "https"
        or parsed.hostname != "compass.openrangeconstruction.ltd"
        or parsed.port is not None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path
    ):
        raise InvalidDeliveryRequest("Delivery consumer requires the production Compass origin")
    return configured


def validate_item_id(value: object) -> str:
    if not isinstance(value, str) or UUID_PATTERN.fullmatch(value) is None:
        raise InvalidDeliveryRequest("feedbackDeskItemId must be a UUID")
    return value


def validate_delivery_payload(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise InvalidDeliveryRequest("Delivery request must be an object")
    allowed = {"schemaVersion", "feedbackDeskItemId", "reference", "kind"}
    if set(payload) - allowed:
        raise InvalidDeliveryRequest("Delivery request contains unsupported fields")
    if payload.get("schemaVersion") != 1:
        raise InvalidDeliveryRequest("Unsupported delivery request schema")
    item_id = validate_item_id(payload.get("feedbackDeskItemId"))
    if payload.get("kind") != "bug":
        raise InvalidDeliveryRequest("Only bug delivery requests are supported")
    reference = payload.get("reference")
    if reference != f"CFD-{item_id}":
        raise InvalidDeliveryRequest("Delivery reference does not match the feedback item")
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    if len(encoded.encode("utf-8")) > MAX_REQUEST_BYTES:
        raise InvalidDeliveryRequest("Delivery request is too large")
    return dict(payload)


def validate_event(event: object) -> tuple[str, str, dict[str, object]]:
    if not isinstance(event, dict):
        raise InvalidDeliveryRequest("Bridge event must be an object")
    event_id = event.get("id")
    claim_token = event.get("claimToken")
    if not isinstance(event_id, str) or UUID_PATTERN.fullmatch(event_id) is None:
        raise InvalidDeliveryRequest("Bridge event ID is invalid")
    if not isinstance(claim_token, str) or not claim_token or len(claim_token) > 128:
        raise InvalidDeliveryRequest("Bridge claim token is invalid")
    if event.get("eventType") != EVENT_TYPE or event.get("source") != "feedback-desk":
        raise InvalidDeliveryRequest("Unsupported feedback delivery event")
    return event_id, claim_token, validate_delivery_payload(event.get("payload"))


def _repo_root() -> str:
    configured = required_env("COMPASS_KANBAN_REPO_ROOT")
    path = Path(configured).expanduser().resolve()
    if (
        not path.is_absolute()
        or not path.exists()
        or not path.is_dir()
        or not (path / ".git").exists()
    ):
        raise TerminalDeliveryError(
            "Configured Compass Kanban repository must be a Git checkout"
        )
    return str(path)


def _assignee(name: str) -> str:
    return os.environ.get(name, "default").strip() or "default"


def _task_spec(
    payload: dict[str, object],
    stage: str,
    title: str,
    body: str,
    parent: str | None,
) -> dict[str, object]:
    reference = str(payload["reference"])
    item_id = str(payload["feedbackDeskItemId"])
    assignee_name = {
        "implementation": "COMPASS_KANBAN_IMPLEMENTATION_ASSIGNEE",
        "review": "COMPASS_KANBAN_REVIEW_ASSIGNEE",
        "release": "COMPASS_KANBAN_RELEASE_ASSIGNEE",
    }[stage]
    spec: dict[str, object] = {
        "title": title,
        "body": body,
        "assignee": _assignee(assignee_name),
        "workspace": f"worktree:{_repo_root()}",
        "branch": f"feedback-delivery/{item_id}/{stage}",
        "model": "gpt-5.6-luna",
        "provider": "openai-codex",
        "idempotencyKey": f"feedback-delivery:{item_id}:{stage}",
        "createdBy": "jarvis-feedback-delivery",
        "skill": {
            "implementation": "feedback-operations",
            "review": "independent-review-integrity",
            "release": "delivery-accountability",
        }[stage],
        "parent": parent,
    }
    # Only the opaque CFD reference and stage enter Kanban. Never add item data.
    if reference not in str(spec["title"]) or reference not in str(spec["body"]):
        raise TerminalDeliveryError("Delivery task spec lost its opaque reference")
    return spec


def _task_specs(payload: dict[str, object], implementation_id: str | None = None,
                review_id: str | None = None) -> list[dict[str, object]]:
    reference = str(payload["reference"])
    authorization = (
        "Approved bounded non-feature authorization applies to this bug lane. "
        "The protected Feedback Desk record remains the source of truth."
    )
    return [
        _task_spec(
            payload,
            "implementation",
            f"Implement Compass Feedback Desk bug {reference}",
            f"Implement the confirmed non-feature bug for {reference}. {authorization} "
            "Use only sanitized issue/evidence references from the protected Desk record.",
            None,
        ),
        _task_spec(
            payload,
            "review",
            f"Independent exact-head review for {reference}",
            f"Independently review the exact implementation head for {reference}. {authorization} "
            "Do not use requester content or private source metadata.",
            implementation_id,
        ),
        _task_spec(
            payload,
            "release",
            f"Release steward for {reference}",
            f"Release-steward verification for {reference}: merge, migration, deployment, "
            "and production evidence remain separate gates. " + authorization,
            review_id,
        ),
    ]


def _extract_task_id(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict):
        for key in ("id", "taskId", "task_id"):
            found = _extract_task_id(value.get(key))
            if found:
                return found
    return None


def _required_task_id(value: object) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 256:
        raise TerminalDeliveryError("Kanban task creation returned an invalid task ID")
    return value.strip()


def _kanban_environment() -> dict[str, str]:
    """Keep bridge credentials out of the local Kanban child process."""
    sensitive_fragments = (
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "API_KEY",
        "PRIVATE_KEY",
    )
    return {
        key: value
        for key, value in os.environ.items()
        if not any(fragment in key.upper() for fragment in sensitive_fragments)
    }


def run_kanban_create(spec: dict[str, object]) -> str:
    command = [
        "hermes", "kanban", "create", str(spec["title"]),
        "--body", str(spec["body"]),
        "--assignee", str(spec["assignee"]),
        "--workspace", str(spec["workspace"]),
        "--branch", str(spec["branch"]),
        "--idempotency-key", str(spec["idempotencyKey"]),
        "--model", str(spec["model"]),
        "--provider", str(spec["provider"]),
        "--created-by", str(spec["createdBy"]),
        "--skill", str(spec["skill"]),
        "--json",
    ]
    parent = spec.get("parent")
    if isinstance(parent, str) and parent:
        command.extend(["--parent", parent])
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
            env=_kanban_environment(),
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RetryableDeliveryError("Kanban task creation was unavailable") from error
    if result.returncode != 0:
        raise TerminalDeliveryError("Kanban task creation was rejected")
    try:
        parsed: object = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise TerminalDeliveryError("Kanban task creation returned invalid output") from error
    task_id = _extract_task_id(parsed)
    if task_id is None:
        raise TerminalDeliveryError("Kanban task creation returned no task ID")
    return task_id


def create_delivery_graph(
    payload: object,
    create_task: TaskRunner | None = None,
) -> DeliveryGraph:
    normalized = validate_delivery_payload(payload)
    runner = create_task or run_kanban_create
    specs = _task_specs(normalized)
    implementation_id = _required_task_id(runner(specs[0]))
    specs = _task_specs(normalized, implementation_id=implementation_id)
    review_id = _required_task_id(runner(specs[1]))
    specs = _task_specs(
        normalized,
        implementation_id=implementation_id,
        review_id=review_id,
    )
    release_id = _required_task_id(runner(specs[2]))
    return {
        "graphId": f"feedback-delivery-graph:{normalized['feedbackDeskItemId']}",
        "implementationTaskId": implementation_id,
        "reviewTaskId": review_id,
        "releaseTaskId": release_id,
    }


def signature(secret: str, timestamp: str, method: str, target: str, body: bytes) -> str:
    prefix = f"{timestamp}.{method.upper()}.{target}.".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), prefix + body, hashlib.sha256)
    return f"sha256={digest.hexdigest()}"


def _allowed_target(method: str, target: str) -> bool:
    parsed = urllib.parse.urlsplit(target)
    if parsed.scheme or parsed.netloc or parsed.fragment:
        return False
    if method.upper() == "GET":
        return target == PULL_TARGET
    if method.upper() == "POST":
        if target == HEALTH_TARGET:
            return True
        matched = re.fullmatch(
            r"/api/integrations/jarvis/feedback/([^/]+)/status|"
            r"/api/integrations/jarvis/events/([^/]+)/ack",
            parsed.path,
        )
        return matched is not None and not parsed.query and any(
            UUID_PATTERN.fullmatch(group or "") for group in matched.groups()
        )
    return False


def compass_request(
    method: str,
    target: str,
    payload: dict[str, object] | None = None,
) -> object:
    if not _allowed_target(method, target):
        raise InvalidDeliveryRequest("Bridge target is not allowlisted")
    base_url = validate_runtime_origin()
    secret = required_env("JARVIS_BRIDGE_SECRET")
    body = (
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if payload is not None else b""
    )
    timestamp = str(int(time.time()))
    request = urllib.request.Request(
        f"{base_url}{target}",
        data=body if body else None,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json" if body else "",
            "User-Agent": "Compass-Jarvis-Feedback-Delivery/1.0",
            "X-Compass-Timestamp": timestamp,
            "X-Compass-Signature": signature(secret, timestamp, method, target, body),
        },
        method=method,
    )
    opener = urllib.request.build_opener(_NoRedirectHandler())
    try:
        with opener.open(request, timeout=30) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise TerminalDeliveryError("Compass response exceeded the allowed size")
    except urllib.error.HTTPError as error:
        if error.code in {408, 425, 429} or error.code >= 500:
            raise RetryableDeliveryError("Compass temporarily rejected the request") from error
        raise TerminalDeliveryError("Compass rejected the bridge request") from error
    except (TimeoutError, urllib.error.URLError) as error:
        raise RetryableDeliveryError("Compass bridge request failed") from error
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise TerminalDeliveryError("Compass returned invalid JSON") from error


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: urllib.request.Request, fp: object, code: int,
                         msg: str, headers: object, newurl: str) -> None:
        return None


def attach_delivery_graph(payload: object, graph: DeliveryGraph) -> dict[str, object]:
    normalized = validate_delivery_payload(payload)
    item_id = str(normalized["feedbackDeskItemId"])
    target = f"/api/integrations/jarvis/feedback/{item_id}/status"
    response = compass_request("POST", target, {
        "idempotencyKey": f"delivery-graph-attach:{item_id}",
        "status": "triaged",
        "deliveryGraph": {
            "status": "created",
            "graphId": graph["graphId"],
            "implementationTaskId": graph["implementationTaskId"],
            "reviewTaskId": graph["reviewTaskId"],
            "releaseTaskId": graph["releaseTaskId"],
        },
    })
    if not isinstance(response, dict) or response.get("success") is not True:
        raise TerminalDeliveryError("Compass rejected the delivery graph attachment")
    returned_id = response.get("feedbackDeskItemId")
    if returned_id is not None and returned_id != item_id:
        raise TerminalDeliveryError("Compass returned the wrong feedback item")
    # Return only IDs created/adopted by this graph. Never relay the response body.
    return {"attached": True, **graph}


def acknowledge(event_id: str, claim_token: str, body: dict[str, object]) -> None:
    if UUID_PATTERN.fullmatch(event_id) is None or not claim_token or len(claim_token) > 128:
        raise InvalidDeliveryRequest("Acknowledgement identity is invalid")
    acknowledgement = dict(body)
    acknowledgement["claimToken"] = claim_token
    response = compass_request(
        "POST",
        f"/api/integrations/jarvis/events/{event_id}/ack",
        acknowledgement,
    )
    if not isinstance(response, dict) or response.get("success") is not True:
        raise TerminalDeliveryError("Compass rejected the event acknowledgement")


def execute_delivery(payload: object) -> dict[str, object]:
    normalized = validate_delivery_payload(payload)
    graph = create_delivery_graph(normalized)
    return attach_delivery_graph(normalized, graph)


def handle_event(event: object) -> str:
    try:
        event_id, claim_token, payload = validate_event(event)
    except InvalidDeliveryRequest:
        if isinstance(event, dict):
            raw_id = event.get("id")
            raw_claim = event.get("claimToken")
            if (
                isinstance(raw_id, str)
                and UUID_PATTERN.fullmatch(raw_id) is not None
                and isinstance(raw_claim, str)
                and raw_claim
                and len(raw_claim) <= 128
            ):
                acknowledge(raw_id, raw_claim, {
                    "status": "failed",
                    "error": "invalid_delivery_request",
                })
        return "failed"
    try:
        result = execute_delivery(payload)
    except InvalidDeliveryRequest:
        acknowledge(event_id, claim_token, {
            "status": "failed",
            "error": "invalid_delivery_request",
        })
        return "failed"
    except RetryableDeliveryError:
        acknowledge(event_id, claim_token, {
            "status": "failed",
            "error": "delivery_consumer_temporarily_unavailable",
            "retryAfterSeconds": RETRY_AFTER_SECONDS,
        })
        return "retryable"
    except TerminalDeliveryError:
        acknowledge(event_id, claim_token, {
            "status": "failed",
            "error": "delivery_graph_creation_or_attachment_failed",
        })
        return "failed"
    acknowledge(event_id, claim_token, {"status": "completed", "result": result})
    return "completed"


def heartbeat(status: str, error: str | None = None,
              metadata: dict[str, object] | None = None) -> bool:
    try:
        response = compass_request("POST", HEALTH_TARGET, {
            "serviceName": "jarvis-feedback-delivery-consumer",
            "status": status,
            "error": error[:2_000] if error else None,
            "metadata": metadata or {},
        })
        return isinstance(response, dict) and response.get("success") is True
    except Exception:
        LOGGER.warning("Could not record feedback delivery consumer heartbeat", exc_info=True)
        return False


def run_once() -> None:
    response = compass_request("GET", PULL_TARGET)
    events = response.get("events") if isinstance(response, dict) else None
    if not isinstance(events, list) or len(events) > MAX_EVENT_BATCH:
        raise TerminalDeliveryError("Compass delivery queue response is invalid")
    counts = {"completed": 0, "failed": 0, "retryable": 0}
    for event in events:
        result = handle_event(event)
        counts[result] = counts.get(result, 0) + 1
    heartbeat(
        "degraded" if counts["failed"] or counts["retryable"] else "healthy",
        metadata={
            "claimedEventCount": len(events),
            "completedCount": counts["completed"],
            "failedCount": counts["failed"],
            "retryableCount": counts["retryable"],
        },
    )


def run() -> None:
    poll_seconds = max(0.5, float(os.environ.get("COMPASS_FEEDBACK_DELIVERY_POLL_SECONDS", "2")))
    while RUNNING:
        try:
            run_once()
            time.sleep(poll_seconds)
        except RetryableDeliveryError:
            heartbeat("failed", "delivery queue temporarily unavailable")
            time.sleep(5)
        except Exception:
            heartbeat("failed", "delivery queue execution failed")
            LOGGER.exception("Feedback delivery queue cycle failed")
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
    required_env("COMPASS_KANBAN_REPO_ROOT")
    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
