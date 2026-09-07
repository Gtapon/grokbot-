# YachiCut MVP

Local AI-operable video editor MVP (CLI + MCP + Web UI).

## Install

```bash
npm install
# or: bun install (bun.lock included)
```

`ffmpeg` is recommended for mock MP4 generation, still-image to video conversion (ComfyUI), and timeline concat.

## Features

- Shots, tracks, clips, decisions, content hashes
- Web UI, CLI, MCP
- Pluggable generation: **mock** (ffmpeg) / **ComfyUI** / **auto**
- Export JSON + concatenated timeline
- **Import user videos** (import-media / drag-drop / upload) with hash + ffprobe
- **Manual trim & reorder** on timeline clips (update-clip / move-clip)
- **AI edit with footage** (ai-edit / UI button) link+place+decision log; ComfyUI when workflow supports it

## Generation providers

Select with env:

| `GENERATION_PROVIDER` | Behavior |
|---|---|
| `mock` (default) | `FfmpegMockGenerationProvider` — color-bar MP4 (or text placeholder if no ffmpeg) |
| `comfyui` | `ComfyUIGenerationProvider` — local ComfyUI HTTP API. **Fails clearly** if unreachable (no silent fallback) |
| `auto` | Try ComfyUI, then fall back to mock on unreachable/error |

### Env vars

```bash
export GENERATION_PROVIDER=mock          # mock | comfyui | auto
export COMFYUI_URL=http://127.0.0.1:8188 # ComfyUI base URL
export COMFYUI_WORKFLOW=./workflows/comfyui-default.json
export COMFYUI_TIMEOUT_MS=180000         # poll timeout
export COMFYUI_POLL_MS=1500
export COMFYUI_NEGATIVE_PROMPT="blurry, low quality"
```

### Enable ComfyUI mode

1. Install and run [ComfyUI](https://github.com/comfyanonymous/ComfyUI) locally (default listen `127.0.0.1:8188`).
2. In the ComfyUI UI, build a text-to-image (or video) graph, then **Save (API Format)**.
3. Replace `workflows/comfyui-default.json` with that export (keep or update the `_yachicut` hints / `{{PROMPT}}` placeholders).
4. Point the checkpoint node at a model you actually have installed.
5. Run YachiCut with:

```bash
export GENERATION_PROVIDER=comfyui
export COMFYUI_URL=http://127.0.0.1:8188
npm run cli -- doctor          # should show comfyui.ok: true
npm run cli -- generate-clip -p <PROJECT_ID> -s <SHOT_ID> --prompt "cinematic ocean at dusk"
```

Or use `GENERATION_PROVIDER=auto` to prefer ComfyUI when up, else mock.

The provider:

- Health-checks `GET /system_stats`
- Submits workflow via `POST /prompt`
- Polls `GET /history/{prompt_id}` until done or timeout
- Downloads via `GET /view?...` into the project media store
- Converts still images to a short MP4 (via ffmpeg) so clips stay timeline-friendly

## Import / trim / AI

CLI import-media update-clip move-clip ai-edit suggest-edit. UI drag-drop trim AI button. ComfyUI when supportsMediaInput.

Large media files: prefer the UI drag-drop / file picker (multipart upload) or CLI `import-media -f path`. Avoid JSON base64 upload for big videos (base64 inflates ~33%).

## CLI

```bash
npm run cli -- doctor
npm run cli -- create MyCut
npm run cli -- add-shot -p ID -t Opening -d "wide shot of a harbor at dawn" --duration 2
npm run cli -- generate-clip -p ID -s SHOT
# optional: --prompt "..." --color blue (mock) --duration 3 --label "..."
npm run cli -- accept -p ID --shot SHOT
npm run cli -- status -p ID
npm run cli -- export -p ID
npm run demo
```

### `generate-clip`

Uses `getGenerationProvider()` (env-selected). Links media to the shot when `-s/--shot` is set, registers an asset under `projects/<id>/media/`, and appends a clip on the video track.

### `doctor`

Reports ffmpeg, projects root, active provider kind, `COMFYUI_URL`, workflow path, and ComfyUI `/system_stats` reachability.

## Run UI

```bash
npm run start   # API on :8787
npm run dev     # UI on :5173 (proxies /api)
```

## MCP

```bash
npm run mcp
```

Point your MCP client at `tsx src/mcp/server.ts` with cwd = this folder.

## Architecture notes

- Provider interface lives in `src/core/generation.ts` (`GenerationProvider`).
- `MockGenerationProvider` remains as a type alias for compatibility.
- Default fallback is always mock unless you explicitly set `comfyui` or `auto`.

## Future

NLE writers (Resolve/Premiere/CapCut), auth/cloud, richer video workflows.

## License

MIT
