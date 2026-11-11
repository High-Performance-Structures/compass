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

Each pay-application read also sends Sage's AR invoice number for the
application (from `dbo.acrinv`, joined on the application's ledger record)
once it is invoiced. Redeploy the poller after it changes by repeating the
`install` line for `sage_pay_application_poller.py`; the timer picks up the
new copy on its next run.

Useful health checks:

```bash
systemctl --user status compass-sage-pay-application-poller.timer
journalctl --user -u compass-sage-pay-application-poller.service -n 50 --no-pager
```

The timer invokes a single, lock-protected poll each minute. The wrapper waits
for Signet's asynchronous job and propagates the poller's real exit status to
systemd. A successful idle run reports `requested: 0`, `processed: 0`, and the
current `taxDistricts` count; that is a healthy state.

## Sage prime change order reader

A separate read-only reader keeps Compass's copy of each linked job's Sage
prime change orders (`dbo.prmchg`, lines in `dbo.pmcgln`) and proposal lines
(`dbo.prplin`), so change orders show "In Sage", "Not in Sage" or "Differs",
Compass never sends one twice, and an accepted estimate is never added as a
second proposal.
It uses the same secrets and read-only SQL account as the pay-application
poller and runs SELECT statements only. Install it next to that poller:

```bash
install -m 0755 scripts/sage_prime_change_order_reader.py \
  "$HOME/.local/lib/compass/sage_prime_change_order_reader.py"
install -m 0644 deploy/systemd/compass-sage-prime-change-order-reader.service \
  "$HOME/.config/systemd/user/"
install -m 0644 deploy/systemd/compass-sage-prime-change-order-reader.timer \
  "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now compass-sage-prime-change-order-reader.timer
```

To redeploy after a change, repeat the first `install` line from an
up-to-date checkout of main; the timer picks up the new script on its next
run. A healthy run prints `{"status": "ok", "jobs": N, "changeOrders": M}`.

## Sage cost code reader

A third read-only reader keeps Compass's cost code catalog (`sage_cost_codes`)
the same as Sage's cost code list (`dbo.cstcde`). Every five minutes it asks
Compass whether a read is due: an hour after the last one, or right away after
someone presses "Refresh from Sage" (Settings > Workflows > Sage export). When
it is, it runs one SELECT of every record number and name and posts the list;
Compass adds new codes, updates changed ones in place, and marks codes Sage no
longer has inactive (never deleted). A read that looks incomplete (fewer than
80% of the active Sage codes) changes nothing. Uses the same secrets and
read-only SQL account as the readers above. Install it next to them:

```bash
install -m 0755 scripts/sage_cost_code_reader.py \
  "$HOME/.local/lib/compass/sage_cost_code_reader.py"
install -m 0644 deploy/systemd/compass-sage-cost-code-reader.service \
  "$HOME/.config/systemd/user/"
install -m 0644 deploy/systemd/compass-sage-cost-code-reader.timer \
  "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now compass-sage-cost-code-reader.timer
```

A healthy idle check prints `{"status": "ok", "due": false}`; a read prints the
counts Compass applied (`inserted`, `updated`, `inactivated`, `unchanged`,
`skipped`). Run `sage_cost_code_reader.py --once --force` under the same secret
wrapper to read immediately.

## Sage employee reader

A fourth read-only reader ties staff to their Sage employee record. Every five
minutes it asks Compass whether a read is due: an hour after the last one, or
right away after someone presses "Read Sage employees now" (Contacts > Sage
review). When it is, it runs one SELECT of `dbo.employ` (record number, GUID,
first and last name, email, `status` and `inactv`; no pay, tax or address
columns) and posts the list. Compass links an unlinked active staff member to
the one current Sage employee with the same email, creating their internal
contact if they have none, and sets each linked staff contact active or
inactive to match Sage. Both steps follow Settings > Workflows > Sage contact
review. Ambiguous matches are left for staff in Sage review; nothing is written
to Sage. Uses the same secrets and read-only SQL account as the readers above:

```bash
install -m 0755 scripts/sage_employee_reader.py \
  "$HOME/.local/lib/compass/sage_employee_reader.py"
install -m 0644 deploy/systemd/compass-sage-employee-reader.service \
  "$HOME/.config/systemd/user/"
install -m 0644 deploy/systemd/compass-sage-employee-reader.timer \
  "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now compass-sage-employee-reader.timer
```

A healthy idle check prints `{"status": "ok", "due": false}`; a read prints the
counts Compass applied (`employees`, `linked`, `needsLinking`, `deactivated`,
`reactivated`). Run `sage_employee_reader.py --once --force` under the same
secret wrapper to read immediately.

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
