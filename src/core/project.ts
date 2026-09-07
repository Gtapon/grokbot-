import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Project,
  ProjectStatus,
  Shot,
  Clip,
  Track,
  MediaAsset,
  Decision,
  DecisionEntry,
  GenerateClipOptions,
  ImportMediaOptions,
  UpdateClipOptions,
  MoveClipOptions,
  AiEditWithMediaOptions,
} from './types.js';
import {
  DEFAULT_PROJECTS_DIR,
  projectDir,
  projectJsonPath,
  mediaDir,
  exportDir,
} from './paths.js';
import { getGenerationProvider } from './generation.js';
import { hasFfmpeg, runFfmpeg } from './ffmpeg.js';
import { installMediaOps } from './media-ops.js';

export interface ProjectStoreOptions {
  projectsRoot?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function id(): string {
  return randomUUID();
}

export interface ProjectStore {
  importMedia(projectId: string, opts: ImportMediaOptions): MediaAsset;
  importMediaBuffer(
    projectId: string,
    input: { filename: string; data: Buffer; label?: string },
  ): MediaAsset;
  updateClip(projectId: string, clipId: string, opts: UpdateClipOptions): Clip;
  moveClip(projectId: string, clipId: string, opts?: MoveClipOptions): Clip;
  aiEditWithMedia(
    projectId: string,
    opts: AiEditWithMediaOptions,
  ): Promise<{
    shot: Shot;
    clip: Clip;
    asset: MediaAsset;
    generationAttempted: boolean;
    generationSkippedReason?: string;
    decisionNote: string;
  }>;
  suggestEdit(
    projectId: string,
    opts?: { mediaIds?: string[]; prompt?: string; maxClips?: number },
  ): { clips: Clip[]; shots: Shot[]; note: string };
}

export class ProjectStore {
  readonly projectsRoot: string;
  constructor(opts: ProjectStoreOptions = {}) {
    this.projectsRoot = opts.projectsRoot ?? DEFAULT_PROJECTS_DIR;
    if (!existsSync(this.projectsRoot)) {
      mkdirSync(this.projectsRoot, { recursive: true });
    }
  }

  listProjects(): { id: string; name: string; updatedAt: string }[] {
    if (!existsSync(this.projectsRoot)) return [];
    return readdirSync(this.projectsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const p = this.tryLoad(d.name);
        if (!p) return null;
        return { id: p.meta.id, name: p.meta.name, updatedAt: p.meta.updatedAt };
      })
      .filter(Boolean) as { id: string; name: string; updatedAt: string }[];
  }

  tryLoad(projectId: string): Project | null {
    const fp = projectJsonPath(this.projectsRoot, projectId);
    if (!existsSync(fp)) return null;
    return JSON.parse(readFileSync(fp, 'utf8')) as Project;
  }

  load(projectId: string): Project {
    const p = this.tryLoad(projectId);
    if (!p) throw new Error(`Project not found: ${projectId}`);
    return p;
  }

  save(project: Project): void {
    project.meta.updatedAt = nowIso();
    mkdirSync(mediaDir(this.projectsRoot, project.meta.id), { recursive: true });
    writeFileSync(
      projectJsonPath(this.projectsRoot, project.meta.id),
      JSON.stringify(project, null, 2),
      'utf8',
    );
  }

  createProject(name: string, opts?: { width?: number; height?: number; fps?: number }): Project {
    const projectId = id();
    const videoTrack: Track = { id: id(), name: 'V1', kind: 'video', clips: [] };
    const audioTrack: Track = { id: id(), name: 'A1', kind: 'audio', clips: [] };
    const project: Project = {
      meta: {
        id: projectId, name, createdAt: nowIso(), updatedAt: nowIso(),
        fps: opts?.fps ?? 24, width: opts?.width ?? 1280, height: opts?.height ?? 720,
        rootDir: projectDir(this.projectsRoot, projectId),
      },
      storyboard: [], tracks: [videoTrack, audioTrack], assets: [], decisions: [],
    };
    this.save(project);
    return project;
  }

  addShot(projectId: string, input: { title: string; description?: string; durationSec?: number }): Shot {
    const project = this.load(projectId);
    const shot: Shot = {
      id: id(), index: project.storyboard.length, title: input.title,
      description: input.description, durationSec: input.durationSec ?? 3, decision: 'pending',
    };
    project.storyboard.push(shot);
    this.save(project);
    return shot;
  }

