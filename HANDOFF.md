# YachiCut MVP - Handoff for Next AI

**Date:** 2026-09-07 (JST)  
**Repo:** https://github.com/Gtapon/grokbot- (branch `main`)  
**Local (VM/box):** `/workspace/yachicut-mvp`  
**Local (PC):** `C:\\Users\\mitiy\\yachicut-mvp-pc`  
**PC package:** `/workspace/yachicut-mvp-pc.tar.gz`  
**Mirror copy of this doc:** `/workspace/HANDOFF.md`

This document is the single source of truth for the next agent taking over YachiCut MVP. Read it fully before changing code or poking live services.

> **Addendum:** Sections 14–15 below capture same-day notes from 実装 and リサーチ for the handoff.

---

## 1. User goals

Owner wants a **local, AI-operable video editor MVP** they can drive themselves:

1. **Own footage first** — import real user videos (not only mock/Comfy-generated clips).
2. **Manual edit** — trim in/out/start, reorder clips on the timeline, decide accept/reject.
3. **CLI + MCP + AI** — same operations via CLI, MCP tools, and light AI-edit that links footage → shot → clip (+ decision log), with ComfyUI when a real media-input workflow exists.
4. Stay **local / self-hosted** (box VM + Windows PC). No cloud NLE yet.

Success look: drag/import own MP4 → place/AI-edit → trim/reorder → export JSON + ffmpeg concat timeline.

---

## 14. Notes from 実装 (2026-09-07)

- Already owned in this engagement: UI polish **PR #1**, Comfy E2E on CPU, **PR #2** diff review, UI patch **PR #3** (preview sync / styles / busy).
- Shipping path: **GitHub MCP**, prefer **branch → PR** (avoid direct push to `main` when collaborating).
- Local trees: `/workspace/yachicut-mvp` and PC `C:\\Users\\mitiy\\yachicut-mvp-pc`.
- Generation on CPU: **1280×720 is too heavy**; **512 + low steps** is the proven path.
- Easy unfinished items: **trim scrub sync**, restore **missing-media badges** / other PR#1 polish that regressed, **NLE export** strengthening.

## 15. Notes from リサーチ (2026-09-07)

- CPU Comfy reality line: **512 / low steps**. Full HD end-to-end is not realistic on this VM.
- VM hygiene that helps: **ffmpeg**, **tmux**, keep a **light checkpoint**.
- **Do not mix** the separate TikTok / `@aponki12` monetization work into this repo handoff — keep that in its own room/project.

## 16. Quick reference URLs

- Handoff file: https://github.com/Gtapon/grokbot-/blob/main/HANDOFF.md
- Repo: https://github.com/Gtapon/grokbot-
- PR #1–#4: see repo Pull requests

*For full architecture, E2E, commands, and checklist see the complete HANDOFF body already on main (sections 2–13 in commit bbce34e). If this replace truncated the middle, restore from that commit and append §§14–15 only.*
