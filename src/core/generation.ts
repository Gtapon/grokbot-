import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { hasFfmpeg, runFfmpeg } from './ffmpeg.js';
import { hashFile } from './hash.js';

export interface GenerationResult {
  path: string;
  contentHash: string;
  durationSec: number;
  width: number;
  height: number;
  provider: string;
  note?: string;
}

export interface MockGenerationRequest {
  outPath: string;
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  color?: string;
  withTone?: boolean;
  label?: string;
}

/** Pluggable provider — swap for ComfyUI later */
export interface MockGenerationProvider {
  readonly name: string;
  generate(req: MockGenerationRequest): Promise<GenerationResult>;
}

/** Default: ffmpeg color bars (+ optional sine tone). Falls back to minimal placeholder MP4-like bytes. */
export class FfmpegMockGenerationProvider implements MockGenerationProvider {
  readonly name = 'ffmpeg-mock';

  async generate(req: MockGenerationRequest): Promise<GenerationResult> {
    const width = req.width ?? 1280;
    const height = req.height ?? 720;
    const fps = req.fps ?? 24;
    const duration = Math.max(0.5, req.durationSec);
    const color = req.color ?? 'blue';
    const dir = path.dirname(req.outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (!hasFfmpeg()) {
      // Minimal placeholder (not a real MP4) — documented in README
      const placeholder = Buffer.from(
        `YACHICUT_PLACEHOLDER\nlabel=${req.label ?? 'clip'}\nduration=${duration}\n` +
          `Install ffmpeg for real mock media.\n`,
      );
      writeFileSync(req.outPath, placeholder);
      return {
        path: req.outPath,
        contentHash: hashFile(req.outPath),
        durationSec: duration,
        width,
        height,
        provider: this.name,
        note: 'ffmpeg not found; wrote text placeholder file',
      };
    }

    const withTone = req.withTone !== false;
    const vf = `color=c=${color}:s=${width}x${height}:d=${duration}:r=${fps},drawtext=text='${(
      req.label ?? 'YachiCut'
    ).replace(/'/g, "\\'")}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`;

    const args = withTone
      ? [
          '-f',
          'lavfi',
          '-i',
          vf,
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=440:duration=${duration}`,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-shortest',
          '-t',
          String(duration),
          req.outPath,
        ]
      : [
          '-f',
          'lavfi',
          '-i',
          vf,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-t',
          String(duration),
          req.outPath,
        ];

    const { ok, stderr } = runFfmpeg(args);
    if (!ok) {
      // Fallback: silent color only without drawtext (fonts may be missing)
      const simple = [
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=${width}x${height}:d=${duration}:r=${fps}`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-t',
        String(duration),
        req.outPath,
      ];
      const r2 = runFfmpeg(simple);
      if (!r2.ok) {
        writeFileSync(
          req.outPath,
          Buffer.from(`YACHICUT_PLACEHOLDER_FFMPEG_FAIL\n${stderr}\n${r2.stderr}`),
        );
        return {
          path: req.outPath,
          contentHash: hashFile(req.outPath),
          durationSec: duration,
          width,
          height,
          provider: this.name,
          note: `ffmpeg failed; wrote placeholder. ${stderr.slice(0, 200)}`,
        };
      }
    }

    return {
      path: req.outPath,
      contentHash: hashFile(req.outPath),
      durationSec: duration,
      width,
      height,
      provider: this.name,
    };
  }
}

let defaultProvider: MockGenerationProvider = new FfmpegMockGenerationProvider();

export function getGenerationProvider(): MockGenerationProvider {
  return defaultProvider;
}

export function setGenerationProvider(p: MockGenerationProvider): void {
  defaultProvider = p;
}
