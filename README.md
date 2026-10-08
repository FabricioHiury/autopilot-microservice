# AutoPilot — Microservice de Integrações

Gateway de comunicação do AutoPilot, CRM para lojas e concessionárias de veículos. Este serviço conecta o CRM a WhatsApp, Instagram, Facebook e OLX, normaliza os eventos recebidos e controla o envio e a entrega das mensagens.

O microservice não contém o pipeline comercial nem executa o copiloto de IA. Essas responsabilidades pertencem ao backend principal; o frontend apresenta os fluxos aos usuários.

## Arquitetura e funcionalidades

| Projeto                  | Responsabilidade                             | Porta local |
| ------------------------ | -------------------------------------------- | ----------- |
| `autopilot-frontend`     | Interface das lojas e backoffice             | 3001        |
| `autopilot-backend`      | CRM, autenticação, regras comerciais e IA    | 3003        |
| `autopilot-microservice` | Provedores, callbacks e entrega de mensagens | 3005        |

Stack: NestJS 10, TypeScript, Prisma 5, PostgreSQL, Redis, Socket.io e Firebase para mídia. O banco `autopilot_micro` é separado do banco comercial `autopilot`; a Evolution mantém seu próprio banco e volume de instâncias.

Funcionalidades implementadas:

- WhatsApp via Evolution v2.3.7: conexão por QR Code, estado da instância, verificação de número e envio/recebimento.
- WhatsApp oficial pela Meta: configuração, templates, tokens criptografados e callbacks.
- Instagram, Facebook e OLX: integração dos respectivos canais, autorização e processamento de eventos.
- Normalização, correlação de IDs externos, processamento de anexos e atualização de status de entrega.
- Fila durável para eventos recebidos, deduplicação, retentativas e recuperação após reinício.
- Envio idempotente e inspeção de resultados incertos.

As funcionalidades de cada canal dependem das contas, permissões e formatos aceitos pelo provedor. OLX suporta texto; recursos como localização e contatos em canais sociais podem ser representados por texto. As sessões do WhatsApp pertencem à Evolution, não ao filesystem do gateway.

## Desenvolvimento integrado com Colima

Use Node.js 22 e pnpm 10.25.0. Os engines do projeto aceitam Node 22–24. Os exemplos assumem os três repositórios em pastas irmãs.

Na primeira configuração:

```bash
cp .env.example .env
pnpm install --frozen-lockfile
```

Preserve o `.env` se já estiver configurado. Inicie a infraestrutura compartilhada pelo `docker-compose.local.yml` do backend, conforme o [guia local](../autopilot-backend/docker/local/README.md). Ele sobe PostgreSQL, Redis, Evolution e Ollama; as três aplicações rodam no host.

Em um terminal deste projeto:

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

Este projeto sincroniza o esquema com `prisma db push`; não usa arquivos de migração. Confira `DATABASE_URL` antes de executar. O backend principal aplica suas próprias migrações ao banco `autopilot`.

O `.env` é carregado pelo serviço; o `.env.local` compartilhado precisa ser carregado explicitamente pelo terminal. O callback de Evolution acima permite que seu container alcance o microservice no host. Meta e OLX precisam de URLs públicas HTTPS acessíveis externamente; `localhost` não substitui esse callback público.

## Configuração dos provedores

