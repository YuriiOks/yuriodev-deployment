---
paths:
  - "docker-compose.yml"
  - "nginx-proxy/**"
  - "**/Dockerfile"
  - "frontend/nginx.conf"
  - "certbot/**"
---
# Infra rules: compose, nginx proxy, Dockerfiles

- `nginx-proxy/` is bind-mounted into the running `yuriodev-proxy` at `/etc/nginx/conf.d`: an edit there goes live at the next reload or restart. After each edit a hook runs `docker exec yuriodev-proxy nginx -t`; reload (`docker exec yuriodev-proxy nginx -s reload`) only with Yurii's OK. A failed reload keeps the old config; a proxy restart with a bad config is a full outage.
- Upstreams are resolved per request (`resolver 127.0.0.11` + `set $var http://<container_name>:<port>; proxy_pass $var;`): recreating frontend/backend needs no proxy reload, and a stopped container only fails its own location. Keep this pattern for every new vhost and address containers by `container_name`, never by service name (service names can repeat across compose projects on `yuriodev-network`, and Docker would round-robin between them). Never add static `upstream {}` blocks.
- `docker-compose.yml` edits take effect on the next `up` of the affected service; a hook validates them with `docker compose config --quiet`. Changing the proxy's ports or volumes needs `docker compose up -d --no-deps proxy` (a ~2 s full-site blip; ask).
- Images: GitHub Actions builds each green `master` commit once (`.github/workflows/ci.yml` -> `images.yml`) and pushes `ghcr.io/yuriioks/yuriodev-{frontend,backend}:sha-<commit>`, then points `:dev` at that digest. The packages are public (anonymous pull, no registry login on this box). Promotions only retag existing digests; never delete `sha-*` tags that were ever promoted (rollback depends on them). Workflow files are pushed over SSH (the local gh token has no `workflow` scope) and every action must be pinned to a full commit SHA (repo setting).
- Only the proxy publishes ports (80, 443). Never add `ports:` to other services.
- Config drift: running containers can carry an older compose config hash than the file, so a bare `docker compose up -d` can recreate services unexpectedly. Always name services and add `--no-deps`; preview with `docker compose --dry-run up -d --no-deps <svc>`.
- Healthchecks: none of the three services (backend, frontend, proxy) define one.
- No log rotation is configured (json-file driver, unlimited). If adding it, use one `x-logging` anchor (`max-size: 10m`, `max-file: "3"`); it applies at each service's next recreate.
- Images: frontend = node:22-alpine build stage -> nginx:stable-alpine (`frontend/nginx.conf` is baked in; it changes only after rebuilding frontend); backend = python:3.11-slim. Base image is an unpinned tag (`nginx:stable-alpine`).
- Origin TLS: Cloudflare Origin CA cert `nginx-proxy/certs/origin.pem` + `origin.key` (key mode 600, gitignored by the `certs/` rule), served from `/etc/nginx/conf.d/certs/` inside the proxy; valid until 2041-09-20; issued via the Cloudflare API from a key generated on this server. Never commit or print the key. Check with `/cert-status`.
- `certbot/` is the legacy root-owned Let's Encrypt store (expired 2026-05-15, nothing renews it). It stays mounted only because `default.conf` includes `/etc/letsencrypt/options-ssl-nginx.conf` and `ssl-dhparams.pem`; don't edit it.
- Not part of this stack: the host's `/etc/nginx/sites-*` and `certbot.timer` (renews the unused `/etc/letsencrypt`), and `/usr/bin/docker-compose` (legacy v1).
