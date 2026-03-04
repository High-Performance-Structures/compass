# Compass

An AI-native workspace platform that handles auth, deployment,
and real-time collaboration -- so you can focus on building
what actually matters.

## 🛠️ Development Setup

Follow these steps to set up your local environment.

### 1. Initial Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/High-Performance-Structures/compass.git
cd compass
bun install
```

### 2. Environment Variables

Create `.env.local` and `.dev.vars` in the root directory.

**`.env.local`** (Local Development):
```ini
# Bypass all auth for local development
BYPASS_AUTH=true

# WorkOS (Use placeholder values to trigger mock mode)
WORKOS_API_KEY=placeholder_development_mode
WORKOS_CLIENT_ID=placeholder_development_mode
WORKOS_COOKIE_PASSWORD=your_cookie_password_here
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback

# AI Agent
OPENROUTER_API_KEY=your_openrouter_key
```

**`.dev.vars`** (Cloudflare Worker Environment):
```ini
# Add any required secret keys here
WORKOS_API_KEY=your_real_key_if_needed
```

### 3. Database Setup

Initialize the local D1 database, run migrations, and seed mock data:

```bash
# 1. Clear any existing local state
rm -rf .wrangler

# 2. Run migrations (schema setup)
bun run db:migrate:local

# 3. Seed data (Users & Projects)
# Finds the local SQLite file and runs the seed scripts
DB_FILE=$(find .wrangler/state/v3/d1 -name "*.sqlite" | head -1) && \
sqlite3 "$DB_FILE" ".read drizzle/seeds/seed-users.sql" && \
sqlite3 "$DB_FILE" ".read drizzle/seeds/seed.sql"

# 4. Insert mock Dev User (if not in seed)
sqlite3 "$DB_FILE" "INSERT OR IGNORE INTO users (id, email, first_name, last_name, display_name, role, is_active, created_at, updated_at) VALUES ('dev-user-1', 'dev@compass.io', 'Dev', 'User', 'Dev User', 'admin', 1, datetime('now'), datetime('now'));"
```

### 4. Running the App

Start the development server:

```bash
bun dev
```

- Open **[http://localhost:3000](http://localhost:3000)**
- You will be automatically redirected to `/dashboard` as the **Dev User**.

---

## 📐 Development Guidelines

### 1. Pulling Changes
Always pull the latest changes before starting work to avoid conflicts:
```bash
git pull origin main
bun install
bun run db:migrate:local
```

### 2. Styling (CSS)
- **Do NOT use hardcoded CSS** (e.g., `style={{ width: '500px' }}`).
- Use **Tailwind CSS classes** (e.g., `w-[500px]` or `w-full max-w-lg`).
- Follow the design system tokens in `tailwind.config.ts`.

### 3. Git Ignore
- Check `.gitignore` before adding new files.
- Never commit `.env` files or local database artifacts (`.wrangler/`).

---

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
