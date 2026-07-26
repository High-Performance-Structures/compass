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


if __name__ == "__main__":
    unittest.main()
