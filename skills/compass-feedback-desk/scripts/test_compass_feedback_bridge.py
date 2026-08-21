import importlib.util
import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, HTTPServer


SCRIPT_PATH = (
    Path(__file__).parent / "compass_feedback_bridge.py"
)
SPEC = importlib.util.spec_from_file_location(
    "compass_feedback_bridge",
    SCRIPT_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load bridge helper")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SignatureTests(unittest.TestCase):
    def test_signature_uses_canonical_request(self) -> None:
        actual = MODULE.signature(
            "test-secret",
            "1800000000",
            "post",
            "/api/integrations/jarvis/events?limit=10",
            b'{"kind":"bug"}',
        )
        self.assertEqual(
            actual,
            "sha256=bc5d2a69489415e9bbbb469ffcc36b3036ab8f"
            "442e866dc0a48fbae587d4ba92",
        )

    def test_update_env_file_preserves_unrelated_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                "TELEGRAM_BOT_TOKEN=unchanged\n"
                "JARVIS_BRIDGE_SECRET=old\n"
                "JARVIS_BRIDGE_SECRET=duplicate\n",
                encoding="utf-8",
            )

            MODULE.update_env_file(
                env_path,
                {
                    "COMPASS_BASE_URL": "https://compass.example.com",
                    "JARVIS_BRIDGE_SECRET": "new",
                },
            )

            self.assertEqual(
                env_path.read_text(encoding="utf-8"),
                "TELEGRAM_BOT_TOKEN=unchanged\n"
                "JARVIS_BRIDGE_SECRET=new\n"
                "\n"
                "COMPASS_BASE_URL=https://compass.example.com\n",
            )
            self.assertEqual(env_path.stat().st_mode & 0o777, 0o600)

    def test_encrypt_for_transfer_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            private_key = temporary / "private.pem"
            public_der = temporary / "public.der"
            encrypted = temporary / "encrypted.bin"
            decrypted = temporary / "decrypted.txt"
            subprocess.run(
                [
                    "openssl",
                    "genpkey",
                    "-algorithm",
                    "RSA",
                    "-pkeyopt",
                    "rsa_keygen_bits:2048",
                    "-out",
                    str(private_key),
                ],
                check=True,
            )
            subprocess.run(
                [
                    "openssl",
                    "pkey",
                    "-in",
                    str(private_key),
                    "-pubout",
                    "-outform",
                    "DER",
                    "-out",
                    str(public_der),
                ],
                check=True,
            )
            encoded_public_key = MODULE.base64.b64encode(
                public_der.read_bytes()
            ).decode("ascii")
            encrypted.write_bytes(
                MODULE.base64.b64decode(
                    MODULE.encrypt_for_transfer(
                        "shared-bridge-secret",
                        encoded_public_key,
                    )
                )
            )
            subprocess.run(
                [
                    "openssl",
                    "pkeyutl",
                    "-decrypt",
                    "-inkey",
                    str(private_key),
                    "-pkeyopt",
                    "rsa_padding_mode:oaep",
                    "-pkeyopt",
                    "rsa_oaep_md:sha256",
                    "-in",
                    str(encrypted),
                    "-out",
                    str(decrypted),
                ],
                check=True,
            )

            self.assertEqual(
                decrypted.read_text(encoding="utf-8"),
                "shared-bridge-secret",
            )

    def test_visuals_command_requires_an_output_directory(self) -> None:
        parser = MODULE.build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(["visuals", "--event-id", "event-1"])

    def test_visual_response_limit_exceeds_normal_bridge_limit(self) -> None:
        self.assertGreater(
            MODULE.MAX_VISUAL_RESPONSE_BYTES,
            MODULE.MAX_BODY_BYTES,
        )


