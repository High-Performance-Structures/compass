#!/usr/bin/env python3
"""Signed client for the Compass Jarvis feedback bridge."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

MAX_BODY_BYTES = 64 * 1024
MAX_VISUAL_RESPONSE_BYTES = 3 * 1024 * 1024
MAX_FEEDBACK_MESSAGE_CHARS = 2_000
MAX_FEEDBACK_URL_CHARS = 2_048
COMPASS_PRODUCTION_BASE_URL = "https://compass.openrangeconstruction.ltd"
FEEDBACK_STATUS_PATH = "/api/integrations/jarvis/feedback/{item_id}/status"
FEEDBACK_STATUSES = frozenset(
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
FEEDBACK_PRIORITIES = frozenset({"low", "normal", "high", "urgent"})
FEEDBACK_STATUS_KEYS = frozenset(
    {
        "itemId",
        "status",
        "message",
        "priority",
        "githubIssueUrl",
        "draftPullRequestUrl",
        "idempotencyKey",
    }
)
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


def update_env_file(path: Path, values: dict[str, str]) -> None:
    """Update selected dotenv keys without disturbing unrelated settings."""
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    remaining = dict(values)
    managed_keys = set(values)
    updated: list[str] = []

    for line in existing.splitlines():
        key, separator, _value = line.partition("=")
        if separator and key in managed_keys:
            if key in remaining:
                updated.append(f"{key}={remaining.pop(key)}")
        else:
            updated.append(line)

    if updated and updated[-1]:
        updated.append("")
    updated.extend(f"{key}={value}" for key, value in remaining.items())

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(updated).rstrip() + "\n", encoding="utf-8")
    path.chmod(0o600)


def encrypt_for_transfer(secret: str, public_key_der: str) -> str:
    """Encrypt a generated secret so the bridge key never enters tool output."""
    try:
        public_key = base64.b64decode(public_key_der, validate=True)
    except ValueError as error:
        raise ValueError("Public key must be valid base64-encoded DER") from error

    with tempfile.TemporaryDirectory(prefix="compass-bridge-") as directory:
        temporary = Path(directory)
        public_key_path = temporary / "public.der"
        public_pem_path = temporary / "public.pem"
        secret_path = temporary / "secret"
        encrypted_path = temporary / "secret.enc"
        public_key_path.write_bytes(public_key)
        secret_path.write_bytes(secret.encode("utf-8"))
        convert_result = subprocess.run(
            [
                "openssl",
                "pkey",
                "-pubin",
                "-inform",
                "DER",
                "-in",
                str(public_key_path),
                "-out",
                str(public_pem_path),
            ],
            capture_output=True,
            check=False,
        )
        if convert_result.returncode != 0:
            raise RuntimeError("OpenSSL could not read the bridge public key")
        result = subprocess.run(
            [
                "openssl",
                "pkeyutl",
                "-encrypt",
                "-pubin",
                "-inkey",
                str(public_pem_path),
                "-pkeyopt",
                "rsa_padding_mode:oaep",
                "-pkeyopt",
                "rsa_oaep_md:sha256",
                "-in",
                str(secret_path),
                "-out",
                str(encrypted_path),
            ],
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError("OpenSSL could not encrypt the bridge secret")
        return base64.b64encode(encrypted_path.read_bytes()).decode("ascii")


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


def load_payload(path: str) -> bytes:
    data = Path(path).read_bytes()
    if len(data) > MAX_BODY_BYTES:
        raise ValueError("Payload exceeds the 64 KiB bridge limit")
    parsed = json.loads(data)
    return json.dumps(
        parsed,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def claim_bound_payload(
    path: str,
    claim_token: str,
    event_id: str | None = None,
) -> bytes:
    if not claim_token or len(claim_token) > 128:
        raise ValueError("claimToken is invalid")
    if event_id is not None and UUID_PATTERN.fullmatch(event_id) is None:
        raise ValueError("eventId must be a UUID")
    parsed = json.loads(load_payload(path))
    if not isinstance(parsed, dict):
        raise ValueError("Claim-bound payload must be a JSON object")
    parsed["claimToken"] = claim_token
    if event_id is not None:
        parsed["eventId"] = event_id
    body = json.dumps(
        parsed,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    if len(body) > MAX_BODY_BYTES:
        raise ValueError("Claim-bound payload exceeds the 64 KiB bridge limit")
    return body


def validate_feedback_status_payload(payload: object) -> dict[str, object]:
    """Validate the only structured payload accepted by the lifecycle command."""
    if not isinstance(payload, dict):
        raise ValueError("Feedback status payload must be a JSON object")
    unknown_keys = set(payload) - FEEDBACK_STATUS_KEYS
    if unknown_keys:
        raise ValueError("Feedback status payload contains unsupported fields")

    item_id = payload.get("itemId")
    if not isinstance(item_id, str) or UUID_PATTERN.fullmatch(item_id) is None:
        raise ValueError("itemId must be a UUID")

    status = payload.get("status")
    if not isinstance(status, str) or status not in FEEDBACK_STATUSES:
        raise ValueError("status is not an allowed Feedback Desk lifecycle status")

    idempotency_key = payload.get("idempotencyKey")
    if (
        not isinstance(idempotency_key, str)
        or IDEMPOTENCY_KEY_PATTERN.fullmatch(idempotency_key) is None
    ):
        raise ValueError("idempotencyKey is invalid")

    message = payload.get("message")
    if message is not None and (
        not isinstance(message, str)
        or not message.strip()
        or len(message) > MAX_FEEDBACK_MESSAGE_CHARS
    ):
        raise ValueError("message is invalid or too long")

    priority = payload.get("priority")
    if priority is not None and (
        not isinstance(priority, str) or priority not in FEEDBACK_PRIORITIES
    ):
        raise ValueError("priority is invalid")

    for key, pattern in (
        ("githubIssueUrl", GITHUB_ISSUE_PATTERN),
        ("draftPullRequestUrl", GITHUB_PULL_REQUEST_PATTERN),
    ):
        value = payload.get(key)
        if value is not None and (
            not isinstance(value, str)
            or len(value) > MAX_FEEDBACK_URL_CHARS
            or pattern.fullmatch(value) is None
        ):
            raise ValueError(f"{key} is invalid")

    normalized = dict(payload)
    body = json.dumps(
        normalized,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    if len(body) > MAX_BODY_BYTES:
        raise ValueError("Feedback status payload exceeds the 64 KiB bridge limit")
    return normalized


def load_feedback_status_payload(path: str) -> dict[str, object]:
    """Load and validate a bounded JSON file without invoking a shell."""
    data = Path(path).read_bytes()
    if len(data) > MAX_BODY_BYTES:
        raise ValueError("Feedback status payload exceeds the 64 KiB bridge limit")
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError as error:
        raise ValueError("Feedback status payload is not valid JSON") from error
    return validate_feedback_status_payload(parsed)


def feedback_status_target(item_id: str) -> str:
    """Build the fixed lifecycle path only after UUID validation."""
    if UUID_PATTERN.fullmatch(item_id) is None:
        raise ValueError("itemId must be a UUID")
    return FEEDBACK_STATUS_PATH.format(item_id=urllib.parse.quote(item_id, safe=""))


def redact_feedback_status_response(response: object) -> dict[str, object]:
    """Return only the documented, non-sensitive lifecycle result fields."""
    if not isinstance(response, dict) or response.get("success") is not True:
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


def require_feedback_status_production_origin() -> None:
    """Require the exact production origin for every signed bridge request."""
    configured = os.environ.get("COMPASS_BASE_URL", "")
    expected = COMPASS_PRODUCTION_BASE_URL
    parsed = urllib.parse.urlsplit(configured)
    expected_parsed = urllib.parse.urlsplit(expected)
    if (
        configured != expected
        or parsed.scheme != expected_parsed.scheme
        or parsed.hostname != expected_parsed.hostname
        or parsed.port != expected_parsed.port
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("Feedback status requires the production Compass endpoint")


def request_feedback_status(
    payload: object,
    max_attempts: int = 2,
) -> dict[str, object]:
    """Submit one fixed lifecycle request; retries reuse its idempotency key."""
    normalized = validate_feedback_status_payload(payload)
    body = json.dumps(
        normalized,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    target = feedback_status_target(str(normalized["itemId"]))
    require_feedback_status_production_origin()
    attempts = max(1, min(2, max_attempts))
    for attempt in range(attempts):
        try:
            response = request_json(
                "POST",
                target,
                body,
            )
            return redact_feedback_status_response(response)
        except (TimeoutError, urllib.error.URLError) as error:
            if attempt + 1 == attempts:
                raise RuntimeError("Feedback status request failed") from error
    raise RuntimeError("Feedback status request failed")


def feedback_status_payload_from_args(args: argparse.Namespace) -> dict[str, object]:
    """Convert explicit CLI fields or one safe JSON file into one payload."""
    direct_fields = (
        args.item_id,
        args.status,
        args.message,
        args.priority,
        args.github_issue_url,
        args.draft_pull_request_url,
        args.idempotency_key,
    )
    if args.payload_file:
        if any(value is not None for value in direct_fields):
            raise ValueError("Use --payload-file or structured fields, not both")
        return load_feedback_status_payload(args.payload_file)
    payload = {
        key: value
        for key, value in {
            "itemId": args.item_id,
            "status": args.status,
            "message": args.message,
            "priority": args.priority,
            "githubIssueUrl": args.github_issue_url,
            "draftPullRequestUrl": args.draft_pull_request_url,
            "idempotencyKey": args.idempotency_key,
        }.items()
        if value is not None
    }
    return validate_feedback_status_payload(payload)


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Reject redirects so signed lifecycle headers cannot cross origins."""

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


