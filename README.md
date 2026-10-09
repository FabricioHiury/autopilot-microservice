# AutoPilot — Integrations Microservice

The communication gateway for AutoPilot, a CRM for vehicle retailers and dealerships. This service connects the CRM to WhatsApp, Instagram, Facebook, and OLX, normalizes incoming events, and manages message sending and delivery.

The microservice does not contain the sales pipeline or run the AI copilot. Those responsibilities belong to the main backend; the frontend presents the workflows to users.

## Architecture and features

| Project                                                                           | Responsibility                              | Local port |
| --------------------------------------------------------------------------------- | ------------------------------------------- | ---------- |
| [autopilot-frontend](https://github.com/FabricioHiury/autopilot-frontend)         | Store interface and platform backoffice     | 3001       |
| [autopilot-backend](https://github.com/FabricioHiury/autopilot-backend)           | CRM, authentication, business rules, and AI | 3003       |
| [autopilot-microservice](https://github.com/FabricioHiury/autopilot-microservice) | Providers, callbacks, and message delivery  | 3005       |

Stack: NestJS 10, TypeScript, Prisma 5, PostgreSQL, Redis, Socket.io, and Firebase for media. The `autopilot_micro` database is separate from the business database, `autopilot`; Evolution maintains its own database and instance volume.

Implemented features:

- WhatsApp through Evolution v2.3.7: QR code pairing, instance state, number verification, and message sending/receiving.
- Official WhatsApp through Meta: configuration, templates, encrypted tokens, and callbacks.
- Instagram, Facebook, and OLX: channel integrations, authorization, and event processing.
- Normalization, external ID correlation, attachment processing, and delivery status updates.
- Durable inbound event queue, deduplication, retries, and recovery after restarts.
- Idempotent sending and inspection of uncertain outcomes.

Each channel's capabilities depend on provider accounts, permissions, and supported formats. OLX supports text; features such as locations and contacts on social channels may be represented as text. WhatsApp sessions belong to Evolution, rather than the gateway filesystem.

## Integrated development with Colima

Use Node.js 22 and pnpm 10.25.0. The project engines support Node 22–24. These examples assume all three repositories are sibling directories.

For the initial setup:

```bash
cp .env.example .env
pnpm install --frozen-lockfile
```

Preserve `.env` if it is already configured. Start the shared infrastructure through the backend's `docker-compose.local.yml`, following the [local guide](https://github.com/FabricioHiury/autopilot-backend/blob/main/docker/local/README.md). It runs PostgreSQL, Redis, Evolution, and Ollama; the three applications run on the host.

In a terminal for this project:

```bash
set -a
source ../autopilot-backend/.env.local
set +a
export DATABASE_URL='postgresql://autopilot:autopilot@127.0.0.1:55432/autopilot_micro?schema=public'
export REDIS_HOST=127.0.0.1 REDIS_PORT=56379 REDIS_USERNAME='' REDIS_PASSWORD=''
export PORT=3005 AUTOPILOT_URL=http://localhost:3003 APP_BASE_URL=http://localhost:3005
export FRONT_URL=http://localhost:3001 EVOLUTION_API_URL=http://localhost:8080
export EVOLUTION_WEBHOOK_URL=http://host.docker.internal:3005/whatsapp/webhook/evolution
pnpm db:generate
pnpm db:push
pnpm dev
```

This project synchronizes its schema with `prisma db push`; it does not use migration files. Inspect `DATABASE_URL` before running it. The main backend applies its own migrations to the `autopilot` database.

The service loads `.env`; the terminal must explicitly load the shared `.env.local`. The Evolution callback above lets its container reach the microservice on the host. Meta and OLX require externally reachable public HTTPS URLs; `localhost` cannot replace that public callback.

## Provider configuration

| Variable                                           | Purpose                                                 |
| -------------------------------------------------- | ------------------------------------------------------- |
| `MICROSERVICE_TOKEN`                               | Internal request secret; must match the backend         |
| `AUTOPILOT_URL`                                    | Backend origin for HTTP event delivery                  |
| `APP_BASE_URL`                                     | Gateway URL used by callback workflows                  |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`           | Evolution access                                        |
| `EVOLUTION_WEBHOOK_TOKEN`, `EVOLUTION_WEBHOOK_URL` | Evolution event authentication and destination          |
| `ENCRYPTION_KEY`                                   | Base64-encoded 32-byte key for official WhatsApp tokens |
| `META_*`, `INSTAGRAM_*`, `OLX_*`                   | Respective provider configuration                       |

Use different secrets for the Evolution API and its webhook. Never send `MICROSERVICE_TOKEN` to the browser.

Firebase accepts `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`, or a JSON file at `FIREBASE_CREDENTIALS_PATH`. Configure `FIREBASE_STORAGE_BUCKET` when necessary. Without storage configured, the service can handle text, but media processing remains pending. FFmpeg is used by media workflows and is included in the project image.

## Internal API and health

Internal requests use `x-micro-token`; the `x-api-key` alias is also accepted. Standard responses follow `{ message, statusCode, data }`; webhook verification follows each provider's protocol. Documentation is available at `/docs` when `ENABLE_DOCS` is enabled.

| Method | Route                                          | Purpose                               |
| ------ | ---------------------------------------------- | ------------------------------------- |
| GET    | `/health`                                      | Process health                        |
| GET    | `/health/ready`                                | PostgreSQL and Redis readiness        |
| POST   | `/communication/messages`                      | Idempotent provider sending           |
| POST   | `/communication/whatsapp/verify-number`        | Evolution number verification         |
| GET    | `/integrations/whatsapp/qrcode/:storeId`       | Connect instance and retrieve QR code |
| GET    | `/integrations/:storeId/status`                | Store channel states                  |
| GET    | `/communication/messages-with-error`           | Inspect pending/failed events         |
| POST   | `/communication/events/:id/retry`              | Reschedule event                      |
| GET    | `/communication/outbound-with-error`           | Inspect sends with uncertain outcomes |
| POST   | `/communication/messages/:messageId/reconcile` | Associate confirmed sending evidence  |

A send identifies `storeId`, `messageId`, `recipient`, and `channel`. Repeating the store/message combination returns the stored result; changing the content of the same attempt returns 409. A timeout after possible provider acceptance produces an `indeterminate` state, which is not automatically resent. Reconciliation requires checking the provider and supplying the confirmed external ID; it does not trigger another send.

## Durable delivery to the CRM

Callbacks are authenticated and persisted in `delivery_jobs` before acknowledgment. Workers use leases and PostgreSQL `SKIP LOCKED`, recover expired claims, and process normalization/media after persistence. Transient failures use exponential retries; permanent failures remain available for inspection.

The backend can connect to the Socket.io `/crm` namespace, authenticated by the shared token. Events include `message:incoming`, `lead:incoming`, and `message:ack`. Without an available socket or positive acknowledgment, the worker uses HTTP through the backend routes `/chat/messages/incoming`, `/leads/incoming`, and `/chat/messages/ack`.

Event IDs are preserved across transports and retries for deduplication. Attachments are processed and uploaded to storage before delivery to the CRM. WhatsApp group and broadcast messages are ignored.

Payload, acknowledgment, and event details are in the [communication contract](https://github.com/FabricioHiury/autopilot-backend/blob/main/docs/COMMUNICATION.md). Delivery and outbound records retain the idempotency and correlation keys used in retries.

## Organization and verification

Provider and communication modules are in `src/core/`; configuration, infrastructure, and adapters in `src/base/`; the schema in `prisma/schema.prisma`; fixtures in `test/`; and manifests in `k8s/`. Jest tests live alongside implementations in `*.spec.ts` files.

```bash
pnpm exec prisma validate
pnpm exec tsc --noEmit
pnpm exec jest --runInBand
pnpm lint
pnpm format:check
pnpm build
```

For concurrency and leases, configure `TEST_DATABASE_URL` with a dedicated database and run `pnpm test:database`. The smoke test uses disposable containers, two gateways, and a CRM stub; it does not send messages to real WhatsApp accounts:

```bash
docker compose -p autopilot-micro-smoke -f test/docker-compose.smoke.yml up --build -d
node test/runtime-smoke.mjs
TEST_REDIS_URL=redis://localhost:56389 TEST_DATABASE_URL=postgresql://postgres:test-password@localhost:55439/autopilot_micro_test pnpm exec jest --runInBand
docker compose -p autopilot-micro-smoke -f test/docker-compose.smoke.yml down -v
```

Wait for gateway readiness and Evolution initialization. Run the script once per fresh fixture; `down -v` removes that fixture's data. Never substitute an application database for the test database.

## Running in containers

This repository's `docker-compose.yml` remains available to run the gateway and its infrastructure as a separate stack. PostgreSQL/Redis ports are 5433/6380, different from the shared Colima environment. Choose one stack for a test to avoid duplicate Evolution instances on port 8080.

The Kubernetes manifests include Deployment, readiness/liveness checks, and HPA. They require PostgreSQL, Redis, Evolution, secrets, and a release image configured for the environment. See [AGENTS.md](AGENTS.md) to contribute.
