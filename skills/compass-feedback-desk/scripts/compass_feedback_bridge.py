#!/usr/bin/env python3
"""Signed client for the Compass Jarvis feedback bridge."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

MAX_BODY_BYTES = 64 * 1024


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


def request_json(
    method: str,
    target: str,
    body: bytes = b"",
) -> Any:
    base_url = os.environ.get("COMPASS_BASE_URL", "").rstrip("/")
    secret = os.environ.get("JARVIS_BRIDGE_SECRET", "")
    if not base_url or not secret:
        raise RuntimeError(
            "COMPASS_BASE_URL and JARVIS_BRIDGE_SECRET are required"
        )
    parsed_base_url = urllib.parse.urlsplit(base_url)
    is_local = parsed_base_url.hostname in {"localhost", "127.0.0.1"}
    if parsed_base_url.scheme != "https" and not is_local:
        raise RuntimeError(
            "COMPASS_BASE_URL must use HTTPS outside local development"
        )

    timestamp = str(int(time.time()))
    headers = {
        "Accept": "application/json",
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
            response_body = response.read(MAX_BODY_BYTES)
    except urllib.error.HTTPError as error:
        error_body = error.read(2048).decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Compass returned HTTP {error.code}: {error_body}"
        ) from error
    return json.loads(response_body)


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
    acknowledge.add_argument("--payload-file", required=True)

    reply = commands.add_parser("reply")
    reply.add_argument("--payload-file", required=True)

    return parser


def main() -> int:
    args = build_parser().parse_args()

    if args.command == "pull":
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
        event_id = urllib.parse.quote(args.event_id, safe="")
        result = request_json(
            "POST",
            f"/api/integrations/jarvis/events/{event_id}/ack",
            load_payload(args.payload_file),
        )
    else:
        result = request_json(
            "POST",
            "/api/integrations/jarvis/replies",
            load_payload(args.payload_file),
        )

    print(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(f"compass-feedback-bridge: {error}", file=sys.stderr)
        raise SystemExit(1) from error
