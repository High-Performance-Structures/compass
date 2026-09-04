#!/usr/bin/env python3
"""Run a Signet secret-exec job and wait for the real subprocess result."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from collections.abc import Sequence


JOB_ID_PATTERN = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)


def job_id_from_output(output: str) -> str | None:
    match = JOB_ID_PATTERN.search(output)
    return match.group(0) if match else None


def result_from_output(output: str) -> dict[str, object] | None:
    decoder = json.JSONDecoder()
    lines = output.splitlines()
    for index in range(len(lines) - 1, -1, -1):
        candidate = "\n".join(lines[index:]).lstrip()
        if not candidate.startswith("{"):
            continue
        try:
            value, end = decoder.raw_decode(candidate)
        except json.JSONDecodeError:
            continue
        if not candidate[end:].strip() and isinstance(value, dict):
            return value

    # Preserve compatibility with older Signet output that appended a
    # standalone compact JSON result after human-readable status lines.
    for line in reversed(output.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def result_succeeded(result: dict[str, object] | None) -> bool:
    """Recognize supported command result envelopes without guessing success."""
    if result is None or "error" in result:
        return False

    status = result.get("status")
    if isinstance(status, str):
        return status == "ok"

    candidate_count = result.get("candidateCount")
    results = result.get("results")
    if type(candidate_count) is not int or not isinstance(results, list):
        return False
    if candidate_count != len(results):
        return False
    return all(
        isinstance(item, dict)
        and item.get("action") != "error"
        and "error" not in item
        for item in results
    )


def run_command(command: Sequence[str], timeout: float) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--signet", required=True)
    parser.add_argument("--secret", action="append", default=[])
    parser.add_argument("--timeout", type=int, default=55)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command:
        parser.error("a subprocess command is required")

    queue_command = [args.signet, "secret", "exec"]
    for secret in args.secret:
        queue_command.extend(["--secret", secret])
    queue_command.extend(["--timeout", str(args.timeout), *args.command])

    queued = run_command(queue_command, timeout=15)
    queue_output = f"{queued.stdout}\n{queued.stderr}".strip()
    if queue_output:
        print(queue_output, flush=True)
    if queued.returncode != 0:
        return queued.returncode

    job_id = job_id_from_output(queue_output)
    if job_id is None:
        print("Signet did not return a secret-exec job ID", file=sys.stderr)
        return 1

    deadline = time.monotonic() + args.timeout + 10
    while time.monotonic() < deadline:
        status = run_command(
            [args.signet, "secret", "exec-status", job_id],
            timeout=10,
        )
        status_output = f"{status.stdout}\n{status.stderr}".strip()
        normalized = status_output.lower()
        if status.returncode != 0:
            if status_output:
                print(status_output, file=sys.stderr)
            return status.returncode
        if "status: completed" in normalized:
            if status_output:
                print(status_output, flush=True)
            result = result_from_output(status_output)
            return 0 if result_succeeded(result) else 1
        if "status: failed" in normalized or "status: timed_out" in normalized:
            if status_output:
                print(status_output, file=sys.stderr)
            return 1
        time.sleep(1)

    print(f"Timed out waiting for Signet job {job_id}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
