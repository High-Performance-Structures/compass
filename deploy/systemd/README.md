# Compass private integration services

These units run private-network integration workers outside Cloudflare. They
must not contain secret values. Secrets are injected at process start by the
host's secret broker.

## Sage pay-application poller

Install the poller and units on the private bridge host:

```bash
install -d "$HOME/.local/lib/compass"
install -m 0755 scripts/sage_pay_application_poller.py \
  "$HOME/.local/lib/compass/sage_pay_application_poller.py"
install -m 0755 scripts/wait_for_signet_secret_exec.py \
  "$HOME/.local/lib/compass/wait_for_signet_secret_exec.py"
install -d "$HOME/.config/systemd/user"
install -m 0644 deploy/systemd/compass-sage-pay-application-poller.service \
  "$HOME/.config/systemd/user/"
install -m 0644 deploy/systemd/compass-sage-pay-application-poller.timer \
  "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now compass-sage-pay-application-poller.timer
```

The secret broker must expose `HPS_SAGE_SQL_PASSWORD`,
`SAGE_PAY_APPLICATION_BRIDGE_SECRET`, and `SAGE_BRIDGE_SECRET`. The poller
prefers its dedicated key and retries the shared key only after a 401 so
rolling deployments remain available while still isolating normal rotations.
The SQL account is read-only and the poller never sends SQL credentials to
Compass. Each successful poll also sends a complete snapshot of Sage's
combined tax districts so estimate selectors stay aligned with `dbo.taxdst`.

Useful health checks:

```bash
systemctl --user status compass-sage-pay-application-poller.timer
journalctl --user -u compass-sage-pay-application-poller.service -n 50 --no-pager
```

The timer invokes a single, lock-protected poll each minute. The wrapper waits
for Signet's asynchronous job and propagates the poller's real exit status to
systemd. A successful idle run reports `requested: 0`, `processed: 0`, and the
current `taxDistricts` count; that is a healthy state.

## Feedback Desk bug-delivery consumer

From the Compass repository root, install the exact consumer file referenced by
the user service and give Hermes Kanban an explicit writable state directory:

```bash
install -d "$HOME/.local/lib/compass" \
  "$HOME/.local/state/hermes" \
  "$HOME/.config/systemd/user"
install -m 0755 scripts/jarvis-feedback-delivery.py \
  "$HOME/.local/lib/compass/jarvis-feedback-delivery.py"
install -m 0644 ops/systemd/compass-jarvis-feedback-delivery.service \
  "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now compass-jarvis-feedback-delivery.service
```

The unit keeps `ProtectHome=read-only` and explicitly grants write access only
to `%h/.local/state/hermes`, where `HERMES_KANBAN_DB` points. The consumer is
therefore the repository's `scripts/jarvis-feedback-delivery.py` copied to the
same `%h/.local/lib/compass/jarvis-feedback-delivery.py` path used by
`ExecStart`; do not hand-edit the unit to point at a repository-relative path.
