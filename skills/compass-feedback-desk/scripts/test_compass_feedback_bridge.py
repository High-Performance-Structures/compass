import importlib.util
import subprocess
import tempfile
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
                    "-quiet",
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


if __name__ == "__main__":
    unittest.main()
