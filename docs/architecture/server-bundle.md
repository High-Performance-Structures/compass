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
3. **`opennextjs-cloudflare deploy`** uploads the Worker with Wrangler
   (`wrangler.jsonc`, entry `custom-worker.ts`).

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
