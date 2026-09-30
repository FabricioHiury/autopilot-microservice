# AutoPilot CRM - Microsserviço de Integrações Omnichannel

Microsserviço responsável por toda a camada de integração com canais de atendimento e portais de anúncios do AutoPilot CRM. Gerencia a comunicação bidirecional com WhatsApp, Instagram, Facebook, OLX e outros canais, recebendo leads/mensagens e enviando respostas em tempo real. Construído com NestJS, Prisma e Bull (filas).

## Sobre o Projeto

O AutoPilot é um CRM omnichannel especializado no mercado automotivo. Este repositório é o microsserviço de integrações que abstrai as APIs específicas de cada provedor e expõe endpoints unificados para o backend principal. Principais responsabilidades:

### Canais Integrados

- **WhatsApp (não oficial)**: Integração via `whatsapp-web.js` + Puppeteer com Chromium. Suporta múltiplos dispositivos/sessões, envio/recebimento de mensagens, mídia, QR code para pareamento, status online/offline. Usa filas (Bull) para controle de envio e renovação de tokens.
- **WhatsApp Oficial (Cloud API)**: Integração com WhatsApp Business Platform (Meta). Templates de mensagem HSM, envio de notificações transacionais, webhooks oficiais.
- **Instagram (Meta)**: Integração com Instagram Messaging via Graph API. Recebimento/envio de DMs, stories, webhooks, origem da mensagem (story, post, anúncio, DM direta).
- **Facebook (Meta)**: Integração com Facebook Messenger e leads de anúncios (Lead Ads). Recebimento/envio de mensagens do Messenger, captura automática de leads de campanhas.
- **OLX**: Integração com portal OLX (autoupload, leads e chat). OAuth flow, chat direto com compradores, recebimento de leads de anúncios, envio de mensagens, renovação de tokens via cron.
- **Comunicação genérica**: Módulo de comunicação unificado para listar e enviar mensagens entre canais.

### Funcionalidades Complementares
- **Webhooks unificados**: Recebe callbacks de todos os provedores e roteia para os devidos módulos
- **Status de integrações**: Centraliza e monitora o status (conectado, desconectado, vencido, não configurado) de todas as integrações por loja
- **Saúde do sistema**: Health check com Redis e dependências
- **Autenticação API Key**: Endpoints protegidos por API Key para comunicação interna com o backend
- **Armazenamento**: Upload de arquivos/mídias via S3 ou GCS
- **Processamento de imagens/OCR**: Tesseract.js para reconhecimento óptico
- **Manipulação de arquivos**: FFmpeg para conversão de mídia, arquivers ZIP
- **Filas assíncronas**: Bull + Redis para envio de mensagens, renovação de tokens e tarefas agendadas

## Stack Tecnológica

- **Framework**: NestJS 10 (Node.js)
- **ORM**: Prisma 5
- **Banco de Dados**: PostgreSQL
- **Cache/Filas**: Redis + Bull
- **WhatsApp Web**: whatsapp-web.js + Puppeteer 24 + Chromium
- **Raspagem/Automação**: Puppeteer (OLX e WhatsApp não oficial)
- **OCR**: Tesseract.js
- **Mídia**: ffmpeg-static
- **HTTP**: Axios + axios-retry
- **Armazenamento**: AWS S3 / Google Cloud Storage
- **Autenticação**: JWT, API Key (guarda interna)
- **Outros**: Firebase Admin, QR Code terminal/web, Schedule (cron jobs)
- **Containerização**: Docker + supervisord (gerencia Chromium em background)
- **Deploy**: Kubernetes (k8s/)

## Pré-requisitos

- Node.js 18+
- PostgreSQL
- Redis
- **Chromium** (obrigatório para WhatsApp Web e OLX)
- pnpm ou npm
- Puppeteer devidamente configurado (Chromium)

## Instalação

```bash
# PULA_DOWNLOAD_CHROMIUM caso tenha instalado globalmente
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=$(which chromium)

pnpm install
```

## Configuração

Copie o arquivo `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

Variáveis principais:
- `DATABASE_URL`: PostgreSQL
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis (para Bull e cache)
- `API_KEY`: Chave de comunicação com backend principal
- `PUPPETEER_EXECUTABLE_PATH`: Caminho do Chromium
- `META_*`: App ID/Secret do Meta Business (Instagram/Facebook/WhatsApp Oficial)
- `OLX_CLIENT_ID`, `OLX_CLIENT_SECRET`: Credenciais OLX OAuth
- `WHATSAPP_OFFICIAL_*`: Credenciais WhatsApp Cloud API
- `AWS_S3_*` ou `GCS_*`: Armazenamento de arquivos
- `FIREBASE_*`: Configurações Firebase

Execute as migrações:

```bash
pnpm prisma migrate dev
```

## Execução

```bash
# Desenvolvimento com watch
pnpm dev

# Produção
pnpm start:prod
```

Serviço: `http://localhost:3003` (padrão)
Swagger: `/api` ou `/reference`
Health check: `/health`

## Docker

O Dockerfile já configura Chromium e usa `supervisord` para manter os processos:

```bash
docker-compose up -d
```

## Kubernetes

Manifestos em `k8s/`:
- `statefulset.yaml`: StatefulSet (necessário para sessões persistentes do WhatsApp)
- `service.yaml`: Service interno
- `ingress.yaml`: Ingress para webhooks públicos

## Testes

```bash
# Unitários
pnpm test

# E2E
pnpm test:e2e

# Cobertura
pnpm test:cov
```

## Estrutura Principal

```
src/
├── base/                          # Módulos base compartilhados
│   ├── config/firebase.config.ts
│   ├── guard/api-key.guard.ts
│   ├── queues/token-renewal.queue.ts
│   └── service/                    # Prisma, Redis, Firebase, Arquivos, Rate Limit
├── core/
│   ├── comunication/              # API unificada de comunicação
│   ├── whatsapp/                  # WhatsApp Não Oficial (wpp-web + Puppeteer)
│   │   └── services/message-queue.service.ts
│   ├── whatsapp-official/         # WhatsApp Cloud API + Templates
│   ├── instagram/                 # Instagram Messaging (Meta Graph API) + cron
│   ├── facebook/                  # Facebook Messenger + Lead Ads
│   ├── olx/                       # OLX (OAuth, leads, chat)
│   ├── integrations/              # Status centralizado das integrações
│   └── health-check/              # Health check
└── prisma/                        # Schema e migrações
```

## Fluxo de Mensagens

1. Mensagem chega via **webhook** do provedor (Meta, OLX) ou polling (WhatsApp Web)
2. Microsserviço normaliza o payload para o formato comum do CRM
3. Dispara evento HTTP para o backend principal (`autopilot-backend`) processar no módulo de Chat/Atendimento
4. Respostas do atendente chegam do backend via API Key protegida
5. Microsserviço enfileira (Bull) e envia pelo canal correspondente
