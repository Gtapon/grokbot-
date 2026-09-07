import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  Project, Shot, Clip, Track, MediaAsset,
  ImportMediaOptions, UpdateClipOptions, MoveClipOptions, AiEditWithMediaOptions,
} from './types.js';
import { REPO_ROOT, mediaDir } from './paths.js';
import { hashFile } from './hash.js';
import { getGenerationProvider, resolveProviderKind } from './generation.js';
import { probeMedia } from './ffmpeg.js';

function nowIso(): string { return new Date().toISOString(); }
function id(): string { return randomUUID(); }

export function installImportOps(proto: any): void {
  proto.findClip = function (project: Project, clipId: string) {
    for (const track of project.tracks) {
      const index = track.clips.findIndex((c: Clip) => c.id === clipId);
      if (index >= 0) return { track, clip: track.clips[index], index };
    }
    throw new Error(`Clip not found: ${clipId}`);
  };
  proto.guessKind = function (filePath: string): MediaAsset['kind'] {
    const ext = path.extname(filePath).toLowerCase();
    if (['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'].includes(ext)) return 'video';
    if (['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg'].includes(ext)) return 'audio';
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'image';
    return 'other';
  };
  proto.importMedia = function (projectId: string, opts: ImportMediaOptions): MediaAsset {
    const project = this.load(projectId);
    const src = path.resolve(opts.filePath);
    if (!existsSync(src)) throw new Error(`File not found: ${src}`);
    const contentHash = hashFile(src);
    if (opts.dedupe !== false) {
      const existing = project.assets.find((a: MediaAsset) => a.contentHash === contentHash);
      if (existing) return existing;
    }
    const mdir = mediaDir(this.projectsRoot, projectId);
    mkdirSync(mdir, { recursive: true });
    const base = path.basename(src);
    const safe = base.replace(/[^\w.\-()+ ]+/g, '_');
    const filename = `import_${Date.now()}_${safe}`;
    const dest = path.join(mdir, filename);
    copyFileSync(src, dest);
    const probe = probeMedia(dest);
    const asset: MediaAsset = {
      id: id(), path: dest, kind: this.guessKind(src), contentHash,
      durationSec: probe.durationSec, width: probe.width, height: probe.height,
      createdAt: nowIso(), label: opts.label ?? path.parse(base).name, sourcePath: src,
    };
    project.assets.push(asset);
    this.save(project);
    return asset;
  };
  proto.importMediaBuffer = function (projectId: string, input: { filename: string; data: Buffer; label?: string }): MediaAsset {
    const project = this.load(projectId);
    const mdir = mediaDir(this.projectsRoot, projectId);
    mkdirSync(mdir, { recursive: true });
    const safe = path.basename(input.filename).replace(/[^\w.\-()+ ]+/g, '_');
    const dest = path.join(mdir, `import_${Date.now()}_${safe}`);
    writeFileSync(dest, input.data);
    const contentHash = hashFile(dest);
    const existing = project.assets.find((a: MediaAsset) => a.contentHash === contentHash);
    if (existing) return existing;
    const probe = probeMedia(dest);
    const asset: MediaAsset = {
      id: id(), path: dest, kind: this.guessKind(dest), contentHash,
      durationSec: probe.durationSec, width: probe.width, height: probe.height,
      createdAt: nowIso(), label: input.label ?? path.parse(safe).name,
    };
    project.assets.push(asset);
    this.save(project);
    return asset;
  };
}
