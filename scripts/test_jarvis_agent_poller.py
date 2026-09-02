import importlib.util
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SCRIPT_PATH = Path(__file__).parent / "jarvis-agent-poller.py"
SPEC = importlib.util.spec_from_file_location(
    "jarvis_agent_poller",
    SCRIPT_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load Jarvis agent poller")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CompassTransportSecurityTests(unittest.TestCase):
    def test_compass_request_rejects_non_production_origins_before_network(self) -> None:
        for base_url in (
            "https://attacker.example",
            "https://compass.openrangeconstruction.ltd/",
            "https://compass.openrangeconstruction.ltd:443",
        ):
            with self.subTest(base_url=base_url), patch.dict(
                os.environ,
                {
                    "COMPASS_BASE_URL": base_url,
                    "JARVIS_BRIDGE_SECRET": "test-secret",
                },
                clear=False,
            ), patch.object(MODULE.urllib.request, "urlopen") as urlopen:
                with self.assertRaisesRegex(RuntimeError, "production Compass origin"):
                    MODULE.compass_request("GET", MODULE.HEALTH_TARGET)
                urlopen.assert_not_called()

    def test_compass_request_uses_a_no_redirect_opener(self) -> None:
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                return b"{}"

        opener = Mock()
        opener.open.return_value = Response()
        with (
            patch.dict(
                os.environ,
                {
                    "COMPASS_BASE_URL": "https://compass.openrangeconstruction.ltd",
                    "JARVIS_BRIDGE_SECRET": "test-secret",
                },
                clear=False,
            ),
            patch.object(
                MODULE.urllib.request,
                "build_opener",
                return_value=opener,
            ) as build_opener,
        ):
            self.assertEqual(
                MODULE.compass_request("GET", MODULE.HEALTH_TARGET),
                {},
            )

        build_opener.assert_called_once()
        handler = build_opener.call_args.args[0]
        self.assertIsNone(
            handler.redirect_request(None, None, 302, "Found", None, "/next")
        )


class CompassSearchContextTests(unittest.TestCase):
    def test_empty_results_add_no_prompt_context(self) -> None:
        self.assertEqual(
            MODULE.compass_context_prompt({"results": []}),
            "",
        )

    def test_results_are_marked_untrusted_and_keep_live_url(self) -> None:
        prompt = MODULE.compass_context_prompt(
            {
                "query": "latest Loomis update",
                "results": [
                    {
                        "kind": "owner_update",
                        "title": "Weekly update",
                        "url": (
                            "https://compass.example.com/dashboard/"
                            "projects/loomis/owner-updates/update-1"
                        ),
                    }
                ],
            }
        )

        self.assertIn("untrusted JSON data", prompt)
        self.assertIn('"kind":"owner_update"', prompt)
        self.assertIn(
            "https://compass.example.com/dashboard/projects/"
            "loomis/owner-updates/update-1",
            prompt,
        )

    def test_context_is_bounded(self) -> None:
        prompt = MODULE.compass_context_prompt(
            {
                "results": [
                    {
                        "title": "Newest valid result",
                        "url": "https://compass.example.com/latest",
                    },
                    {
                        "title": "A" * (
                            MODULE.MAX_COMPASS_CONTEXT_CHARACTERS * 2
                        )
                    }
                ]
            }
        )
        self.assertLessEqual(
            len(prompt),
            MODULE.MAX_COMPASS_CONTEXT_CHARACTERS + 220,
        )
        payload_text = prompt.rsplit("\n", 1)[-1]
        parsed = MODULE.json.loads(payload_text)
        self.assertTrue(parsed["readOnly"])
        self.assertEqual(len(parsed["results"]), 1)
        self.assertEqual(
            parsed["results"][0]["url"],
            "https://compass.example.com/latest",
        )

    def test_latest_user_message_ignores_earlier_feedback(self) -> None:
        payload = {
            "messages": [
                {
                    "role": "user",
                    "content": "Please add a better RFI filter.",
                },
                {"role": "assistant", "content": "I recorded that."},
                {
                    "role": "user",
                    "content": "Can you send me a link to Loeffler RFIs?",
                },
            ]
        }
        latest = MODULE.latest_user_message(payload)

        self.assertEqual(
            latest,
            "Can you send me a link to Loeffler RFIs?",
        )
        self.assertFalse(
            MODULE.explicitly_requests_compass_feedback(latest),
        )

    def test_explicit_feedback_language_is_accepted(self) -> None:
        examples = (
            "I would like to suggest Jarvis can search Compass.",
            "There should be a persistent To-Dos link.",
            "Can you fix the photo upload error?",
            "Please add an option to print Daily Logs.",
            "I can't create a schedule item.",
        )

        for example in examples:
            with self.subTest(example=example):
                self.assertTrue(
                    MODULE.explicitly_requests_compass_feedback(example),
                )

    def test_ordinary_help_language_is_not_feedback(self) -> None:
        examples = (
            "What does this error mean?",
            "How do I fix an RFI?",
            "Can you show me the latest owner update?",
        )

        for example in examples:
            with self.subTest(example=example):
                self.assertFalse(
                    MODULE.explicitly_requests_compass_feedback(example),
                )

    def test_feedback_confirmation_requires_the_immediately_prior_question(
        self,
    ) -> None:
        confirmed = {
            "messages": [
                {
                    "role": "user",
                    "content": "Please add a better RFI filter.",
                },
                {
                    "role": "assistant",
                    "content": MODULE.FEEDBACK_CONFIRMATION_QUESTION,
                },
                {"role": "user", "content": "Yes, please file it."},
            ]
        }
        unrelated = {
            "messages": [
                {
                    "role": "user",
                    "content": "Please add a better RFI filter.",
                },
                {"role": "assistant", "content": "Would you like a link?"},
                {"role": "user", "content": "Yes."},
            ]
        }

        self.assertTrue(MODULE.confirms_pending_feedback(confirmed))
        self.assertFalse(MODULE.confirms_pending_feedback(unrelated))

    def test_feedback_confirmation_accepts_natural_filing_questions(
        self,
    ) -> None:
        self.assertTrue(
            MODULE.asked_to_file_feedback(
                "Would you like me to file both requests?"
            )
        )
        self.assertTrue(
            MODULE.asked_to_file_feedback(
                "Should I submit this to the Compass Feedback Desk?"
            )
        )
        self.assertFalse(
            MODULE.asked_to_file_feedback(
                "I can explain how the Feedback Desk works."
            )
        )

    def test_feedback_confirmation_accepts_explicit_sentence_with_context(
        self,
    ) -> None:
        report = (
            "The owner update says required fields are incomplete even "
            "though I filled them in."
        )
        payload = {
            "messages": [
                {"role": "user", "content": report},
                {
                    "role": "assistant",
                    "content": MODULE.FEEDBACK_CONFIRMATION_QUESTION,
                },
                {
                    "role": "user",
                    "content": (
                        "Yes, please file this with the Compass Feedback "
                        "Desk. The draft also reopened without my photos."
                    ),
                },
            ]
        }

        self.assertEqual(
            MODULE.pending_feedback_report(payload),
            report,
        )

    def test_confirmed_report_has_deterministic_fallback_candidate(
        self,
    ) -> None:
        report = (
            "The owner update fails to publish after I complete the fields."
        )

        self.assertEqual(
            MODULE.fallback_feedback_candidate(report),
            {
                "kind": "bug",
                "title": report,
                "description": report,
            },
        )

    def test_confirmation_submits_when_model_omits_feedback_object(
        self,
    ) -> None:
        report = "Please add Select all to the owner-update photo picker."
        event = {
            "id": "event-confirmed-feedback",
            "claimToken": "1d223b6f-20ca-424d-a0b5-e66f2f9be830",
            "eventType": "agent.prompt",
            "payload": {
                "user": {
                    "id": "user-1",
                    "displayName": "Staff Member",
                    "email": "staff@example.com",
                },
                "context": {"organizationId": "org-1"},
                "messages": [
                    {"role": "user", "content": report},
                    {
                        "role": "assistant",
                        "content": MODULE.FEEDBACK_CONFIRMATION_QUESTION,
                    },
                    {"role": "user", "content": "Yes, please file it."},
                ],
            },
        }
        completion = {
            "model": "hermes-agent",
            "choices": [
                {
                    "message": {
                        "content": MODULE.json.dumps(
                            {
                                "response": "I will submit that.",
                                "feedback": None,
                            }
                        )
                    }
                }
            ],
        }

        with (
            patch.object(
                MODULE,
                "compass_search",
                return_value=None,
            ),
            patch.object(
                MODULE,
                "hermes_request",
                return_value=completion,
            ),
            patch.object(MODULE, "submit_feedback") as submit,
            patch.object(MODULE, "acknowledge") as acknowledge,
        ):
            MODULE.handle_event(event)

        submitted = submit.call_args.args[2]
        self.assertEqual(submitted["kind"], "feature")
        self.assertEqual(submitted["description"], report)
        self.assertEqual(
            submit.call_args.args[3],
            "1d223b6f-20ca-424d-a0b5-e66f2f9be830",
        )
        self.assertEqual(
            acknowledge.call_args.args[1],
            "1d223b6f-20ca-424d-a0b5-e66f2f9be830",
        )
        result = acknowledge.call_args.args[2]["result"]
        self.assertTrue(result["feedbackSubmitted"])
        self.assertNotIn(
            MODULE.FEEDBACK_CONFIRMATION_QUESTION,
            result["content"],
        )

    def test_initial_report_is_not_confirmation(self) -> None:
        payload = {
            "messages": [
                {
                    "role": "user",
                    "content": "There should be a persistent To-Dos link.",
                }
            ]
        }

        self.assertFalse(MODULE.confirms_pending_feedback(payload))


class CompassMemoryScopeTests(unittest.TestCase):
    @staticmethod
    def payload(
        *,
        user_id: str = "user-1",
        organization_id: str = "org-1",
        session_id: str = "session-1",
    ) -> dict[str, object]:
        return {
            "user": {"id": user_id},
            "context": {"organizationId": organization_id},
            "sessionId": session_id,
        }

    def test_scope_is_stable_and_contains_no_raw_identity(self) -> None:
        payload = self.payload()

        first = MODULE.hermes_session_key(payload)
        second = MODULE.hermes_session_key(payload)

        self.assertEqual(first, second)
        self.assertRegex(
            first,
            (
                r"^signet-isolated:v1:compass:"
                r"[0-9a-f]{64}:[0-9a-f]{64}$"
            ),
        )
        self.assertNotIn("user-1", first)
        self.assertNotIn("org-1", first)
        self.assertNotIn("session-1", first)

    def test_user_and_organization_change_memory_identity(self) -> None:
        baseline = MODULE.hermes_session_key(self.payload())
        other_user = MODULE.hermes_session_key(
            self.payload(user_id="user-2")
        )
        other_organization = MODULE.hermes_session_key(
            self.payload(organization_id="org-2")
        )

        self.assertNotEqual(
            baseline.split(":")[3],
            other_user.split(":")[3],
        )
        self.assertNotEqual(
            baseline.split(":")[3],
            other_organization.split(":")[3],
        )

    def test_session_changes_only_conversation_scope(self) -> None:
        first = MODULE.hermes_session_key(self.payload())
        second = MODULE.hermes_session_key(
            self.payload(session_id="session-2")
        )
        first_parts = first.split(":")
        second_parts = second.split(":")

        self.assertEqual(first_parts[3], second_parts[3])
        self.assertNotEqual(first_parts[4], second_parts[4])

    def test_missing_identity_fails_closed(self) -> None:
        for payload in (
            self.payload(user_id=""),
            self.payload(organization_id=""),
            self.payload(session_id=""),
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(RuntimeError):
                    MODULE.hermes_session_key(payload)

    def test_plugin_attestation_accepts_exact_digest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            plugin = Path(directory) / "signet.py"
            client = Path(directory) / "client.py"
            config = Path(directory) / "config.yaml"
            plugin.write_bytes(b"isolated plugin")
            client.write_bytes(b"isolated client")
            config.write_text(
                "memory:\n"
                "  memory_enabled: false\n"
                "  user_profile_enabled: false\n"
                "  provider: signet\n"
                "other:\n"
                "  enabled: true\n",
                encoding="utf-8",
            )
            digest = hashlib.sha256(plugin.read_bytes()).hexdigest()
            client_digest = hashlib.sha256(
                client.read_bytes()
            ).hexdigest()

            with patch.dict(
                os.environ,
                {
                    "COMPASS_SIGNET_PLUGIN_PATH": str(plugin),
                    "COMPASS_SIGNET_PLUGIN_SHA256": digest,
                    "COMPASS_SIGNET_CLIENT_PATH": str(client),
                    "COMPASS_SIGNET_CLIENT_SHA256": client_digest,
                    "COMPASS_HERMES_CONFIG_PATH": str(config),
                },
                clear=False,
            ):
                MODULE.verify_signet_isolation()

    def test_plugin_attestation_rejects_changed_plugin(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            plugin = Path(directory) / "signet.py"
            client = Path(directory) / "client.py"
            config = Path(directory) / "config.yaml"
            plugin.write_bytes(b"unexpected plugin")
            client.write_bytes(b"isolated client")
            config.write_text(
                "memory:\n"
                "  memory_enabled: false\n"
                "  user_profile_enabled: false\n"
                "  provider: signet\n",
                encoding="utf-8",
            )

            with patch.dict(
                os.environ,
                {
                    "COMPASS_SIGNET_PLUGIN_PATH": str(plugin),
                    "COMPASS_SIGNET_PLUGIN_SHA256": "0" * 64,
                    "COMPASS_SIGNET_CLIENT_PATH": str(client),
                    "COMPASS_SIGNET_CLIENT_SHA256": (
                        hashlib.sha256(
                            client.read_bytes()
                        ).hexdigest()
                    ),
                    "COMPASS_HERMES_CONFIG_PATH": str(config),
                },
                clear=False,
            ):
                with self.assertRaises(RuntimeError):
                    MODULE.verify_signet_isolation()

    def test_attestation_rejects_shared_hermes_memory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            plugin = Path(directory) / "signet.py"
            client = Path(directory) / "client.py"
            config = Path(directory) / "config.yaml"
            plugin.write_bytes(b"isolated plugin")
            client.write_bytes(b"isolated client")
            config.write_text(
                "memory:\n"
                "  memory_enabled: true\n"
                "  user_profile_enabled: true\n"
                "  provider: signet\n",
                encoding="utf-8",
            )
            digest = hashlib.sha256(plugin.read_bytes()).hexdigest()
            client_digest = hashlib.sha256(
                client.read_bytes()
            ).hexdigest()

            with patch.dict(
                os.environ,
                {
                    "COMPASS_SIGNET_PLUGIN_PATH": str(plugin),
                    "COMPASS_SIGNET_PLUGIN_SHA256": digest,
                    "COMPASS_SIGNET_CLIENT_PATH": str(client),
                    "COMPASS_SIGNET_CLIENT_SHA256": client_digest,
                    "COMPASS_HERMES_CONFIG_PATH": str(config),
                },
                clear=False,
            ):
                with self.assertRaises(RuntimeError):
                    MODULE.verify_signet_isolation()


if __name__ == "__main__":
    unittest.main()
