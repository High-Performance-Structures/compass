import importlib.util
import json
import os
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
            "claimToken": "telegram-claim",
            "eventType": "feedback.status_changed",
            "source": "telegram",
            "payload": {},
        }
        with (
            patch.object(
                MODULE,
                "delivery_details",
                return_value={
                    "message": "Your request was received.",
                    "deliveryTarget": {"externalActorId": "123456"},
                },
            ),
            patch.object(MODULE, "send_via_hermes") as sender,
            patch.object(MODULE, "save_ledger"),
        ):
            requires_ack = MODULE.deliver_event(event, {})

        self.assertTrue(requires_ack)
        sender.assert_called_once_with(
            "telegram:123456",
            "Your request was received.",
        )

    def test_telegram_accepts_an_existing_prefixed_username(self) -> None:
        event = {
            "id": "event-telegram-username",
            "claimToken": "username-claim",
            "eventType": "feedback.status_changed",
            "source": "telegram",
            "payload": {},
        }

        with (
            patch.object(
                MODULE,
                "delivery_details",
                return_value={
                    "message": "Your request was closed.",
                    "deliveryTarget": {"externalActorId": "telegram:martinevogel"},
                },
            ),
            patch.object(MODULE, "send_via_hermes") as sender,
            patch.object(MODULE, "save_ledger"),
        ):
            requires_ack = MODULE.deliver_event(event, {})

        self.assertTrue(requires_ack)
        sender.assert_called_once_with(
            "telegram:@martinevogel",
            "Your request was closed.",
        )

    def test_email_uses_the_original_sender_address(self) -> None:
        event = {
            "id": "event-2",
            "claimToken": "email-claim",
            "eventType": "feedback.status_changed",
            "source": "jarvis-email",
            "payload": {},
        }

        with (
            patch.object(
                MODULE,
                "delivery_details",
                return_value={
                    "message": "Your request is ready for testing.",
                    "deliveryTarget": {"email": "staff@example.com"},
                },
            ),
            patch.object(MODULE, "send_via_hermes") as sender,
            patch.object(MODULE, "save_ledger"),
        ):
            requires_ack = MODULE.deliver_event(event, {})

        self.assertTrue(requires_ack)
        sender.assert_called_once_with(
            "email:staff@example.com",
            "Your request is ready for testing.",
        )

    def test_compass_conversation_replies_to_stored_event(self) -> None:
        event = {
            "id": "event-3",
            "claimToken": "conversation-claim",
            "eventType": "feedback.status_changed",
            "source": "compass-conversation",
            "payload": {},
        }

        with (
            patch.object(
                MODULE,
                "delivery_details",
                return_value={"message": "Development has started."},
            ),
            patch.object(MODULE, "reply_to_compass") as reply,
        ):
            requires_ack = MODULE.deliver_event(event, {})

        self.assertTrue(requires_ack)
        reply.assert_called_once_with(
            event,
            "Development has started.",
        )

    def test_delivery_ledger_prevents_a_duplicate_send(self) -> None:
        event = {
            "id": "event-4",
            "claimToken": "1d223b6f-20ca-424d-a0b5-e66f2f9be830",
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
                MODULE.handle_event(event, {"event-4": "delivered"})

        delivery.assert_not_called()
        acknowledge.assert_called_once_with(
            "event-4",
            "1d223b6f-20ca-424d-a0b5-e66f2f9be830",
            {"status": "completed"},
        )

    def test_acknowledges_with_the_claim_refreshed_before_delivery(self) -> None:
        event = {
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "claimToken": "old-claim",
            "eventType": "feedback.status_changed",
            "source": "telegram",
            "payload": {},
        }

        def deliver(
            current: dict[str, object],
            _ledger_state: dict[str, str],
        ) -> bool:
            current["claimToken"] = "refreshed-claim"
            return True

        ledger_state: dict[str, str] = {}
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            with (
                patch.dict(
                    MODULE.os.environ,
                    {"COMPASS_FEEDBACK_LEDGER": str(ledger)},
                    clear=False,
                ),
                patch.object(MODULE, "deliver_event", side_effect=deliver),
                patch.object(MODULE, "acknowledge") as acknowledge,
            ):
                MODULE.handle_event(event, ledger_state)

        acknowledge.assert_called_once_with(
            "123e4567-e89b-12d3-a456-426614174000",
            "refreshed-claim",
            {"status": "completed"},
        )
        self.assertEqual(
            ledger_state["123e4567-e89b-12d3-a456-426614174000"],
            "delivered",
        )

    def test_external_attempt_is_durable_before_the_send_starts(self) -> None:
        event = {
            "id": "event-attempt",
            "claimToken": "attempt-claim",
            "eventType": "feedback.status_changed",
            "source": "telegram",
            "payload": {},
        }
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            ledger_state: dict[str, str] = {}

            def assert_reserved(_target: str, _message: str) -> None:
                self.assertEqual(
                    json.loads(ledger.read_text(encoding="utf-8")),
                    {"event-attempt": "attempting"},
                )

            with (
                patch.dict(
                    MODULE.os.environ,
                    {"COMPASS_FEEDBACK_LEDGER": str(ledger)},
                    clear=False,
                ),
                patch.object(
                    MODULE,
                    "delivery_details",
                    return_value={
                        "message": "Update",
                        "deliveryTarget": {"externalActorId": "123456"},
                    },
                ),
                patch.object(
                    MODULE,
                    "send_via_hermes",
                    side_effect=assert_reserved,
                ),
            ):
                MODULE.deliver_event(event, ledger_state)

            self.assertEqual(ledger_state, {"event-attempt": "delivered"})

    def test_an_ambiguous_external_attempt_is_not_sent_twice(self) -> None:
        event = {
            "id": "event-ambiguous",
            "claimToken": "replacement-claim",
            "eventType": "feedback.status_changed",
            "source": "telegram",
            "payload": {},
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
                MODULE.handle_event(event, {"event-ambiguous": "attempting"})

        delivery.assert_not_called()
        acknowledge.assert_called_once_with(
            "event-ambiguous",
            "replacement-claim",
            {
                "status": "failed",
                "error": (
                    "External delivery outcome is ambiguous; "
                    "duplicate send suppressed"
                ),
            },
        )

    def test_legacy_delivery_ledger_migrates_to_delivered_states(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            ledger.write_text('["event-legacy"]', encoding="utf-8")
            with patch.dict(
                MODULE.os.environ,
                {"COMPASS_FEEDBACK_LEDGER": str(ledger)},
                clear=False,
            ):
                state = MODULE.load_ledger()

        self.assertEqual(state, {"event-legacy": "delivered"})

    def test_stale_ledger_writer_cannot_erase_another_delivery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            with patch.dict(
                MODULE.os.environ,
                {"COMPASS_FEEDBACK_LEDGER": str(ledger)},
                clear=False,
            ):
                MODULE.save_ledger({"event-a": "delivered"})
                MODULE.save_ledger({"event-b": "attempting"})
                state = MODULE.load_ledger()

        self.assertEqual(state, {
            "event-a": "delivered",
            "event-b": "attempting",
        })

    def test_stale_worker_reloads_durable_state_before_external_send(self) -> None:
        event = {
            "id": "event-durable",
            "claimToken": "replacement-claim",
            "eventType": "feedback.status_changed",
            "source": "telegram",
            "payload": {},
        }
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "ledger.json"
            ledger.write_text(
                json.dumps({"event-durable": "delivered"}),
                encoding="utf-8",
            )
            with (
                patch.dict(
                    MODULE.os.environ,
                    {"COMPASS_FEEDBACK_LEDGER": str(ledger)},
                    clear=False,
                ),
                patch.object(MODULE, "deliver_event") as delivery,
                patch.object(MODULE, "acknowledge") as acknowledge,
            ):
                MODULE.handle_event(event, {})

        delivery.assert_not_called()
        acknowledge.assert_called_once_with(
            "event-durable",
            "replacement-claim",
            {"status": "completed"},
        )

    def test_delivery_details_refreshes_the_event_claim_before_sending(self) -> None:
        event = {
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "claimToken": "old claim",
        }
        with patch.object(
            MODULE,
            "compass_request",
            return_value={
                "claimToken": "refreshed-claim",
                "message": "Update",
                "deliveryTarget": {},
            },
        ) as request:
            details = MODULE.delivery_details(event)

        self.assertEqual(event["claimToken"], "refreshed-claim")
        self.assertEqual(details["message"], "Update")
        request.assert_called_once_with(
            "GET",
            "/api/integrations/jarvis/events/"
            "123e4567-e89b-12d3-a456-426614174000/delivery",
            claim_token="old claim",
        )

    def test_compass_reply_refreshes_the_claim_used_by_ack(self) -> None:
        event = {
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "claimToken": "delivery-claim",
        }
        with patch.object(
            MODULE,
            "compass_request",
            return_value={"success": True, "claimToken": "reply-claim"},
        ) as request:
            MODULE.reply_to_compass(event, "Development has started.")

        self.assertEqual(event["claimToken"], "reply-claim")
        self.assertEqual(
            request.call_args.args[2]["claimToken"],
            "delivery-claim",
        )

    def test_rejects_missing_claim_token_before_delivery(self) -> None:
        event = {
            "id": "event-5",
            "eventType": "feedback.status_changed",
            "source": "feedback-widget",
            "payload": {},
        }

        with patch.object(MODULE, "deliver_event", return_value=False) as delivery:
            with self.assertRaises(RuntimeError):
                MODULE.handle_event(event, {})

        delivery.assert_not_called()


class TransportSecurityTests(unittest.TestCase):
    def test_rejects_nonproduction_origins_before_network_access(self) -> None:
        invalid_origins = (
            "https://attacker.example",
            "https://compass.openrangeconstruction.ltd:443",
            "https://COMPASS.openrangeconstruction.ltd",
            "https://sub.compass.openrangeconstruction.ltd",
            "https://compass.openrangeconstruction.ltd.attacker.example",
            "https://compass.openrangeconstruction.ltd/api",
            "https://compass.openrangeconstruction.ltd/",
            " https://compass.openrangeconstruction.ltd ",
        )
        with (
            patch.object(MODULE.urllib.request, "build_opener") as opener,
            patch.object(MODULE.urllib.request, "urlopen") as urlopen,
        ):
            for origin in invalid_origins:
                with self.subTest(origin=origin), patch.dict(
                    os.environ,
                    {
                        "COMPASS_BASE_URL": origin,
                        "JARVIS_BRIDGE_SECRET": "not-used",
                    },
                    clear=False,
                ):
                    with self.assertRaises(RuntimeError):
                        MODULE.compass_request("GET", MODULE.PULL_TARGET)

        opener.assert_not_called()
        urlopen.assert_not_called()

    def test_rejects_nonallowlisted_paths_before_network_access(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "COMPASS_BASE_URL": MODULE.COMPASS_PRODUCTION_ORIGIN,
                    "JARVIS_BRIDGE_SECRET": "not-used",
                },
                clear=False,
            ),
            patch.object(MODULE.urllib.request, "build_opener") as opener,
        ):
            invalid_targets = (
                ("GET", "/api/integrations/jarvis/events/../health"),
                (
                    "POST",
                    "/api/integrations/jarvis/events/"
                    "------------------------------------/ack",
                ),
                (
                    "GET",
                    "/api/integrations/jarvis/events/"
                    "123e4567-e89b-12d3-a456-426614174000/delivery"
                    "?claimToken=active&next=https%3A%2F%2Fattacker.example",
                ),
            )
            for method, target in invalid_targets:
                with self.subTest(target=target), self.assertRaises(RuntimeError):
                    MODULE.compass_request(method, target)

        opener.assert_not_called()
        self.assertTrue(MODULE.allowed_target(
            "GET",
            "/api/integrations/jarvis/events/"
            "123e4567-e89b-12d3-a456-426614174000/delivery",
        ))

    def test_rejects_redirect_responses_without_following_them(self) -> None:
        redirect = MODULE.urllib.error.HTTPError(
            MODULE.COMPASS_PRODUCTION_ORIGIN + MODULE.PULL_TARGET,
            302,
            "redirect",
            {"Location": "https://attacker.example/collect"},
            None,
        )
        with (
            patch.dict(
                os.environ,
                {
                    "COMPASS_BASE_URL": MODULE.COMPASS_PRODUCTION_ORIGIN,
                    "JARVIS_BRIDGE_SECRET": "not-used",
                },
                clear=False,
            ),
            patch.object(MODULE.urllib.request, "build_opener") as opener,
        ):
            opener.return_value.open.side_effect = redirect
            with self.assertRaises(RuntimeError):
                MODULE.compass_request("GET", MODULE.PULL_TARGET)

        handler = opener.call_args.args[0]
        self.assertIsInstance(handler, MODULE._NoRedirectHandler)
        opener.return_value.open.assert_called_once()


if __name__ == "__main__":
    unittest.main()
