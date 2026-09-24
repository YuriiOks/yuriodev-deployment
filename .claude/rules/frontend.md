---
paths:
  - "frontend/**"
---
# Frontend: React 19 + Vite 7 + TypeScript 5.9 (npm)

- Scripts (run in `frontend/`): `npm run dev` (vite on :5173; over SSH use VS Code port forwarding), `npm run build` (`tsc -b && vite build` -> `dist/`, gitignored), `npm run lint` (eslint 9 flat config), typecheck only: `npx tsc --noEmit -p tsconfig.app.json` (clean).
- `npm run lint` is not a passing gate yet: about 34 existing problems (mostly `@typescript-eslint/no-explicit-any` plus one emoji regex in `src/components/ui/InteractiveTerminal/`). Don't add new ones; don't mass-fix unasked.
- The production build runs inside Docker (`npm ci` on node:22-alpine), so `package-lock.json` must stay in sync with `package.json`. Dependency changes (`npm install ...`) need Yurii's OK.
- Structure: `src/pages/*` compose `src/components/sections/*`; reusable widgets in `src/components/ui/*`; layout in `src/components/layout/*`. One CSS Module per component (`X/X.tsx` + `X/X.module.css`). Colours only through the CSS variables in `src/assets/styles/_variables.css`, with both `[data-theme="light"]` and `[data-theme="dark"]` variants. Font: Fira Code.
- Routes (react-router 7, `src/App.tsx`): `/` portfolio; `/community`, `/courses`, `/dashboard` are ComingSoon placeholders.
- API calls: none. The backend now only exposes an internal `GET /health`; there is no `/api/chat` or other business endpoint for the frontend to call.
- Dead files (don't extend): `community.html`, `courses.html`, `dashboard.html` (legacy multi-page entries), the 0-byte files in `public/`, `tmp/`, `generate_project_doc.py`, `show_docs_tree.sh`, `*.tsbuildinfo` at the frontend root.
