# AutoPilot CRM - Microsserviço Gateway Omnichannel

> **Projeto**: autopilot-microservice (Gateway Único de Integrações Omnichannel)  
> **Backend Principal Relacionado**: `autopilot-backend`  
> **Status**: Arquitetura Consolidada & Stateless  
> **Porta**: `3005`

Microsserviço responsável por toda a camada de borda para comunicação externa do AutoPilot CRM. O `autopilot-backend` **não** conversa diretamente com APIs de terceiros (Meta, Evolution API, OLX); todas as conexões são delegadas a este gateway, que normaliza eventos e DTOs para o CRM.

---

## 🏗️ Principais Pilares Arquiteturais

1. **Gateway Único Omnichannel** — Evolution API v2 (Baileys), WhatsApp Business API Oficial, Instagram Graph API, Facebook Messenger API, OLX Chat & Leads.
2. **Internacionalização Total** — Código, DTOs e Endpoints 100% em Inglês Padronizado.
3. **Sanitização Extrema** — Substituição de Chromium/Puppeteer/whatsapp-web.js pela **Evolution API v2 (Baileys)** em container dedicado, reduzindo o peso e a volatilidade do runtime.
4. **Tratamento Híbrido de Áudio** — Evolution API nativa para WhatsApp não-oficial + FFmpeg nativo do Alpine para Meta Cloud API.
5. **Isolamento de Banco de Dados (Database-per-Service)** — Banco `autopilot_micro` separado do CRM Core, particionado por `storeId`.
6. **Stateless & Kubernetes-Ready** — Transição de `StatefulSet` ➔ `Deployment` padrão, habilitando HPA (Horizontal Pod Autoscaler) e rolling deploys sem PVCs.
7. **Enriquecimento Estratégico do AutoPilot IA** — Extração de `externalAdId`, dados de veículo e referência de campanhas para alimentar o Dossiê do Lead.

---

## 🌐 Arquitetura Consolidada: Gateway Único de Integrações

```mermaid
graph TD
    subgraph "External Providers & APIs"
        WPP_EVO[Evolution API v2 Container / Baileys]
        WPP_OFF[Meta Cloud API / WABA]
        INSTA[Instagram Graph API]
        FB[Facebook Messenger API]
        OLX[OLX Chat & Leads API]
    end

    subgraph "autopilot-microservice (Port 3005 - Stateless Omnichannel Gateway)"
        EVO_MOD[Evolution API Service]
        WPP_OFF_MOD[WhatsApp Official Service]
        INSTA_MOD[Instagram Service]
        FB_MOD[Facebook Service]
        OLX_MOD[OLX Service]
        COMM_HUB[Communication Hub & Normalizer]
        MICRO_DB[(autopilot_micro DB / Isolated)]
    end

    subgraph "autopilot-backend (Port 3000 - Core CRM Boilerplate)"
        CORE_API[NestJS Core API - English Standards]
        AI_SVC[AutoPilot AI Service - Dossier & 1-Click]
        CORE_DB[(autopilot_main DB / Isolated)]
    end

    WPP_EVO <-->|HTTP REST & Webhooks| EVO_MOD
    WPP_OFF <--> WPP_OFF_MOD
    INSTA <--> INSTA_MOD
    FB <--> FB_MOD
    OLX <--> OLX_MOD

    EVO_MOD --> COMM_HUB
    WPP_OFF_MOD --> COMM_HUB
    INSTA_MOD --> COMM_HUB
    FB_MOD --> COMM_HUB
    OLX_MOD --> COMM_HUB

    COMM_HUB --> MICRO_DB

    COMM_HUB -->|POST /chat/messages/incoming| CORE_API
    COMM_HUB -->|POST /leads/incoming| CORE_API
    COMM_HUB -->|POST /chat/messages/ack| CORE_API
    CORE_API -->|POST /communication/messages| COMM_HUB
    CORE_API --> AI_SVC
    CORE_API --> CORE_DB
```

---

## 🗄️ Estratégia de Banco de Dados: Database-per-Service

Por que bancos separados?

