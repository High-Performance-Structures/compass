from __future__ import annotations

import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).parent / "compass_feedback_watchdog.py"
SPEC = importlib.util.spec_from_file_location(
    "compass_feedback_watchdog",
    SCRIPT_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load Compass Feedback Desk watchdog")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeRunner:
    def __init__(self, results: list[SimpleNamespace]) -> None:
        self.results = results
        self.calls: list[dict[str, object]] = []

    def __call__(self, args: list[str], **kwargs: object) -> SimpleNamespace:
        self.calls.append({"args": args, **kwargs})
        return self.results.pop(0)


class WatchdogQueryTests(unittest.TestCase):
    def result(
        self,
        *,
        returncode: int,
        stdout: str = "",
        stderr: str = "",
    ) -> SimpleNamespace:
        return SimpleNamespace(
            returncode=returncode,
            stdout=stdout,
            stderr=stderr,
        )

    def payload(self) -> str:
        return json.dumps(
            [
                {"results": []},
                {"results": [{"owner": "unassigned", "count": 2}]},
                {"results": [{"sla": "overdue", "count": 1}]},
                {"results": [{"status": "pending", "count": 3}]},
                {
                    "results": [
                        {
                            "service_name": "jarvis-agent-poller",
                            "status": "healthy",
                            "last_heartbeat_at": "2026-09-11T00:00:00Z",
                            "consecutive_failures": 0,
                        }
                    ]
                },
            ]
        )

    def test_retries_a_transient_wrangler_failure_then_returns_query_payload(self) -> None:
        runner = FakeRunner(
            [
                self.result(
                    returncode=1,
                    stderr="account secret and private path must never be surfaced",
                ),
                self.result(returncode=0, stdout=self.payload()),
            ]
        )
        delays: list[float] = []

        payload = MODULE.run_query(runner=runner, sleep=delays.append)

        self.assertEqual(payload[1]["results"][0]["owner"], "unassigned")
        self.assertEqual(len(runner.calls), 2)
        self.assertEqual(delays, [MODULE.RETRY_BACKOFF_SECONDS])
        first_args = runner.calls[0]["args"]
        second_args = runner.calls[1]["args"]
        if not isinstance(first_args, list) or not isinstance(second_args, list):
            self.fail("query runner did not receive argument lists")
        self.assertEqual(first_args, second_args)
        self.assertEqual(first_args[-3:], ["--json", "--command", MODULE.SQL])

    def test_persistent_wrangler_failure_raises_only_sanitized_category_and_status(self) -> None:
        runner = FakeRunner(
            [
                self.result(returncode=7, stderr="private stderr with credentials"),
                self.result(returncode=7, stderr="different private stderr"),
                self.result(returncode=7, stderr="third private stderr"),
            ]
        )
        delays: list[float] = []

        with self.assertRaises(MODULE.QueryFailure) as raised:
            MODULE.run_query(runner=runner, sleep=delays.append)

        self.assertEqual(raised.exception.category, "process_exit")
        self.assertEqual(raised.exception.exit_status, 7)
        self.assertEqual(str(raised.exception), "query failed (category=process_exit, exit_status=7)")
        self.assertNotIn("private", str(raised.exception))
        self.assertNotIn("credentials", str(raised.exception))
        self.assertEqual(len(runner.calls), MODULE.MAX_QUERY_ATTEMPTS)
        self.assertEqual(
            delays,
            [MODULE.RETRY_BACKOFF_SECONDS, MODULE.RETRY_BACKOFF_SECONDS * 2],
        )

    def test_malformed_wrangler_json_is_sanitized_after_bounded_retries(self) -> None:
        runner = FakeRunner(
            [
                self.result(returncode=0, stdout='{"feedback":"private"'),
                self.result(returncode=0, stdout="not json with identity"),
                self.result(returncode=0, stdout="still not json"),
            ]
        )
        delays: list[float] = []

        with self.assertRaises(MODULE.QueryFailure) as raised:
            MODULE.run_query(runner=runner, sleep=delays.append)

        self.assertEqual(raised.exception.category, "malformed_json")
        self.assertEqual(raised.exception.exit_status, 0)
        self.assertEqual(str(raised.exception), "query failed (category=malformed_json, exit_status=0)")
        self.assertNotIn("feedback", str(raised.exception))
        self.assertNotIn("identity", str(raised.exception))

    def test_query_failure_alert_is_idempotent_and_contains_no_process_detail(self) -> None:
        failure = MODULE.QueryFailure("process_exit", 9)
        with (
            patch.object(MODULE, "run_query", side_effect=failure),
            patch.object(MODULE, "notify_desktop_when_changed", return_value=False) as notify,
            patch.object(MODULE, "send_imessage_alert") as send,
            patch("builtins.print") as output,
        ):
            exit_status = MODULE.main()

        self.assertEqual(exit_status, 1)
        notify.assert_called_once_with(
            "ALERT: Compass Feedback Desk monitor query failed "
            "(category=process_exit, exit_status=9)"
        )
        send.assert_not_called()
        output.assert_called_once_with(
            "ALERT: Compass Feedback Desk monitor query failed "
            "(category=process_exit, exit_status=9)"
        )

    def test_recovered_payload_preserves_overdue_queue_and_heartbeat_alerts(self) -> None:
        payload = json.loads(self.payload())
        alerts = MODULE.build_alerts(
            payload,
            now=MODULE.datetime.fromisoformat("2026-09-11T00:10:00+00:00"),
        )

        self.assertEqual(
            alerts,
            [
                "1 open request(s) are overdue",
                "2 open request(s) are unassigned",
                "bridge queue pending=3, processing=0",
                "jarvis-agent-poller: healthy, stale heartbeat",
            ],
        )


if __name__ == "__main__":
    unittest.main()