| Variável                                           | Uso                                                         |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `MICROSERVICE_TOKEN`                               | Segredo das chamadas internas; deve coincidir com o backend |
| `AUTOPILOT_URL`                                    | Origem do backend para entrega HTTP dos eventos             |
| `APP_BASE_URL`                                     | URL do gateway usada pelos fluxos de callback               |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`           | Acesso à Evolution                                          |
| `EVOLUTION_WEBHOOK_TOKEN`, `EVOLUTION_WEBHOOK_URL` | Autenticação e destino dos eventos Evolution                |
| `ENCRYPTION_KEY`                                   | Chave de 32 bytes em base64 para tokens do WhatsApp oficial |
| `META_*`, `INSTAGRAM_*`, `OLX_*`                   | Configuração dos respectivos provedores                     |

Use segredos diferentes para a API Evolution e seu webhook. Nunca envie `MICROSERVICE_TOKEN` ao navegador.

Firebase aceita variáveis `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` ou um JSON em `FIREBASE_CREDENTIALS_PATH`. Configure `FIREBASE_STORAGE_BUCKET` quando necessário. Sem armazenamento configurado, o serviço pode operar com texto, mas o processamento de mídia permanece pendente. FFmpeg é usado nos fluxos de mídia e está incluído na imagem do projeto.

## API interna e saúde

As chamadas internas usam `x-micro-token`; o alias `x-api-key` também é aceito. As respostas usuais seguem `{ message, statusCode, data }`; a verificação de webhooks segue os protocolos de cada provedor. A documentação fica em `/docs` quando `ENABLE_DOCS` está habilitado.

| Método | Rota                                           | Finalidade                               |
| ------ | ---------------------------------------------- | ---------------------------------------- |
| GET    | `/health`                                      | Saúde do processo                        |
| GET    | `/health/ready`                                | Disponibilidade de PostgreSQL e Redis    |
| POST   | `/communication/messages`                      | Envio idempotente para o provedor        |
| POST   | `/communication/whatsapp/verify-number`        | Verificação de número na Evolution       |
| GET    | `/integrations/whatsapp/qrcode/:storeId`       | Conectar instância e obter QR Code       |
| GET    | `/integrations/:storeId/status`                | Estado dos canais da loja                |
| GET    | `/communication/messages-with-error`           | Inspeção de eventos pendentes/falhos     |
| POST   | `/communication/events/:id/retry`              | Reagendamento de evento                  |
| GET    | `/communication/outbound-with-error`           | Inspeção de envios com resultado incerto |
| POST   | `/communication/messages/:messageId/reconcile` | Vincular evidência confirmada do envio   |

Um envio identifica `storeId`, `messageId`, `recipient` e `channel`. Repetir a combinação loja/mensagem retorna o resultado armazenado; modificar o conteúdo da mesma tentativa retorna 409. Um timeout depois de possível aceite do provedor gera estado `indeterminate`, que não é reenviado automaticamente. A reconciliação exige verificar o provedor e informar o ID externo confirmado; não dispara outro envio.

## Entrega durável ao CRM

Callbacks são autenticados e persistidos em `delivery_jobs` antes da confirmação. Workers usam leases e `SKIP LOCKED` no PostgreSQL, recuperam claims expirados e processam normalização/mídia após a persistência. Falhas transitórias têm retentativa exponencial; falhas permanentes ficam disponíveis para inspeção.

O backend pode conectar ao namespace Socket.io `/crm`, autenticado pelo token compartilhado. Eventos incluem `message:incoming`, `lead:incoming` e `message:ack`. Sem socket disponível ou confirmação positiva, o worker usa HTTP nas rotas `/chat/messages/incoming`, `/leads/incoming` e `/chat/messages/ack` do backend.

IDs de evento são preservados entre transportes e retentativas para permitir deduplicação. Anexos são processados e enviados ao armazenamento antes de serem entregues ao CRM. Mensagens WhatsApp de grupos e broadcasts são ignoradas.

Detalhes de payloads, confirmações e eventos estão no [contrato de comunicação](../autopilot-backend/docs/COMMUNICATION.md). Registros de entrega e envio guardam as chaves de idempotência e correlação usadas nas retentativas.

## Organização e verificação

Módulos de provedores e comunicação ficam em `src/core/`; configuração, infraestrutura e adapters em `src/base/`; esquema em `prisma/schema.prisma`; fixtures em `test/`; manifests em `k8s/`. Testes Jest ficam junto às implementações em `*.spec.ts`.

```bash
pnpm exec prisma validate
pnpm exec tsc --noEmit
pnpm exec jest --runInBand
pnpm lint
pnpm format:check
pnpm build
```

Para concorrência e leases, configure `TEST_DATABASE_URL` em um banco dedicado e execute `pnpm test:database`. O smoke test usa containers descartáveis, dois gateways e um stub do CRM; não envia mensagens a contas WhatsApp reais:

```bash
docker compose -p autopilot-micro-smoke -f test/docker-compose.smoke.yml up --build -d
node test/runtime-smoke.mjs
TEST_REDIS_URL=redis://localhost:56389 TEST_DATABASE_URL=postgresql://postgres:test-password@localhost:55439/autopilot_micro_test pnpm exec jest --runInBand
docker compose -p autopilot-micro-smoke -f test/docker-compose.smoke.yml down -v
```

Aguarde a readiness dos gateways e a inicialização da Evolution. Execute o script uma vez por fixture nova; `down -v` remove os dados dessa fixture. Não substitua o banco de testes por um banco da aplicação.

## Execução em containers

O `docker-compose.yml` deste repositório continua disponível para executar o gateway e sua infraestrutura em uma stack própria. Suas portas de PostgreSQL/Redis são 5433/6380, diferentes do ambiente compartilhado do Colima. Escolha uma stack para o mesmo teste, evitando instâncias duplicadas da Evolution na porta 8080.

Os manifests Kubernetes incluem Deployment, readiness/liveness e HPA. Exigem PostgreSQL, Redis, Evolution, segredos e imagem de release configurados para o ambiente. Consulte [AGENTS.md](AGENTS.md) para contribuir.
