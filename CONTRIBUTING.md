# Contributing to Streamz

Thanks for your interest! This repo is a monorepo with an npm-workspaces Node.js backend plus native iOS and Android clients.

## Project Layout

- `backend/` — npm workspaces: `shared`, `services/*` (auth, video, purchase, streaming, webhook), `api-gateway`
- `ios/Streamz/` — SwiftUI client (MVVM)
- `android/` — Jetpack Compose client (MVVM + Hilt)
- `index.html` — interactive HTML prototype
- `WALKTHROUGH.md` — detailed change log

## Environment

```bash
cd backend
docker-compose up -d        # PostgreSQL + Redis
npm install                 # all workspaces (hoisted)
```

Copy `backend/.env.example` to `backend/.env` and fill in credentials (Stripe, Mux). Never commit `.env` files.

## Common Commands

Run from the repo root unless noted:

| Command | Purpose |
|---------|---------|
| `npm run dev` | Boot all six microservices concurrently |
| `npm run dev -w services/<name>` | Run a single service |
| `npm run build` | Type-check + compile every workspace (must pass) |
| `npm run lint` | ESLint across `services/**/*.ts` and `api-gateway/**/*.ts` (must pass) |
| `npm run migrate` | Apply idempotent DB migrations |

Also run `cd backend && npm run build && npm run lint` before opening a PR.

## Code Style

- TypeScript (strict-leaning), 2-space indent, no semicolons, single quotes, trailing commas.
- Add types to shared code in `backend/shared` (`@streamz/shared`) rather than duplicating across services.
- Do not add comments unless they explain a non-obvious decision.
- Name environment variables `SERVICE_NAME_VARIABLE` and document new ones in `backend/.env.example`.
- Mobile: keep MVVM — network via `APIClient`/`ApiClient`, token storage via iOS Keychain / Android Keystore-encrypted DataStore.

## Security Rules

- Verify webhook signatures; never trust raw `req.body` on `/webhooks/stripe` / `/webhooks/mux`.
- Never log or commit secrets, API keys, or tokens. `.env` is git-ignored.
- Rate limiting and JWT rotation live at the gateway — keep them there.

## Committing

Write clear, imperative commit messages that match repo history, e.g.:

```
fix(backend): tsc clean across services
chore: root package.json scripts, fix backend build/migrate
docs: add system architecture diagram to README
```

Use conventional-commit prefixes (`feat`, `fix`, `chore`, `docs`, `refactor`). Keep each commit focused — stage only the files for that change.

## Pull Requests

1. Branch off `master`.
2. Run `npm run build` and `npm run lint` locally (exit 0).
3. Describe what changed and why; note any .env additions.
4. Prefer small, reviewable PRs over mega-diffs.