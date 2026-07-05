# GitHub Actions Deploy

Workflow: `.github/workflows/deploy-leadvirt-ru.yml`.

Target: `https://leadvirt.ru` on `193.187.92.88`.

## Required GitHub Secret

Create repository secret:

```text
LEADVIRT_DEPLOY_SSH_KEY
```

Value: private SSH key allowed to log in as `deploy@193.187.92.88`.

Recommended dedicated CI key on this workstation:

```powershell
Get-Content $env:USERPROFILE\.ssh\leadvirt-github-actions_ed25519 -Raw
```

Public key installed on the server:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL5FU5NoP1xqvy0VywGcZ8YKeXBYOzht7Aleg9d1R7uK leadvirt-github-actions
```

Fingerprint:

```text
SHA256:DgKg84mqLLPgKMr4Rui6MYf6Q8IXw6vsreNHLoRltvE
```

## Optional GitHub Variables

The workflow has defaults, but these can be set as repository variables:

```text
LEADVIRT_DEPLOY_HOST=193.187.92.88
LEADVIRT_DEPLOY_USER=deploy
```

## Triggers

- Push to `main` or `master`.
- Manual run through `Actions > Deploy LeadVirt.ru > Run workflow`.

## Server Assumptions

- Runtime env exists at `/opt/leadvirt/secrets/.env`.
- `deploy` can write to `/opt/leadvirt` and run Docker.
- HTTPS certificates exist at `/etc/letsencrypt/live/leadvirt.ru`.

## What It Does

1. Runs typecheck, lint, and build for shared types, API, and web.
2. Creates a source package without `.env`, `node_modules`, `.next`, `dist`, screenshots, or local caches.
3. Uploads the package to the VPS.
4. Extracts it to `/opt/leadvirt/releases/<sha>`.
5. Points `/opt/leadvirt/current` to the new release.
6. Copies `deploy/nginx.https.conf` to `deploy/nginx.conf`.
7. Runs Docker Compose with `/opt/leadvirt/secrets/.env`.
8. Verifies `https://leadvirt.ru/health` and no-cookie `401` on `/api/auth/me`.
9. Keeps the 5 latest releases.

On the first run, if `/opt/leadvirt/current` is still a regular directory, the workflow moves it to `/opt/leadvirt/current.backup.<timestamp>` before creating the release symlink.