  pushDecision(
    project: Project, targetType: 'shot' | 'clip' | 'media', targetId: string, decision: Decision, note?: string,
  ): DecisionEntry {
    const entry: DecisionEntry = { id: id(), at: nowIso(), targetType, targetId, decision, note };
    project.decisions.push(entry);
    return entry;
  }

  decideShot(projectId: string, shotId: string, decision: Decision, note?: string): Shot {
    const project = this.load(projectId);
    const shot = project.storyboard.find((s) => s.id === shotId);
    if (!shot) throw new Error(`Shot not found: ${shotId}`);
    shot.decision = decision;
    this.pushDecision(project, 'shot', shotId, decision, note);
    this.save(project);
    return shot;
  }

  decideClip(projectId: string, clipId: string, decision: Decision, note?: string): Clip {
    const project = this.load(projectId);
    let found: Clip | undefined;
    for (const t of project.tracks) {
      found = t.clips.find((c) => c.id === clipId);
      if (found) break;
    }
    if (!found) throw new Error(`Clip not found: ${clipId}`);
    found.decision = decision;
    this.pushDecision(project, 'clip', clipId, decision, note);
    this.save(project);
    return found;
  }

  placeClip(projectId: string, input: {
    mediaId: string; trackId?: string; startSec?: number; inSec?: number; outSec?: number; label?: string; shotId?: string;
  }): Clip {
    const project = this.load(projectId);
    const asset = project.assets.find((a) => a.id === input.mediaId);
    if (!asset) throw new Error(`Asset not found: ${input.mediaId}`);
    const track = project.tracks.find((t) => t.id === input.trackId)
      ?? project.tracks.find((t) => t.kind === 'video') ?? project.tracks[0];
    if (!track) throw new Error('No tracks on project');
    const inSec = input.inSec ?? 0;
    const outSec = input.outSec ?? asset.durationSec ?? 3;
    let startSec = input.startSec;
    if (startSec === undefined) {
      const ends = track.clips.map((c) => c.startSec + (c.outSec - c.inSec));
      startSec = ends.length ? Math.max(...ends) : 0;
    }
    const clip: Clip = {
      id: id(), trackId: track.id, mediaId: input.mediaId, startSec, inSec, outSec,
      label: input.label ?? asset.label, decision: 'pending',
    };
    track.clips.push(clip);
    if (input.shotId) {
      const shot = project.storyboard.find((s) => s.id === input.shotId);
      if (shot) { shot.mediaId = input.mediaId; shot.clipId = clip.id; }
    }
    this.save(project);
    return clip;
  }

  async generateClip(projectId: string, opts: GenerateClipOptions = {}): Promise<{ asset: MediaAsset; clip: Clip; shot?: Shot }> {
    const project = this.load(projectId);
    let shot: Shot | undefined;
    if (opts.shotId) {
      shot = project.storyboard.find((s) => s.id === opts.shotId);
      if (!shot) throw new Error(`Shot not found: ${opts.shotId}`);
    }
    const duration = opts.durationSec ?? shot?.durationSec ?? 3;
    const label = opts.label ?? shot?.title ?? 'clip';
    const prompt = opts.prompt ?? shot?.description ?? shot?.title ?? label;
    const colors = ['blue', 'red', 'green', 'purple', 'orange', 'teal'];
    const color = opts.color ?? colors[(shot?.index ?? project.assets.length) % colors.length];
    const mdir = mediaDir(this.projectsRoot, projectId);
    mkdirSync(mdir, { recursive: true });
    const filename = `gen_${Date.now()}_${(shot?.index ?? project.assets.length)}.mp4`;
    const outPath = path.join(mdir, filename);
    const provider = getGenerationProvider();
    const result = await provider.generate({
      outPath, durationSec: duration, width: project.meta.width, height: project.meta.height,
      fps: project.meta.fps, color, withTone: opts.withTone !== false, label, prompt,
      negativePrompt: opts.negativePrompt,
    });
    const asset: MediaAsset = {
      id: id(), path: outPath, kind: 'video', contentHash: result.contentHash,
      durationSec: result.durationSec, width: result.width, height: result.height,
      createdAt: nowIso(), label,
    };
    project.assets.push(asset);
    const track = project.tracks.find((t) => t.kind === 'video') ?? project.tracks[0];
    const ends = track.clips.map((c) => c.startSec + (c.outSec - c.inSec));
    const startSec = ends.length ? Math.max(...ends) : 0;
    const clip: Clip = {
      id: id(), trackId: track.id, mediaId: asset.id, startSec, inSec: 0,
      outSec: result.durationSec, label, decision: 'pending',
    };
    track.clips.push(clip);
    if (shot) { shot.mediaId = asset.id; shot.clipId = clip.id; }
    this.save(project);
    return { asset, clip, shot };
  }

