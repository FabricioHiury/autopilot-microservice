FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl && corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY prisma ./prisma
RUN pnpm exec prisma generate
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN pnpm run build

FROM builder AS production-dependencies
RUN pnpm prune --prod --ignore-scripts

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl ffmpeg dumb-init && corepack enable
ENV NODE_ENV=production PORT=3005
COPY --from=builder --chown=node:node /app/package.json /app/pnpm-lock.yaml ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
USER node
EXPOSE 3005
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
