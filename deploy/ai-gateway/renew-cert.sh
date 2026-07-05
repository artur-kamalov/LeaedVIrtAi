#!/bin/sh
set -eu

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /opt/leadvirt/ai-gateway/certbot/www:/var/www/certbot \
  certbot/certbot renew --quiet --webroot -w /var/www/certbot

docker exec ai-gateway-nginx-1 nginx -s reload >/dev/null 2>&1 || true
