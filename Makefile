# Local development helpers (run on the Mac; see compose.local.yml).
LOCAL := docker compose -f compose.local.yml

.PHONY: help dev-up dev-down dev-logs dev-ps dev-test lint typecheck test check

help:
	@echo "dev-up     start the local stack (frontend :5173 with HMR, backend :8000 with reload)"
	@echo "dev-down   stop and remove the local stack"
	@echo "dev-logs   follow both services' logs"
	@echo "dev-ps     show the local containers"
	@echo "dev-test   run vitest and pytest inside the running local containers"
	@echo "check      typecheck + lint + tests + compose guards (what CI runs)"

dev-up:
	$(LOCAL) up -d --build

dev-down:
	$(LOCAL) down

dev-logs:
	$(LOCAL) logs -f --tail 100

dev-ps:
	$(LOCAL) ps

dev-test:
	$(LOCAL) exec -T frontend npm run test
	$(LOCAL) exec -T backend python -m pytest -q

typecheck:
	$(LOCAL) exec -T frontend npx tsc --noEmit -p tsconfig.app.json

lint:
	$(LOCAL) exec -T frontend npm run lint

test: dev-test

check: typecheck lint dev-test
	python3 scripts/check-compose.py
