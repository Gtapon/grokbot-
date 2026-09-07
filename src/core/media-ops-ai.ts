import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Project, Shot, Clip, Track, MediaAsset, AiEditWithMediaOptions } from './types.js';
import { REPO_ROOT } from './paths.js';
import { getGenerationProvider, resolveProviderKind } from './generation.js';

function id(): string { return randomUUID(); }

export function installAiOps(proto: any): void {
  proto.aiEditWithMedia = async function (projectId: string, opts: AiEditWithMediaOptions) {
    const project = this.load(projectId);
    const asset = project.assets.find((a: MediaAsset) => a.id === opts.mediaId);
    if (!asset) throw new Error(`Asset not found: ${opts.mediaId}`);
    let shot: Shot | undefined;
    if (opts.shotId) {
      shot = project.storyboard.find((s: Shot) => s.id === opts.shotId);
      if (!shot) throw new Error(`Shot not found: ${opts.shotId}`);
    } else {
      shot = {
        id: id(), index: project.storyboard.length,
        title: opts.shotTitle ?? asset.label ?? 'AI footage shot',
        description: opts.prompt, durationSec: asset.durationSec ?? 3, decision: 'pending',
      };
      project.storyboard.push(shot);
    }
    const prompt = opts.prompt ?? shot.aiPrompt ?? shot.description ?? asset.label ?? '';
    shot.aiPrompt = prompt || shot.aiPrompt;
    shot.mediaId = asset.id;
    if (prompt && !shot.description) shot.description = prompt;
    const place = opts.place !== false;
    let clip: Clip | undefined;
    if (place) {
      const inSec = opts.inSec ?? 0;
      const outSec = opts.outSec ?? asset.durationSec ?? shot.durationSec ?? 3;
      const track = project.tracks.find((t: Track) => t.id === opts.trackId)
        ?? project.tracks.find((t: Track) => t.kind === 'video') ?? project.tracks[0];
      if (!track) throw new Error('No tracks on project');
      let startSec = opts.startSec;
      if (startSec === undefined) {
        const ends = track.clips.map((c: Clip) => c.startSec + (c.outSec - c.inSec));
        startSec = ends.length ? Math.max(...ends) : 0;
      }
      clip = { id: id(), trackId: track.id, mediaId: asset.id, startSec, inSec, outSec,
        label: asset.label ?? shot.title, decision: 'pending' };
      track.clips.push(clip);
      shot.clipId = clip.id;
      shot.durationSec = Math.max(0.01, outSec - inSec);
    } else if (shot.clipId) {
      clip = this.findClip(project, shot.clipId).clip;
    }
    if (!clip) throw new Error('No clip placed; set place:true or provide an existing shot.clipId');
    const kind = resolveProviderKind();
    let generationAttempted = false;
    let generationSkippedReason: string | undefined;
    const tryGenerate = opts.tryGenerate !== false;
    if (tryGenerate && kind === 'comfyui') {
      const support = this.comfyMediaWorkflowSupport();
      if (support.supported) {
        generationAttempted = true;
        try {
          const provider = getGenerationProvider();
          const health = provider.healthCheck ? await provider.healthCheck() : { ok: false };
          if (!health.ok) {
            generationSkippedReason = `ComfyUI unreachable: ${health.detail ?? 'unknown'}`;
            generationAttempted = false;
          } else {
            generationSkippedReason = 'ComfyUI reachable but generate-from-media workflow hook is a stub (see workflows/comfyui-vid2vid-stub.json). Footage placed as-is.';
          }
        } catch (err) {
          generationSkippedReason = err instanceof Error ? err.message : String(err);
          generationAttempted = false;
        }
      } else {
        generationSkippedReason = support.reason ?? 'No media-input workflow configured; placed imported footage as-is';
      }
    } else if (tryGenerate) {
      generationSkippedReason = `GENERATION_PROVIDER=${kind} (not comfyui); placed imported footage as-is`;
    } else {
      generationSkippedReason = 'tryGenerate=false; placed imported footage as-is';
    }
    const decisionNote = [
      'AI edit with footage',
      prompt ? `prompt=${JSON.stringify(prompt)}` : 'prompt=(none)',
      `media=${asset.id}`, `clip=${clip.id}`,
      generationAttempted ? 'generation=attempted_stub' : 'generation=skipped',
      generationSkippedReason ? `detail=${generationSkippedReason}` : '',
    ].filter(Boolean).join(' | ');
    this.pushDecision(project, 'shot', shot.id, 'pending', decisionNote);
    this.save(project);
    return { shot, clip, asset, generationAttempted, generationSkippedReason, decisionNote };
  };

  proto.suggestEdit = function (projectId: string, opts: { mediaIds?: string[]; prompt?: string; maxClips?: number } = {}) {
    const project = this.load(projectId);
    let assets = project.assets.slice();
    if (opts.mediaIds?.length) {
      const set = new Set(opts.mediaIds);
      assets = assets.filter((a: MediaAsset) => set.has(a.id));
    } else {
      assets = assets.filter((a: MediaAsset) => a.kind === 'video' || a.kind === 'image');
    }
    assets = assets.slice(0, opts.maxClips ?? assets.length);
    const clips: Clip[] = [];
    const shots: Shot[] = [];
    const track = project.tracks.find((t: Track) => t.kind === 'video') ?? project.tracks[0];
    if (!track) throw new Error('No tracks on project');
    let startSec = track.clips.length ? Math.max(...track.clips.map((c: Clip) => c.startSec + (c.outSec - c.inSec))) : 0;
    for (const asset of assets) {
      const duration = asset.durationSec ?? 3;
      const shot: Shot = {
        id: id(), index: project.storyboard.length,
        title: asset.label ?? `Shot ${project.storyboard.length + 1}`,
        description: opts.prompt, durationSec: duration, mediaId: asset.id,
        decision: 'pending', aiPrompt: opts.prompt,
      };
      const clip: Clip = {
        id: id(), trackId: track.id, mediaId: asset.id, startSec,
        inSec: 0, outSec: duration, label: asset.label, decision: 'pending',
      };
      shot.clipId = clip.id;
      project.storyboard.push(shot);
      track.clips.push(clip);
      shots.push(shot); clips.push(clip);
      startSec += duration;
    }
    const note = `suggest-edit: placed ${clips.length} clip(s)` + (opts.prompt ? ` prompt=${JSON.stringify(opts.prompt)}` : '');
    if (shots[0]) this.pushDecision(project, 'shot', shots[0].id, 'pending', note);
    this.save(project);
    return { clips, shots, note };
  };

  proto.comfyMediaWorkflowSupport = function (): { supported: boolean; reason?: string } {
    try {
      const stubPath = path.join(REPO_ROOT, 'workflows/comfyui-vid2vid-stub.json');
      const wfPath = process.env.COMFYUI_MEDIA_WORKFLOW ?? stubPath;
      if (!existsSync(wfPath)) {
        return { supported: false, reason: 'Media workflow file missing; set COMFYUI_MEDIA_WORKFLOW or add workflows/comfyui-vid2vid-stub.json' };
      }
      const j = JSON.parse(readFileSync(wfPath, 'utf8')) as { _yachicut?: { supportsMediaInput?: boolean } };
      if (j._yachicut?.supportsMediaInput) return { supported: true };
      return { supported: false, reason: 'Workflow _yachicut.supportsMediaInput is false/absent (stub documents img2vid/vid2vid hook)' };
    } catch (err) {
      return { supported: false, reason: err instanceof Error ? err.message : String(err) };
    }
  };
}
