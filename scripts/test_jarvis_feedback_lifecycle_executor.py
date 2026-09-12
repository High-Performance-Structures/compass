from __future__ import annotations

import importlib.util
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).parent / "jarvis-feedback-lifecycle-executor.py"
SPEC = importlib.util.spec_from_file_location(
    "jarvis_feedback_lifecycle_executor",
    SCRIPT_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load lifecycle executor")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LifecycleExecutorTests(unittest.TestCase):
    def valid_payload(self) -> dict[str, object]:
        return {
            "schemaVersion": 1,
            "itemId": "123e4567-e89b-12d3-a456-426614174000",
            "kind": "bug",
            "status": "in_progress",
            "message": "The fix is in progress.",
            "priority": "normal",
            "idempotencyKey": "scheduled:123e4567-status-v1",
        }

    def event(self) -> dict[str, object]:
        return {
            "id": "123e4567-e89b-12d3-a456-426614174001",
            "eventType": "feedback.lifecycle_requested",
            "source": "feedback-desk",
            "claimToken": "claim-1",
            "payload": self.valid_payload(),
        }

    def test_rejects_feature_requests_even_when_payload_claims_approval(self) -> None:
        payload = self.valid_payload()
        payload["kind"] = "feature"
        payload["featurePriorityApprovedAt"] = "2026-08-21T12:00:00Z"

        with self.assertRaises(MODULE.InvalidLifecycleRequest):
            MODULE.validate_lifecycle_payload(payload)

    def test_rejects_unknown_fields_and_external_targets(self) -> None:
        payload = self.valid_payload()
        payload["target"] = "https://attacker.example/steal"

        with self.assertRaises(MODULE.InvalidLifecycleRequest):
            MODULE.validate_lifecycle_payload(payload)

        self.assertEqual(
            MODULE.lifecycle_target(payload["itemId"]),
            "/api/integrations/jarvis/feedback/123e4567-e89b-12d3-a456-426614174000/status",
        )

    def test_malformed_event_is_terminal_and_observable(self) -> None:
        event = self.event()
        event["payload"] = {"kind": "bug"}
        acknowledgements: list[tuple[str, str, dict[str, object]]] = []

        with patch.object(
            MODULE,
            "acknowledge",
            side_effect=lambda event_id, claim_token, body: acknowledgements.append((event_id, claim_token, body)),
        ):
            MODULE.handle_event(event)

        self.assertEqual(acknowledgements, [
            (
                "123e4567-e89b-12d3-a456-426614174001",
                "claim-1",
                {
                    "status": "failed",
                    "error": "invalid_lifecycle_request",
                },
            ),
        ])

    def test_wrong_event_type_is_terminal_without_helper_call(self) -> None:
        event = self.event()
        event["eventType"] = "feedback.status_changed"
        acknowledgements: list[tuple[str, str, dict[str, object]]] = []

        with (
            patch.object(MODULE, "execute_lifecycle") as execute,
            patch.object(
                MODULE,
                "acknowledge",
                side_effect=lambda event_id, claim_token, body: acknowledgements.append((event_id, claim_token, body)),
            ),
        ):
            MODULE.handle_event(event)

        execute.assert_not_called()
        self.assertEqual(acknowledgements[0][2], {
            "status": "failed",
            "error": "invalid_lifecycle_event",
        })

    def test_retryable_execution_returns_to_durable_queue(self) -> None:
        acknowledgements: list[tuple[str, str, dict[str, object]]] = []
        retryable = MODULE.RetryableExecutionError("temporary")

        with (
            patch.object(MODULE, "execute_lifecycle", side_effect=retryable),
            patch.object(
                MODULE,
                "acknowledge",
                side_effect=lambda event_id, claim_token, body: acknowledgements.append((event_id, claim_token, body)),
            ),
        ):
            MODULE.handle_event(self.event())

        self.assertEqual(acknowledgements[0][0], "123e4567-e89b-12d3-a456-426614174001")
        self.assertEqual(acknowledgements[0][2]["status"], "failed")
        self.assertEqual(acknowledgements[0][2]["retryAfterSeconds"], 30)

    def test_terminal_execution_is_visible_without_retry_loop(self) -> None:
        acknowledgements: list[tuple[str, str, dict[str, object]]] = []
        with (
            patch.object(
                MODULE,
                "execute_lifecycle",
                return_value={"success": False, "error": "compass_rejected_feedback_status"},
            ),
            patch.object(
                MODULE,
                "acknowledge",
                side_effect=lambda event_id, claim_token, body: acknowledgements.append((event_id, claim_token, body)),
            ),
        ):
            MODULE.handle_event(self.event())

        self.assertEqual(acknowledgements, [
            (
                "123e4567-e89b-12d3-a456-426614174001",
                "claim-1",
                {
                    "status": "failed",
                    "error": "compass_rejected_feedback_status",
                },
            ),
        ])

    def test_wrapped_transient_http_failure_is_retryable(self) -> None:
        wrapped = RuntimeError("Compass status request failed")
        wrapped.__cause__ = MODULE.urllib.error.HTTPError(
            "https://compass.openrangeconstruction.ltd",
            503,
            "unavailable",
            {},
            None,
        )
        with patch.object(MODULE, "request_feedback_status", side_effect=wrapped):
            with self.assertRaises(MODULE.RetryableExecutionError):
                MODULE.execute_lifecycle(self.valid_payload())

    def test_execution_preserves_one_idempotency_key_across_retries(self) -> None:
        payloads: list[dict[str, object]] = []
        with patch.object(
            MODULE,
            "request_feedback_status",
            side_effect=lambda payload: payloads.append(payload) or {"success": True},
        ):
            result_one = MODULE.execute_lifecycle(self.valid_payload())
            result_two = MODULE.execute_lifecycle(self.valid_payload())

        self.assertEqual(result_one, {"success": True})
        self.assertEqual(result_two, {"success": True})
        self.assertEqual(
            [payload["idempotencyKey"] for payload in payloads],
            ["scheduled:123e4567-status-v1", "scheduled:123e4567-status-v1"],
        )
        self.assertNotIn("schemaVersion", payloads[0])
        self.assertNotIn("kind", payloads[0])

    def test_run_once_reports_item_failures_after_processing(self) -> None:
        calls: list[str] = []
        health_payloads: list[dict[str, object]] = []

        def request(method: str, target: str, payload: dict[str, object] | None = None) -> dict[str, object]:
            if method == "GET" and target == MODULE.PULL_TARGET:
                calls.append("pull")
                return {"events": [self.event()]}
            if method == "POST" and target == MODULE.HEALTH_TARGET:
                calls.append("health")
                if payload is not None:
                    health_payloads.append(payload)
                return {"success": True}
            raise AssertionError(f"unexpected bridge request: {method} {target}")

        def acknowledge(
            event_id: str,
            claim_token: str,
            body: dict[str, object],
        ) -> None:
            calls.append("event")
            self.assertEqual(event_id, "123e4567-e89b-12d3-a456-426614174001")
            self.assertEqual(claim_token, "claim-1")
            self.assertEqual(body, {
                "status": "failed",
                "error": "compass_rejected_feedback_status",
            })

        with (
            patch.object(MODULE, "compass_request", side_effect=request),
            patch.object(MODULE, "execute_lifecycle", return_value={"success": False}),
            patch.object(MODULE, "acknowledge", side_effect=acknowledge),
        ):
            MODULE.run_once()

        self.assertEqual(calls, ["pull", "event", "health"])
        self.assertEqual(health_payloads, [{
            "serviceName": "jarvis-feedback-lifecycle-executor",
            "status": "degraded",
            "error": None,
            "metadata": {
                "claimedEventCount": 1,
                "completedCount": 0,
                "failedCount": 1,
                "retryableCount": 0,
            },
        }])

    def test_systemd_unit_uses_only_the_dedicated_lifecycle_environment(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        unit = (
            repo_root
            / "ops/systemd/compass-jarvis-feedback-lifecycle-executor.service"
        ).read_text(encoding="utf-8")

        environment_file_lines = [
            line for line in unit.splitlines() if line.startswith("EnvironmentFile=")
        ]
        self.assertEqual(environment_file_lines, [
            "EnvironmentFile=%h/.config/compass/"
            "jarvis-feedback-lifecycle-executor.env",
        ])
        self.assertNotIn("%h/.hermes/.env", unit)

        environment_template = (
            repo_root
            / "ops/systemd/compass-jarvis-feedback-lifecycle-executor.env.example"
        ).read_text(encoding="utf-8")
        configured_keys = {
            line.split("=", 1)[0]
            for line in environment_template.splitlines()
            if line and not line.startswith("#")
        }
        self.assertEqual(
            configured_keys,
            {
                "COMPASS_BASE_URL",
                "JARVIS_BRIDGE_SECRET",
                "COMPASS_FEEDBACK_LIFECYCLE_POLL_SECONDS",
                "LOG_LEVEL",
            },
        )
        self.assertIn(
            "COMPASS_BASE_URL=https://compass.openrangeconstruction.ltd",
            environment_template,
        )
        self.assertIn("JARVIS_BRIDGE_SECRET=", environment_template)
        self.assertIn(
            "COMPASS_FEEDBACK_LIFECYCLE_POLL_SECONDS=2",
            environment_template,
        )
        self.assertIn("LOG_LEVEL=INFO", environment_template)
        self.assertNotIn("OPENROUTER_API_KEY", environment_template)

        installation = (repo_root / "deploy/systemd/README.md").read_text(
            encoding="utf-8",
        )
        self.assertIn("jarvis-feedback-lifecycle-executor.env", installation)
        self.assertIn("install -m 0600", installation)

    def test_compass_request_rejects_non_https_runtime_origin(self) -> None:
        with patch.dict(
            os.environ,
            {
                "COMPASS_BASE_URL": "http://attacker.example",
                "JARVIS_BRIDGE_SECRET": "not-used",
            },
        ):
            with self.assertRaises(MODULE.InvalidLifecycleRequest):
                MODULE.validate_runtime_origin()

    def test_compass_request_rejects_external_target_before_network(self) -> None:
        with patch.dict(
            os.environ,
            {
                "COMPASS_BASE_URL": "https://compass.openrangeconstruction.ltd",
                "JARVIS_BRIDGE_SECRET": "test-secret",
            },
        ), patch.object(MODULE.urllib.request, "urlopen") as urlopen:
            with self.assertRaises(MODULE.InvalidLifecycleRequest):
                MODULE.compass_request(
                    "POST",
                    "https://attacker.example/steal",
                    {"status": "healthy"},
                )
        urlopen.assert_not_called()

    def test_compass_request_does_not_follow_redirects(self) -> None:
        redirected: list[dict[str, str]] = []

        class RedirectedHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                redirected.append(dict(self.headers))
                self.send_response(200)
                self.end_headers()

            def log_message(self, format: str, *args: object) -> None:
                return

        redirected_server = HTTPServer(("127.0.0.1", 0), RedirectedHandler)
        redirected_thread = threading.Thread(
            target=redirected_server.serve_forever,
            daemon=True,
        )
        redirected_thread.start()

        class PrimaryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                self.send_response(302)
                self.send_header(
                    "Location",
                    f"http://127.0.0.1:{redirected_server.server_port}/redirected",
                )
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, format: str, *args: object) -> None:
                return

        primary_server = HTTPServer(("127.0.0.1", 0), PrimaryHandler)
        primary_thread = threading.Thread(
            target=primary_server.serve_forever,
            daemon=True,
        )
        primary_thread.start()
        try:
            with (
                patch.dict(
                    os.environ,
                    {
                        "COMPASS_BASE_URL": f"http://127.0.0.1:{primary_server.server_port}",
                        "JARVIS_BRIDGE_SECRET": "redirect-secret",
                    },
                ),
                patch.object(MODULE, "validate_runtime_origin"),
                self.assertRaises(MODULE.TerminalExecutionError),
            ):
                MODULE.compass_request("POST", MODULE.HEALTH_TARGET, {"status": "healthy"})
        finally:
            primary_server.shutdown()
            primary_thread.join(timeout=2)
            primary_server.server_close()
            redirected_server.shutdown()
            redirected_thread.join(timeout=2)
            redirected_server.server_close()

        self.assertEqual(redirected, [])


if __name__ == "__main__":
    unittest.main()
