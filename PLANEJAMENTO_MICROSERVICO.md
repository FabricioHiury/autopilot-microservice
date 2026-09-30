# 📋 Planejamento de Implementação: Microsserviço de Integrações (autopilot-micro)

> **Projeto**: autopilot-micro (Microsserviço Omnichannel de Mensageria e Conexões)  
> **Backend Principal Relacionado**: autopilot-back  
> **Status**: Arquitetura Consolidada & Pronto para Execução  
> **Pilares Centrais**:
> 1. **Microsserviço como Gateway Único Omnichannel** (Evolution API v2, WABA Oficial, Instagram, Facebook, OLX)
> 2. **Internacionalização Total (Código, DTOs e Endpoints 100% em Inglês)**
> 3. **Sanitização Extrema (Substituição de Chromium/Puppeteer por Baileys via Evolution API)**
> 4. **Tratamento Híbrido de Áudio (Evolution API nativa + FFmpeg do Alpine para Meta Cloud API)**
> 5. **Isolamento de Banco de Dados (Database-per-Service)**
> 6. **Transição de Infraestrutura: StatefulSet ➔ Deployment Stateless no Kubernetes**
> 7. **Alimentação Estratégica do AutoPilot IA (Extração de Veículos e Campanhas)**

---

## 🏗️ 1. Arquitetura Consolidada: Gateway Único de Integrações

O `autopilot-micro` é a **única camada de borda para comunicação externa** da plataforma. O `autopilot-back` não conversa diretamente com nenhuma API de terceiros (Meta, Evolution API ou OLX), delegando todas as conexões para este microsserviço.

```mermaid
graph TD
    subgraph "External Providers & APIs"
        WPP_EVO[Evolution API v2 Container / Baileys]
        WPP_OFF[Meta Cloud API / WABA]
        INSTA[Instagram Graph API]
        FB[Facebook Messenger API]
        OLX[OLX Chat & Leads API]
    end

    subgraph "autopilot-micro (Port 3005 - Stateless Omnichannel Gateway)"
        EVO_MOD[Evolution API Service]
        WPP_OFF_MOD[WhatsApp Official Service]
        INSTA_MOD[Instagram Service]
        FB_MOD[Facebook Service]
        OLX_MOD[OLX Service]
        COMM_HUB[Communication Hub & Normalizer]
        MICRO_DB[(autopilot_micro DB / Isolated)]
    end

    subgraph "autopilot-back (Port 3000 - Core CRM Boilerplate)"
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

    %% Standardized Bilateral Contracts
    COMM_HUB -->|POST /chat/messages/incoming| CORE_API
    COMM_HUB -->|POST /leads/incoming| CORE_API
    COMM_HUB -->|POST /chat/messages/ack| CORE_API
    CORE_API -->|POST /communication/messages| COMM_HUB
    CORE_API --> AI_SVC
    CORE_API --> CORE_DB
```

---

## 🗄️ 2. Estratégia de Banco de Dados: Isolamento de Domínio (Database-per-Service)

### Por que manter Bancos Separados?
1. **Desacoplamento de Ciclo de Vida e Migrações**: O `autopilot-back` passa por migrações frequentes de regras de negócio (`Dealership`, `User`, `Role`, `Customer`, `Deal`, `StoreCustomization`). O `autopilot-micro` cuida estritamente de dados de autenticação e sessões (`WhatsAppAuthData`, `InstagramAuthData`, etc.). Manter bases separadas impede que uma migração do CRM bloqueie o microsserviço de mensageria.
2. **Resiliência e I/O**: Mensageria opera sob rajadas de webhooks. Com banco isolado, locks de escrita no CRM não travam a atualização de status do WhatsApp.
3. **Multi-Tenancy Simplificado**: O microsserviço não precisa saber nada sobre regras visuais, slugs ou permissões de usuários; ele particiona dados apenas pelo `storeId` (UUID).
4. **Infraestrutura Otimizada**: No Docker Compose ou em nuvem, ambos utilizam o mesmo cluster PostgreSQL, mas em bases separadas (`autopilot_main` e `autopilot_micro`) ou schemas dedicados.

