The Server Bundle
===

How Compass's server code becomes one Cloudflare Worker file, why that file is
large, what the memory limit is, and how to measure it. Read this before adding
a big library, or when production starts answering 503 with `exceededMemory`.

Run `bun run bundle:report` after a build to see the current numbers.


From `next build` to one Worker file
---

`bun run deploy` runs three steps (see `package.json`):

1. **`opennextjs-cloudflare build`** runs `next build` (Turbopack) and then
   packages the result for Cloudflare.
2. **`scripts/ascii-worker-bundle.mjs`** rewrites any non-ASCII characters in
   the bundle (explained below).
3. **`scripts/deploy-with-update-window.mjs`** uploads the Worker as a new
   version with Wrangler (`wrangler.jsonc`, entry `custom-worker.ts`) and puts
   it live while keeping the previous version reachable for tabs that are
   already open. See "Updates and open tabs" below.

`bun run deploy:direct` is the old one-step path (`opennextjs-cloudflare
deploy`). Use it only when Cloudflare refuses the upload because the build
adds, renames or deletes a Durable Object class; open tabs then have to refresh
straight away.

What happens inside step 1:

- **Turbopack builds server chunks per route.** Every page and API route gets
  its own group of chunk files in `.next/server/chunks/`. A module that two
  routes both use (say `src/lib/permissions.ts`) is often copied into each
  route's chunk group instead of being shared, because Turbopack optimizes each
  route on its own.
- **OpenNext bundles everything into one file.** A Worker cannot read files
  from disk at run time, so OpenNext uses esbuild to pull the Next runtime,
  every route chunk, the needed `node_modules`, and all of Next's build
  manifests into a single file:
  `.open-next/server-functions/default/handler.mjs`. Next's manifest loader
  (`load-manifest.external.js`) is patched to hold every manifest inline.
- **The result is that duplicates survive.** esbuild sees each chunk as a
  separate file, so the copies Turbopack made are all kept. That is why the same
  module appears many times in `handler.mjs`.

Baseline on main `26274ed3` (2026-11-08):

| What | Size |
|------|------|
| `handler.mjs` | 51.37 MB |
| module code inside route chunks | 40.5 MB |
| ... of which unique (each source file once) | 20.2 MB |
| Next manifests (inlined) | 4.81 MB |
| V8 parse time of `handler.mjs` | ~393 ms |

So roughly half the module code is extra copies. The biggest copied modules at
that point were `src/db/schema.ts` (7 copies), `src/lib/permissions.ts` (28),
Drizzle's SQLite dialect, and Capacitor's core plugins (37).


The 128 MB memory limit and `exceededMemory`
---

Each Worker isolate gets **128 MB** of memory. That one budget covers:

- the script source V8 keeps in memory (the whole `handler.mjs`),
- V8's compiled code for it,
- everything the running requests allocate.

When the isolate goes over, Cloudflare stops it and the request fails with an
`exceededMemory` outcome (users see a 503 or a blank error). In
`npx wrangler tail compass --format json` these show as
`"outcome": "exceededMemory"`. Bigger bundle = less room for requests.

Background jobs count too. Until 2026-11-09 the cron fired 7 jobs every minute
(16 on every tenth minute) with `Promise.all`, and 42 requests died in one
minute. Jobs now run one after another, spread over the hour by the table in
`src/lib/operations/schedule.ts` (see "Scheduled jobs" in the
[code map](code-map.md)). Keep heavy jobs (PDF renders, Google calls, big
downloads) on different minutes when adding one.


Why `scripts/ascii-worker-bundle.mjs` exists
---

