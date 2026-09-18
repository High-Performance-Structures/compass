import contextlib
import io
import json
import os
import unittest
import urllib.error
from unittest.mock import patch

import square_auth_monitor as monitor


class Response(io.BytesIO):
    pass


class AuthMonitorTests(unittest.TestCase):
    def test_success_without_sage_or_invoices(self):
        locations = [{"name": name, "status": "ACTIVE"} for name in ("HPS", "ORC", "Nu-Tech")]
        with patch.object(monitor, "open_request", return_value=Response(json.dumps({"locations": locations}).encode())) as opening:
            self.assertEqual(monitor.check_authentication("test-token"), "healthy")
            request = opening.call_args.args[0]
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.full_url, monitor.SQUARE_URL)

    def test_missing_token_no_network(self):
        with patch.object(monitor, "open_request") as opening:
            self.assertEqual(monitor.check_authentication(""), "missing_credential")
            opening.assert_not_called()

    def test_http_classification(self):
        for status in (401, 403, 429, 500, 302):
            with self.subTest(status=status), patch.object(monitor, "open_request", side_effect=urllib.error.HTTPError(monitor.SQUARE_URL, status, "sensitive-body", {}, None)):
                self.assertEqual(monitor.check_authentication("test-token"), "credentials_rejected" if status in (401, 403) else "unavailable")

    def test_bad_payload_location_and_timeout(self):
        for raw, state in ((b"{}", "unavailable"), (b'{"locations":[]}', "location_mismatch"), (b"x" * (monitor.MAX_RESPONSE_BYTES + 1), "unavailable")):
            with patch.object(monitor, "open_request", return_value=Response(raw)):
                self.assertEqual(monitor.check_authentication("test-token"), state)
        with patch.object(monitor, "open_request", side_effect=TimeoutError("sensitive")):
            self.assertEqual(monitor.check_authentication("test-token"), "unavailable")

    def test_signed_reporting(self):
        with patch.object(monitor, "open_request", return_value=Response(b'{"success":true}')) as opening:
            monitor.report_observation("https://compass.example", "test-secret-long-enough", {"state": "healthy", "checkedAt": "2026-09-18T00:00:00.000Z"})
            request = opening.call_args.args[0]
            self.assertEqual(request.get_method(), "POST")
            self.assertTrue(request.get_header("X-compass-signature").startswith("sha256="))
            self.assertNotIn("test-secret", request.data.decode())

    def test_reject_unsafe_origins_and_redirects(self):
        for origin in ("http://compass.example", "https://user:pass@compass.example", "https://compass.example?next=1", "https://compass.example/other"):
            with self.assertRaises(ValueError):
                monitor.report_observation(origin, "test-secret-long-enough", {})
        self.assertIsNone(monitor.NoRedirects().redirect_request(None, None, 302, "", {}, "https://evil.example"))

    def test_reporting_failure_never_logs_secrets(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"HPS_SQUARE_PRODUCTION_ACCESS_TOKEN": "private-token"}), patch.object(monitor, "check_authentication", return_value="credentials_rejected"), patch.object(monitor, "report_observation", side_effect=ValueError("private-token")), contextlib.redirect_stdout(output):
            self.assertEqual(monitor.main(), 1)
        self.assertNotIn("private-token", output.getvalue())
        self.assertFalse(json.loads(output.getvalue())["reported"])


if __name__ == "__main__":
    unittest.main()