def _allowed_request_target(method: str, target: str) -> bool:
    parsed = urllib.parse.urlsplit(target)
    if (
        parsed.scheme
        or parsed.netloc
        or parsed.fragment
        or not parsed.path.startswith("/api/integrations/jarvis/")
    ):
        return False
    normalized_method = method.upper()
    if parsed.path == "/api/integrations/jarvis/events":
        if normalized_method == "POST":
            return not parsed.query
        if normalized_method != "GET":
            return False
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        if set(query) - {"limit"} or len(query.get("limit", [])) > 1:
            return False
        if "limit" not in query:
            return True
        limit = query["limit"][0]
        return limit.isdigit() and 1 <= int(limit) <= 50
    if parsed.query:
        return False
    if (
        normalized_method == "POST"
        and parsed.path == "/api/integrations/jarvis/replies"
    ):
        return True
    parts = parsed.path.split("/")
    if (
        len(parts) == 7
        and parts[1:5] == ["api", "integrations", "jarvis", "events"]
        and UUID_PATTERN.fullmatch(parts[5]) is not None
        and normalized_method == "POST"
        and parts[6:] == ["ack"]
    ):
        return True
    if (
        len(parts) == 7
        and parts[1:5] == ["api", "integrations", "jarvis", "events"]
        and UUID_PATTERN.fullmatch(parts[5]) is not None
        and normalized_method == "GET"
        and parts[6:] in (["search"], ["visuals"])
    ):
        return True
    if (
        len(parts) == 7
        and parts[1:5] == ["api", "integrations", "jarvis", "feedback"]
        and UUID_PATTERN.fullmatch(parts[5]) is not None
        and parts[6:] == ["status"]
        and normalized_method == "POST"
    ):
        return True
    return False


