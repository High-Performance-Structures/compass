# Sage client and project write runbook

## Scope

This integration has one narrow purpose: when Compass creates a client or a client plus project, it may ensure the matching client and job exist in **High Performance Structures Inc** in Sage 100 Contractor.

It does not expose void, post, or delete operations. The Compass routes only claim `ensure_client`, `ensure_client_and_job`, and `update_client_email` operations. The modification-only operation requires the already-stored Sage client ID and number, verifies that they identify the same record, and may only fill a blank primary email. It has no client-creation fallback and will not overwrite a different nonblank Sage email. An ensure request with a known email also stops when it finds only a same-name Sage client with a blank email; link that client's Sage ID and number in Compass before using the guarded email-fill operation. The Sage worker contains no delete request.

## Verified configuration

- Sage company: `High Performance Structures Inc`
- Sage API service user: `jarvis.api`
- Sage security group: `API` (Sage requires this exact group name)
- `jarvis.api` has already completed successful authenticated API writes through the installed Sage API.
- Compass `projects.sage_job_number` maps to Sage `actrec.recnum`; `projects.sage_job_id` maps to Sage `_idnum`.
- Sage lookup tables are `clnsts` (client status), `jobsts` (job status), and `jobtyp` (job type).
- Client records are `reccln`; job records are `actrec`.

The worker resolves status and type names from the live company before every add. It fails closed if a name is missing or ambiguous. Client status is additionally checked against the approved HPS numbering:

1. Current
2. Warranty
3. Complete
4. Inactive
5. Archive
6. Other

## Compass authorization policy

Creating the customer or project is the business authorization for its expected
Sage record. A user who passes the normal Compass customer/project create
permission queues the narrow Sage operation immediately; there is no second
Sage-specific person approval. Authentication, organization scoping, RBAC, the
two operational write switches, claim tokens, idempotency, schema validation,
and read-back verification remain enforced.

## Safety controls

1. Compass and the Sage host each have an independent `SAGE_CLIENT_PROJECT_WRITES_ENABLED=true` switch. Both must be enabled.
2. Every bridge request uses the existing HMAC `SAGE_BRIDGE_SECRET`, a timestamp, and a single-use request ID.
3. Queue claims have a random token and ten-minute lease. Results without the active claim token are rejected.
4. Idempotency keys prevent a second operation for the same Compass customer or project.
5. Before an add, the worker checks Sage for an exact email/name match and refuses ambiguous duplicates. A matching client with a blank email may be enriched later, but a different nonblank Sage email is never overwritten.
6. Client status numbers are verified against their live names. Job status and type numbers are resolved by live name.
7. Generated MBXML is validated against the Sage machine's installed `mbxml.xsd` before `submitXML` is called.
8. The worker reads back `_idnum` and `recnum` after client/job creation; Compass accepts only those receipts. Sage commits an accepted client-email modification when the API session closes, so that narrow update relies on the validated `ClientModRq` response.
9. Existing Sage records with a conflicting selected status or type are not modified automatically.

## Deployment

### 1. Deploy Compass with writes disabled

Apply migration `0111_sage_client_project_write_queue.sql`, deploy the application, and leave the checked-in Cloudflare variable at:

```text
SAGE_CLIENT_PROJECT_WRITES_ENABLED=false
```

Confirm `SAGE_BRIDGE_SECRET` is present as a Cloudflare secret. Do not put its value in source control.

### 2. Build the Windows worker on the Sage computer

Copy these two files to the Sage computer:

- `scripts/Sage.100.Contractor.CompassClientProjectWriter.cs`
- `scripts/install_sage_client_project_writer.ps1`

From an elevated PowerShell prompt:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_sage_client_project_writer.ps1 `
  -CompassBaseUrl "https://compass.openrangeconstruction.ltd"
```

The installer compiles the worker to:

```text
C:\ProgramData\HPS\CompassSageWriter\CompassSageClientProjectWriter.exe
```

### 3. Configure machine-level environment variables

