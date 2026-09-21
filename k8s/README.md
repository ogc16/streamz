# Deploying Streamz to Kubernetes

The `helm/streamz` chart deploys the six microservices, Postgres (StatefulSet),
Redis, an optional PgBouncer, and an NGINX ingress. It is NOT end-to-end verified
against a live cluster — review rendered manifests before applying.

## Prerequisites

- A cluster (e.g. `kind`, `minikube`, or managed AKS/EKS/GKE)
- `helm` CLI
- An ingress controller matching `ingress.className` (default `nginx`)
- Container images built from `backend/Dockerfile` per target

## 1. Build and push images

Images are built per Dockerfile target (auth/video/purchase/streaming/webhook/gateway):

```sh
cd backend
REGISTRY=ghcr.io/ogc16/streamz/backend
TAG=v1.0.0
for svc in gateway auth video purchase streaming webhook; do
  docker build --target ${svc} -t ${REGISTRY}/${svc}:${TAG} .
  docker push ${REGISTRY}/${svc}:${TAG}
done
```

## 2. Configure secrets

The chart reads `secret.*` values and emits a `Secret`. In production, prefer
sealed secrets / External Secrets and a values override:

```sh
helm install streamz ./helm/streamz \
  --set secret.POSTGRES_PASSWORD="$(openssl rand -hex 32)" \
  --set secret.JWT_SECRET="$(openssl rand -hex 32)" \
  --set secret.JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  --set secret.STRIPE_SECRET_KEY=sk_live_... \
  --set secret.STRIPE_WEBHOOK_SECRET=whsec_... \
  --set secret.MUX_TOKEN_ID=... \
  --set secret.MUX_TOKEN_SECRET=... \
  --set secret.MUX_WEBHOOK_SECRET=... \
  --set secret.MUX_SIGNING_KEY=... \
  --set secret.MUX_PRIVATE_KEY="$(grep -A1000 -- '-----BEGIN' your-key.pem)" \
  --set ingress.host=streamz.example.com
```

- `streaming` auto-enables **signed playback** when both `MUX_SIGNING_KEY` and
  `MUX_PRIVATE_KEY` are set; leave them unset to keep public playback in dev.
- `STRIPE_SECRET_KEY` must be present for `auth` (creates Stripe customers) and
  `purchase` (creates payment intents). For local testing you can empty-string it,
  but checkout/create-payment-intent calls will fail.

## 3. Migrations

The chart does not run migrations. Apply them once against the Postgres
StatefulSet before/after scaling services:

```sh
kubectl exec deploy/<release>-postgres-0 -- \
  psql -U streamz -d streamz -f - < backend/branch/migrations
```

or run `npm run migrate` from a container that has the source and the matching
`DATABASE_URL` (the created `events.outbox` table is required by `purchase`).

## 4. Install

```sh
helm upgrade --install streamz ./helm/streamz --namespace streamz --create-namespace -f prod-values.yaml
kubectl -n streamz get all
```

## Scaling notes

- `purchase`, `streaming`, `webhook` are event/HTTP workers and scale horizontally
  via `replicas`. Purchase replays its transactional outbox on startup, so any
  lost publish is recovered.
- Set `pgbouncer.enabled: true` to route service `DATABASE_URL` through PgBouncer
  (transaction pooling) when Postgres connection capacity becomes a bottleneck.
- Signed playback URLs are bounded to the remaining rental window by
  `PLAYBACK_TTL_SECONDS`, so players must re-fetch `/api/stream/playback/:id`
  for a fresh token when it expires.