# Contributing to Streamz

Thank you for considering a contribution — this project is built by a community of people with different backgrounds, experiences, and skill levels. Whether you are fixing a typo, writing an integration test, improving the docs, or shipping a feature, you are welcome here.

Please read the [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) first. By participating you agree to keep this a respectful, harassment-free space.

## Ways to Contribute

You do not need to be a senior engineer to help. Every contribution counts:

| Kind | Examples |
|------|----------|
| **Code** | Bug fixes, features, refactors, performance |
| **Tests** | Unit tests, the Testcontainers integration suite, manual QA reports |
| **Docs** | README, `k8s/README.md`, guides, API examples, diagrams |
| **Design** | App polish, accessibility, the HTML prototype in `index.html` |
| **Localization** | String extraction + translations on iOS/Android |
| **Triage** | Reproing issues, confirming bugs, labeling edge cases |
| **Ideas** | A GitHub Discussion describing a problem you hit while using the app |

Anything marked `good-first-issue` or `help-wanted` is fair game — `documentation` issues need no backend knowledge at all.

## Project Layout

- `backend/` — npm workspaces: `shared`, `services/*` (auth, video, purchase, streaming, webhook), `api-gateway`, `integration-tests`
- `ios/Streamz/` — SwiftUI client (MVVM)
- `android/` — Jetpack Compose client (MVVM + Hilt)
- `index.html` — interactive HTML prototype
- `helm/streamz/` + `k8s/README.md` — Kubernetes deployment
- `WALKTHROUGH.md` — detailed change log

## Environment

```bash
cd backend
docker-compose up -d        # PostgreSQL + Redis + PgBouncer
npm install                 # all workspaces (hoisted)
```

Copy `backend/.env.example` to `backend/.env` and fill in credentials (Stripe, Mux). Never commit `.env` files.

> **First-time contributor?** If anything in this section errors on your machine, file an issue — "this setup doc is wrong" is a perfectly valid, valuable contribution. Beginner questions are welcome in GitHub Discussions.

## Common Commands

Run from the repo root unless noted:

| Command | Purpose |
|---------|---------|
| `npm run dev` | Boot all six microservices concurrently |
| `npm run dev -w services/<name>` | Run a single service |
| `npm run build` | Type-check + compile every workspace (must pass) |
| `npm run lint` | ESLint across `services/**/*.ts` and `api-gateway/**/*.ts` (must pass) |
| `npm run migrate` | Apply idempotent DB migrations |
| `npm test -w integration-tests` | Testcontainers integration suite (needs Docker running) |
| `npm run mock:webhook` | Send locally-signed Stripe/Mux webhook events |

> **Tip:** the Canary-style feedback loop is: `docker-compose up -d` → `npm run migrate` → `npm run dev` → poke the API.
> The fastest way to see the whole pipeline work is `npm test -w integration-tests` (starts real Postgres/Redis, posts a signed webhook, asserts the purchase + outbox rows land).

### Code of Conduct enforcement

The maintainers listed below enforce the [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). To report a concern, open a **private** GitHub issue or email `ogc16@users.noreply.github.com`.

- Maintainers: `ogc16` ([@ogc16](https://github.com/ogc16))

All reports are reviewed promptly and confidentially. Retaliation against a good-faith reporter is a violation of the Code of Conduct.

## Before Opening a PR

```bash
cd backend && npm run build && npm run lint
# don't forget the integration suite:
npm test -w integration-tests
```

All three must pass. If Docker isn't running on your machine, run `npm run build` and `npm run lint` and mention in the PR that the integration suite needs a CI run.

## Code Style

- TypeScript (strict-leaning), 2-space indent, no semicolons, single quotes, trailing commas.
- Add types to shared code in `backend/shared` (`@streamz/shared`) rather than duplicating across services.
- Do not add comments unless they explain a non-obvious decision.
- Name environment variables `SERVICE_NAME_VARIABLE` and document new ones in `backend/.env.example`.
- Mobile: keep MVVM — network via `APIClient`/`ApiClient`, token storage via iOS Keychain / Android Keystore-encrypted DataStore.

## Security Rules

- Verify webhook signatures; never trust raw `req.body` on `/webhooks/stripe` / `/webhooks/mux`.
- Never log or commit secrets, API keys, or tokens. `.env` is git-ignored. Key rotation documentation lives in `k8s/README.md`.
- Rate limiting and JWT rotation live at the gateway — keep them there.
- If you find a vulnerability, report it privately (see the Code of Conduct section); do not post P0 security bugs publicly.

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
2. Follow the checklist under **Before Opening a PR** so reviewers don't have to hunt for failures.
3. Describe what changed and why; note any `.env` additions or new env vars.
4. Prefer small, reviewable PRs over mega-diffs.
5. A reviewer will reply with inline feedback; expect 1–3 rounds on larger changes. Unless labeled, issues are triaged weekly.

### Review expectations for maintainers

- New reviewers are paired with an experienced contributor on their first PRs.
- Feedback is focused on the change, not the person; we use "I notice…" phrasing and always give a reason so newcomers can learn.
- No question is too basic — ask anything in the PR thread; maintainers commit to answering.

## Recognition

Contributors who land changes are credited in release notes. Substantial or sustained contributions earn a spot in the acknowledgements section of the README, including non-code contributors (docs, design, translations, QA).

## Communication

Questions, ideas, and discussions happen in GitHub Discussions. Bugs and concrete feature requests go in Issues. Prefer English so the whole community can follow, but non-native speakers are very welcome — clarity matters more than fluency.