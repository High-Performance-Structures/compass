# Compass

An AI-native workspace platform that handles auth, deployment,
and real-time collaboration -- so you can focus on building
what actually matters.

## Build With Direction

- **AI agent built in** -- every workspace ships with an intelligent
  assistant that understands your domain and takes action through
  tools you define
- **Modular by design** -- scheduling, financials, file management,
  messaging. drop in what you need, leave out what you don't
- **Deploy anywhere** -- self-host, ship to desktop and mobile,
  or deploy to the edge with Cloudflare
- **Enterprise auth** -- SSO, directory sync, and role-based access
  control out of the box

## Quick Start

```bash
git clone https://github.com/High-Performance-Structures/compass.git
cd compass
bun install
cp .env.example .env.local   # add your keys
bun run db:generate
bun run db:migrate:local
bun dev
```

See [docs/](docs/README.md) for detailed setup, environment
variables, and deployment options.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript 5.x (strict) |
| UI | shadcn/ui, Tailwind CSS v4 |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM |
| Auth | WorkOS (SSO, directory sync) |
| AI | AI SDK v6 + OpenRouter |
| Mobile | Capacitor (iOS + Android) |
| Desktop | Tauri 2.0 |
| Deployment | Cloudflare Workers via OpenNext |

## License

[AGPL-3.0](LICENSE)

## Links

- [Documentation](docs/README.md)
- [Issues](https://github.com/High-Performance-Structures/compass/issues)
- [Discussions](https://github.com/High-Performance-Structures/compass/discussions)
