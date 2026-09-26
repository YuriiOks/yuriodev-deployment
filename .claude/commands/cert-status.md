---
description: Diagnose the origin TLS certificate behind Cloudflare Full (strict) - served certificate, file on disk, edge status - and say what to do if something is off. Read-only. Use on a Cloudflare 526/525 or when asked "cert status" / "is the cert ok".
---
Setup (since 2026-09-24): the proxy serves a Cloudflare Origin CA certificate from `nginx-proxy/certs/origin.pem` + `origin.key` (mounted at `/etc/nginx/conf.d/certs/`), ECC, SAN `yuriodev.co.uk` + `*.yuriodev.co.uk`, valid until 2041-09-20. It is trusted only by Cloudflare, so direct-to-origin HTTPS shows an untrusted certificate (expected). Nothing needs renewing. `certbot/` is the legacy Let's Encrypt store, mounted only for `options-ssl-nginx.conf` and dhparams.

Read-only checks (run from /home/yurii/yuriodev-deployment):
1. Served by the proxy: `echo | openssl s_client -connect 127.0.0.1:443 -servername yuriodev.co.uk 2>/dev/null | openssl x509 -noout -issuer -dates -ext subjectAltName` (issuer should be "CloudFlare Origin SSL ECC Certificate Authority").
2. File on disk matches the key: `a=$(openssl x509 -in nginx-proxy/certs/origin.pem -noout -pubkey | sha256sum); b=$(openssl pkey -in nginx-proxy/certs/origin.key -pubout | sha256sum); [ "$a" = "$b" ] && echo match || echo MISMATCH` (prints hashes only, never the key).
3. Proxy wiring: `grep -n ssl_certificate nginx-proxy/*.conf` and `docker exec yuriodev-proxy nginx -t`.
4. Edge: `curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 --doh-url https://1.1.1.1/dns-query https://yuriodev.co.uk/` (plain DNS on this box resolves to the origin). 200 = fine; 526 = Cloudflare rejects the origin cert; 525 = TLS handshake failed; 521/522 = proxy down or unreachable.

If something is wrong, report what and propose the fix, then wait for Yurii's go:
- 526 with the right cert served: check the zone's SSL mode is still Full (strict) and the hostname is proxied (orange cloud) via the Cloudflare MCP (`/zones?name=yuriodev.co.uk`, `/zones/<id>/settings/ssl`).
- Wrong or missing cert: the files may have been lost (they're gitignored, so a fresh clone won't have them). Issue a new one: generate a key + CSR here (`openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout origin.key -out origin.csr -subj "/CN=yuriodev.co.uk"` inside `nginx-proxy/certs/`, umask 077), POST the CSR to `/certificates` via the Cloudflare MCP (`request_type: origin-ecc`, `hostnames: [yuriodev.co.uk, *.yuriodev.co.uk]`, `requested_validity: 5475`), save the returned cert as `origin.pem`, then `nginx -t` and `docker exec yuriodev-proxy nginx -s reload`. Revoke the old cert (`DELETE /certificates/<id>`) once the new one is live.
After any fix: run `/smoke-test`.