### Schema do Microsserviço (`prisma/schema.prisma`)
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL") // autopilot_micro database
}

model Store {
  id                       String                    @id @unique
  facebookAuthData         FacebookAuthData?
  instagramAuthData        InstagramAuthData?
  olxAuthData              OlxAuthData?
  requestDeletionData      RequestDeletionData[]
  whatsappAuthData         WhatsAppAuthData?
  whatsappOfficialAuthData WhatsAppOfficialAuthData?

  createdAt                DateTime                  @default(now()) @map("created_at")
  updatedAt                DateTime                  @updatedAt @map("updated_at")

  @@map("stores")
}

model WhatsAppAuthData {
  id           String    @id @default(uuid())
  storeId      String    @unique @map("store_id")
  instanceName String    @unique @map("instance_name")
  instanceToken String?  @map("instance_token")
  phoneNumber  String?   @map("phone_number")
  profileName  String?   @map("profile_name")
  status       String    @default("disconnected") // disconnected | connecting | connected
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  store        Store     @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@map("whatsapp_auth_data")
}

model OlxAuthData {
  id               String    @id @default(uuid())
  clientId         String    @map("client_id")
  clientSecret     String    @map("client_secret")
  code             String?
  receiveMessages  Boolean   @default(true) @map("receive_messages")
  accessToken      String?   @map("access_token")
  uniqueId         String?   @unique @map("unique_id")
  storeId          String    @unique @map("store_id")
  leadWebhookToken String?   @map("lead_webhook_token")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime? @updatedAt @map("updated_at")
  store            Store     @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([clientId, storeId])
  @@map("olx_auth_data")
}

model InstagramAuthData {
  id                String    @id @default(uuid())
  storeId           String    @unique @map("store_id")
  instagramAppId    String?   @unique @map("instagram_app_id")
  instagramGlobalId String?   @unique @map("instagram_global_id")
  uniqueId          String?   @unique @map("unique_id")
  token             String?
  tokenExpiry       DateTime? @map("token_expiry")
  scheduledRenewal  DateTime? @map("scheduled_renewal")
  lastTokenRenewal  DateTime? @map("last_token_renewal")
  userToken         String?   @map("user_token")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime? @updatedAt @map("updated_at")
  store             Store     @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([instagramAppId, storeId])
  @@map("instagram_auth_data")
}

model FacebookAuthData {
  id               String    @id @default(uuid())
  storeId          String    @unique @map("store_id")
  uniqueId         String?   @unique @map("unique_id")
  pageId           String?   @unique @map("page_id")
  facebookUserId   String?   @unique @map("facebook_user_id")
  userToken        String?   @map("user_token")
  pageToken        String?   @map("page_token")
  tokenExpiry      DateTime? @map("token_expiry")
  scheduledRenewal DateTime? @map("scheduled_renewal")
  lastTokenRenewal DateTime? @map("last_token_renewal")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime? @updatedAt @map("updated_at")
  store            Store     @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([pageId, storeId])
  @@map("facebook_auth_data")
}

model WhatsAppOfficialAuthData {
  id            String   @id @default(uuid())
  storeId       String   @unique @map("store_id")
  wabaId        String   @map("waba_id")
  phoneNumberId String   @map("phone_number_id")
  accessToken   String   @map("access_token")
  verifyToken   String   @map("verify_token")
  businessPhone String   @map("business_phone")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  store         Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@map("whatsapp_official_auth_data")
}

model RequestDeletionData {
  id             String   @id @default(uuid())
  code           String   @unique
  storeId        String   @map("store_id")
  externalUserId String?  @map("external_user_id")
  channel        String
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  store          Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([code, storeId])
  @@map("request_deletion_data")
}
```

---

## 🌐 3. Fase 1: Internacionalização e Padronização de Contratos (Português ➔ Inglês)

*Objetivo: Estabelecer DTOs e rotas limpas em inglês padrão internacional compatíveis com o `autopilot-back`.*

### 3.1 Refatoração de Diretórios
- [ ] Renomear diretório `src/core/comunication/` ➔ `src/core/communication/`
- [ ] Renomear classes e injeções:
  - `ComunicationModule` ➔ `CommunicationModule`
  - `ComunicationService` ➔ `CommunicationService`
  - `ComunicationController` ➔ `CommunicationController`

### 3.2 De-Para de DTOs e Contratos de Mensagens (`src/core/communication/dto/`)

#### A. Envio de Mensagem do CRM para o Canal (`SendMessageDto` - era `ChatIncomingMessageDto`)
```typescript
export class SendMessageDto {
  @IsString() @IsNotEmpty()
  storeId: string;

