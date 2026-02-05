dashboard-app-template
===

a Next.js 15 dashboard template deployed to Cloudflare Workers via OpenNext.

tech stack
---

- Next.js 15.5 with Turbopack
- React 19
- Tailwind CSS v4
- shadcn/ui (new-york style)
- Recharts for data visualization
- Cloudflare Workers (via @opennextjs/cloudflare)

commands
---

- `bun dev` - start dev server (turbopack)
- `bun build` - production build
- `bun preview` - build and preview on cloudflare runtime
- `bun deploy` - build and deploy to cloudflare
- `bun lint` - run eslint

project structure
---

```
src/
├── app/              # Next.js app router
│   ├── dashboard/    # dashboard routes
│   ├── globals.css   # tailwind + theme variables
│   ├── layout.tsx    # root layout
│   └── page.tsx      # home page
├── components/
│   ├── ui/           # shadcn/ui primitives
│   └── *.tsx         # app-specific components (sidebar, charts, tables)
├── hooks/            # custom react hooks
└── lib/
    └── utils.ts      # cn() helper for class merging
```

shadcn/ui
---

uses shadcn/ui with new-york style. add components via:

```bash
bunx shadcn@latest add <component-name>
```

config in `components.json`. aliases:
- `@/components` -> src/components
- `@/components/ui` -> src/components/ui
- `@/lib` -> src/lib
- `@/hooks` -> src/hooks

cloudflare deployment
---

configured in `wrangler.jsonc`. uses OpenNext for Next.js compatibility.

env vars go in `.dev.vars` (local) or cloudflare dashboard (prod).

key bindings:
- `ASSETS` - static asset serving
- `IMAGES` - cloudflare image optimization
- `WORKER_SELF_REFERENCE` - self-reference for caching

known issues (WIP)
---

- gantt chart pan/zoom: zoom controls (+/-) and ctrl+scroll work. pan mode
  toggle (pointer/grab) exists but vertical panning does not work correctly
  yet - the scroll-based approach conflicts with how frappe-gantt sizes its
  container. horizontal panning works. needs a different approach for
  vertical navigation (possibly a custom viewport with transform-based
  rendering for the body while keeping the header fixed separately).

coding style
---

strict typescript discipline:

- `readonly` everywhere mutation isn't intended. `ReadonlyArray<T>`, 
  `Readonly<Record<K, V>>`, deep readonly wrappers. write `DeepReadonly<T>` 
  utilities when needed
- discriminated unions over optional properties. `{ status: 'ok'; data: T } | 
  { status: 'error'; error: Error }` instead of `{ status: string; error?: 
  Error; data?: T }`. makes impossible states unrepresentable
- no `enum`. use `as const` objects or union types instead. enums have quirks, 
  especially numeric ones with reverse mappings
- branded/opaque types for primitive identifiers. `type UserId = string & 
  { readonly __brand: unique symbol }` prevents mixing up `PostId` and `UserId`
- no `any`, no `as`, no `!` - genuinely zero. use `unknown` with proper 
  narrowing. write type guards instead of assertions
- explicit return types on all exported functions. don't rely on inference for 
  public APIs. catches accidental changes, improves compile speed
- effect-free module scope. no side effects at top level (no `console.log`, 
  `fetch`, mutations during import). everything meaningful happens in 
  explicitly called functions
- result types over thrown exceptions. return `Result<T, E>` or `Either` 
  instead of throwing. makes error handling visible in type signatures

these trade short-term convenience for long-term correctness. the strict 
version is always better even when the permissive version works right now.
