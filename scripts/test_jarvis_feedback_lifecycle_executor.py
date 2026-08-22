import importlib.util
import io
import os
import threading
import urllib.error
import unittest
from email.message import Message
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
            "id": "event-1",
            "eventType": "feedback.lifecycle_requested",
            "source": "feedback-desk",
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
        acknowledgements: list[tuple[str, dict[str, object]]] = []

        with patch.object(
            MODULE,
            "acknowledge",
            side_effect=lambda event_id, body: acknowledgements.append((event_id, body)),
        ):
            MODULE.handle_event(event)

        self.assertEqual(acknowledgements, [
            (
                "event-1",
                {
                    "status": "failed",
                    "error": "invalid_lifecycle_request",
                },
            ),
        ])

    def test_retryable_execution_returns_to_durable_queue(self) -> None:
        acknowledgements: list[tuple[str, dict[str, object]]] = []
        retryable = MODULE.RetryableExecutionError("temporary")

        with (
            patch.object(MODULE, "execute_lifecycle", side_effect=retryable),
            patch.object(
                MODULE,
                "acknowledge",
                side_effect=lambda event_id, body: acknowledgements.append((event_id, body)),
            ),
        ):
            MODULE.handle_event(self.event())

        self.assertEqual(acknowledgements[0][0], "event-1")
        self.assertEqual(acknowledgements[0][1]["status"], "failed")
        self.assertEqual(acknowledgements[0][1]["retryAfterSeconds"], 30)

    def test_terminal_execution_is_visible_without_retry_loop(self) -> None:
        acknowledgements: list[tuple[str, dict[str, object]]] = []
        with (
            patch.object(
                MODULE,
                "execute_lifecycle",
                return_value={"success": False, "error": "compass_rejected_feedback_status"},
            ),
            patch.object(
                MODULE,
                "acknowledge",
                side_effect=lambda event_id, body: acknowledgements.append((event_id, body)),
            ),
        ):
            MODULE.handle_event(self.event())

        self.assertEqual(acknowledgements, [
            (
                "event-1",
                {
                    "status": "failed",
                    "error": "compass_rejected_feedback_status",
                },
            ),
        ])

    def test_http_policy_rejections_are_terminal_but_transient_statuses_retry(self) -> None:
        terminal_statuses = (400, 401, 404, 409)
        retryable_statuses = (408, 425, 429, 500, 503)

        for status in terminal_statuses:
            with self.subTest(status=status), patch.object(
                MODULE,
                "request_feedback_status",
                side_effect=urllib.error.HTTPError(
                    "https://compass.example/status",
                    status,
                    "rejected",
                    Message(),
                    io.BytesIO(),
                ),
            ):
                with self.assertRaises(MODULE.TerminalExecutionError):
                    MODULE.execute_lifecycle(self.valid_payload())

        for status in retryable_statuses:
            with self.subTest(status=status), patch.object(
                MODULE,
                "request_feedback_status",
                side_effect=urllib.error.HTTPError(
                    "https://compass.example/status",
                    status,
                    "temporary",
                    Message(),
                    io.BytesIO(),
                ),
            ):
                with self.assertRaises(MODULE.RetryableExecutionError):
                    MODULE.execute_lifecycle(self.valid_payload())

    def test_wrapped_transport_failures_retry_but_wrapped_policy_http_failures_stay_terminal(self) -> None:
        wrapped_timeout = RuntimeError("request failed", TimeoutError("timed out"))
        wrapped_url_error = RuntimeError(
            "request failed",
            urllib.error.URLError("connection reset"),
        )
        terminal_http = urllib.error.HTTPError(
            "https://compass.example/status",
            409,
            "rejected",
            Message(),
            io.BytesIO(),
        )
        wrapped_terminal_http = RuntimeError("request failed", terminal_http)

        for error in (wrapped_timeout, wrapped_url_error):
            with self.subTest(error=error), patch.object(
                MODULE,
                "request_feedback_status",
                side_effect=error,
            ):
                with self.assertRaises(MODULE.RetryableExecutionError):
                    MODULE.execute_lifecycle(self.valid_payload())

        with patch.object(
            MODULE,
            "request_feedback_status",
            side_effect=wrapped_terminal_http,
        ):
            with self.assertRaises(MODULE.TerminalExecutionError):
                MODULE.execute_lifecycle(self.valid_payload())

    def test_unhashable_lifecycle_values_are_terminal_acknowledged_events(self) -> None:
        for field in ("kind", "status", "priority"):
            for malformed_value in ([], {}):
                with self.subTest(field=field, malformed_value=malformed_value):
                    event = self.event()
                    event["id"] = "123e4567-e89b-12d3-a456-426614174000"
                    payload = self.valid_payload()
                    payload[field] = malformed_value
                    event["payload"] = payload
                    acknowledgements: list[tuple[str, dict[str, object]]] = []

                    with patch.object(
                        MODULE,
                        "acknowledge",
                        side_effect=lambda event_id, body: acknowledgements.append((event_id, body)),
                    ):
                        MODULE.handle_event(event)

                    self.assertEqual(acknowledgements, [
                        (
                            "123e4567-e89b-12d3-a456-426614174000",
                            {
                                "status": "failed",
                                "error": "invalid_lifecycle_request",
                            },
                        ),
                    ])

    def test_heartbeat_failure_is_observable(self) -> None:
        with patch.object(MODULE, "compass_request", side_effect=RuntimeError("offline")):
            with self.assertLogs(MODULE.LOGGER, level="WARNING") as logs:
                result = MODULE.heartbeat("healthy")

        self.assertFalse(result)
        self.assertTrue(any("Could not record lifecycle executor heartbeat" in line for line in logs.output))

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
