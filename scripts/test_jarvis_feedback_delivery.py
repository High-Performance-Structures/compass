import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).parent / "jarvis-feedback-delivery.py"
SPEC = importlib.util.spec_from_file_location("jarvis_feedback_delivery", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load feedback delivery consumer")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DeliveryConsumerTests(unittest.TestCase):
    def payload(self) -> dict[str, object]:
        item_id = "123e4567-e89b-12d3-a456-426614174000"
        return {
            "schemaVersion": 1,
            "feedbackDeskItemId": item_id,
            "reference": f"CFD-{item_id}",
            "kind": "bug",
        }

    def test_creates_complete_pinned_graph_with_real_dependency_edges(self) -> None:
        created: list[dict[str, object]] = []
        repo_root = str(Path(__file__).resolve().parents[1])

        def create_task(spec: dict[str, object]) -> str:
            created.append(spec)
            return f"task-{len(created)}"

        with (
            patch.dict(os.environ, {"COMPASS_KANBAN_REPO_ROOT": repo_root}, clear=False),
            patch.object(MODULE, "run_kanban_create", side_effect=create_task),
        ):
            graph = MODULE.create_delivery_graph(self.payload())

        self.assertEqual(
            graph,
            {
                "graphId": "feedback-delivery-graph:123e4567-e89b-12d3-a456-426614174000",
                "implementationTaskId": "task-1",
                "reviewTaskId": "task-2",
                "releaseTaskId": "task-3",
            },
        )
        self.assertEqual([task["parent"] for task in created], [None, "task-1", "task-2"])
        for task in created:
            self.assertEqual(task["model"], "gpt-5.6-luna")
            self.assertEqual(task["provider"], "openai-codex")
            self.assertEqual(task["workspace"], f"worktree:{repo_root}")
            self.assertIn("title", task)
            self.assertIn("body", task)
            for protected in ("private title", "private description", "reporterEmail", "channelId"):
                self.assertNotIn(protected, json.dumps(task))

    def test_rejects_features_extra_fields_and_mismatched_references(self) -> None:
        payload = self.payload()
        for invalid in (
            {**payload, "kind": "feature"},
            {**payload, "reporterEmail": "private@example.com"},
            {**payload, "reference": "CFD-other"},
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(MODULE.InvalidDeliveryRequest):
                    MODULE.validate_delivery_payload(invalid)

    def test_rejects_a_kanban_create_without_a_task_id(self) -> None:
        with patch.dict(os.environ, {"COMPASS_KANBAN_REPO_ROOT": str(Path(__file__).resolve().parents[1])}, clear=False):
            with self.assertRaises(MODULE.TerminalDeliveryError):
                MODULE.create_delivery_graph(self.payload(), lambda _spec: "")

    def test_attaches_before_completed_ack_and_returns_only_graph_ids(self) -> None:
        event = {
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "claimToken": "claim-1",
            "eventType": "feedback.delivery_requested",
            "source": "feedback-desk",
            "payload": self.payload(),
        }
        calls: list[str] = []
        graph = {
            "graphId": "feedback-delivery-graph:123e4567-e89b-12d3-a456-426614174000",
            "implementationTaskId": "task-1",
            "reviewTaskId": "task-2",
            "releaseTaskId": "task-3",
        }

        def attach(payload: object, attached_graph: dict[str, str]) -> dict[str, object]:
            calls.append("attach")
            self.assertEqual(payload, self.payload())
            self.assertEqual(attached_graph, graph)
            return {"attached": True, **graph}

        with (
            patch.object(MODULE, "create_delivery_graph", return_value=graph),
            patch.object(MODULE, "attach_delivery_graph", side_effect=attach),
            patch.object(MODULE, "acknowledge", side_effect=lambda *_args: calls.append("ack")),
        ):
            result = MODULE.handle_event(event)

        self.assertEqual(result, "completed")
        self.assertEqual(calls, ["attach", "ack"])

    def test_callback_rejection_is_terminal_and_never_completed(self) -> None:
        event = {
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "claimToken": "claim-1",
            "eventType": "feedback.delivery_requested",
            "source": "feedback-desk",
            "payload": self.payload(),
        }
        acknowledgements: list[dict[str, object]] = []
        with (
            patch.object(MODULE, "create_delivery_graph", return_value={
                "graphId": "graph-1",
                "implementationTaskId": "task-1",
                "reviewTaskId": "task-2",
                "releaseTaskId": "task-3",
            }),
            patch.object(
                MODULE,
                "attach_delivery_graph",
                side_effect=MODULE.TerminalDeliveryError("rejected"),
            ),
            patch.object(MODULE, "acknowledge", side_effect=lambda _id, _claim, body: acknowledgements.append(body)),
        ):
            result = MODULE.handle_event(event)

        self.assertEqual(result, "failed")
        self.assertEqual(acknowledgements[0]["status"], "failed")
        self.assertNotEqual(acknowledgements[0]["status"], "completed")

    def test_retryable_partial_creation_returns_event_to_queue(self) -> None:
        event = {
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "claimToken": "claim-1",
            "eventType": "feedback.delivery_requested",
            "source": "feedback-desk",
            "payload": self.payload(),
        }
        acknowledgements: list[dict[str, object]] = []
        with (
            patch.object(MODULE, "execute_delivery", side_effect=MODULE.RetryableDeliveryError("temporary")),
            patch.object(MODULE, "acknowledge", side_effect=lambda _id, _claim, body: acknowledgements.append(body)),
        ):
            result = MODULE.handle_event(event)

        self.assertEqual(result, "retryable")
        self.assertEqual(acknowledgements[0]["retryAfterSeconds"], MODULE.RETRY_AFTER_SECONDS)

    def test_run_once_reports_queue_and_per_event_outcomes_in_health(self) -> None:
        event = {
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "claimToken": "claim-1",
            "eventType": "feedback.delivery_requested",
            "source": "feedback-desk",
            "payload": self.payload(),
        }
        requests: list[tuple[str, str, object]] = []

        def request(method: str, target: str, payload: object = None) -> object:
            requests.append((method, target, payload))
            return {"events": [event]} if method == "GET" else {"success": True}

        with (
            patch.object(MODULE, "compass_request", side_effect=request),
            patch.object(MODULE, "handle_event", return_value="completed"),
        ):
            MODULE.run_once()

        self.assertEqual(requests[0][1], MODULE.PULL_TARGET)
        health = requests[-1][2]
        self.assertEqual(health["serviceName"], "jarvis-feedback-delivery-consumer")
        self.assertEqual(health["metadata"]["claimedEventCount"], 1)
        self.assertEqual(health["metadata"]["completedCount"], 1)

    def test_kanban_command_uses_idempotency_and_does_not_pass_bridge_secrets(self) -> None:
        captured: dict[str, object] = {}
        spec = {
            "title": "Implement Compass Feedback Desk bug CFD-123e4567-e89b-12d3-a456-426614174000",
            "body": "sanitized body",
            "assignee": "default",
            "workspace": "worktree:/repo",
            "branch": "feedback-delivery/item/implementation",
            "idempotencyKey": "feedback-delivery:item:implementation",
            "model": "gpt-5.6-luna",
            "provider": "openai-codex",
            "createdBy": "jarvis-feedback-delivery",
            "skill": "feedback-operations",
            "parent": None,
        }

        class Result:
            returncode = 0
            stdout = json.dumps({"id": "task-1"})
            stderr = ""

        def run(command: list[str], **kwargs: object) -> Result:
            captured["command"] = command
            captured["kwargs"] = kwargs
            return Result()

        with patch.object(MODULE.subprocess, "run", side_effect=run):
            with patch.dict(os.environ, {"JARVIS_BRIDGE_SECRET": "do-not-pass"}, clear=False):
                self.assertEqual(MODULE.run_kanban_create(spec), "task-1")

        command = captured["command"]
        self.assertIsInstance(command, list)
        self.assertIn("--idempotency-key", command)
        self.assertIn("feedback-delivery:item:implementation", command)
        self.assertIn("--model", command)
        self.assertIn("gpt-5.6-luna", command)
        self.assertNotIn("do-not-pass", json.dumps(captured))
        kwargs = captured["kwargs"]
        if not isinstance(kwargs, dict):
            self.fail("subprocess kwargs were not captured")
        child_env = kwargs.get("env")
        if not isinstance(child_env, dict):
            self.fail("subprocess environment was not captured")
        self.assertNotIn("JARVIS_BRIDGE_SECRET", child_env)

    def test_callback_body_is_opaque_and_attachment_is_idempotent(self) -> None:
        payload = self.payload()
        graph = {
            "graphId": "feedback-delivery-graph:123e4567-e89b-12d3-a456-426614174000",
            "implementationTaskId": "task-1",
            "reviewTaskId": "task-2",
            "releaseTaskId": "task-3",
        }
        requests: list[dict[str, object]] = []

        def request(_method: str, _target: str, body: dict[str, object]) -> object:
            requests.append(body)
            return {"success": True, "feedbackDeskItemId": payload["feedbackDeskItemId"], "status": "triaged"}

        with patch.object(MODULE, "compass_request", side_effect=request):
            self.assertEqual(MODULE.attach_delivery_graph(payload, graph), {"attached": True, **graph})
            self.assertEqual(MODULE.attach_delivery_graph(payload, graph), {"attached": True, **graph})

        self.assertEqual(requests[0]["idempotencyKey"], requests[1]["idempotencyKey"])
        serialized = json.dumps(requests)
        for protected in ("private title", "private description", "reporterEmail", "channelId", "sourceId", "metadata"):
            self.assertNotIn(protected, serialized)

    def test_acknowledgement_requires_a_successful_server_transition(self) -> None:
        with patch.object(MODULE, "compass_request", return_value={"success": False}):
            with self.assertRaises(MODULE.TerminalDeliveryError):
                MODULE.acknowledge(
                    "123e4567-e89b-12d3-a456-426614174000",
                    "claim-1",
                    {"status": "completed"},
                )


if __name__ == "__main__":
    unittest.main()