1. **Desacoplamento de Ciclo de Vida e Migrações** — O `autopilot-backend` passa por migrações frequentes de regras de negócio (User, Role, Customer, Deal, StoreCustomization). O microsserviço cuida apenas de dados de autenticação e sessões (WhatsAppAuthData, InstagramAuthData, etc.). Bases separadas impedem que uma migração do CRM bloqueie a mensageria.
2. **Resiliência e I/O** — Mensageria opera sob rajadas de webhooks; com banco isolado, locks de escrita no CRM não travam atualizações de status do WhatsApp.
3. **Multi-Tenancy Simplificado** — O microsserviço particiona dados apenas por `storeId` (UUID), sem precisar saber nada sobre regras visuais, slugs ou permissões.
4. **Infraestrutura Otimizada** — Ambos utilizam o mesmo cluster PostgreSQL, mas em bases/schemas dedicados (`autopilot_main` e `autopilot_micro`).

---

## 📋 Canais e Funcionalidades

### WhatsApp Não-Oficial (Evolution API v2 / Baileys)
- Criação dinâmica de instâncias por `storeId`.
- QR code base64 com renovação automática via webhook `QRCODE_UPDATED`.
- Envio e recebimento de texto, mídia (imagem/vídeo/documento) e notas de voz (PTT).
- Webhook de eventos: `MESSAGES_UPSERT`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`.
- Sem Chromium, sem Puppeteer, sem locks de disco — tudo delegado ao container da Evolution API.

### WhatsApp Oficial (Meta Cloud API / WABA)
- Templates HSM, notificações transacionais.
- Conversão de áudio para `audio/ogg; codecs=opus` via **FFmpeg nativo do Alpine**.
- Webhooks oficiais de entrada e status.

### Instagram (Meta Graph API)
- Recebimento/envio de DMs diretas.
- Origem da mensagem (story, post, anúncio, DM direta).
- Captura de `ad_id` / `referral` em campanhas Click-to-Chat para alimentar o AutoPilot IA (`metadata.externalAdId`).

### Facebook (Meta)
- Facebook Messenger.
- Leads de campanhas Lead Ads.
- Enriquecimento de metadados de anúncio.

### OLX
- OAuth flow completo.
- Chat direto com compradores.
- Recebimento automático de leads de anúncios (inclui `externalAdId` = `listId`, título e valor).
- Renovação automática de tokens via cron.

### Communication Hub (Normalização)
- Todos os canais entram em um formato unificado: `IncomingMessageEventDto`.
- Contratos bilaterais padronizados com o `autopilot-backend`.

---

## 🛠️ Stack Tecnológica

| Categoria | Tecnologia |
| :--- | :--- |
| **Framework** | NestJS 10 (Node.js 20) |
| **ORM** | Prisma 5 |
| **Banco de Dados** | PostgreSQL 15 (`autopilot_micro`) |
| **Cache / Filas** | Redis + Bull |
| **HTTP** | Axios + axios-retry |
| **Autenticação** | API Key (`x-micro-token` / `x-api-key`) + JWT |
| **Agendamento** | @nestjs/schedule (renovação de tokens) |
| **Validação** | class-validator + class-transformer |
| **Containerização** | Node:20-alpine + FFmpeg nativo (apk) |
| **Deploy** | Kubernetes (Deployment padrão, HPA, Ingress) |

---

## ✅ Pré-requisitos

- Node.js 18+
- PostgreSQL 15+ (banco `autopilot_micro` separado)
- Redis 7+
- pnpm ou npm
- **Container Evolution API v2** rodando (atendai/evolution-api:v2.1.1)
- Meta Business configurado (se usar Instagram / Facebook / WhatsApp Oficial)
- Credenciais OLX OAuth (se usar OLX)

---

## 🚀 Instalação

```bash
pnpm install
```

> ⚠️ **Não há mais necessidade** de `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` ou Chromium local. Todo o WhatsApp não-oficial roda via container da Evolution API.

---

## ⚙️ Configuração

Copie o arquivo `.env.example` para `.env`:

```bash
cp .env.example .env
```

### Variáveis Principais

| Variável | Descrição |
| :--- | :--- |
| `DATABASE_URL` | Conexão PostgreSQL do microsserviço (ex: `postgresql://user:pass@localhost:5433/autopilot_micro`) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Conexão Redis (Bull + cache) |
| `API_KEY` | Chave para comunicação interna com o `autopilot-backend` |
| `AUTOPILOT_URL` | URL do backend principal (ex: `http://localhost:3000`) |
| `APP_BASE_URL` | URL pública/privada deste microsserviço (para webhooks da Evolution) |
| `EVOLUTION_API_URL` | URL do container da Evolution API (ex: `http://localhost:8080`) |
| `EVOLUTION_API_KEY` | API Key global da Evolution API |
| `META_*` | App ID/Secret do Meta Business (Instagram/Facebook/WhatsApp Oficial) |
| `OLX_CLIENT_ID`, `OLX_CLIENT_SECRET` | Credenciais OLX OAuth |
| `WHATSAPP_OFFICIAL_*` | Credenciais WhatsApp Cloud API (WABA) |
| `FFMPEG_PATH` | Opcional. Padrão: `ffmpeg` (binário Alpine nativo) |

