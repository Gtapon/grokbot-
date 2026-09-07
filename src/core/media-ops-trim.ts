import type { Project, Clip, Track, UpdateClipOptions, MoveClipOptions } from './types.js';

export function installTrimOps(proto: any): void {
  proto.updateClip = function (projectId: string, clipId: string, opts: UpdateClipOptions): Clip {
    const project = this.load(projectId);
    const { clip } = this.findClip(project, clipId);
    if (opts.inSec !== undefined) clip.inSec = Math.max(0, Number(opts.inSec));
    if (opts.outSec !== undefined) clip.outSec = Math.max(clip.inSec + 0.01, Number(opts.outSec));
    if (opts.startSec !== undefined) clip.startSec = Math.max(0, Number(opts.startSec));
    if (opts.label !== undefined) clip.label = opts.label;
    if (opts.decision !== undefined) clip.decision = opts.decision;
    if (clip.outSec <= clip.inSec) clip.outSec = clip.inSec + 0.01;
    this.save(project);
    return clip;
  };

  proto.moveClip = function (projectId: string, clipId: string, opts: MoveClipOptions = {}): Clip {
    const project = this.load(projectId);
    const found = this.findClip(project, clipId);
    let track = found.track;
    let index = found.index;
    const clip = found.clip;
    if (opts.trackId && opts.trackId !== track.id) {
      const dest = project.tracks.find((t: Track) => t.id === opts.trackId);
      if (!dest) throw new Error(`Track not found: ${opts.trackId}`);
      track.clips.splice(index, 1);
      const destIndex = opts.index !== undefined ? Math.max(0, Math.min(opts.index, dest.clips.length)) : dest.clips.length;
      clip.trackId = dest.id;
      dest.clips.splice(destIndex, 0, clip);
      this.repackStarts(dest);
      this.save(project);
      return clip;
    }
    const dir = opts.direction;
    if (dir === 'up' || dir === 'left') {
      if (index > 0) {
        const tmp = track.clips[index - 1];
        track.clips[index - 1] = clip;
        track.clips[index] = tmp;
      }
    } else if (dir === 'down' || dir === 'right') {
      if (index < track.clips.length - 1) {
        const tmp = track.clips[index + 1];
        track.clips[index + 1] = clip;
        track.clips[index] = tmp;
      }
    } else if (opts.index !== undefined) {
      const target = Math.max(0, Math.min(opts.index, track.clips.length - 1));
      if (target !== index) {
        track.clips.splice(index, 1);
        track.clips.splice(target, 0, clip);
      }
    }
    this.repackStarts(track);
    this.save(project);
    return clip;
  };

  proto.repackStarts = function (track: Track): void {
    let t = 0;
    for (const c of track.clips) {
      c.startSec = t;
      t += Math.max(0.01, c.outSec - c.inSec);
    }
  };
}
