# LeadVirt Staging Deploy

Target: `https://leadvirt.ru`, host `193.187.92.88`, `/opt/leadvirt/current`.

Runtime env lives outside git at:

```text
/opt/leadvirt/secrets/.env
```

Create it from `deploy/env.staging.example`, replacing all `change-me` values and adding `AI_API_KEY`.

## GitHub Actions Deploy

Primary deploy path:

```text
.github/workflows/deploy-leadvirt-ru.yml
```

It verifies the app, uploads a release package to the VPS, switches `/opt/leadvirt/current` to the new release, rebuilds Docker Compose, and checks `https://leadvirt.ru/health`.

Setup details are in `docs/GITHUB_ACTIONS_DEPLOY.md`.

## Manual Deploy

Deploy from `/opt/leadvirt/current`:

```bash
mkdir -p deploy/certbot/www
docker rm -f deploy-caddy-1 2>/dev/null || true
docker compose --env-file /opt/leadvirt/secrets/.env -f deploy/docker-compose.staging.yml up -d --build --remove-orphans
docker compose --env-file /opt/leadvirt/secrets/.env -f deploy/docker-compose.staging.yml ps
curl -fsS https://leadvirt.ru/health
```

Current public env uses `https://leadvirt.ru` and `AUTH_COOKIE_SECURE=true`.

If the HTTPS/domain config must be reapplied:

```bash
cd /opt/leadvirt/current
deploy/enable-leadvirt-ru-https.sh
```

The cutover script installs daily certificate renewal through `/etc/cron.d/leadvirt-ru-certbot`.

Staging operator credentials are stored on the server at:

```text
/opt/leadvirt/secrets/operator-login.txt
```

Reverse proxy: nginx. HTTP redirects to HTTPS for `leadvirt.ru`; `www.leadvirt.ru` redirects to the apex domain.
