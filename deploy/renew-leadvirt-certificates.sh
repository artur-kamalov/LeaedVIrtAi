#!/bin/sh
set -eu

CURRENT_LINK="${LEADVIRT_CURRENT_LINK:-/opt/leadvirt/current}"
ENV_FILE="${LEADVIRT_ENV_FILE:-/opt/leadvirt/secrets/.env}"
DEPLOY_LOCK_FILE="${LEADVIRT_DEPLOY_LOCK_FILE:-/opt/leadvirt/.deploy.lock}"
DEPLOY_LOCK_WAIT_SECONDS="${LEADVIRT_DEPLOY_LOCK_WAIT_SECONDS:-900}"
active_root="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
compose_file="$active_root/deploy/docker-compose.staging.yml"
certbot_webroot="${LEADVIRT_CERTBOT_WEBROOT:-$active_root/deploy/certbot/www}"

case "$DEPLOY_LOCK_WAIT_SECONDS" in
  ""|*[!0-9]*)
    echo "LEADVIRT_DEPLOY_LOCK_WAIT_SECONDS must be a non-negative integer." >&2
    exit 1
    ;;
esac

exec 9>"$DEPLOY_LOCK_FILE"
if ! flock -w "$DEPLOY_LOCK_WAIT_SECONDS" 9; then
  echo "Timed out waiting for the LeadVirt deployment lock." >&2
  exit 1
fi

read_compose_project_name() {
  release_root="$1"
  marker="$release_root/.leadvirt-compose-project"

  if [ ! -e "$marker" ]; then
    return 0
  fi
  if [ ! -f "$marker" ] || [ -L "$marker" ]; then
    echo "Invalid Compose project marker: $marker is not a regular file." >&2
    return 1
  fi

  project_name="$(cat "$marker")"
  marker_size="$(wc -c < "$marker" | tr -d '[:space:]')"
  project_size="${#project_name}"
  if [ "$marker_size" -eq "$project_size" ]; then
    :
  elif [ "$marker_size" -eq $((project_size + 1)) ] &&
    [ "$(tail -c 1 "$marker" | od -An -tu1 | tr -d '[:space:]')" = "10" ]; then
    :
  else
    echo "Invalid Compose project marker encoding: $marker." >&2
    return 1
  fi
  case "$project_name" in
    ""|[-_]*|*[!a-z0-9_-]*)
      echo "Invalid Compose project name in $marker." >&2
      return 1
      ;;
  esac
  printf '%s\n' "$project_name"
}

if [ ! -f "$compose_file" ] || [ ! -d "$certbot_webroot" ] || [ ! -f "$ENV_FILE" ]; then
  echo "Missing active Compose file, certbot webroot, or deploy env." >&2
  exit 1
fi

compose_project_name="$(read_compose_project_name "$active_root")"

active_compose() {
  if [ -n "$compose_project_name" ]; then
    docker compose --project-name "$compose_project_name" --env-file "$ENV_FILE" -f "$compose_file" "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$compose_file" "$@"
  fi
}

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v "$certbot_webroot:/var/www/certbot" \
  certbot/certbot renew --quiet --webroot -w /var/www/certbot

active_compose exec -T nginx nginx -t
active_compose exec -T nginx nginx -s reload
