import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("wait_for_signet_secret_exec.py")
SPEC = importlib.util.spec_from_file_location("signet_wait", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load Signet wait helper")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SignetWaitParsingTests(unittest.TestCase):
    def test_extracts_job_id(self) -> None:
        output = "Secret exec queued: 2a89fb1e-0a30-4213-b82b-bce2cfa86b66"
        self.assertEqual(
            MODULE.job_id_from_output(output),
            "2a89fb1e-0a30-4213-b82b-bce2cfa86b66",
        )

    def test_reads_final_json_result(self) -> None:
        self.assertEqual(
            MODULE.result_from_output(
                'Status: completed\n{"status":"ok","requested":0}'
            ),
            {"status": "ok", "requested": 0},
        )
        self.assertEqual(
            MODULE.result_from_output(
                'Status: completed\n{"status":"error","error":"HTTP 401"}'
            ),
            {"status": "error", "error": "HTTP 401"},
        )

    def test_reads_pretty_printed_multiline_result(self) -> None:
        self.assertEqual(
            MODULE.result_from_output(
                'Status: completed\n{\n  "status": "ok",\n  "requested": 1\n}'
            ),
            {"status": "ok", "requested": 1},
        )

    def test_reads_top_level_result_instead_of_nested_object(self) -> None:
        self.assertEqual(
            MODULE.result_from_output(
                'Status: completed\n{\n  "status": "ok",\n'
                '  "details": {"count": 1}\n}'
            ),
            {"status": "ok", "details": {"count": 1}},
        )

    def test_recognizes_supported_success_results(self) -> None:
        self.assertTrue(MODULE.result_succeeded({"status": "ok", "requested": 1}))
        self.assertTrue(
            MODULE.result_succeeded(
                {
                    "candidateCount": 1,
                    "results": [{"action": "already_published"}],
                }
            )
        )
        self.assertTrue(
            MODULE.result_succeeded({"candidateCount": 0, "results": []})
        )

    def test_rejects_error_or_unknown_results(self) -> None:
        self.assertFalse(
            MODULE.result_succeeded({"status": "error", "error": "HTTP 401"})
        )
        self.assertFalse(
            MODULE.result_succeeded(
                {
                    "candidateCount": 1,
                    "results": [{"action": "error", "error": "Square failed"}],
                }
            )
        )
        self.assertFalse(
            MODULE.result_succeeded({"candidateCount": 2, "results": []})
        )
        self.assertFalse(
            MODULE.result_succeeded({"candidateCount": True, "results": [{}]})
        )
        self.assertFalse(MODULE.result_succeeded({"message": "done"}))
        self.assertFalse(MODULE.result_succeeded(None))


if __name__ == "__main__":
    unittest.main()
