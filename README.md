# AutoPilot integrations gateway

NestJS gateway for Evolution WhatsApp, Meta Cloud WhatsApp, Instagram, Facebook and OLX. The CRM calls only this service; provider sessions live in Evolution, not in the gateway filesystem.

## First run

Use Node 22 and pnpm 10.25.0. Copy `.env.example` to `.env`, set independent microservice, Evolution API and Evolution webhook secrets, and configure the providers you will connect. `MICROSERVICE_TOKEN` must match the backend. Never expose it to a browser.

```sh
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:generate
docker compose up --build -d
```

Compose creates `autopilot_micro` and `evolution` on the same PostgreSQL server, runs `prisma db push` against the empty microservice database and starts Evolution with its own database initialization. No migration files are used. Initialization SQL runs only on a fresh PostgreSQL volume. Existing volumes require creating the Evolution database explicitly.

For host development, start only PostgreSQL, Redis and Evolution, initialize the schema, set `AUTOPILOT_URL=http://localhost:3003`, and run the gateway:

```sh
docker compose up -d postgres redis evolution-api
pnpm db:push
pnpm dev
```

Evolution requires a reachable callback: set `APP_BASE_URL` to the host address reachable from its container when running the gateway on the host. Compose supplies an internal `EVOLUTION_WEBHOOK_URL` independently. Set `APP_BASE_URL` to a public HTTPS callback URL for Meta/OLX; their OAuth/webhook URLs stay separate from the internal Evolution callback.

Firebase credentials can come from `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, or a read-only JSON mounted at `FIREBASE_CREDENTIALS_PATH`. Set `FIREBASE_STORAGE_BUCKET` when the bucket differs from the project default. Missing storage configuration does not prevent text-only startup, but media processing remains pending until storage is configured. Official WhatsApp requires a 32-byte base64 `ENCRYPTION_KEY` and system FFmpeg (included in the container).

## Internal API

Internal operations require `x-micro-token: <MICROSERVICE_TOKEN>`; `x-api-key` is also accepted. `/docs` documents the HTTP endpoints. Responses use `{ message, statusCode, data }`; webhook verification responses follow provider protocols.

| Method | Path                                          | Purpose                                                |
| ------ | --------------------------------------------- | ------------------------------------------------------ |
| POST   | `/communication/messages`                     | Idempotent provider send                               |
| POST   | `/communication/whatsapp/verify-number`       | Evolution number lookup                                |
| GET    | `/integrations/whatsapp/qrcode/:storeId`      | Create/reuse instance and return QR                    |
| GET    | `/integrations/:storeId/status`               | Consolidated provider status                           |
| DELETE | `/integrations/:storeId`                      | Disconnect and remove configuration                    |
| POST   | `/integrations/:storeId/:channel/clear-cache` | Clear provider cache/circuit breaker                   |
| GET    | `/communication/messages-with-error`          | Inspect pending/failed delivery jobs; optional storeId |
| POST   | `/communication/events/:id/retry`             | Requeue a pending/failed job                           |
| GET    | `/health`                                     | Process liveness                                       |
| GET    | `/health/ready`                               | PostgreSQL and Redis readiness                         |

Provider configuration, OAuth callbacks, templates, refresh, per-channel removal and cache inspection remain available. Routes no longer include the obsolete `/store` segment in QR requests.

Outbound requests require UUID `storeId` and `messageId`, `recipient`, and `channel` (`whatsapp`, `instagram`, `facebook`, `olx`). Text, attachment, coordinates, contacts or a reaction supply content. Optional properties may be null. WhatsApp `official` selects Meta; `baileys`, `evolution` and `unofficial` select Evolution. Without a selector, an existing official configuration takes precedence. Unsupported channel features return an explicit error; OLX supports text, while locations/contacts on social channels use a textual representation.

```json
{
  "storeId": "2e18bdb9-512d-4415-99e5-daa9b446ab10",
  "messageId": "748ac386-857a-4889-9759-110b66a7c9e7",
  "recipient": "5511999999999",
  "channel": "whatsapp",
  "wppApiType": "baileys",
  "text": "Hello"
}
```

Successful sends return `data.externalMessageId` and `data.response` with the same provider ID (null when the provider does not return one). Repeating `storeId + messageId` returns the stored result; changing its content returns 409. A timeout after possible acceptance creates an `indeterminate` outbound record. Such requests are never automatically resent. After checking the provider, an authenticated operator can bind confirmed evidence using `POST /communication/messages/:messageId/reconcile` with `{ storeId, externalMessageId }`. This endpoint only accepts indeterminate sends or sending records abandoned for over three minutes. It does not infer a match or resend a message. Inspect uncertain records at `GET /communication/outbound-with-error` (optional storeId). Inspect the provider before attempting any new send; an abandoned `sending` record also blocks resend after restart.

QR responses contain `data.qrCode.base64`, `data.message` and `data.status` (`connected`, `connecting`, `qr_code_generated`). Evolution sessions and its instance volume remain stateful; only the gateway scales horizontally.

## Durable delivery to the CRM

Provider callbacks are authenticated and persisted in `delivery_jobs` before success. Workers run every five seconds and claim jobs with PostgreSQL leases and `SKIP LOCKED`; expired claims are recovered after restart. Normalization/media work runs after persistence. Group and broadcast WhatsApp messages are ignored.

The backend may connect to the gateway namespace `/crm` with Socket.io, websocket transport and `auth.token` or `x-micro-token`. Set backend `MICROSERVICE_WS_URL=http://localhost:3005/crm`. The gateway emits `message:incoming`, `lead:incoming` and `message:ack`. One connected CRM socket receives each attempt. No Redis Socket.io adapter is needed: a worker without a local socket uses HTTP.

