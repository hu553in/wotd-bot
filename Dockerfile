# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --fund=false

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json bot.js logger.js knexfile.js ./
COPY --chown=node:node migrations ./migrations

USER node
CMD ["node", "bot.js"]