### Executar Migrações

```bash
pnpm prisma migrate dev
```

---

## 🏃 Execução

```bash
# Desenvolvimento com watch
pnpm dev

# Build de produção
pnpm build

# Produção
pnpm start:prod
```

- **API REST**: `http://localhost:3005`
- **Swagger**: `/api` ou `/reference`
- **Health Check**: `/health`

---

## 🐳 Docker Compose (Ambiente de Desenvolvimento)

```yaml
version: '3.8'

services:
  autopilot-micro:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3005:3005"
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
      - evolution-api

  evolution-api:
    image: atendai/evolution-api:v2.1.1
    container_name: evolution_api
    restart: always
    ports:
      - "8080:8080"
    environment:
      - SERVER_URL=http://localhost:8080
      - AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY}
      - DATABASE_ENABLED=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      - REDIS_ENABLED=true
      - REDIS_URI=redis://redis:6379
      - WEBHOOK_GLOBAL_ENABLED=true
      - WEBHOOK_GLOBAL_URL=http://autopilot-micro:3005/whatsapp/webhook/evolution
      - WEBHOOK_EVENTS_MESSAGES_UPSERT=true
      - WEBHOOK_EVENTS_CONNECTION_UPDATE=true
      - WEBHOOK_EVENTS_QRCODE_UPDATED=true
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
      POSTGRES_DB: ${DB_NAME:-autopilot_micro}
    ports:
      - "5433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6380:6379"

volumes:
  postgres_data:
```

### Dockerfile Ultra-Leve (Node 20 Alpine, ~180MB)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
# FFmpeg nativo do Alpine para a Meta Cloud API (áudio opus/ogg)
RUN apk add --no-cache ffmpeg dumb-init
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3005
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
```

---

## ☸️ Kubernetes (Stateless Deployment)

O microsserviço não possui mais estado em disco local (sem `.wwebjs_auth`). O manifesto é convertido de `StatefulSet` para `Deployment` padrão:

- Elimina PersistentVolumeClaims (PVCs).
- Permite réplicas com deploy rolling sem downtime.
- Habilita `HorizontalPodAutoscaler` (HPA) baseado em CPU/memória para absorver picos de webhooks.

Manifestos em `k8s/`:
- `deployment.yaml` — Deployment stateless + probes.
- `service.yaml` — Service interno.
- `ingress.yaml` — Ingress para webhooks públicos.
- `hpa.yaml` — Auto Scaling.

---

## 🧪 Testes

```bash
# Unitários
pnpm test

# E2E
pnpm test:e2e

