#!/bin/sh
set -eu

PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-leadvirt.com}"
WWW_DOMAIN="${WWW_DOMAIN:-www.leadvirt.com}"
LEGACY_DOMAIN="${LEGACY_DOMAIN:-leadvirt.ru}"
LEGACY_WWW_DOMAIN="${LEGACY_WWW_DOMAIN:-www.leadvirt.ru}"
TARGET_IP="${DOMAIN_TARGET_IP:-193.187.92.88}"
EMAIL="${CERTBOT_EMAIL:-admin@leadvirt.com}"
ENV_FILE="${LEADVIRT_ENV_FILE:-/opt/leadvirt/secrets/.env}"
CURRENT_LINK="${LEADVIRT_CURRENT_LINK:-/opt/leadvirt/current}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RELEASE_ROOT="${LEADVIRT_RELEASE_ROOT:-$(dirname "$SCRIPT_DIR")}"
COMPOSE_FILE="$RELEASE_ROOT/deploy/docker-compose.staging.yml"

is_true() {
  case "$1" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

if [ ! -f "$ENV_FILE" ] || [ ! -f "$COMPOSE_FILE" ] || [ ! -f "$RELEASE_ROOT/deploy/nginx.https.conf" ]; then
  echo "Missing deploy env, Compose file, or nginx HTTPS config." >&2
  exit 1
fi

active_root="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
if [ -n "${LEADVIRT_CERTBOT_WEBROOT:-}" ]; then
  certbot_webroot="$LEADVIRT_CERTBOT_WEBROOT"
elif [ -n "$active_root" ] && [ -d "$active_root/deploy/certbot/www" ]; then
  certbot_webroot="$active_root/deploy/certbot/www"
else
  certbot_webroot="$RELEASE_ROOT/deploy/certbot/www"
fi
mkdir -p "$certbot_webroot"

for domain in "$PRIMARY_DOMAIN" "$WWW_DOMAIN"; do
  resolved_ips="$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  if ! printf '%s\n' "$resolved_ips" | grep -Fx "$TARGET_IP" >/dev/null 2>&1; then
    echo "DNS is not ready: $domain -> ${resolved_ips:-missing}; expected $TARGET_IP" >&2
    exit 1
  fi
done

challenge_token="leadvirt-domain-cutover-$$"
challenge_dir="$certbot_webroot/.well-known/acme-challenge"
challenge_path="$challenge_dir/$challenge_token"
mkdir -p "$challenge_dir"
cleanup_challenge() {
  rm -f "$challenge_path"
}
trap cleanup_challenge EXIT INT TERM
printf '%s' "$challenge_token" > "$challenge_path"
for domain in "$PRIMARY_DOMAIN" "$WWW_DOMAIN"; do
  response="$(curl -fsS --max-time 15 "http://$domain/.well-known/acme-challenge/$challenge_token" || true)"
  if [ "$response" != "$challenge_token" ]; then
    echo "ACME challenge path is not reachable through $domain." >&2
    exit 1
  fi
done
cleanup_challenge
trap - EXIT INT TERM

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v "$certbot_webroot:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  --cert-name "$PRIMARY_DOMAIN" \
  -d "$PRIMARY_DOMAIN" -d "$WWW_DOMAIN" \
  --email "$EMAIL" --agree-tos --non-interactive --keep-until-expiring

PRIMARY_DOMAIN="$PRIMARY_DOMAIN" \
WWW_DOMAIN="$WWW_DOMAIN" \
LEGACY_DOMAIN="$LEGACY_DOMAIN" \
LEGACY_WWW_DOMAIN="$LEGACY_WWW_DOMAIN" \
python3 - "$ENV_FILE" <<'PY'
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
primary = os.environ["PRIMARY_DOMAIN"]
origins = [
    f"https://{primary}",
    f"https://{os.environ['WWW_DOMAIN']}",
    f"https://{os.environ['LEGACY_DOMAIN']}",
    f"https://{os.environ['LEGACY_WWW_DOMAIN']}",
]
updates = {
    "APP_URL": origins[0],
    "API_URL": origins[0],
    "NEXT_PUBLIC_API_URL": f"{origins[0]}/api",
    "NEXT_PUBLIC_APP_URL": origins[0],
    "NEXT_PUBLIC_WEB_URL": origins[0],
    "CORS_ORIGINS": ",".join(origins),
    "AUTH_COOKIE_SECURE": "true",
}

lines = path.read_text().splitlines()
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY

cp "$RELEASE_ROOT/deploy/nginx.https.conf" "$RELEASE_ROOT/deploy/nginx.conf"

if [ -n "$active_root" ] && [ -f "$active_root/deploy/docker-compose.staging.yml" ]; then
  nginx_container="$(cd "$active_root" && docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.staging.yml ps -q nginx 2>/dev/null || true)"
  if [ -n "$nginx_container" ]; then
    docker cp "$RELEASE_ROOT/deploy/nginx.https.conf" "$nginx_container:/tmp/leadvirt-nginx.https.conf"
    docker exec "$nginx_container" nginx -t -c /tmp/leadvirt-nginx.https.conf
    docker exec "$nginx_container" rm -f /tmp/leadvirt-nginx.https.conf
  fi
fi

if [ -f "$RELEASE_ROOT/deploy/renew-leadvirt-certificates.sh" ]; then
  chmod +x "$RELEASE_ROOT/deploy/renew-leadvirt-certificates.sh"
  echo '23 3 * * * root /opt/leadvirt/current/deploy/renew-leadvirt-certificates.sh >> /var/log/leadvirt/leadvirt-certbot.log 2>&1' \
    | sudo tee /etc/cron.d/leadvirt-certbot >/dev/null
  sudo chmod 644 /etc/cron.d/leadvirt-certbot
  sudo rm -f /etc/cron.d/leadvirt-ru-certbot
fi

if is_true "${LEADVIRT_SKIP_REBUILD:-false}"; then
  echo "Domain certificate, env, and nginx config are prepared for $PRIMARY_DOMAIN."
  exit 0
fi

cd "$RELEASE_ROOT"
docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.staging.yml up -d --build --force-recreate api worker web nginx
docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.staging.yml exec -T nginx nginx -t
curl -fsS "https://$PRIMARY_DOMAIN/health"

echo "HTTPS enabled for $PRIMARY_DOMAIN; $LEGACY_DOMAIN remains available for migration compatibility."