class FeedbackStatusTests(unittest.TestCase):
    def valid_payload(self) -> dict[str, object]:
        return {
            "itemId": "123e4567-e89b-12d3-a456-426614174000",
            "status": "in_progress",
            "message": "The fix is in progress.",
            "priority": "high",
            "githubIssueUrl": "https://github.com/High-Performance-Structures/compass/issues/468",
            "draftPullRequestUrl": "https://github.com/High-Performance-Structures/compass/pull/469",
            "idempotencyKey": "feedback-468-status-v1",
        }

    def test_valid_status_payload_signs_only_the_fixed_lifecycle_target(self) -> None:
        payload = self.valid_payload()
        with patch.dict(
            os.environ,
            {
                "COMPASS_BASE_URL": MODULE.COMPASS_PRODUCTION_BASE_URL,
                "JARVIS_BRIDGE_SECRET": "test-secret",
            },
        ):
            with patch.object(
                MODULE,
                "request_json",
                return_value={
                    "success": True,
                    "feedbackDeskItemId": payload["itemId"],
                    "status": payload["status"],
                    "notifiedUserCount": 1,
                    "requesterUpdateQueued": True,
                    "secret": "must-not-leak",
                },
            ) as request:
                result = MODULE.request_feedback_status(payload)

        target = request.call_args.args[1]
        body = request.call_args.args[2]
        self.assertEqual(
            target,
            "/api/integrations/jarvis/feedback/123e4567-e89b-12d3-a456-426614174000/status",
        )
        self.assertEqual(json.loads(body), payload)
        self.assertEqual(
            result,
            {
                "success": True,
                "feedbackDeskItemId": payload["itemId"],
                "status": payload["status"],
                "notifiedUserCount": 1,
                "requesterUpdateQueued": True,
            },
        )
        self.assertNotIn("secret", result)

    def test_status_payload_rejects_invalid_uuid_and_arbitrary_target_fields(self) -> None:
        payload = self.valid_payload()
        payload["itemId"] = "../../api/bridge/tools"
        payload["target"] = "https://attacker.example/steal"

        with self.assertRaises(ValueError):
            MODULE.validate_feedback_status_payload(payload)

    def test_status_payload_rejects_oversize_message_and_invalid_urls(self) -> None:
        payload = self.valid_payload()
        payload["message"] = "x" * 2_001
        with self.assertRaises(ValueError):
            MODULE.validate_feedback_status_payload(payload)

        payload = self.valid_payload()
        payload["githubIssueUrl"] = "http://attacker.example/468"
        with self.assertRaises(ValueError):
            MODULE.validate_feedback_status_payload(payload)

        payload = self.valid_payload()
        payload["githubIssueUrl"] = (
            "https://github.com/High-Performance-Structures/compass/issues/"
            + "1" * MODULE.MAX_FEEDBACK_URL_CHARS
        )
        with self.assertRaises(ValueError):
            MODULE.validate_feedback_status_payload(payload)

    def test_retries_use_the_same_idempotency_key_and_body(self) -> None:
        payload = self.valid_payload()
        with patch.dict(
            os.environ,
            {
                "COMPASS_BASE_URL": MODULE.COMPASS_PRODUCTION_BASE_URL,
                "JARVIS_BRIDGE_SECRET": "test-secret",
            },
        ):
            with patch.object(
                MODULE,
                "request_json",
                side_effect=[
                    MODULE.urllib.error.URLError("temporary"),
                    {"success": True, "duplicate": True},
                ],
            ) as request:
                result = MODULE.request_feedback_status(payload)

        self.assertEqual(result, {"success": True, "duplicate": True})
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[0].args[1:], request.call_args_list[1].args[1:])

    def test_payload_file_is_bounded_before_json_parsing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            payload_path = Path(directory) / "payload.json"
            payload_path.write_bytes(b"{" + b'"x":"' + b"x" * MODULE.MAX_BODY_BYTES + b'"}')

            with self.assertRaises(ValueError):
                MODULE.load_feedback_status_payload(str(payload_path))

    def test_local_integration_signs_the_fixed_path_and_redacts_response(self) -> None:
        payload = self.valid_payload()
        observed: dict[str, object] = {}
        secret = "integration-only-secret"

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                body = self.rfile.read(int(self.headers["Content-Length"]))
                observed["path"] = self.path
                observed["body"] = body
                observed["timestamp"] = self.headers["X-Compass-Timestamp"]
                observed["signature"] = self.headers["X-Compass-Signature"]
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "success": True,
                            "feedbackDeskItemId": payload["itemId"],
                            "status": payload["status"],
                            "notifiedUserCount": 1,
                            "requesterUpdateQueued": True,
                            "bridgeSecret": secret,
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.dict(
                os.environ,
                {
                    "COMPASS_BASE_URL": f"http://127.0.0.1:{server.server_port}",
                    "JARVIS_BRIDGE_SECRET": secret,
                },
            ):
                with patch.object(
                    MODULE,
                    "COMPASS_PRODUCTION_BASE_URL",
                    f"http://127.0.0.1:{server.server_port}",
                ):
                    result = MODULE.request_feedback_status(payload, max_attempts=1)
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

        body = observed.get("body")
        timestamp = observed.get("timestamp")
        path = observed.get("path")
        signature = observed.get("signature")
        if not isinstance(body, bytes) or not isinstance(timestamp, str):
            raise AssertionError("local server did not capture the signed request")
        if not isinstance(path, str) or not isinstance(signature, str):
            raise AssertionError("local server did not capture bridge headers")
        self.assertEqual(
            path,
            "/api/integrations/jarvis/feedback/123e4567-e89b-12d3-a456-426614174000/status",
        )
        self.assertEqual(json.loads(body), payload)
        self.assertEqual(
            signature,
            MODULE.signature(secret, timestamp, "POST", path, body),
        )
        self.assertEqual(result["requesterUpdateQueued"], True)
        self.assertNotIn(secret, json.dumps(result))

    def test_status_does_not_follow_redirects_with_bridge_signature(self) -> None:
        payload = self.valid_payload()
        primary_observed: dict[str, object] = {}
        redirected_observed: dict[str, object] = {}

        class RedirectedHandler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                redirected_observed["headers"] = dict(self.headers)
                self.send_response(200)
                self.end_headers()

            def do_POST(self) -> None:
                redirected_observed["headers"] = dict(self.headers)
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

        redirect_target = (
            f"http://127.0.0.1:{redirected_server.server_port}/off-origin"
        )

        class PrimaryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                primary_observed["path"] = self.path
                primary_observed["signature"] = self.headers.get(
                    "X-Compass-Signature"
                )
                self.send_response(302)
                self.send_header("Location", redirect_target)
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
            base_url = f"http://127.0.0.1:{primary_server.server_port}"
            with patch.dict(
                os.environ,
                {
                    "COMPASS_BASE_URL": base_url,
                    "JARVIS_BRIDGE_SECRET": "redirect-test-secret",
                },
            ):
                with patch.object(MODULE, "COMPASS_PRODUCTION_BASE_URL", base_url):
                    with self.assertRaises(RuntimeError):
                        MODULE.request_feedback_status(payload, max_attempts=1)
        finally:
            primary_server.shutdown()
            primary_thread.join(timeout=2)
            primary_server.server_close()
            redirected_server.shutdown()
            redirected_thread.join(timeout=2)
            redirected_server.server_close()

        self.assertEqual(
            primary_observed["path"],
            "/api/integrations/jarvis/feedback/123e4567-e89b-12d3-a456-426614174000/status",
        )
        self.assertIsInstance(primary_observed["signature"], str)
        self.assertEqual(redirected_observed, {})


if __name__ == "__main__":
    unittest.main()
