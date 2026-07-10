#!/bin/sh
set -eu

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /opt/leadvirt/current/deploy/certbot/www:/var/www/certbot \
  certbot/certbot renew --quiet --webroot -w /var/www/certbot

cd /opt/leadvirt/current
docker compose --env-file /opt/leadvirt/secrets/.env -f deploy/docker-compose.staging.yml exec -T nginx nginx -t
docker compose --env-file /opt/leadvirt/secrets/.env -f deploy/docker-compose.staging.yml exec -T nginx nginx -s reload
