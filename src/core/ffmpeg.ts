import { spawnSync } from 'node:child_process';

let cached: boolean | null = null;
let cachedProbe: boolean | null = null;

export function hasFfmpeg(): boolean {
  if (cached !== null) return cached;
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  cached = r.status === 0;
  return cached;
}

export function hasFfprobe(): boolean {
  if (cachedProbe !== null) return cachedProbe;
  const r = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
  cachedProbe = r.status === 0;
  return cachedProbe;
}

export function runFfmpeg(args: string[]): { ok: boolean; stderr: string } {
  const r = spawnSync('ffmpeg', ['-y', ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, stderr: (r.stderr || r.stdout || '').toString() };
}

export interface MediaProbe {
  durationSec?: number;
  width?: number;
  height?: number;
  note?: string;
}

/** Probe duration/width/height via ffprobe when available. */
export function probeMedia(filePath: string): MediaProbe {
  if (!hasFfprobe()) {
    return { note: 'ffprobe not available' };
  }
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    const r2 = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath],
      { encoding: 'utf8' },
    );
    if (r2.status !== 0) {
      return { note: `ffprobe failed: ${(r.stderr || '').toString().slice(0, 200)}` };
    }
    try {
      const j = JSON.parse(r2.stdout || '{}') as { format?: { duration?: string } };
      const d = Number(j.format?.duration);
      return Number.isFinite(d) ? { durationSec: d } : {};
    } catch {
      return { note: 'ffprobe parse failed' };
    }
  }
  try {
    const j = JSON.parse(r.stdout || '{}') as {
      streams?: { width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const stream = j.streams?.[0];
    const d = Number(j.format?.duration);
    return {
      durationSec: Number.isFinite(d) ? d : undefined,
      width: stream?.width,
      height: stream?.height,
    };
  } catch {
    return { note: 'ffprobe parse failed' };
  }
}