# Cobertura
pnpm test:cov
```

---

## 📂 Estrutura de Diretórios (Inglês Padronizado)

```
src/
├── base/                                # Módulos base compartilhados
│   ├── config/firebase.config.ts
│   ├── guard/api-key.guard.ts
│   ├── queues/token-renewal.queue.ts
│   └── service/                          # Prisma, Redis, Arquivos, Rate Limit
├── core/
│   ├── communication/                   # Hub unificado (ex: comunication com typo corrigido)
│   │   ├── communication.controller.ts
│   │   ├── communication.service.ts
│   │   ├── dto/
│   │   │   ├── send-message.dto.ts
│   │   │   ├── incoming-message-event.dto.ts
│   │   │   └── message-metadata.dto.ts
│   │   └── axios.config.ts
│   ├── whatsapp/                        # WhatsApp Não-Oficial via Evolution API v2
│   │   ├── services/evolution-api.service.ts
│   │   └── evolution-webhook.controller.ts
│   ├── whatsapp-official/               # WhatsApp Cloud API + Templates HSM
│   ├── instagram/                       # Instagram Messaging (Meta Graph API) + cron
│   ├── facebook/                        # Facebook Messenger + Lead Ads
│   ├── olx/                             # OLX (OAuth, leads, chat)
│   ├── integrations/                    # Status centralizado das integrações
│   └── health-check/
└── prisma/                              # schema.prisma (autopilot_micro) + migrações
```

---

## 🔌 Contratos Bilaterais com o `autopilot-backend`

### Rotas Expostas pelo Microsserviço (REST)

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `/communication/messages` | Envio de mensagem para canal externo |
| `POST` | `/communication/whatsapp/verify-number` | Valida se número tem WhatsApp ativo |
| `GET` | `/integrations/:storeId/status` | Status consolidado das integrações da loja |
| `GET` | `/integrations/whatsapp/qrcode/:storeId` | QR Code da sessão Evolution API |
| `DELETE` | `/integrations/:storeId` | Desconexão/remoção de conexões da loja |
| `POST` | `/integrations/:storeId/:channel/clear-cache` | Limpeza de circuit-breaker e cache |

### Webhooks Emitidos para o `autopilot-backend`

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `${AUTOPILOT_URL}/chat/messages/incoming` | Nova mensagem normalizada (qualquer canal) |
| `POST` | `${AUTOPILOT_URL}/leads/incoming` | Novo lead externo normalizado (OLX/Campanhas Meta) |
| `POST` | `${AUTOPILOT_URL}/chat/messages/ack` | Confirmação de envio/entrega/leitura |

### DTOs Principais (Inglês)

**`SendMessageDto`** (CRM → Canal)
```typescript
storeId, recipient, text?, attachmentUrl?, attachmentType?,
quotedMessageId?, channel, messageId?, contacts?,
isVoiceRecording?, wppApiType? ('official' | 'evolution')
```

**`IncomingMessageEventDto`** (Canal → CRM)
```typescript
storeId, text?, attachmentUrl?, attachmentType?, messageId?,
quotedMessageId?, channel, isFromStore?,
externalSenderId, timestamp, metadata? (MessageMetadataDto)
```

**`MessageMetadataDto`** (Enriquecimento AutoPilot IA)
```typescript
name, phone, email, avatarUrl,
externalAdId,    // ← Chave para identificar veículo no Dossiê IA
source, sourceDetails
```

---

## 🤖 Enriquecimento de Dados para o AutoPilot IA

- **OLX**: `externalAdId` contém o `listId` do anúncio; título e valor são incluídos em `metadata`.
- **Instagram / Facebook**: `ad_id` / `referral` de campanhas Click-to-Chat são capturados e encaminhados em `metadata.externalAdId`, permitindo ao CRM identificar automaticamente o veículo em estoque.

---

## 🧹 Diferenças-chave em Relação ao Legado

| Item | Antes (Legado) | Agora (Novo) |
| :--- | :--- | :--- |
| **WhatsApp não-oficial** | `whatsapp-web.js` + Puppeteer + Chromium local | Evolution API v2 (Baileys) em container dedicado |
| **Runtime** | ~2GB imagem + Chromium + 6GB heap | ~180MB Alpine + FFmpeg nativo |
| **Estado** | StatefulSet + PVC (sessões em disco) | Deployment stateless + Evolution API centraliza sessões |
| **Áudio PTT** | `ffmpeg-static` (~50MB node_modules) | FFmpeg Alpine (`apk add`, ~5MB) |
| **Linguagem código** | PT/EN misto, typo "comunication" | 100% EN, "communication" corrigido |
| **Banco** | Compartilhado com CRM | Database-per-Service (`autopilot_micro`) |
| **OCR** | Tesseract.js | Removido (descontinuado) |

---

## 🔗 Repositórios Relacionados

- **[autopilot-backend](../autopilot-backend)** — Core CRM Multi-Tenant com WebSockets e AutoPilot IA.
- **[autopilot-frontend](../autopilot-frontend)** — Frontend Next.js 14 com White-Label Dinâmico.
