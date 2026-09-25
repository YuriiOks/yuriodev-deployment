#!/usr/bin/env python3
"""Guard the compose files that the release pipeline and the deploy agent rely on.

Checks (reads YAML only; never runs `docker compose config`, which would load env files):
  * every deployed app service runs ghcr.io/yuriioks/yuriodev-<svc>:<env tag>,
    has a container_name, restart: unless-stopped, and builds (if at all) with
    target: runtime, so the dev stage can never ship;
  * container names are unique, and dev/stage never reuse the prod service names
    (the service name is a DNS alias on the shared network);
  * the deploy agent's parser (deploy/agent/yuriodev-deploy.sh, services_of) sees
    exactly the expected services;
  * every service has the same logging block, every app service has resource
    limits, the proxy has a healthcheck and never a memory limit;
  * no deployed service sets network_mode (host networking would expose every
    listening port without a `ports:` key);
  * only the prod proxy publishes ports; its image is pinned by digest
    (name:tag@sha256:<64 hex>) and every volume it mounts, ./nginx-proxy
    included, is read-only;
  * compose.local.yml (if present) is Mac-only: dev targets, its own network, no
    registry images, never the shared yuriodev-network.
Exit code 1 on any failure. Run from the repo root: python3 scripts/check-compose.py
"""
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DEPLOYED = {
    "prod": (ROOT / "docker-compose.yml", "production"),
    "dev": (ROOT / "deploy/dev/compose.yml", "dev"),
    "stage": (ROOT / "deploy/stage/compose.yml", "stage"),
}
# What deploy/agent/yuriodev-deploy.sh must see: (service, container, port).
EXPECTED_AGENT_VIEW = {
    "prod": {("frontend", "yuriodev-frontend", "80"), ("backend", "yuriodev-backend", "8000")},
    "dev": {("frontend-dev", "yuriodev-dev-frontend", "80"), ("backend-dev", "yuriodev-dev-backend", "8000")},
    "stage": {("frontend-stage", "yuriodev-stage-frontend", "80"), ("backend-stage", "yuriodev-stage-backend", "8000")},
}
PROD_SERVICE_NAMES = {"frontend", "backend", "proxy"}
DIGEST_PINNED = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")
PROXY_CONF = ("./nginx-proxy", "/etc/nginx/conf.d")

errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def load(path: Path) -> dict:
    try:
        return yaml.safe_load(path.read_text()) or {}
    except FileNotFoundError:
        fail(f"{path.relative_to(ROOT)}: missing")
        return {}


def agent_view(doc: dict) -> set:
    """Same rule as services_of() in deploy/agent/yuriodev-deploy.sh."""
    out = set()
    for name, svc in (doc.get("services") or {}).items():
        img = (svc or {}).get("image", "")
        if not img.startswith("ghcr.io/"):
            continue
        port = "8000" if "backend" in name else "80"
        out.add((name, svc.get("container_name", ""), port))
    return out


def volume(entry) -> tuple:
    """(source, target, read_only) for a short ("src:dst[:mode]") or long-syntax volume."""
    if isinstance(entry, dict):
        return str(entry.get("source", "")), str(entry.get("target", "")), entry.get("read_only") is True
    parts = str(entry).split(":")
    mode = parts[2] if len(parts) > 2 else ""
    return parts[0], (parts[1] if len(parts) > 1 else ""), "ro" in mode.split(",")


def check_proxy(rel, svc: dict) -> None:
    image = str(svc.get("image", ""))
    if not DIGEST_PINNED.match(image):
        fail(f"{rel}: the proxy image '{image}' must be pinned by digest (name:tag@sha256:<64 hex>)")
    vols = [volume(v) for v in svc.get("volumes") or []]
    if not any((src.rstrip("/"), dst.rstrip("/")) == PROXY_CONF for src, dst, _ in vols):
        fail(f"{rel}: the proxy must mount {PROXY_CONF[0]} at {PROXY_CONF[1]}")
    for src, dst, read_only in vols:
        if not read_only:
            fail(f"{rel}: proxy volume '{src}:{dst}' must be mounted read-only (:ro)")


def block(svc: dict, *keys):
    cur = svc
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


