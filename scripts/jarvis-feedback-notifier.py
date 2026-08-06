#!/usr/bin/env python3
"""Deliver Compass Feedback Desk lifecycle updates through their source channel."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

MAX_RESPONSE_BYTES = 64 * 1024
MAX_LEDGER_EVENTS = 5_000
PULL_TARGET = (
    "/api/integrations/jarvis/events"
    "?limit=20&eventType=feedback.status_changed"
)
HEALTH_TARGET = "/api/integrations/jarvis/health"
LOGGER = logging.getLogger("compass-jarvis-feedback-notifier")
RUNNING = True
LAST_HEARTBEAT_AT = 0.0


class RetryableError(RuntimeError):
    """A temporary delivery or bridge error."""


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
    digest = hmac.new(
        secret.encode("utf-8"),
        prefix + body,
        hashlib.sha256,
    ).hexdigest()
    return f"sha256={digest}"


def compass_request(
    method: str,
    target: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    base_url = required_env("COMPASS_BASE_URL").rstrip("/")
    secret = required_env("JARVIS_BRIDGE_SECRET")
    parsed_url = urllib.parse.urlsplit(base_url)
    if parsed_url.scheme != "https":
        raise RuntimeError("COMPASS_BASE_URL must use HTTPS")

    body = (
        json.dumps(
            payload,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        if payload is not None
        else b""
    )
    timestamp = str(int(time.time()))
    headers = {
        "Accept": "application/json",
        "User-Agent": "Compass-Jarvis-Feedback-Notifier/1.0",
        "X-Compass-Timestamp": timestamp,
        "X-Compass-Signature": signature(
            secret,
            timestamp,
            method,
            target,
            body,
        ),
    }
    if body:
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        f"{base_url}{target}",
        data=body if body else None,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as error:
        if error.code == 429 or error.code >= 500:
            raise RetryableError(
                f"Compass returned HTTP {error.code}"
            ) from error
        message = error.read(2_048).decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Compass returned HTTP {error.code}: {message}"
        ) from error
    except (TimeoutError, urllib.error.URLError) as error:
        raise RetryableError("Compass request failed") from error

    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError("Compass returned invalid JSON") from error


def heartbeat(status: str, error: str | None = None) -> None:
    global LAST_HEARTBEAT_AT
    now = time.time()
    if status == "healthy" and now - LAST_HEARTBEAT_AT < 60:
        return
    try:
        compass_request(
            "POST",
            HEALTH_TARGET,
            {
                "serviceName": "jarvis-feedback-notifier",
                "status": status,
                "error": error[:2_000] if error else None,
            },
        )
        LAST_HEARTBEAT_AT = now
    except Exception:
        LOGGER.debug("Could not record notifier heartbeat", exc_info=True)


def acknowledge(
    event_id: str,
    payload: dict[str, Any],
) -> None:
    escaped_id = urllib.parse.quote(event_id, safe="")
    compass_request(
        "POST",
        f"/api/integrations/jarvis/events/{escaped_id}/ack",
        payload,
    )


def metadata_object(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = payload.get("metadata")
    if isinstance(metadata, dict):
        return metadata
    if isinstance(metadata, str):
        try:
            parsed = json.loads(metadata)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def reporter_object(payload: dict[str, Any]) -> dict[str, Any]:
    reporter = payload.get("reporter")
    return reporter if isinstance(reporter, dict) else {}


def external_actor_id(payload: dict[str, Any]) -> str | None:
    reporter = reporter_object(payload)
    value = reporter.get("externalActorId")
    if isinstance(value, str) and value.strip():
        return value.strip()
    metadata = metadata_object(payload)
    value = metadata.get("externalActorId")
    return value.strip() if isinstance(value, str) and value.strip() else None


def reporter_email(payload: dict[str, Any]) -> str | None:
    value = reporter_object(payload).get("email")
    if not isinstance(value, str):
        return None
    candidate = value.strip().lower()
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", candidate):
        return candidate
    return None


def message_text(payload: dict[str, Any]) -> str:
    value = payload.get("message")
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError("Feedback event has no requester message")
    return value.strip()[:2_000]


def send_via_hermes(target: str, message: str) -> None:
    root = Path(
        os.environ.get(
            "HERMES_AGENT_ROOT",
            "/home/jarvis/.hermes/hermes-agent",
        )
    )
    root_value = str(root)
    if root_value not in sys.path:
        sys.path.insert(0, root_value)

    from tools.send_message_tool import send_message_tool

    result = send_message_tool(
        {
            "action": "send",
            "target": target,
            "message": message,
        }
    )
    if isinstance(result, str):
        try:
            parsed: Any = json.loads(result)
        except json.JSONDecodeError as error:
            raise RetryableError(
                "Hermes returned an invalid delivery result"
            ) from error
    else:
        parsed = result
    if not isinstance(parsed, dict):
        raise RetryableError("Hermes returned an invalid delivery result")
    if parsed.get("error"):
        raise RetryableError("Hermes could not deliver the requester update")


def reply_to_compass(
    event_id: str,
    message: str,
) -> None:
    compass_request(
        "POST",
        "/api/integrations/jarvis/replies",
        {
            "eventId": event_id,
            "idempotencyKey": f"feedback-notify:{event_id}",
            "content": message,
        },
    )


def deliver_event(event: dict[str, Any]) -> bool:
    event_id = event.get("id")
    source = event.get("source")
    payload = event.get("payload")
    if (
        not isinstance(event_id, str)
        or event.get("eventType") != "feedback.status_changed"
        or not isinstance(source, str)
        or not isinstance(payload, dict)
    ):
        raise RuntimeError("Invalid feedback lifecycle event")

    message = message_text(payload)
    if source == "telegram":
        target = external_actor_id(payload)
        if target is None or not re.fullmatch(r"-?\d+", target):
            raise RuntimeError("Telegram feedback has no valid reply target")
        send_via_hermes(f"telegram:{target}", message)
        return True
    if source == "jarvis-email":
        target = reporter_email(payload)
        if target is None:
            raise RuntimeError("Email feedback has no valid reply target")
        send_via_hermes(f"email:{target}", message)
        return True
    if source == "compass-conversation":
        reply_to_compass(event_id, message)
        return False
    if source in {"ask-jarvis", "feedback-widget"}:
        # Ask Jarvis confirms receipt in its original response and later
        # lifecycle changes create requester-scoped Compass notifications.
        # Widget requests remain visible in the request center.
        return True
    raise RuntimeError(f"Unsupported feedback source: {source}")


def ledger_path() -> Path:
    return Path(
        os.environ.get(
            "COMPASS_FEEDBACK_LEDGER",
            "/home/jarvis/.local/state/compass/feedback-notifier.json",
        )
    )


def load_ledger() -> list[str]:
    path = ledger_path()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [value for value in parsed if isinstance(value, str)][
        -MAX_LEDGER_EVENTS:
    ]


def save_ledger(event_ids: list[str]) -> None:
    path = ledger_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(event_ids[-MAX_LEDGER_EVENTS:]),
        encoding="utf-8",
    )
    temporary.replace(path)


def handle_event(event: dict[str, Any], delivered: list[str]) -> None:
    event_id = event.get("id")
    if not isinstance(event_id, str):
        raise RuntimeError("Feedback lifecycle event has no ID")
    if event_id in delivered:
        acknowledge(event_id, {"status": "completed"})
        return

    requires_ack = deliver_event(event)
    if requires_ack:
        delivered.append(event_id)
        save_ledger(delivered)
        acknowledge(event_id, {"status": "completed"})


def run() -> None:
    poll_seconds = max(
        0.5,
        float(os.environ.get("COMPASS_FEEDBACK_POLL_SECONDS", "2")),
    )
    delivered = load_ledger()
    while RUNNING:
        try:
            response = compass_request("GET", PULL_TARGET)
            events = (
                response.get("events")
                if isinstance(response, dict)
                else None
            )
            if not isinstance(events, list):
                raise RuntimeError("Compass pull response has no events")
            heartbeat("healthy")
            if not events:
                time.sleep(poll_seconds)
                continue

            for event in events:
                if not RUNNING:
                    break
                if not isinstance(event, dict):
                    continue
                event_id = event.get("id")
                try:
                    handle_event(event, delivered)
                    LOGGER.info("Completed feedback event %s", event_id)
                except RetryableError as error:
                    if isinstance(event_id, str):
                        acknowledge(
                            event_id,
                            {
                                "status": "failed",
                                "error": str(error),
                                "retryAfterSeconds": 30,
                            },
                        )
                    LOGGER.warning(
                        "Retryable feedback delivery failure: %s",
                        event_id,
                    )
                except Exception as error:
                    if isinstance(event_id, str):
                        acknowledge(
                            event_id,
                            {
                                "status": "failed",
                                "error": str(error)[:2_000],
                            },
                        )
                    LOGGER.exception(
                        "Feedback delivery failed: %s",
                        event_id,
                    )
        except RetryableError as error:
            heartbeat("failed", str(error))
            LOGGER.warning("Bridge temporarily unavailable")
            time.sleep(5)
        except Exception as error:
            heartbeat("failed", str(error))
            LOGGER.exception("Feedback poll cycle failed")
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
