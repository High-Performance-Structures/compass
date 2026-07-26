import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parent / "jarvis-agent-poller.py"
SPEC = importlib.util.spec_from_file_location(
    "jarvis_agent_poller",
    SCRIPT_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load Jarvis agent poller")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


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


if __name__ == "__main__":
    unittest.main()
