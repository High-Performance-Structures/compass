import importlib.util
import pathlib
import unittest


SCRIPT_PATH = pathlib.Path(__file__).with_name("square_webhook_subscription.py")
SPEC = importlib.util.spec_from_file_location("square_webhook_subscription", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load Square webhook subscription script")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SquareWebhookSubscriptionTests(unittest.TestCase):
    def test_exact_subscription_requires_name_and_url(self) -> None:
        self.assertTrue(
            MODULE.exact_subscription(
                {
                    "name": MODULE.SUBSCRIPTION_NAME,
                    "notification_url": MODULE.NOTIFICATION_URL,
                }
            )
        )
        self.assertFalse(
            MODULE.exact_subscription(
                {
                    "name": MODULE.SUBSCRIPTION_NAME,
                    "notification_url": "https://example.invalid/webhook",
                }
            )
        )

    def test_validation_rejects_event_drift(self) -> None:
        with self.assertRaisesRegex(MODULE.SubscriptionError, "event list"):
            MODULE.validate_subscription(
                {
                    "enabled": True,
                    "api_version": MODULE.API_VERSION,
                    "event_types": ["payment.updated"],
                    "signature_key": "a-valid-test-signature-key",
                }
            )


if __name__ == "__main__":
    unittest.main()