Set these through an elevated PowerShell prompt or Windows system settings. Use the existing secret stores for values; do not save a plaintext password in the repository or scheduled-task arguments.

```text
COMPASS_BASE_URL=https://compass.openrangeconstruction.ltd
SAGE_BRIDGE_SECRET=<same value as Cloudflare>
SAGE_API_USER=jarvis.api
SAGE_API_PASSWORD=<jarvis.api Sage password>
SAGE_SQL_SERVER=NUC-PC\SQLEXPRESS
SAGE_SQL_DATABASE=High Performance Structures Inc
SAGE_CLIENT_PROJECT_WRITES_ENABLED=false
```

The default connection uses Windows integrated security. If the scheduled-task identity needs an explicit read-only SQL connection, set `SAGE_SQL_CONNECTION_STRING` through the machine secret configuration instead.

### 4. Verify Sage security before activation

In Sage 100 Contractor for **High Performance Structures Inc**:

- In 7-2-2, confirm `jarvis.api` belongs to the exact `API` group.
- In 7-2-1, confirm the `API` group has Save permission.
- Confirm the group can save in 3-5 Jobs and 3-6 Receivable Clients.
- Delete permission is not required by Compass and should be removed from the API group if no other integration needs it.

### 5. Controlled validation

Keep the scheduled task stopped. Change the local switch to `true`, enable the Cloudflare switch in a controlled deployment, and run one operation manually:

```powershell
C:\ProgramData\HPS\CompassSageWriter\CompassSageClientProjectWriter.exe --once
```

Use a specifically approved test client/job. Verify in Sage that the client, client status, job status, job type, and client-to-job link are correct. Verify Compass received the Sage client/job IDs. If schema validation or permissions fail, the worker performs no unvalidated add and posts a failed receipt for review.

Before enabling the Cloudflare switch, inspect
`sage_client_project_write_operations` and confirm that each queued row came
from an intentional Compass customer/project creation. `--once` may claim up
to five queued rows, so use a controlled environment or temporarily hold any
rows that are outside the validation scope.

### 6. Start one-minute operation

After the controlled validation passes, register the compiled executable under the approved Windows identity, set both switches to `true`, and start it. The task launches a fresh `--once` process every minute. This is required because the Sage 2026.1 API can fail in `EnableRequests()` when one long-running process repeatedly deinitializes and reinitializes the API. A short run also releases the Sage API license between polls.

For an existing installation, use the guarded repair script from an elevated PowerShell prompt. It compiles a candidate, backs up the task and executable, runs the Sage diagnostic under the scheduled-task identity, installs the one-minute task, and automatically rolls back on failure:

```powershell
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\repair_sage_client_project_writer.ps1
```

For a new manual registration:

```powershell
$binary = "C:\ProgramData\HPS\CompassSageWriter\CompassSageClientProjectWriter.exe"
$action = New-ScheduledTaskAction -Execute $binary -Argument "--once"
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$minuteTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
Register-ScheduledTask `
  -TaskName "HPS Compass Sage Client Project Writer" `
  -Action $action `
  -Trigger @($startupTrigger, $minuteTrigger) `
  -Settings $settings `
  -User "<approved Windows service identity>" `
  -RunLevel Highest
```

The task identity must have read access to the HPS Sage SQL database and permission to read the machine-level environment variables. The Sage write itself still authenticates as `jarvis.api` through the API.

Operational logs rotate at 5 MiB and are stored in:

```text
C:\ProgramData\HPS\CompassSageWriter\logs\writer.log
C:\ProgramData\HPS\CompassSageWriter\logs\writer.previous.log
```

Between runs, Task Scheduler should show `Ready`. Confirm `LastTaskResult=0`, a `PT1M` repetition interval, and paired `Writer run started` / `Writer run completed` log entries.

## Rollback

Set either write switch to `false` and stop the Windows scheduled task. Existing Compass and Sage records remain intact; queued records are retained for audit. Do not roll back by deleting Sage records through Compass—there is intentionally no delete route.
