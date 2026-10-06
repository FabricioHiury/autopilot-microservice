# Repository Guidelines

## Project Structure & Module Organization

This NestJS 10 gateway handles Evolution WhatsApp, Meta, Instagram, Facebook, and OLX integrations. Provider modules and durable delivery live in `src/core/`; shared guards, configuration, database adapters, and infrastructure services live in `src/base/`. `src/main.ts` configures HTTP, validation, documentation, and startup.

`prisma/schema.prisma` defines the dedicated microservice database. `docker/` contains database initialization SQL, `k8s/` contains deployment manifests, and `test/` contains the disposable container smoke fixture. Keep unit tests beside implementations as `*.spec.ts`.

## Build, Test, and Development Commands

Use Node 22 and pnpm 10.25.0; package engines support Node 22–24.

- `pnpm install --frozen-lockfile`: install locked dependencies.
- `pnpm db:generate`: generate the Prisma client.
- `pnpm db:push`: synchronize the schema against the configured database; inspect `DATABASE_URL` first. This project does not use migration files.
- `pnpm dev`: start the gateway locally with watch mode on port 3005.
- `pnpm build`: compile into `dist/`.
- `pnpm lint` and `pnpm format:check`: check ESLint and Prettier rules.
- `pnpm test --runInBand`: run Jest tests.
- `pnpm test:database`: run durable queue database tests.

For host development, start only PostgreSQL, Redis, and Evolution with `docker compose up -d postgres redis evolution-api`. Follow `README.md` for environment and callback configuration. Health endpoints are `/health` and `/health/ready`; documentation is at `/docs`.

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, single quotes, and trailing commas. Use PascalCase classes, camelCase methods, and dotted filenames such as `evolution-api.service.ts`. Keep provider logic within its module, validate DTOs, and preserve the `{ message, statusCode, data }` response envelope.

## Testing Guidelines

Jest and ts-jest run colocated tests. Cover webhook authentication, normalization, idempotency, leases, and uncertain provider outcomes. No numeric coverage threshold is configured. Set `TEST_DATABASE_URL` to a dedicated test database for concurrency tests. Follow the README smoke workflow; never substitute an application database. Run relevant tests, type checking, and build before review.

## Commit & Pull Request Guidelines

History uses `feat:` and `docs:` prefixes. Keep commits focused. PRs should explain changed behavior, linked issues, validation, and schema/environment changes. Document communication contract changes and provider-specific limitations.

## Security & Architecture

Keep secrets and credential JSON out of Git and browsers. Match `MICROSERVICE_TOKEN` with the backend; use separate Evolution API and webhook secrets. Persist inbound events before acknowledgment. Never automatically resend an indeterminate outbound message. Evolution owns WhatsApp sessions; the gateway owns durable delivery and correlation.
