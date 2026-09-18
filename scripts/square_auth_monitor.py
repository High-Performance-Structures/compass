#!/usr/bin/env python3
"""Read-only production Square credential check and signed Compass heartbeat."""

from __future__ import annotations

import datetime as dt
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

TARGET = "/api/integrations/square/auth-health"
SQUARE_URL = "https://connect.squareup.com/v2/locations"
MAX_RESPONSE_BYTES = 128 * 1024


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Neither the Square bearer token nor the Compass HMAC may follow redirects.
        return None


def open_request(request: urllib.request.Request):
    return urllib.request.build_opener(NoRedirects()).open(request, timeout=10)


def check_authentication(token: str) -> str:
    if not token.strip():
        return "missing_credential"
    request = urllib.request.Request(SQUARE_URL, headers={
        "Authorization": f"Bearer {token}", "Square-Version": "2026-08-19",
    })
    try:
        with open_request(request) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                return "unavailable"
            payload = json.loads(raw)
            if not isinstance(payload, dict) or not isinstance(payload.get("locations"), list):
                return "unavailable"
            active = [row.get("name") for row in payload["locations"]
                      if isinstance(row, dict) and row.get("status") == "ACTIVE"]
            # All production invoice routes must resolve uniquely in this account.
            if any(active.count(name) != 1 for name in ("HPS", "ORC", "Nu-Tech")):
                return "location_mismatch"
            return "healthy"
    except urllib.error.HTTPError as error:
        return "credentials_rejected" if error.code in (401, 403) else "unavailable"
    except (OSError, ValueError, urllib.error.URLError):
        return "unavailable"


def report_observation(base_url: str, secret: str, observation: dict[str, str]) -> None:
    url = urllib.parse.urlsplit(base_url)
    if url.scheme != "https" or not url.netloc or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        raise ValueError("Invalid Compass HTTPS origin")
    if len(secret) < 16:
        raise ValueError("Missing Compass reporting credential")
    body = json.dumps(observation, separators=(",", ":"))
    timestamp = str(int(time.time()))
    signature = hmac.new(secret.encode(), f"{timestamp}.POST.{TARGET}.{body}".encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(base_url.rstrip("/") + TARGET, method="POST", data=body.encode(), headers={
        "Accept": "application/json", "User-Agent": "Compass-Square-Auth-Monitor/1.0",
        "Content-Type": "application/json", "X-Compass-Timestamp": timestamp,
        "X-Compass-Signature": "sha256=" + signature,
    })
    with open_request(request) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("Invalid reporting response")
        payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get("success") is not True:
            raise ValueError("Compass did not acknowledge the observation")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compass-base-url", default=os.environ.get("COMPASS_BASE_URL", ""))
    args = parser.parse_args(argv)
    state = check_authentication(os.environ.get("HPS_SQUARE_PRODUCTION_ACCESS_TOKEN", ""))
    observation = {"state": state, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")}
    try:
        report_observation(args.compass_base_url, os.environ.get("JARVIS_BRIDGE_SECONDARY_SECRET", ""), observation)
    except (OSError, ValueError, urllib.error.URLError):
        # Provider exception bodies can contain sensitive information. Never log them.
        print(json.dumps({"status": "failed", "state": state, "reported": False, "error": "Compass health report failed"}))
        return 1
    print(json.dumps({"status": "ok" if state == "healthy" else "failed", "state": state, "reported": True}))
    return 0 if state == "healthy" else 1


if __name__ == "__main__":
    sys.exit(main())
