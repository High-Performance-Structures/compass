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
install -d "$HOME/.config/systemd/user"
install -m 0644 deploy/systemd/compass-sage-pay-application-poller.service \
  "$HOME/.config/systemd/user/"
install -m 0644 deploy/systemd/compass-sage-pay-application-poller.timer \
  "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now compass-sage-pay-application-poller.timer
```

The secret broker must expose `HPS_SAGE_SQL_PASSWORD` and
`SAGE_BRIDGE_SECRET`. The latter must match the Cloudflare Worker secret. The
SQL account is read-only and the poller never sends SQL credentials to
Compass.

Useful health checks:

```bash
systemctl --user status compass-sage-pay-application-poller.timer
journalctl --user -u compass-sage-pay-application-poller.service -n 50 --no-pager
```

The timer invokes a single, lock-protected poll each minute. A successful idle
run reports `requested: 0` and `processed: 0`; that is a healthy state.
