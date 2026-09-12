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

From the Compass repository root, create or reuse the real Git checkout that
Hermes Kanban will use as its worktree anchor. The consumer script is installed
separately because the service runs from a fixed private-runtime path:

```bash
install -d "$HOME/.local/src" \
  "$HOME/.local/lib/compass" \
  "$HOME/.local/state/hermes" \
  "$HOME/.config/systemd/user"
if [ -e "$HOME/.local/src/compass/.git" ]; then
  git -C "$HOME/.local/src/compass" fetch origin main
else
  git clone --branch main --single-branch git@github.com:High-Performance-Structures/compass.git "$HOME/.local/src/compass"
fi
export COMPASS_KANBAN_REPO_ROOT="$HOME/.local/src/compass"
install -m 0755 scripts/jarvis-feedback-delivery.py \
  "$HOME/.local/lib/compass/jarvis-feedback-delivery.py"
install -m 0644 ops/systemd/compass-jarvis-feedback-delivery.service \
  "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now compass-jarvis-feedback-delivery.service
```

The unit keeps `ProtectHome=read-only` and explicitly grants write access to the
Kanban state directory and the Git checkout anchor. The checkout at
`%h/.local/src/compass` is required because Hermes creates child worktrees from
that repository; the service must not point `COMPASS_KANBAN_REPO_ROOT` at the
directory containing only the installed consumer script. The consumer is the
repository's `scripts/jarvis-feedback-delivery.py` copied to the fixed
`%h/.local/lib/compass/jarvis-feedback-delivery.py` path used by `ExecStart`.

## Feedback Desk lifecycle executor

The lifecycle executor must use its own environment file. Never point this
service at `~/.hermes/.env` or copy the shared Hermes environment into the
dedicated file. From the Compass repository root, install the two constrained
scripts, unit, and allowlisted environment template:

```bash
install -d -m 0700 "$HOME/.config/compass"
install -d "$HOME/.local/lib/compass" "$HOME/.config/systemd/user"
install -m 0755 scripts/jarvis-feedback-lifecycle-executor.py \
  "$HOME/.local/lib/compass/jarvis-feedback-lifecycle-executor.py"
install -m 0755 skills/compass-feedback-desk/scripts/compass_feedback_bridge.py \
  "$HOME/.local/lib/compass/compass_feedback_bridge.py"
install -m 0644 ops/systemd/compass-jarvis-feedback-lifecycle-executor.service \
  "$HOME/.config/systemd/user/"
install -m 0600 \
  ops/systemd/compass-jarvis-feedback-lifecycle-executor.env.example \
  "$HOME/.config/compass/jarvis-feedback-lifecycle-executor.env"
```

Provision `JARVIS_BRIDGE_SECRET` into that mode-`0600` file through the
private runtime's approved secret broker without printing it or placing it in
shell history. Keep exactly these four assignments: the fixed production
`COMPASS_BASE_URL`, `JARVIS_BRIDGE_SECRET`,
`COMPASS_FEEDBACK_LIFECYCLE_POLL_SECONDS=2`, and `LOG_LEVEL=INFO`. Reject the
installation if the file contains any other key, if the origin differs from
`https://compass.openrangeconstruction.ltd`, if the bridge secret is blank, or
if the file mode is not `0600`. Only after those checks pass may an authorized
operator run `systemctl --user daemon-reload` and enable the service.