Events are persisted before emission. A matching positive callback within five seconds completes delivery. Missing socket, rejection or timeout uses HTTP: `/chat/messages/incoming`, `/leads/incoming`, `/chat/messages/ack`. Messages/leads require HTTP 202 with `data.accepted=true` and matching eventId. The same IDs are reused across transports and retries; the CRM deduplicates them. ACKs waiting for an outbound correlation remain pending.

Normalized events contain only the fields accepted by the CRM: `storeId`, `eventId`, `externalMessageId`, `externalContactId`, `channel`, ISO `timestamp`, optional `text`, `attachmentUrl`, `attachmentType`, `quotedMessageId`, `name`, `externalAdId`, `sentByStore`. Provider quote IDs are converted to CRM IDs only when a stored correlation exists. Rich ad/source metadata stays in `delivery_jobs.metadata`; sending those extra fields would be rejected by the current backend.

Failures use exponential retry capped at five minutes. Permanent 4xx failures are retained for inspection/requeue (408/409/425/429 remain retryable). Delivery jobs retain accepted-event keys, and outbound records retain idempotency/correlation keys; do not truncate these tables while replay or message retries are possible. Provider media is decrypted/downloaded and uploaded to Firebase before delivery. Encrypted WhatsApp attachment URLs are never forwarded as accessible media.

## Deployment and verification

Kubernetes manifests use port 3005, Deployment, separate readiness/liveness and HPA (1–3 replicas, CPU target 70%). Provision external PostgreSQL, Redis and Evolution, apply the empty schema with `pnpm db:push`, and supply the `autopilot-micro-env` secret. Replace the example image tag with the built immutable release before deploying. Ingress retains request paths and allows long-lived WebSocket connections.

```sh
pnpm exec prisma validate
pnpm exec tsc --noEmit
pnpm test --runInBand
pnpm build
docker compose --env-file .env.example config --quiet
docker build -t autopilot-micro:local .
```

Real QR scanning, provider media/voice delivery and account authorization require external accounts and credentials. Measure image size and memory after building/running. The database concurrency suite uses `TEST_DATABASE_URL` pointing to a dedicated empty PostgreSQL database; never point it at an application database.

The disposable container smoke fixture initializes a fresh database, starts two gateway processes, Evolution v2.3.7 and a CRM acceptance stub. It injects synthetic callbacks; it never sends to a real WhatsApp account. Run the smoke script once per fresh fixture (its stub counters start at zero):

```sh
docker compose -p autopilot-micro-smoke -f test/docker-compose.smoke.yml up --build -d
node test/runtime-smoke.mjs
TEST_REDIS_URL=redis://localhost:56389 TEST_DATABASE_URL=postgresql://postgres:test-password@localhost:55439/autopilot_micro_test pnpm test --runInBand
docker compose -p autopilot-micro-smoke -f test/docker-compose.smoke.yml down -v
```

The fixture binds only to localhost and uses ports 55439, 56389, 56005, 56006 and 56103. Its PostgreSQL data is disposable; never substitute a real database. Wait for gateway readiness and Evolution startup before running the script. Some installations expose Compose as `docker-compose` instead of `docker compose`.
