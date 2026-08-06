import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).parent / "jarvis-feedback-notifier.py"
SPEC = importlib.util.spec_from_file_location(
    "jarvis_feedback_notifier",
    SCRIPT_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load Jarvis feedback notifier")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RoutingTests(unittest.TestCase):
    def test_reads_external_actor_from_serialized_metadata(self) -> None:
        payload = {
            "metadata": json.dumps({"externalActorId": "123456"})
        }

        self.assertEqual(
            MODULE.external_actor_id(payload),
            "123456",
        )

    def test_telegram_uses_the_existing_hermes_sender(self) -> None:
        event = {
            "id": "event-1",
            "eventType": "feedback.status_changed",
            "source": "telegram",
            "payload": {
                "message": "Your request was received.",
                "reporter": {"externalActorId": "123456"},
            },
        }

        with patch.object(MODULE, "send_via_hermes") as sender:
            requires_ack = MODULE.deliver_event(event)

        self.assertTrue(requires_ack)
        sender.assert_called_once_with(
            "telegram:123456",
            "Your request was received.",
        )

    def test_telegram_accepts_an_existing_prefixed_username(self) -> None:
        event = {
            "id": "event-telegram-username",
            "eventType": "feedback.status_changed",
            "source": "telegram",
            "payload": {
                "message": "Your request was closed.",
                "reporter": {
                    "externalActorId": "telegram:martinevogel"
                },
            },
        }

        with patch.object(MODULE, "send_via_hermes") as sender:
            requires_ack = MODULE.deliver_event(event)

        self.assertTrue(requires_ack)
        sender.assert_called_once_with(
            "telegram:@martinevogel",
            "Your request was closed.",
        )

    def test_email_uses_the_original_sender_address(self) -> None:
        event = {
            "id": "event-2",
            "eventType": "feedback.status_changed",
            "source": "jarvis-email",
            "payload": {
                "message": "Your request is ready for testing.",
                "reporter": {"email": "staff@example.com"},
            },
        }

        with patch.object(MODULE, "send_via_hermes") as sender:
            requires_ack = MODULE.deliver_event(event)

        self.assertTrue(requires_ack)
        sender.assert_called_once_with(
            "email:staff@example.com",
            "Your request is ready for testing.",
        )

    def test_compass_conversation_replies_to_stored_event(self) -> None:
        event = {
            "id": "event-3",
            "eventType": "feedback.status_changed",
            "source": "compass-conversation",
            "payload": {"message": "Development has started."},
        }

        with patch.object(MODULE, "reply_to_compass") as reply:
            requires_ack = MODULE.deliver_event(event)

        self.assertFalse(requires_ack)
        reply.assert_called_once_with(
            "event-3",
            "Development has started.",
        )

    def test_delivery_ledger_prevents_a_duplicate_send(self) -> None:
        event = {
            "id": "event-4",
            "eventType": "feedback.status_changed",
            "source": "telegram",
            "payload": {
                "message": "Your request was received.",
                "reporter": {"externalActorId": "123456"},
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            with (
                patch.dict(
                    MODULE.os.environ,
                    {"COMPASS_FEEDBACK_LEDGER": str(ledger)},
                    clear=False,
                ),
                patch.object(MODULE, "deliver_event") as delivery,
                patch.object(MODULE, "acknowledge") as acknowledge,
            ):
                MODULE.handle_event(event, ["event-4"])

        delivery.assert_not_called()
        acknowledge.assert_called_once_with(
            "event-4",
            {"status": "completed"},
        )


if __name__ == "__main__":
    unittest.main()