V8 stores a string either one byte per character (Latin-1) or two bytes per
character (UTF-16). If a script contains even **one** character above U+00FF
(a curly quote, an em dash, an emoji in a regular expression), V8 stores the
**entire** script source two bytes per character. For a ~51 MB bundle that
doubles the source from ~51 MB to ~100 MB of the 128 MB budget, which caused
the `exceededMemory` 503s fixed on 2026-11-08 (PR #1227).

The script reads `handler.mjs`, the middleware bundle and `worker.js`, finds
every string, regular expression and comment holding non-ASCII text (using the
`acorn` tokenizer, so it never touches code), and rewrites each character as a
`\uXXXX` escape. Strings and regular expressions mean exactly the same thing
afterwards. It refuses template literals, because an escape would change a
`String.raw` value, and fails the build if any non-ASCII text is left.

Do not remove it from the `deploy`, `upload` and `preview` scripts.
`bun run bundle:report` warns if `handler.mjs` is not ASCII only.


Browser-only libraries stay out of the server bundle
---

Libraries that only work in the browser (maps, 3D terrain, video calls,
Capacitor plugins, PDF viewers, rich text editors) add size to every route
chunk that imports them, even if the server never runs them. Two patterns keep
them out:

- **`next/dynamic` with `ssr: false`** for components:

  ```tsx
  const PortfolioTerrain = dynamic(
    () => import("@/components/dashboard/portfolio-map/portfolio-terrain"),
    { ssr: false, loading: () => <div className="h-full min-h-[320px]" /> },
  )
  ```

  Examples: `src/components/projects/vendor-job-map.tsx`,
  `src/components/voice/realtimekit-meeting-window-loader.tsx`,
  `src/components/help/help-drawer.tsx`.

- **`typeof window` guard plus `import()`** for code paths, so the library is
  only loaded in the browser:

  ```ts
  // src/lib/native/platform.ts: safe to call on the server
  if (typeof window === "undefined") return undefined

  // src/lib/native/field-store.ts: the plugin is loaded only when used
  const { Preferences } = await import("@capacitor/preferences")
  ```
 All Capacitor and desktop imports follow
  this rule (see [native mobile](native-mobile.md)).

The architecture standard (section 6, "Heavy libraries load lazily") requires
this for maps, charts, PDF, rich text and video.


How to measure
---

Build without deploying, then run the report:

```bash
NODE_OPTIONS=--max-old-space-size=8192 bunx opennextjs-cloudflare build
bun scripts/ascii-worker-bundle.mjs
bun run bundle:report
# with V8 parse time:
node --experimental-vm-modules scripts/bundle-report.mjs --parse
```

`scripts/bundle-report.mjs` is read only. It prints:

- **`handler.mjs` size**, and whether it is ASCII only.
- **What it is made of**: route chunks, inlined Next manifests, the Next
  runtime and other `node_modules`, and OpenNext glue (from esbuild's
  `handler.mjs.meta.json`).
- **Module code**: total, unique (each module id once), unique by source file,
  and how many modules sit in more than one chunk. It reads each Turbopack
  chunk's `[moduleId, factory, ...]` array and uses the chunk's source map
  (in `.next/server/chunks/`) to name each module.
- **Top duplicated modules**: which source files cost the most in extra
  copies. These are the best targets when trimming the bundle.

Compare the numbers before and after a change that adds a dependency or moves
a large module. A change that adds megabytes to `handler.mjs` should say so in
its PR.


Updates and open tabs
---

Each deploy changes Next.js server action IDs, so a tab that was opened before
the deploy cannot run Save (or any server action) against the new version.
Compass handles that in three layers.

**1. The deploy keeps the previous version (`bun run deploy`).**
`scripts/deploy-with-update-window.mjs` notes the live version, uploads the new
build with `opennextjs-cloudflare upload` (no traffic yet), then runs
`wrangler versions deploy <new>@100% <previous>@0%`. New page loads get the new
version immediately. The previous version gets no ordinary traffic, but
Cloudflare still sends it any request carrying
`Cloudflare-Workers-Version-Overrides: compass="<previous version id>"`. It
stays in the deployment until the next deploy replaces it (Cloudflare allows
two versions in one deployment).

**2. Open tabs stay on their version and count down.**
`/api/deployment-version` reports the build id, the Worker version id
(`CF_VERSION_METADATA` binding), the Worker name (`COMPASS_WORKER_NAME` var)
and when that version was uploaded. `src/components/deployment-refresh-prompt.tsx`
polls it every minute. While the answer matches the tab's own build, the tab
tags every same-origin fetch with the override header for its own version
(`src/lib/deployment/version-pin.ts`). When the answer comes from a newer build
the tab shows "Compass will update in 2:00 - save your work now", counting down
to two minutes after the new version went live (server time, so all tabs
agree; a tab that notices late gets at least 30 seconds). Saving keeps working
during the countdown because requests still reach the old version. At zero the
notice asks for a refresh. Five minutes after that the tab stops asking for
the old version.

The window lives in `src/lib/deployment/update-window.ts`:
`UPDATE_COUNTDOWN_MS` (2 minutes), `MIN_LATE_NOTICE_MS` (30 seconds) and
`OLD_VERSION_GRACE_AFTER_COUNTDOWN_MS` (5 minutes). Change them there.

**3. Safety net for typed text.** If a save fails because of an update anyway,
or someone refreshes while the notice shows, `src/lib/deployment/unsaved-text.ts`
copies what they typed (text inputs, textareas, rich-text editors as plain
text; never passwords, hidden, file or card fields, nor anything inside
`data-compass-no-restore`) into the tab's sessionStorage. After the reload
`src/components/unsaved-text-restore-notice.tsx` puts it back into the same
fields and shows "Restored your unsaved text" with Discard. Matching is by page
path and field name/label/placeholder/id, so a field that only appears after a
click is restored only if it shows up within 20 seconds; dropdowns, checkboxes
and files are not kept.

What depends on how the deploy is run:

- **Every production deploy must use `bun run deploy`.** A plain
  `wrangler deploy` or `opennextjs-cloudflare deploy` (including a Workers
  Builds deploy command set to either) puts the new version at 100% alone, so
  open tabs' saves fail at once. They still see the countdown and then the
  refresh notice, and the safety net still keeps their typing.
- **Two deploys inside the window** drop the first version: only the version
  live just before a deploy is kept.
- **Only fetch requests are pinned.** Script chunks loaded by `<script>` tags,
  images, EventSource and WebSocket connections reach the newest version. A tab
  that opens a never-loaded screen during the countdown may need the refresh
  first.
- **Durable Object class changes** cannot be uploaded as a version; use
  `bun run deploy:direct` for that deploy.
- **Routes and cron triggers** are not changed by a version deploy. After
  editing them in `wrangler.jsonc`, also run `npx wrangler triggers deploy`.

Cloudflare's version-URL based skew protection (OpenNext `skewProtection`) is
not used: Cloudflare does not create version URLs for a Worker that exports a
Durable Object, and Compass exports `ListeningRoomCoordinator`.
