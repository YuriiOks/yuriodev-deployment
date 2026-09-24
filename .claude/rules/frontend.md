---
paths:
  - "frontend/**"
---
# Frontend: React 19 + Vite 7 + TypeScript 5.9 (npm)

- Scripts (run in `frontend/`): `npm run dev` (vite on :5173; over SSH use VS Code port forwarding), `npm run build` (`tsc -b && vite build` -> `dist/`, gitignored), `npm run lint` (eslint 9 flat config), typecheck only: `npx tsc --noEmit -p tsconfig.app.json` (clean).
- `npm run lint` is not a passing gate yet: about 34 existing problems (mostly `@typescript-eslint/no-explicit-any` plus one emoji regex in `src/components/ui/InteractiveTerminal/`). Don't add new ones; don't mass-fix unasked.
- The build runs inside Docker (`npm ci` on node:22-alpine), so `package-lock.json` must stay in sync with `package.json`. Dependency changes (`npm install ...`) need Yurii's OK.
- Builds happen in GitHub Actions, not on this box: `.github/workflows/ci.yml` runs typecheck/build/lint on every push to `master` and every PR, then `images.yml` builds the image once per green `master` commit and points `:dev` at it (and `:stage` while `STAGE_AUTO_PROMOTE=true`). A manual `docker compose build frontend` here is break-glass only (see root `CLAUDE.md` golden rule 2).
- To see a change live before a release: push to `master` (or merge a PR into it) and wait for CI + the deploy agent (cron, within a minute of the image landing) to update `dev.yuriodev.co.uk` — behind basic auth, credentials at `~/.config/yuriodev/basic-auth.txt` (never print them). There is no local dev container for this; `npm run dev` (Vite on :5173) is the fast local loop.
- Structure: `src/pages/*` compose `src/components/sections/*`; reusable widgets in `src/components/ui/*`; layout in `src/components/layout/*`. One CSS Module per component (`X/X.tsx` + `X/X.module.css`). Colours only through the CSS variables in `src/assets/styles/_variables.css`, with both `[data-theme="light"]` and `[data-theme="dark"]` variants. Font: Fira Code.
- Routes (react-router 7, `src/App.tsx`): `/` portfolio; `/community`, `/courses`, `/dashboard` are ComingSoon placeholders.
- API calls: none. The backend now only exposes an internal `GET /health`; there is no `/api/chat` or other business endpoint for the frontend to call.
- Dead files (don't extend): `community.html`, `courses.html`, `dashboard.html` (legacy multi-page entries), the 0-byte files in `public/`, `tmp/`, `generate_project_doc.py`, `show_docs_tree.sh`, `*.tsbuildinfo` at the frontend root.
