import contextlib
import io
import json
import unittest
from unittest.mock import MagicMock, patch

import sage_square_invoice_creator_poller as poller


class InvoiceCreatorTests(unittest.TestCase):
    def setUp(self):
        self.pending = [{"operationId": "operation-100", "sageInvoiceId": "100", "invoiceNumber": "INV-100", "sageJobShortName": "H-100"}]
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.cursor.fetchall.return_value = [{"recnum": 100, "invnum": "INV-100", "shtnme": "H-100", "insusr": "invoice.operator"}]

    def test_parameterized_read_uses_original_creator_never_sage_writes(self):
        self.assertEqual(poller.read_creators(self.connection, self.pending), [{**self.pending[0], "creatorUsername": "invoice.operator"}])
        sql, params = self.cursor.execute.call_args.args
        self.assertIn("i.insusr", sql)
        self.assertNotIn("updusr", sql)
        self.assertTrue(sql.startswith("SELECT"))
        self.assertEqual(params, (100,))
        self.cursor.close.assert_called_once()
        self.connection.commit.assert_not_called()

    def test_missing_creator_is_reported_without_guessing(self):
        self.cursor.fetchall.return_value[0]["insusr"] = None
        self.assertIsNone(poller.read_creators(self.connection, self.pending)[0]["creatorUsername"])

    def test_mismatched_invoice_or_job_is_not_reported(self):
        for field in ("invnum", "shtnme"):
            with self.subTest(field=field):
                self.cursor.fetchall.return_value = [{"recnum": 100, "invnum": "INV-100", "shtnme": "H-100", "insusr": "invoice.operator", field: "wrong"}]
                with self.assertRaises(ValueError):
                    poller.read_creators(self.connection, self.pending)

    def test_injected_or_oversized_identity_never_reaches_sql(self):
        with self.assertRaises(ValueError):
            poller.read_creators(self.connection, [{**self.pending[0], "sageInvoiceId": "100;DELETE"}])
        with self.assertRaises(ValueError):
            poller.read_creators(self.connection, self.pending * 11)
        self.cursor.execute.assert_not_called()

    def test_https_origin_and_secret_checks_precede_network(self):
        for origin in ("http://compass.example.test", "https://user:password@compass.example.test", "https://compass.example.test/private"):
            with self.assertRaises(ValueError):
                poller.request_compass(origin, "test-secret-long-enough", "GET")

    @patch.object(poller, "connect_sage")
    @patch.object(poller, "request_compass")
    def test_no_pending_work_never_opens_sage(self, request, connect):
        request.return_value = {"requests": []}
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(poller.main(["--compass-base-url", "https://compass.example.test"]), 0)
        connect.assert_not_called()

    @patch.object(poller, "connect_sage")
    @patch.object(poller, "request_compass")
    def test_report_closes_connection_and_only_logs_counts(self, request, connect):
        request.side_effect = [{"requests": self.pending}, {"success": True}]
        connect.return_value = self.connection
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(poller.main(["--compass-base-url", "https://compass.example.test"]), 0)
        self.connection.close.assert_called_once()
        self.assertEqual(json.loads(output.getvalue()), {"status": "ok", "reported": 1})
        self.assertEqual(request.call_args.args[3]["creatorUsername"], "invoice.operator")
        self.assertIn("checkedAt", request.call_args.args[3])

    @patch.object(poller, "request_compass", side_effect=RuntimeError("secret-and-private-employee"))
    def test_failed_read_logs_no_sensitive_exception(self, _request):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(poller.main(["--compass-base-url", "https://compass.example.test"]), 1)
        self.assertNotIn("secret-and-private-employee", output.getvalue())


if __name__ == "__main__":
    unittest.main()