def request_json(
    method: str,
    target: str,
    body: bytes = b"",
    max_response_bytes: int = MAX_BODY_BYTES,
) -> Any:
    require_feedback_status_production_origin()
    if not _allowed_request_target(method, target):
        raise RuntimeError("Compass bridge target is not allowed")
    base_url = COMPASS_PRODUCTION_BASE_URL
    secret = os.environ.get("JARVIS_BRIDGE_SECRET", "")
    if not secret:
        raise RuntimeError(
            "COMPASS_BASE_URL and JARVIS_BRIDGE_SECRET are required"
        )

    timestamp = str(int(time.time()))
    headers = {
        "Accept": "application/json",
        "User-Agent": "Compass-Jarvis-Bridge/1.0",
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
    opener = urllib.request.build_opener(_NoRedirectHandler())
    try:
        with opener.open(request, timeout=30) as response:
            response_status = response.status
            response_type = response.headers.get("Content-Type", "unknown")
            response_body = response.read(max_response_bytes + 1)
            if len(response_body) > max_response_bytes:
                raise RuntimeError("Compass response exceeded the allowed size")
    except urllib.error.HTTPError as error:
        error_body = error.read(2048).decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Compass returned HTTP {error.code}: {error_body}"
        ) from error
    try:
        return json.loads(response_body)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            "Compass returned non-JSON "
            f"HTTP {response_status} ({response_type}, "
            f"{len(response_body)} bytes)"
        ) from error


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Call the signed Compass Jarvis bridge"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    submit = commands.add_parser("submit")
    submit.add_argument("--payload-file", required=True)

    pull = commands.add_parser("pull")
    pull.add_argument("--limit", type=int, default=20)

    acknowledge = commands.add_parser("ack")
    acknowledge.add_argument("--event-id", required=True)
    acknowledge.add_argument("--claim-token", required=True)
    acknowledge.add_argument("--payload-file", required=True)

    reply = commands.add_parser("reply")
    reply.add_argument("--event-id", required=True)
    reply.add_argument("--claim-token", required=True)
    reply.add_argument("--payload-file", required=True)

    search = commands.add_parser("search")
    search.add_argument("--event-id", required=True)

    visuals = commands.add_parser("visuals")
    visuals.add_argument("--event-id", required=True)
    visuals.add_argument("--output-dir", required=True)

    status = commands.add_parser(
        "status",
        help="update one Feedback Desk item through the fixed lifecycle endpoint",
    )
    status.add_argument("--payload-file")
    status.add_argument("--item-id")
    status.add_argument("--status")
    status.add_argument("--message")
    status.add_argument("--priority")
    status.add_argument("--github-issue-url")
    status.add_argument("--draft-pull-request-url")
    status.add_argument("--idempotency-key")

    configure = commands.add_parser("configure")
    configure.add_argument("--base-url", required=True)
    configure.add_argument("--env-file", required=True)
    configure.add_argument("--public-key-der-base64", required=True)

    return parser