  @IsString() @IsNotEmpty()
  recipient: string; // era: destinatario

  @IsString() @IsOptional()
  text?: string; // era: mensagem

  @IsString() @IsOptional()
  attachmentUrl?: string; // era: anexoMensagem

  @IsString() @IsOptional()
  attachmentType?: string; // era: tipoAnexo

  @IsString() @IsOptional()
  quotedMessageId?: string; // era: mensagemReferencia

  @IsEnum(IntegrationsEnum) @IsNotEmpty()
  channel: IntegrationsEnum; // era: canal

  @IsString() @IsOptional()
  messageId?: string; // era: idMensagem

  @IsArray() @IsOptional()
  contacts?: ContactDto[]; // era: contatos

  @IsBoolean() @IsOptional()
  isVoiceRecording?: boolean;

  @IsString() @IsOptional()
  wppApiType?: 'official' | 'evolution'; // era: 'official' | 'naooficial'
}
```

#### B. Recepção de Mensagem do Canal para o CRM (`IncomingMessageEventDto` - era `ChatOutgoingMessageDto`)
```typescript
export class IncomingMessageEventDto {
  @IsString() @IsNotEmpty()
  storeId: string;

  @IsString() @IsOptional()
  text?: string; // era: mensagem

  @IsString() @IsOptional()
  attachmentUrl?: string; // era: anexoMensagem

  @IsString() @IsOptional()
  attachmentType?: string; // era: tipoAnexo

  @IsString() @IsOptional()
  messageId?: string; // era: idMensagem

  @IsString() @IsOptional()
  quotedMessageId?: string; // era: mensagemReferencia

  @IsEnum(IntegrationsEnum) @IsNotEmpty()
  channel: IntegrationsEnum; // era: canal

  @IsBoolean() @IsOptional()
  isFromStore?: boolean; // era: enviadaLoja

  @IsString() @IsNotEmpty()
  externalSenderId: string; // era: idDestinatarioApiExterna

  @IsDateString() @IsNotEmpty()
  timestamp: Date;

