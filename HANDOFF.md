# YachiCut MVP - Handoff for Next AI

**Date:** 2026-09-07 (JST)  
**Repo:** https://github.com/Gtapon/grokbot- (branch `main`)  
**Local (VM/box):** `/workspace/yachicut-mvp`  
**Local (PC):** `C:\\Users\\mitiy\\yachicut-mvp-pc`  
**PC package:** `/workspace/yachicut-mvp-pc.tar.gz`  
**Mirror copy of this doc:** `/workspace/HANDOFF.md`

This document is the single source of truth for the next agent taking over YachiCut MVP. Read it fully before changing code or poking live services.

---

## 1. User goals

Owner wants a **local, AI-operable video editor MVP** they can drive themselves:

1. **Own footage first** — import real user videos (not only mock/Comfy-generated clips).
2. **Manual edit** — trim in/out/start, reorder clips on the timeline, decide accept/reject.
3. **CLI + MCP + AI** — same operations via CLI, MCP tools, and light AI-edit that links footage → shot → clip (+ decision log), with ComfyUI when a real media-input workflow exists.
4. Stay **local / self-hosted** (box VM + Windows PC). No cloud NLE yet.

Success look: drag/import own MP4 → place/AI-edit → trim/reorder → export JSON + ffmpeg concat timeline.

---

## 2. What works vs what does not

### Works (verified / implemented)

