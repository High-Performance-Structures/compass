# Regression testing

Compass is used while it is being actively developed, so regression protection
must cover more than whether the application compiles. The testing program uses
several layers because no single suite can be fast, realistic, and exhaustive
at the same time.

## The operating model

| Layer | When | Purpose | Environment |
| --- | --- | --- | --- |
| Pull request | Every change | Prevent known workflows from breaking before merge | Seeded local database |
| Daily regression | Every morning and on demand | Confirm the deployed app and native projects remain healthy | Production demo plus native builds |
| Weekly deep checks | Planned | Exercise native devices, uploads, offline recovery, accessibility, and visual changes | Test tenant and simulators |
| Release gate | Before a production or app-store release | Verify reversible write workflows and the packaged apps | Staging/test tenant |

Pull requests should remain deterministic and reasonably fast. Daily checks can
spend more time on browser and native coverage. Tests that create, edit, upload,
or delete data belong in an isolated test tenant, never in the production
workspace.

## What is automated today

### Pull requests and `main`

The `Tests` workflow runs:

- unit and integration tests;
- seeded, read-only browser journeys in Chromium, Firefox, and WebKit;
- the Electron runtime suite on `main`;
- test coverage reporting.

The browser suite enters through `/demo`, then checks the usable core areas,
project workspaces, and schedule view switching. Its local database is recreated
from migrations in CI and populated by `scripts/seed-e2e-local.mjs`, so it does not
depend on a developer's database or external credentials.

### Daily regression

`.github/workflows/daily-regression.yml` runs every day and can also be started
manually. It performs:

- read-only production core-area journeys in desktop Chromium;
- the same core journeys at Android and iPhone browser sizes;
- Capacitor synchronization plus Android unit tests, lint, and a debug build;
- Capacitor synchronization plus an unsigned iOS simulator build.

If any job fails, the workflow creates or updates one rolling GitHub issue named
`Daily regression checks are failing`. It links to the run containing browser
screenshots/traces or native diagnostics. When all checks recover, the workflow
comments on and closes that issue.

The production browser journeys use the demo workspace and must remain
read-only. The deployed demo currently has no project fixture, so the
project-workspace journeys run against deterministic data on every pull request
and skip during the production synthetic check. Once a production-safe demo
project is provisioned, remove `PLAYWRIGHT_REQUIRE_PROJECT: "false"` from the
daily workflow to enable them there as well. Browser emulation catches layout
and navigation regressions, but it does not prove that the camera, biometric
prompt, file picker, push notifications, background execution, or offline
storage work on a real device.

## Coverage map

The smoke suite is organized by product area so failures are actionable and new
areas have an obvious home.

| Area | Current daily signal | Next deeper coverage |
| --- | --- | --- |
| Dashboard | Page journey | cards, links, role-specific data |
| Projects | Hub and workspace journeys | create/edit in test tenant |
| Schedule | Global page, project page, calendar/list/Gantt switching | create, assign, color, dependency, baseline |
| Daily logs | Project page journey | create log, link to-do, upload multiple photos |
| Photos | Project page journey | camera/library selection, size errors, retry queue |
| Contacts and people | Page journeys | search, manual entry, permissions |
| RFIs and RFQs | Global/project journeys | create, share, status transitions |
| Purchase orders | Global/project journeys | draft, validation, approval boundary |
| Financials and budget | Global/project journeys | totals and Sage read-model fixtures |
| Files | Page journey | folder navigation, upload limits, Drive errors |
| Conversations | Page journey | channel/message/thread flows |
| Owner updates and selections | Project journeys | exact log/photo selection, reporting period, frozen schedule preview, publish in test tenant |
| Desktop | Electron launch/runtime | update, offline, deep-link, packaging |
| Android and iOS | Sync, lint/tests, build | simulator/device field journeys |

Whenever a usable product area or critical workflow is added, update this table
and add its route or journey in the same pull request. A feature is not complete
until its regression signal is identified.

## Running checks locally

Install the browser used by the test once:

```bash
bunx playwright install chromium
```

Run the seeded web journeys:

```bash
LOCAL_DB_PATH=.e2e/compass.db bun run test:e2e:web --project=chromium
```

Run a mobile-sized browser project:

```bash
LOCAL_DB_PATH=.e2e/compass.db bun run test:e2e:prepare
LOCAL_DB_PATH=.e2e/compass.db bunx playwright test e2e/web --project=mobile-chrome
```

Run against the deployed demo without starting a local server:

```bash
PLAYWRIGHT_BASE_URL=https://compass.openrangeconstruction.ltd \
  PLAYWRIGHT_REQUIRE_PROJECT=false \
  bunx playwright test e2e/web --project=chromium
```

Run the native build checks:

```bash
bunx cap sync android
(cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug)

bunx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

Playwright retains screenshots, video, and traces for failures. CI uploads those
artifacts for diagnosis.

## Test design rules

- Prefer a short user journey over checking implementation details.
- Give each test a product-area name and use steps for individual screens.
- Keep production checks read-only and safe to repeat.
- Use deterministic IDs and data in local/test environments.
- Test mutations through public UI or server-action boundaries, not direct
  database changes; direct SQL is reserved for fixture setup.
- Assert the outcome the user sees, including useful validation and file-size
  messages, not only that a button was clickable.
- Add a regression test with every bug fix when the failure can be reproduced
  reliably.
- Keep camera, offline, biometric, push, and background behavior in native
  simulator/device suites rather than treating responsive browser tests as
  substitutes.
- Quarantine a flaky test only with an issue, owner, and removal date. Do not
  silently make a regression check optional.

## Planned next stage

The next investment should be a dedicated test organization with reversible
write data, followed by one critical native field journey:

1. authenticate in an Android emulator and iOS simulator;
2. open a project;
3. create a daily log;
4. attach several photos, including an over-limit selection;
5. create and assign a linked to-do;
6. go offline, queue a change, reconnect, and confirm synchronization.

After that is stable, add accessibility scans and focused visual snapshots for
the dashboard, schedule views, daily log, and mobile field shell. These should
run weekly at first; promote stable, high-value checks into the pull-request
gate.