  status(projectId: string): ProjectStatus {
    const project = this.load(projectId);
    const totalShots = project.storyboard.length;
    const acceptedShots = project.storyboard.filter((s) => s.decision === 'accepted').length;
    const rejectedShots = project.storyboard.filter((s) => s.decision === 'rejected').length;
    const pendingShots = project.storyboard.filter((s) => s.decision === 'pending').length;
    const missingMediaShots = project.storyboard.filter((s) => !s.mediaId).length;
    const decided = acceptedShots + rejectedShots;
    const completionPct = totalShots === 0 ? 0 : Math.round((decided / totalShots) * 1000) / 10;
    const totalClips = project.tracks.reduce((n, t) => n + t.clips.length, 0);
    return {
      projectId: project.meta.id, name: project.meta.name, totalShots, acceptedShots,
      rejectedShots, pendingShots, missingMediaShots, completionPct, totalClips,
      assetCount: project.assets.length,
    };
  }

  async exportProject(projectId: string): Promise<{ exportDir: string; projectJson: string; mediaPath?: string; note?: string }> {
    const project = this.load(projectId);
    const outDir = exportDir(this.projectsRoot, projectId);
    mkdirSync(outDir, { recursive: true });
    const projectJson = path.join(outDir, 'project.json');
    writeFileSync(projectJson, JSON.stringify(project, null, 2), 'utf8');
    const exportMedia = path.join(outDir, 'media');
    mkdirSync(exportMedia, { recursive: true });
    for (const a of project.assets) {
      if (existsSync(a.path)) copyFileSync(a.path, path.join(exportMedia, path.basename(a.path)));
    }
    const videoTrack = project.tracks.find((t) => t.kind === 'video');
    const clips = (videoTrack?.clips ?? []).filter((c) => c.decision !== 'rejected').sort((a, b) => a.startSec - b.startSec);
    let mediaPath: string | undefined;
    let note: string | undefined;
    if (clips.length === 0) {
      note = 'No non-rejected clips to concatenate';
    } else if (!hasFfmpeg()) {
      note = 'ffmpeg not available; exported project JSON + media copies only';
    } else {
      const listFile = path.join(outDir, 'concat.txt');
      const lines: string[] = [];
      for (const c of clips) {
        const asset = project.assets.find((a) => a.id === c.mediaId);
        if (!asset || !existsSync(asset.path)) continue;
        const p = asset.path.replace(/'/g, "'\\''");
        lines.push(`file '${p}'`);
      }
      if (lines.length === 0) {
        note = 'Clip media files missing; JSON-only export';
      } else {
        writeFileSync(listFile, lines.join('\n') + '\n', 'utf8');
        mediaPath = path.join(outDir, 'timeline.mp4');
        const r = runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', mediaPath]);
        if (!r.ok) {
          const r2 = runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mediaPath]);
          if (!r2.ok) { mediaPath = undefined; note = `concat failed: ${r2.stderr.slice(0, 300)}`; }
        }
      }
    }
    writeFileSync(path.join(outDir, 'export-manifest.json'), JSON.stringify({
      format: 'yachicut-mvp-export-v1', projectId, exportedAt: nowIso(),
      timelineMedia: mediaPath ? path.basename(mediaPath) : null,
      futureTargets: ['DaVinci Resolve', 'Adobe Premiere', 'CapCut'], note,
    }, null, 2), 'utf8');
    return { exportDir: outDir, projectJson, mediaPath, note };
  }
}

installMediaOps(ProjectStore);

export function getDefaultStore(): ProjectStore {
  return new ProjectStore();
}
