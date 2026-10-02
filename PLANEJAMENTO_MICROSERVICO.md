# AutoPilot microservice restructuring — implementation record

The gateway implements the agreed restructuring as a fresh project. The main backend is unchanged. Initialize the dedicated microservice schema with `prisma db push`; no migrations or legacy-data conversion are required.

## Architecture

- The gateway owns provider configuration and normalizes Evolution WhatsApp, official WhatsApp, Instagram, Facebook and OLX events.
- Evolution `evoapicloud/evolution-api:v2.3.7` owns Baileys sessions. The gateway has no browser, local WhatsApp authentication or persistent session volume.
- PostgreSQL stores a durable webhook inbox, CRM outbox, outbound idempotency records and message-ID correlations. Redis stores shared QR codes, connection caches and rate-limit state.
- The backend connects to Socket.io namespace `/crm`; the gateway delivers through one authenticated connection, waits five seconds for acceptance and falls back to HTTP. PostgreSQL leases coordinate workers across replicas and recover abandoned jobs.
- Compose isolates the gateway and Evolution databases on one PostgreSQL server. The CRM database remains independent. Kubernetes uses Deployment and HPA, with separate readiness and liveness.

## Implemented phases

### Contracts and English naming

`src/core/communication` replaces the misspelled module. Public outbound DTOs use English fields, UUID store/message IDs and nullable optional fields. Internal authentication uses `MICROSERVICE_TOKEN` with `x-micro-token` or `x-api-key`.

The gateway exposes `/communication/messages`, `/communication/whatsapp/verify-number`, `/integrations/whatsapp/qrcode/:storeId`, consolidated status, disconnect, cache clearing and existing backend integration operations. Successful outbound responses contain both `data.externalMessageId` and `data.response`. QR responses contain `data.qrCode.base64`, `data.message` and `data.status`.

Ingress uses the backend's exact `eventId`, `externalMessageId`, `externalContactId`, `sentByStore` and ISO timestamp contract. HTTP delivery targets `/chat/messages/incoming`, `/leads/incoming` and `/chat/messages/ack`. Retries reuse stable IDs. Extra provider metadata remains internal because the backend rejects unknown fields.

### Evolution driver and reliability

Instance creation uses storeId as the instance name and a PostgreSQL advisory lock. Missing-instance HTTP 404 responses trigger creation. Per-instance webhooks include a separate authentication header and subscribe to message upserts, message status updates, connection changes and QR updates; global webhooks remain disabled.

The driver supports number verification, text, media, native PTT, contacts, location, reactions, logout and deletion. Received media is decrypted through Evolution and uploaded to Firebase before it reaches the CRM. Groups and broadcasts are ignored. `baileys`, `evolution` and `unofficial` all select Evolution; `official` selects Meta Cloud API.

Provider callbacks are persisted before HTTP success. Normalization/media processing happens in workers. Events awaiting CRM acceptance survive restart; permanent failures remain available for authenticated inspection and reprocessing. Early ACKs stay pending until the provider ID can be mapped to the CRM UUID.

Outbound uniqueness is enforced by storeId + messageId. Repeated requests return the stored result; conflicting content is rejected. Uncertain provider acceptance never triggers automatic resend. Authenticated operators can inspect uncertain sends and reconcile an ID after checking explicit provider evidence, without inferring matches or retransmitting messages.

### Media and dependency cleanup

Chromium, Puppeteer, whatsapp-web.js, OCR, ffmpeg-static, browser/session utilities, unused packages and supervisord were removed. Official WhatsApp voice conversion uses asynchronous system FFmpeg with argument arrays, timeout and temporary-file cleanup. Conversion failure prevents sending incompatible voice media.

Firebase accepts environment credentials or a mounted service-account JSON. Text-only startup is available without storage credentials; media jobs wait for valid storage configuration.

### Infrastructure

The Dockerfile uses Node 22 Alpine, pnpm with a frozen lockfile, generated Prisma client, production dependencies, system FFmpeg, dumb-init and a non-root runtime. The builder target supplies the schema initialization command.

Compose initializes empty gateway/Evolution databases, includes Redis persistence and uses internal Evolution callbacks separately from public Meta/OLX callback URLs. Kubernetes uses port 3005, no gateway session PVC, requests of 100m/256Mi, limits of 1000m/512Mi and HPA from one to three replicas at 70% CPU.

### AI context

OLX listing IDs and available listing details are preserved. Instagram, Facebook and official WhatsApp ad referrals populate externalAdId when the provider identifies an advertisement. Publication IDs are not substituted for campaign IDs. Name and externalAdId are projected into the existing backend contract; richer source/title/value metadata stays in the gateway.

## Verification

See `README.md` for startup, environment variables, API contracts, pending-event diagnosis and the disposable two-process container fixture. Tests cover HTTP validation/authentication, real Socket.io connections, provider normalization, actual OGG/Opus conversion, PostgreSQL concurrent claims, lease recovery, early ACK correlation, outbound idempotency and explicit reconciliation.

Live QR scanning, account authorization, real provider message delivery and production rollout require external accounts and infrastructure. Container image size and idle memory are measured during verification; the original 180 MB image and 250 MB memory estimates are targets rather than assumed guarantees.

Local verification on 2026-10-02 passed 50 tests across 10 suites, TypeScript, lint, Prisma validation, application build, Compose configuration and Docker build. The disposable fixture generated a QR code against Evolution v2.3.7 and delivered 25 synthetic events exactly once through two gateway containers sharing PostgreSQL and Redis. This does not certify real account messaging.

The local Docker image measured 492,228,990 bytes (approximately 469 MiB, uncompressed), exceeding the 180 MB target. The two idle gateway containers used 67.42 MiB and 72.89 MiB after the smoke run. These memory measurements are not a production load benchmark.
