# LeadVirt External API Gateway

Purpose: route LeadVirt OpenAI and Telegram Bot API traffic through a supported-region VPS while keeping the main app on the primary staging server.

Current host:

```text
fr-vmnano
147.90.14.240
https://147-90-14-240.sslip.io:8443/v1
https://147-90-14-240.sslip.io:8443/telegram
```

Deploy:

```bash
cd /opt/leadvirt/ai-gateway
mkdir -p certbot/www
docker compose up -d
```

The nginx gateway allows OpenAI and Telegram proxy traffic only from the main LeadVirt server IP `193.187.92.88`. Public `/health` is intentionally available for a simple uptime check. Telegram access and non-emergency error logging are disabled because Bot API request paths contain bot tokens.

Port note: `443` is intentionally left to the existing `xray` service on the FR VPS; nginx serves the AI gateway on `8443` and uses `80` for health checks and ACME HTTP validation.

First certificate issue after stopping the old gateway:

```bash
docker compose down
sudo docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly --standalone \
  -d 147-90-14-240.sslip.io \
  --email admin@leadvirt.ai --agree-tos --non-interactive
docker compose up -d
```

Renew:

```bash
/opt/leadvirt/ai-gateway/renew-cert.sh
```

The FR host runs this daily through `/etc/cron.d/leadvirt-ai-gateway-certbot`.

Main LeadVirt env:

```text
AI_BASE_URL=https://147-90-14-240.sslip.io:8443/v1
TELEGRAM_BOT_API_BASE_URL=https://147-90-14-240.sslip.io:8443/telegram
```
