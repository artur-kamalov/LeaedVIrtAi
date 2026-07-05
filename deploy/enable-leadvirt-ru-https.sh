#!/bin/sh
set -eu

DOMAIN="${DOMAIN:-leadvirt.ru}"
WWW_DOMAIN="${WWW_DOMAIN:-www.leadvirt.ru}"
TARGET_IP="${TARGET_IP:-193.187.92.88}"
EMAIL="${CERTBOT_EMAIL:-admin@leadvirt.ai}"
ENV_FILE="${LEADVIRT_ENV_FILE:-/opt/leadvirt/secrets/.env}"
COMPOSE_FILE="deploy/docker-compose.staging.yml"

if [ ! -f "$COMPOSE_FILE" ] || [ ! -f "deploy/nginx.https.conf" ]; then
  echo "Run from /opt/leadvirt/current with deploy files present." >&2
  exit 1
fi

resolve_ip() {
  getent ahostsv4 "$1" | awk '{print $1; exit}'
}

DOMAIN_IP="$(resolve_ip "$DOMAIN" || true)"
WWW_IP="$(resolve_ip "$WWW_DOMAIN" || true)"

if [ "$DOMAIN_IP" != "$TARGET_IP" ] || [ "$WWW_IP" != "$TARGET_IP" ]; then
  echo "DNS is not ready." >&2
  echo "$DOMAIN -> ${DOMAIN_IP:-missing}, expected $TARGET_IP" >&2
  echo "$WWW_DOMAIN -> ${WWW_IP:-missing}, expected $TARGET_IP" >&2
  exit 1
fi

mkdir -p deploy/certbot/www

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d nginx

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v "$(pwd)/deploy/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "$WWW_DOMAIN" \
  --email "$EMAIL" --agree-tos --non-interactive --keep-until-expiring

cp deploy/nginx.conf deploy/nginx.http.backup.conf
cp deploy/nginx.https.conf deploy/nginx.conf

python3 - "$ENV_FILE" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
updates = {
    "APP_URL": "https://leadvirt.ru",
    "API_URL": "https://leadvirt.ru",
    "NEXT_PUBLIC_API_URL": "https://leadvirt.ru/api",
    "NEXT_PUBLIC_APP_URL": "https://leadvirt.ru",
    "NEXT_PUBLIC_WEB_URL": "https://leadvirt.ru",
    "CORS_ORIGINS": "https://leadvirt.ru,https://www.leadvirt.ru",
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

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --force-recreate api worker web nginx
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T nginx nginx -t
curl -fsS "https://$DOMAIN/health"

if [ -f deploy/renew-leadvirt-ru-cert.sh ]; then
  chmod +x deploy/renew-leadvirt-ru-cert.sh
  echo '23 3 * * * root /opt/leadvirt/current/deploy/renew-leadvirt-ru-cert.sh >> /var/log/leadvirt/leadvirt-ru-certbot.log 2>&1' \
    | sudo tee /etc/cron.d/leadvirt-ru-certbot >/dev/null
  sudo chmod 644 /etc/cron.d/leadvirt-ru-certbot
fi

echo "HTTPS enabled for $DOMAIN and $WWW_DOMAIN."
