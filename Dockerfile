FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

ARG NEXT_PUBLIC_API_URL=http://localhost:4001/api
ARG NEXT_PUBLIC_APP_URL=http://localhost:3001
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3001
ARG NEXT_PUBLIC_DEMO_MODE=false
ARG NEXT_PUBLIC_TELEGRAM_LOGIN_BOT=

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_WEB_URL=${NEXT_PUBLIC_WEB_URL}
ENV NEXT_PUBLIC_DEMO_MODE=${NEXT_PUBLIC_DEMO_MODE}
ENV NEXT_PUBLIC_TELEGRAM_LOGIN_BOT=${NEXT_PUBLIC_TELEGRAM_LOGIN_BOT}
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
COPY artifacts ./artifacts

RUN corepack pnpm install --frozen-lockfile \
  && corepack pnpm --filter @leadvirt/db db:generate \
  && corepack pnpm -r --if-present build

EXPOSE 3001 4001

CMD ["corepack", "pnpm", "--filter", "@leadvirt/web", "start"]
