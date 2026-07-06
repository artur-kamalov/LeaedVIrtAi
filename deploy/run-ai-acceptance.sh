#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.staging.yml}"
ENV_FILE="${LEADVIRT_ENV_FILE:-/opt/leadvirt/secrets/.env}"
ACCEPTANCE_API_BASE="${LEADVIRT_ACCEPTANCE_API_BASE:-http://api:4001/api}"
ACCEPTANCE_WORKER_METRICS_URL="${LEADVIRT_ACCEPTANCE_WORKER_METRICS_URL:-http://127.0.0.1:4002/metrics}"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Run from /opt/leadvirt/current or set COMPOSE_FILE. Missing: $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

mode="$(compose exec -T api sh -lc 'printf "%s" "${AI_REPLY_MODE:-}"' | tr -d '\r')"
if [ "$mode" != "queue" ]; then
  echo "qa:ai:acceptance requires AI_REPLY_MODE=queue in the running api service. Current: ${mode:-unset}" >&2
  exit 1
fi

compose exec -T \
  -e LEADVIRT_API_BASE="$ACCEPTANCE_API_BASE" \
  -e WORKER_METRICS_URL="$ACCEPTANCE_WORKER_METRICS_URL" \
  worker sh -lc 'corepack pnpm run qa:ai:acceptance'
