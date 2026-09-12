from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import tempfile
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
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_directory = tempfile.mkdtemp(prefix="compass-watchdog-repo-")
        repo = Path(cls.repo_directory)
        (repo / "package.json").write_text("{}")
        wrangler = repo / "node_modules/.bin/wrangler"
        wrangler.parent.mkdir(parents=True)
        wrangler.write_text("")

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.repo_directory)

    def repo_root(self) -> Path:
        return Path(self.repo_directory)

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
                {"success": True, "results": []},
                {"success": True, "results": [{"owner": "unassigned", "count": 2}]},
                {"success": True, "results": [{"sla": "overdue", "count": 1}]},
                {"success": True, "results": [{"status": "pending", "count": 3}]},
                {
                    "success": True,
                    "results": [
                        {
                            "service_name": "jarvis-agent-poller",
                            "status": "healthy",
                            "last_heartbeat_at": "2026-09-11T00:00:00Z",
                            "consecutive_failures": 0,
                        }
                    ],
                },
            ]
        )

    def test_installed_script_uses_explicit_repository_root_for_wrangler(self) -> None:
        installed_path = Path("/Users/martine/.hermes/scripts/compass_feedback_watchdog.py")
        with patch.dict(
            MODULE.os.environ,
            {"COMPASS_REPO_ROOT": str(self.repo_root())},
            clear=False,
        ):
            resolved = MODULE.resolve_repo_root(installed_path)
            command = MODULE.query_command()

        self.assertEqual(resolved, self.repo_root().resolve())
        self.assertEqual(command[0], str(self.repo_root().resolve() / "node_modules/.bin/wrangler"))
        self.assertNotIn(".hermes/node_modules", command[0])

    def test_missing_approved_repository_fails_closed_without_deriving_from_script_path(self) -> None:
        installed_path = Path("/Users/martine/.hermes/scripts/compass_feedback_watchdog.py")
        with patch.object(MODULE, "APPROVED_REPO_ROOT", self.repo_root() / "missing"):
            with patch.dict(MODULE.os.environ, {}, clear=True):
                with self.assertRaises(MODULE.QueryFailure) as raised:
                    MODULE.resolve_repo_root(installed_path)

        self.assertEqual(raised.exception.category, "repository_root_unavailable")
        self.assertNotIn(".hermes", str(raised.exception))

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

        with patch.dict(
            MODULE.os.environ,
            {"COMPASS_REPO_ROOT": str(self.repo_root())},
            clear=False,
        ):
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

        with patch.dict(
            MODULE.os.environ,
            {"COMPASS_REPO_ROOT": str(self.repo_root())},
            clear=False,
        ):
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

        with patch.dict(
            MODULE.os.environ,
            {"COMPASS_REPO_ROOT": str(self.repo_root())},
            clear=False,
        ):
            with self.assertRaises(MODULE.QueryFailure) as raised:
                MODULE.run_query(runner=runner, sleep=delays.append)

        self.assertEqual(raised.exception.category, "malformed_json")
        self.assertEqual(raised.exception.exit_status, 0)
        self.assertEqual(str(raised.exception), "query failed (category=malformed_json, exit_status=0)")
        self.assertNotIn("feedback", str(raised.exception))
        self.assertNotIn("identity", str(raised.exception))

    def test_empty_short_and_semantically_malformed_json_is_sanitized(self) -> None:
        invalid_payloads = [
            "[]",
            json.dumps([{"success": True, "results": []}]),
            json.dumps(
                [
                    {"success": True, "results": []},
                    {"success": True, "results": [{"owner": "not-an-owner", "count": 1}]},
                    {"success": True, "results": []},
                    {"success": True, "results": []},
                    {"success": True, "results": []},
                ]
            ),
            json.dumps(
                [
                    {"success": True, "results": []},
                    {"success": True, "results": [{"owner": "unassigned", "count": "1"}]},
                    {"success": True, "results": []},
                    {"success": True, "results": []},
                    {"success": True, "results": []},
                ]
            ),
        ]

        for invalid_payload in invalid_payloads:
            with self.subTest(invalid_payload=invalid_payload):
                runner = FakeRunner(
                    [
                        self.result(returncode=0, stdout=invalid_payload),
                        self.result(returncode=0, stdout=invalid_payload),
                        self.result(returncode=0, stdout=invalid_payload),
                    ]
                )
                with patch.dict(
                    MODULE.os.environ,
                    {"COMPASS_REPO_ROOT": str(self.repo_root())},
                    clear=False,
                ):
                    with self.assertRaises(MODULE.QueryFailure) as raised:
                        MODULE.run_query(runner=runner, sleep=lambda _: None)

                self.assertEqual(raised.exception.category, "unexpected_response")
                self.assertEqual(raised.exception.exit_status, 0)
                self.assertEqual(len(runner.calls), MODULE.MAX_QUERY_ATTEMPTS)

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
