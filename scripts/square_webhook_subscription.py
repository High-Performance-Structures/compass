#!/usr/bin/env python3
"""Create or verify the production Compass Square webhook subscription."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Mapping, Sequence


API_ORIGIN = "https://connect.squareup.com"
API_VERSION = "2026-08-19"
NOTIFICATION_URL = (
    "https://compass.openrangeconstruction.ltd/api/integrations/square/webhook"
)
SUBSCRIPTION_NAME = "Compass Sage payment posting"
EVENT_TYPES = (
    "invoice.payment_made",
    "invoice.refunded",
    "invoice.scheduled_charge_failed",
    "payment.updated",
)


class SubscriptionError(RuntimeError):
    pass


def request(
    token: str,
    method: str,
    path: str,
    body: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    payload = None if body is None else json.dumps(body).encode()
    http_request = urllib.request.Request(
        f"{API_ORIGIN}{path}",
        data=payload,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Square-Version": API_VERSION,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(http_request, timeout=30) as response:
            value = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:1000]
        raise SubscriptionError(
            f"Square returned HTTP {error.code}: {detail}"
        ) from error
    except urllib.error.URLError as error:
        raise SubscriptionError(f"Square request failed: {error.reason}") from error
    if not isinstance(value, dict):
        raise SubscriptionError("Square returned an invalid response")
    return value


def exact_subscription(value: Mapping[str, Any]) -> bool:
    return (
        value.get("name") == SUBSCRIPTION_NAME
        and value.get("notification_url") == NOTIFICATION_URL
    )


def validate_subscription(value: Mapping[str, Any]) -> None:
    if value.get("enabled") is not True:
        raise SubscriptionError("Compass Square webhook subscription is disabled")
    if value.get("api_version") != API_VERSION:
        raise SubscriptionError("Compass Square webhook API version does not match")
    actual_events = value.get("event_types")
    if not isinstance(actual_events, list) or set(actual_events) != set(EVENT_TYPES):
        raise SubscriptionError("Compass Square webhook event list does not match")
    signature_key = value.get("signature_key")
    if not isinstance(signature_key, str) or len(signature_key) < 16:
        raise SubscriptionError("Compass Square webhook signature key is missing")


def ensure_subscription(token: str, create: bool) -> dict[str, Any]:
    listed = request(token, "GET", "/v2/webhooks/subscriptions?include_disabled=true")
    subscriptions = [
        subscription
        for subscription in listed.get("subscriptions", [])
        if isinstance(subscription, dict) and exact_subscription(subscription)
    ]
    if len(subscriptions) > 1:
        raise SubscriptionError("Multiple Compass Square webhook subscriptions exist")
    if subscriptions:
        subscription_id = subscriptions[0].get("id")
        if not isinstance(subscription_id, str):
            raise SubscriptionError("Square webhook subscription is missing its ID")
        retrieved = request(
            token,
            "GET",
            f"/v2/webhooks/subscriptions/{urllib.parse.quote(subscription_id, safe='')}",
        ).get("subscription")
        if not isinstance(retrieved, dict):
            raise SubscriptionError("Square did not return the webhook subscription")
        validate_subscription(retrieved)
        return retrieved
    if not create:
        raise SubscriptionError("Compass Square webhook subscription does not exist")
    created = request(
        token,
        "POST",
        "/v2/webhooks/subscriptions",
        {
            "idempotency_key": str(uuid.uuid4()),
            "subscription": {
                "name": SUBSCRIPTION_NAME,
                "enabled": True,
                "event_types": list(EVENT_TYPES),
                "notification_url": NOTIFICATION_URL,
                "api_version": API_VERSION,
            },
        },
    ).get("subscription")
    if not isinstance(created, dict):
        raise SubscriptionError("Square did not return the created subscription")
    validate_subscription(created)
    return created


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--signature-key-only", action="store_true")
    parser.add_argument(
        "--confirm-notification-url",
        help="Required with --create and must exactly match the production URL",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.create and args.confirm_notification_url != NOTIFICATION_URL:
        raise SubscriptionError(
            "--confirm-notification-url must exactly match the production URL"
        )
    token = (
        os.environ.get("SQUARE_PRODUCTION_ACCESS_TOKEN", "").strip()
        or os.environ.get("HPS_SQUARE_PRODUCTION_ACCESS_TOKEN", "").strip()
    )
    if not token:
        raise SubscriptionError(
            "SQUARE_PRODUCTION_ACCESS_TOKEN or HPS_SQUARE_PRODUCTION_ACCESS_TOKEN is required"
        )
    subscription = ensure_subscription(token, args.create)
    if args.signature_key_only:
        print(subscription["signature_key"], end="")
    else:
        print(
            json.dumps(
                {
                    "id": subscription.get("id"),
                    "name": subscription.get("name"),
                    "enabled": subscription.get("enabled"),
                    "eventTypes": subscription.get("event_types"),
                    "notificationUrl": subscription.get("notification_url"),
                    "apiVersion": subscription.get("api_version"),
                    "signatureKeyPresent": bool(subscription.get("signature_key")),
                },
                indent=2,
            )
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SubscriptionError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