| Area | Status |
|------|--------|
| Project CRUD, shots, mock `generate-clip`, accept/reject, status, export | OK |
| Generation providers: `mock` / `comfyui` / `auto` (`src/core/generation.ts`, `comfyui.ts`) | OK |
| `doctor` (ffmpeg/ffprobe + ComfyUI `/system_stats`) | OK |
| **Import media** CLI/API/UI (hash + optional ffprobe) | OK |
| **Trim / move** clips (`update-clip`, `move-clip`, UI trim panel + Up/Down) | OK |
| **AI edit with footage** — link media→shot, place clip, decision log; skips Comfy generate-from-media unless workflow `_yachicut.supportsMediaInput` | OK |
| MCP tools (core + media-tools) | OK |
| Web UI storyboard ↔ timeline ↔ preview sync, toasts, busy guards | OK (PRs #1, #3) |
| **Multipart FormData upload** (avoids Payload Too Large) | OK code in PR #4 — **retest UI import on PC** |
| ComfyUI CPU on VM listening **8188** | OK when process is up |
| E2E: VM local + PC via tunnel (**PcE2E**) | OK previously verified (see §7) |

### Does not / gaps

| Gap | Notes |
|-----|-------|
| Real **img2vid / vid2vid** Comfy generation from imported media | `workflows/comfyui-vid2vid-stub.json` has `supportsMediaInput: false`; AI-edit places footage as-is and logs skip reason |
| Default txt2img workflow | `workflows/comfyui-default.json` is a **placeholder**; needs user’s ComfyUI “Save (API Format)” + real checkpoint |
| `bun.lock` on GitHub | Often omitted due to API push size; use `npm install` (see `LOCKFILE.md`) |
| Public ComfyUI / app **tunnel** | Ephemeral (`loca.lt` / localtunnel / cloudflared). Old URL dies when tunnel process stops |
| NLE writers (Resolve / Premiere / CapCut) | Explicitly future |
| Auth / multi-user / cloud | Out of scope for MVP |
| Cursor Pro / Cloud Agents | **Not available** for this user — do not plan work that requires them (see §6) |
| UI import after PR #4 | Fix landed in repo; **re-run drag-drop import on PC** to confirm mid-size videos |

---

## 3. Pull requests #1–#4

All merged into `main` on https://github.com/Gtapon/grokbot-

| PR | URL | What it did |
|----|-----|-------------|
| **#1** | https://github.com/Gtapon/grokbot-/pull/1 | UI polish: storyboard ↔ timeline sync, preview empty/generating states, missing-shot list, error banner, operation feedback. Commit `db000dce…` |
| **#2** | https://github.com/Gtapon/grokbot-/pull/2 | **Feature:** import media, trim/reorder, AI edit with footage. Core `media-ops*`, API `media-routes`, CLI/MCP/UI `MediaBridge`, demo scripts, vid2vid stub workflow. Commit `a2243a7c…` |
| **#3** | https://github.com/Gtapon/grokbot-/pull/3 | UI fix: preview prefers selected media; shot/clip clears media selection; missing CSS (toast, empty, trim, dropzone…); import/Place/AI/trim busy guards. Commit `71680565…` |
| **#4** | https://github.com/Gtapon/grokbot-/pull/4 | **Fix Payload Too Large:** UI posts `FormData` multipart to `/import-media-upload` (no manual `Content-Type`); `express.json` limit raised to **512mb**; README large-file note. Commit `4b1d9bb0…` (HEAD at handoff time) |

---

## 4. Architecture paths

```
yachicut-mvp/
├── package.json          # scripts: start, dev, cli, mcp, demo, typecheck
├── vite.config.ts        # UI :5173, proxies /api → :8787
├── workflows/
│   ├── comfyui-default.json      # txt2img placeholder (+ _yachicut hints)
│   └── comfyui-vid2vid-stub.json # generate-from-media stub (supportsMediaInput: false)
├── scripts/
│   ├── demo.ts
│   └── demo-import-ai.ts
├── projects/             # runtime project store (gitignored content)
└── src/
    ├── core/
    │   ├── types.ts, paths.ts, hash.ts, ffmpeg.ts
    │   ├── generation.ts      # GenerationProvider + mock/comfyui/auto factory
    │   ├── comfyui.ts         # HTTP client: /system_stats, /prompt, /history, /view
    │   ├── project.ts         # ProjectStore (wires media-ops)
    │   ├── media-ops.ts       # barrel
    │   ├── media-ops-import.ts
    │   ├── media-ops-trim.ts
    │   └── media-ops-ai.ts    # aiEditWithMedia / suggestEdit + supportsMediaInput gate
    ├── server/
    │   ├── api.ts             # Express API :8787, json limit 512mb
    │   └── media-routes.ts    # import / upload / update-clip / move-clip / ai-edit
    ├── cli/index.ts           # commander CLI
    ├── mcp/
    │   ├── server.ts          # MCP stdio server
    │   └── media-tools.ts     # import/trim/AI MCP tools
    └── ui/
        ├── App.tsx
        ├── MediaBridge.tsx    # FormData multipart import + trim/AI UI
        ├── styles.css
        └── main.tsx
```

**Data model (high level):** Project → storyboard shots, tracks/clips, media assets (content hash), decisions, export under `projects/<id>/`.

**Generation env:**

```bash
GENERATION_PROVIDER=mock|comfyui|auto   # default mock
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_WORKFLOW=./workflows/comfyui-default.json
COMFYUI_TIMEOUT_MS=180000
COMFYUI_POLL_MS=1500
COMFYUI_NEGATIVE_PROMPT="blurry, low quality"
PORT=8787
```

---

## 5. PC environment

| Item | Value |
|------|-------|
| Path | `C:\\Users\\mitiy\\yachicut-mvp-pc` |
| Package manager | Prefer **`npm.cmd`** on Windows (avoid bare `npm` alias quirks in some agent shells) |
| Install | `npm.cmd install` |
| API | `npm.cmd run start` → **http://127.0.0.1:8787** |
| UI | `npm.cmd run dev` → **http://127.0.0.1:5173** (proxies `/api`) |
| CLI | `npm.cmd run cli -- doctor` etc. |
| Registered machine | Cursor machine label **APOponki** (user PC); use machine-targeted Shell when operating there |
| Sync from box | Rebuild/copy `yachicut-mvp-pc.tar.gz` or pull `main` from GitHub |

**Note:** After PR #4, ensure PC tree has multipart `MediaBridge` + `express.json({ limit: '512mb' })`. If PC README/API look older than GitHub `main`, pull or re-extract the tarball before UI import retest.

---

## 6. Constraint: No Cursor Pro / Cloud Agents

- User does **not** have Cursor Pro / Cloud Agents for this workflow.
- Do **not** spawn CloudAgent / remote coding agents as the primary implementation path.
- Work via: **box** (`/workspace`), **PC machine tools**, **user-Github MCP** (`create_or_update_file` / `push_files` / PRs), and local Shell.
- GitHub repo name is literally **`grokbot-`** (trailing hyphen). Owner **`Gtapon`**.

---

## 7. Verified E2Es

### VM (box)

- YachiCut API health + ffmpeg available.
- ComfyUI CPU on **8188** (`GET /system_stats` OK when server running under `/workspace/ComfyUI`).
- CLI/demo import → ai-edit → trim/reorder → export paths exercised.
- UI screenshots exist under `/workspace/demo-ui-*.png` from prior sessions.

### PC tunnel (**PcE2E**)

- PC tree at `C:\\Users\\mitiy\\yachicut-mvp-pc` with `node_modules` present.
- End-to-end exercised with API/UI on PC and (when needed) ephemeral tunnel to box ComfyUI.
- Tunnel URLs are **ephemeral** — example historical: `https://spotty-months-dig.loca.lt` (do not assume still live; restart tunnel and update `COMFYUI_URL` if remote Comfy is required).

### Payload Too Large

- Root cause: UI sent JSON base64 through `express.json` (base64 ~+33%).
- Fixed in **PR #4** (multipart FormData).
- **Next AI must retest:** drag/drop or pick a mid-size video in UI on PC after syncing `main`; expect success without 413 Payload Too Large.

---

## 8. ComfyUI on VM

| Item | Value |
|------|-------|
| Install | `/workspace/ComfyUI` |
| Mode | CPU |
| Port | **8188** (`http://127.0.0.1:8188`) |
| Tunnel | Ephemeral (localtunnel/cloudflared/loca.lt). Restart when dead; never hardcode stale public URL |
| Workflow for txt2img | Replace `workflows/comfyui-default.json` with real API export + checkpoint |
| Workflow for footage AI | Replace stub; set `_yachicut.supportsMediaInput: true` |

---

## 9. Next work list (priority)

1. **Retest UI import** on PC after PR #4 sync (mid-size MP4 drag-drop).
2. Sync PC tree to GitHub `main` if behind (or re-extract updated `yachicut-mvp-pc.tar.gz`).
3. User-provided **real ComfyUI workflows** (txt2img + optional img2vid/vid2vid) + checkpoints.
4. Flip `supportsMediaInput` and wire `generate-from-media` for true AI transform of own footage.
5. Harden multipart parser or adopt a small multer/busboy if edge-case browsers fail.
6. Optional: push `bun.lock` via chunked/`push_files` if desired; otherwise keep `npm install`.
7. Polish export (longer concat, audio track, NLE XML later).
8. Keep tunnels documented as ephemeral; prefer local `COMFYUI_URL` when PC and Comfy share LAN/VPN.

---

## 10. Commands cheat sheet

### Box / Linux

```bash
cd /workspace/yachicut-mvp
npm install          # or bun install
npm run start        # API :8787
npm run dev          # UI  :5173
npm run cli -- doctor
npm run cli -- create MyCut
npm run cli -- import-media -p <ID> -f ./clip.mp4
npm run cli -- ai-edit -p <ID> -m <MEDIA> --prompt "golden hour"
npm run cli -- update-clip -p <ID> -c <CLIP> --in 0.5 --out 2.5 --start 0
npm run cli -- move-clip -p <ID> -c <CLIP> --dir up
npm run cli -- export -p <ID>
npm run demo
npm run mcp          # stdio MCP
npm run typecheck

# ComfyUI
cd /workspace/ComfyUI && (venv) python main.py --cpu --listen 127.0.0.1 --port 8188
export GENERATION_PROVIDER=comfyui
export COMFYUI_URL=http://127.0.0.1:8188
```

### Windows PC

```bat
cd /d C:\\Users\\mitiy\\yachicut-mvp-pc
npm.cmd install
npm.cmd run start
npm.cmd run dev
npm.cmd run cli -- doctor
```

### GitHub (user-Github MCP)

- Owner: `Gtapon`, repo: `grokbot-`, branch: `main`
- Prefer `create_or_update_file` (need SHA for updates via `get_file_contents`) or `push_files` for multi-file commits.
- Open PRs with `create_pull_request`; merge with `merge_pull_request`.

### Rebuild PC tarball (from box)

```bash
cd /workspace/yachicut-mvp
tar czf /workspace/yachicut-mvp-pc.tar.gz \
  --exclude=node_modules --exclude=projects --exclude=dist \
  --exclude='.github_push_payload.json' --exclude='.push_a.json' \
  .
# Ensure HANDOFF.md is inside the tree before packing
```

---

## 11. Checklist for next AI

- [ ] Read this `HANDOFF.md` and current `README.md`
- [ ] Confirm GitHub `main` HEAD includes PR #4 (`MediaBridge` FormData + 512mb json)
- [ ] Confirm PC `C:\\Users\\mitiy\\yachicut-mvp-pc` matches `main` (or refresh from tarball)
- [ ] `npm.cmd run typecheck` / `npm run typecheck` clean
- [ ] `doctor` shows ffmpeg; ComfyUI ok only if needed
- [ ] **Retest UI import** (mid-size video) — no Payload Too Large
- [ ] Smoke: Place / AI edit / trim / Up-Down / export
- [ ] Do **not** rely on Cursor Cloud Agents
- [ ] Do **not** treat tunnel URLs as permanent
- [ ] Push changes via **user-Github MCP** to `Gtapon/grokbot-`
- [ ] Update this handoff when major state changes

---

## 12. Team roles（参謀 / 実装 / リサーチ）

Use these lanes so parallel agents do not collide:

| Role | 日本語 | Responsibility |
|------|--------|----------------|
| **参謀** | 参謀 | Prioritize, write/update handoffs, decide PR scope, verify E2E acceptance criteria, keep user goals aligned. Does not dump large unrelated refactors. |
| **実装** | 実装 | Code changes in `src/**`, workflows, demos; open focused PRs; typecheck; avoid rewriting working mock paths without need. |
| **リサーチ** | リサーチ | ComfyUI models/workflows, tunnel options, NLE export formats, deps; report findings back — do not silently merge speculative stacks into MVP. |

Handoff etiquette: 実装 lands code → 参謀 verifies against goals/E2E → リサーチ feeds next options into §9.

---

## 13. Quick reference URLs

- Repo: https://github.com/Gtapon/grokbot-
- PR #1: https://github.com/Gtapon/grokbot-/pull/1
- PR #2: https://github.com/Gtapon/grokbot-/pull/2
- PR #3: https://github.com/Gtapon/grokbot-/pull/3
- PR #4: https://github.com/Gtapon/grokbot-/pull/4
- This file on disk: `/workspace/yachicut-mvp/HANDOFF.md` and `/workspace/HANDOFF.md`

---

*End of handoff. Prefer updating this file in the same PR as behavioral changes.*