def main() -> int:
    args = build_parser().parse_args()
    return_code = 0

    if args.command == "configure":
        parsed_base_url = urllib.parse.urlsplit(args.base_url)
        if parsed_base_url.scheme != "https" or not parsed_base_url.netloc:
            raise ValueError("Configure requires an HTTPS Compass base URL")
        secret = secrets.token_urlsafe(48)
        encrypted_secret = encrypt_for_transfer(
            secret,
            args.public_key_der_base64,
        )
        update_env_file(
            Path(args.env_file),
            {
                "COMPASS_BASE_URL": args.base_url.rstrip("/"),
                "JARVIS_BRIDGE_SECRET": secret,
            },
        )
        result = {
            "configured": True,
            "encryptedSecret": encrypted_secret,
        }
    elif args.command == "pull":
        limit = min(50, max(1, args.limit))
        target = (
            "/api/integrations/jarvis/events?"
            + urllib.parse.urlencode({"limit": limit})
        )
        result = request_json("GET", target)
    elif args.command == "submit":
        result = request_json(
            "POST",
            "/api/integrations/jarvis/events",
            load_payload(args.payload_file),
        )
    elif args.command == "ack":
        if UUID_PATTERN.fullmatch(args.event_id) is None:
            raise ValueError("eventId must be a UUID")
        event_id = urllib.parse.quote(args.event_id, safe="")
        result = request_json(
            "POST",
            f"/api/integrations/jarvis/events/{event_id}/ack",
            claim_bound_payload(args.payload_file, args.claim_token),
        )
    elif args.command == "search":
        event_id = urllib.parse.quote(args.event_id, safe="")
        result = request_json(
            "GET",
            f"/api/integrations/jarvis/events/{event_id}/search",
        )
    elif args.command == "visuals":
        event_id = urllib.parse.quote(args.event_id, safe="")
        visual_result = request_json(
            "GET",
            f"/api/integrations/jarvis/events/{event_id}/visuals",
            max_response_bytes=MAX_VISUAL_RESPONSE_BYTES,
        )
        output_dir = Path(args.output_dir).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        written: list[dict[str, str]] = []
        for index, image in enumerate(visual_result.get("images", [])):
            if not isinstance(image, dict):
                continue
            data_url = image.get("dataUrl")
            media_type = image.get("mediaType")
            if not isinstance(data_url, str) or not isinstance(media_type, str):
                continue
            prefix = f"data:{media_type};base64,"
            if not data_url.startswith(prefix):
                continue
            extension = {
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/webp": ".webp",
            }.get(media_type)
            if extension is None:
                continue
            filename = f"compass-visual-{index + 1}{extension}"
            destination = output_dir / filename
            destination.write_bytes(base64.b64decode(data_url[len(prefix):], validate=True))
            written.append(
                {
                    "path": str(destination),
                    "mediaType": media_type,
                    "sourceName": str(image.get("filename", filename)),
                }
            )
        result = {
            "eventId": visual_result.get("eventId"),
            "files": written,
            "count": len(written),
            "explicitUserAttachments": True,
        }
    elif args.command == "status":
        try:
            result = request_feedback_status(
                feedback_status_payload_from_args(args),
            )
        except (OSError, ValueError):
            result = {
                "success": False,
                "error": "invalid_feedback_status_input",
            }
            return_code = 2
        except RuntimeError:
            result = {
                "success": False,
                "error": "feedback_status_request_failed",
            }
            return_code = 1
    else:
        result = request_json(
            "POST",
            "/api/integrations/jarvis/replies",
            claim_bound_payload(
                args.payload_file,
                args.claim_token,
                args.event_id,
            ),
        )

    print(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
    return return_code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(f"compass-feedback-bridge: {error}", file=sys.stderr)
        raise SystemExit(1) from error