containers: dict[str, str] = {}
logging_shapes: dict[str, str] = {}
limit_keys: dict[str, str] = {}

for env, (path, tag) in DEPLOYED.items():
    doc = load(path)
    rel = path.relative_to(ROOT)
    services = doc.get("services") or {}
    for name, svc in services.items():
        svc = svc or {}
        cname = svc.get("container_name")
        if not cname:
            fail(f"{rel}: service '{name}' has no container_name")
        elif cname in containers:
            fail(f"{rel}: container_name '{cname}' also used in {containers[cname]}")
        else:
            containers[cname] = str(rel)
        if env != "prod" and name in PROD_SERVICE_NAMES:
            fail(f"{rel}: service name '{name}' collides with a prod service name on yuriodev-network")
        if svc.get("restart") != "unless-stopped":
            fail(f"{rel}: service '{name}' must use restart: unless-stopped")
        build = svc.get("build")
        if build is not None:
            if not isinstance(build, dict) or build.get("target") != "runtime":
                fail(f"{rel}: service '{name}' builds without target: runtime")
        logging = svc.get("logging")
        if logging is None:
            fail(f"{rel}: service '{name}' has no logging block (json-file max-size/max-file)")
        else:
            logging_shapes[f"{rel}:{name}"] = yaml.safe_dump(logging, sort_keys=True)
        limits = block(svc, "deploy", "resources", "limits")
        if limits is not None:
            limit_keys[f"{rel}:{name}"] = ",".join(sorted(limits))
        elif name != "proxy":
            fail(f"{rel}: service '{name}' has no deploy.resources.limits")
        if name == "proxy" and "healthcheck" not in svc:
            fail(f"{rel}: the proxy needs a compose healthcheck (it has no Dockerfile)")
        if name == "proxy" and block(svc, "deploy", "resources", "limits", "memory") is not None:
            fail(f"{rel}: the proxy must not get a memory limit (it serves every environment)")
        if svc.get("network_mode"):
            fail(f"{rel}: service '{name}' sets network_mode; every deployed service must stay on "
                 "yuriodev-network (host networking bypasses the ports rule)")
        if env == "prod" and name == "proxy":
            check_proxy(rel, svc)
        elif svc.get("ports"):
            fail(f"{rel}: service '{name}' publishes ports; only the prod proxy may (it serves every environment)")
        image = svc.get("image", "")
        if name == "proxy":
            continue
        want = f"ghcr.io/yuriioks/yuriodev-{'backend' if 'backend' in name else 'frontend'}:{tag}"
        if image != want:
            fail(f"{rel}: service '{name}' image is '{image}', expected '{want}'")
    if env == "prod" and doc and "proxy" not in services:
        fail(f"{rel}: no 'proxy' service (the only service allowed to publish ports)")
    got = agent_view(doc)
    if doc and got != EXPECTED_AGENT_VIEW[env]:
        fail(f"{rel}: deploy agent would see {sorted(got)}, expected {sorted(EXPECTED_AGENT_VIEW[env])}")

if len(set(logging_shapes.values())) > 1:
    fail("logging blocks differ between services: " + "; ".join(f"{k}" for k in logging_shapes))
if len(set(limit_keys.values())) > 1:
    fail("resource limit keys differ between services: " + "; ".join(f"{k}={v}" for k, v in limit_keys.items()))

local = ROOT / "compose.local.yml"
if local.exists():
    doc = load(local)
    for name, svc in (doc.get("services") or {}).items():
        svc = svc or {}
        if str(svc.get("image", "")).startswith("ghcr.io/"):
            fail(f"compose.local.yml: '{name}' must build locally, not pull a registry image")
        build = svc.get("build")
        if isinstance(build, dict) and build.get("target") != "dev":
            fail(f"compose.local.yml: '{name}' must build target: dev")
    nets = doc.get("networks") or {}
    if any((n or {}).get("name") == "yuriodev-network" or (n or {}).get("external") for n in nets.values()):
        fail("compose.local.yml: must use its own network, never the shared yuriodev-network")

if errors:
    print("check-compose: FAIL")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"check-compose: OK ({len(containers)} containers across {len(DEPLOYED)} environments"
      f"{', local stack checked' if local.exists() else ''})")