  @IsOptional()
  metadata?: MessageMetadataDto; // era: metadados
}
```

#### C. Metadados do Lead para o AutoPilot IA (`MessageMetadataDto` - era `MetadadosMensagemDto`)
- `name` (era `nome`)
- `phone` (era `celular`)
- `email` (era `email`)
- `avatarUrl` (era `urlAvatar`)
- `externalAdId` (era `idAnuncioExterno`) ➔ **Chave para o Dossiê de Veículo do AutoPilot IA**
- `source` (era `origemMensagem`)
- `sourceDetails` (era `detalhesOrigem`)

#### D. Verificação de Número (`VerifyWhatsappNumberDto`)
- `storeId: string`
- `phone: string` (era `numero`)

### 3.3 Rotas Consumidas no `autopilot-back` (Bilateral)
Atualizar em `src/core/communication/axios.config.ts` e `communication.service.ts`:
- **Mensagem Recebida**: `POST ${AUTOPILOT_URL}/chat/messages/incoming`
- **Novo Lead (OLX/Marketplace)**: `POST ${AUTOPILOT_URL}/leads/incoming`
- **Confirmação de Entrega (ACK)**: `POST ${AUTOPILOT_URL}/chat/messages/ack`

### 3.4 Rotas Expostas pelo `autopilot-micro` (REST)
- `POST /communication/messages` (envio de mensagem para canal externo)
- `POST /communication/whatsapp/verify-number` (validação de número no WhatsApp)
- `GET /integrations/:storeId/status` (status consolidado das integrações)
- `GET /integrations/whatsapp/qrcode/:storeId` (obtenção do QR code da Evolution API)
- `DELETE /integrations/:storeId` (remoção de conexões da loja)
- `POST /integrations/:storeId/:channel/clear-cache` (limpeza de circuit-breaker e cache)

---

## 📱 4. Fase 2: Modernização do WhatsApp (Evolution API v2 como Driver)

*Objetivo: Substituir o whatsapp-web.js pela Evolution API v2, mantendo toda a orquestração no microsserviço.*

### 4.1 Limpeza e Descarte Legado
- [ ] Excluir pastas e sessões legadas: `.wwebjs_auth/` e `.wwebjs_cache/`.
- [ ] Remover classes obsoletas de autenticação local: `WhatsappLocalAuth` (`src/core/whatsapp/auth/`).
- [ ] Remover rotinas de Chromium (`removeStaleChromiumLock`, `clearTempDirs`, `puppeteer` flags em `whatsapp.utils.ts`).

### 4.2 Novo `EvolutionApiService` (`src/core/whatsapp/services/evolution-api.service.ts`)
Implementação de cliente HTTP dedicado consumindo a Evolution API v2:
- [ ] `createInstance(storeId: string)`: Cria instância com webhook pré-configurado para o `autopilot-micro`:
  ```typescript
  POST /instance/create
  {
    "instanceName": storeId,
    "token": generateToken(),
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS",
    "webhook": `${process.env.APP_BASE_URL}/whatsapp/webhook/evolution`,
    "webhook_by_events": false,
    "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"]
  }
  ```
- [ ] `getQrCode(storeId: string)`: Retorna o QR code base64 gerado pelo Baileys (`GET /instance/connect/{instanceName}`).
- [ ] `getConnectionState(storeId: string)`: Retorna se a sessão está `open`, `connecting` ou `close`.
- [ ] `sendTextMessage(storeId: string, phone: string, text: string)`: Disparo de texto via REST (`POST /message/sendText/{instanceName}`).
- [ ] `sendMediaMessage(storeId: string, phone: string, mediaUrl: string, mediaType: string, isVoice?: boolean)`:
  - Para notas de voz / PTT: usa `POST /message/sendWhatsAppAudio/{instanceName}` (conversão nativa da Evolution API).
  - Para mídias em geral: usa `POST /message/sendMedia/{instanceName}`.
- [ ] `logoutInstance(storeId: string)`: Desconexão e limpeza na Evolution API (`DELETE /instance/logout/{instanceName}`).
- [ ] `deleteInstance(storeId: string)`: Remoção definitiva (`DELETE /instance/delete/{instanceName}`).

### 4.3 Webhook Controller da Evolution API (`src/core/whatsapp/evolution-webhook.controller.ts`)
- [ ] Configurar endpoint protegido no microsserviço: `POST /whatsapp/webhook/evolution`.
- [ ] Tratar eventos:
  - `MESSAGES_UPSERT`: Normaliza mensagens de texto, imagens, vídeos, áudios e localização para o formato `IncomingMessageEventDto` e emite internamente `message.receive`.
  - `CONNECTION_UPDATE`: Atualiza o status de conexão da loja (`CONNECTED`, `DISCONNECTED`) na tabela `whatsapp_auth_data`.
  - `QRCODE_UPDATED`: Armazena o QR Code mais recente em memória/Redis para entrega imediata ao CRM.

---

## 🧹 5. Fase 3: Sanitização Extrema e Tratamento Híbrido de Áudio

*Objetivo: Remover binários pesados sem quebrar a API Oficial e simplificar o build Docker.*

### 5.1 Descoberta e Solução do Áudio (Evolution API vs. Meta Cloud API)
> [!IMPORTANT]
> **Atenção Técnica Crítica**: A Evolution API v2 converte áudios PTT nativamente para o WhatsApp não-oficial. No entanto, o módulo `WhatsAppOfficialService` (Meta Cloud API) exige estritamente codificação em `audio/ogg; codecs=opus`.  
> **Solução Adotada**:
> 1. Remover o pacote Node `ffmpeg-static` (que adicionava ~50MB de binários ao `node_modules`).
> 2. No container Alpine, instalar o FFmpeg nativo do sistema operacional (`apk add --no-cache ffmpeg`).
> 3. No `WhatsAppOfficialService`, utilizar `process.env.FFMPEG_PATH || 'ffmpeg'` para executar o binário do sistema.
> 4. Dessa forma, a Evolution cuida do WhatsApp não-oficial e o FFmpeg leve do Alpine garante a conversão do WhatsApp Oficial sem quebras de runtime.

### 5.2 Remoção de Dependências Obsoletas (`package.json`)
- [ ] **Desinstalar**:
  - `puppeteer` (não há mais Chromium/navegador)
  - `whatsapp-web.js` (substituído por Baileys via Evolution API)
  - `tesseract.js` (OCR descontinuado)
  - `ffmpeg-static` (substituído pelo binário do sistema Alpine)
- [ ] **Remover scripts legados**:
  - `preinstall: export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true...`
- [ ] **Excluir arquivos mortos**:
  - `supervisord.conf` (arquivo legado desnecessário)
- [ ] **Atualizar identidade do pacote**:
  - `"name": "autopilot-micro"`
  - `"description": "Omnichannel Integrations Microservice for AutoPilot CRM"`

### 5.3 Novo `Dockerfile` Ultra-Leve (Node 20 Alpine)
De uma imagem de ~2GB com Chromium e 6GB de heap para uma imagem limpa de ~180MB:
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

# Instalação leve do FFmpeg nativo para conversão de áudio da API Oficial
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

## ☸️ 6. Fase 4: Modernização de DevOps (Kubernetes & Docker Compose)

*Objetivo: Migrar o serviço de Stateful para Stateless e padronizar o ambiente de desenvolvimento.*

### 6.1 Conversão de `k8s/statefulset.yaml` ➔ `k8s/deployment.yaml`
- [ ] O microsserviço não possui mais estado em disco local (`.wwebjs_auth`).
- [ ] **Substituir o `StatefulSet` por um `Deployment` padrão**:
  - Elimina a necessidade de PersistentVolumeClaims (PVCs).
  - Permite réplicas com deploy rolling sem downtime.
  - Habilita `HorizontalPodAutoscaler` (HPA) baseado em CPU/memória para absorver picos de webhooks.

### 6.2 Atualização do `docker-compose.yml` para Desenvolvimento Local
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

---

## 🤖 7. Fase 5: Enriquecimento de Dados para o AutoPilot IA

*Objetivo: Garantir que o Dossiê do Lead e as Respostas Rápidas de 1 Clique no CRM recebam contexto rico dos canais.*

- [ ] **OLX (`src/core/olx/olx.service.ts`)**:
  - Garantir que `externalAdId` contenha o ID do anúncio (`listId`).
  - Incluir título do anúncio e valor em `metadata` para alimentar o card de inteligência da negociação.
- [ ] **Instagram e Facebook (`src/core/instagram/`, `src/core/facebook/`)**:
  - Capturar o `ad_id` / `referral` em mensagens originadas de campanhas de anúncios (Click-to-Chat).
  - Encaminhar em `metadata.externalAdId` para identificação automática do veículo em estoque pelo AutoPilot IA.

---

## 📋 Checklist de Validação & Homologação

- [ ] Todas as chamadas HTTP para o `autopilot-back` utilizam as novas rotas em inglês (`/chat/messages/incoming`, `/leads/incoming`, `/chat/messages/ack`).
- [ ] Evolution API v2 cria instâncias e entrega QR Codes instantaneamente via WebSocket/HTTP sem locks de Chromium.
- [ ] Mensagens recebidas do WhatsApp, Instagram, Facebook e OLX são padronizadas e chegam perfeitamente ao CRM.
- [ ] Mídias e notas de voz funcionam perfeitamente na Evolution API (nativa) e no WhatsApp Oficial (FFmpeg Alpine).
- [ ] O microsserviço roda em container Alpine stateless com consumo inferior a 250MB de RAM.
- [ ] O manifesto Kubernetes é convertido de `StatefulSet` para `Deployment`.
