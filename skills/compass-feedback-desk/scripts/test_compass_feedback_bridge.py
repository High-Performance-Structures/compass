import importlib.util
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()
