import { spawnSync } from 'node:child_process';

let cached: boolean | null = null;

export function hasFfmpeg(): boolean {
  if (cached !== null) return cached;
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  cached = r.status === 0;
  return cached;
}

export function runFfmpeg(args: string[]): { ok: boolean; stderr: string } {
  const r = spawnSync('ffmpeg', ['-y', ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, stderr: (r.stderr || r.stdout || '').toString() };
}
