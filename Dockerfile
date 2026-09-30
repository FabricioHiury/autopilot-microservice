FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      libnss3 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      libgbm1 \
      libpango1.0-0 \
      libxss1 \
      libasound2 \
      dumb-init \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_BIN=/usr/bin/chromium \
    NODE_OPTIONS="--max-old-space-size=6144"

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

RUN mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache \
    && chmod -R 755 /app

EXPOSE 3005
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm","run","start:prod"]