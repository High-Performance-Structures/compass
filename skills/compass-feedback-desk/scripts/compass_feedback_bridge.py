#!/usr/bin/env python3
"""Signed client for the Compass Jarvis feedback bridge."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
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
        secret_path = temporary / "secret"
        encrypted_path = temporary / "secret.enc"
        public_key_path.write_bytes(public_key)
        secret_path.write_bytes(secret.encode("utf-8"))
        result = subprocess.run(
            [
                "openssl",
                "pkeyutl",
                "-encrypt",
                "-pubin",
                "-inkey",
                str(public_key_path),
                "-keyform",
                "DER",
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
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_status = response.status
            response_type = response.headers.get("Content-Type", "unknown")
            response_body = response.read(MAX_BODY_BYTES)
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
    acknowledge.add_argument("--payload-file", required=True)

    reply = commands.add_parser("reply")
    reply.add_argument("--payload-file", required=True)

    configure = commands.add_parser("configure")
    configure.add_argument("--base-url", required=True)
    configure.add_argument("--env-file", required=True)
    configure.add_argument("--public-key-der-base64", required=True)

    return parser


def main() -> int:
    args = build_parser().parse_args()

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
