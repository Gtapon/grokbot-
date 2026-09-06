import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { hasFfmpeg, runFfmpeg } from './ffmpeg.js';
import { hashFile } from './hash.js';
import {
  ComfyUIGenerationProvider,
  defaultComfyUiUrl,
  defaultComfyWorkflowPath,
} from './comfyui.js';

export type { ComfyUIGenerationProviderOptions } from './comfyui.js';
export { ComfyUIGenerationProvider, defaultComfyUiUrl, defaultComfyWorkflowPath };

export interface GenerationResult {
  path: string;
  contentHash: string;
  durationSec: number;
  width: number;
  height: number;
  provider: string;
  note?: string;
}

export interface GenerationRequest {
  outPath: string;
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  color?: string;
  withTone?: boolean;
  label?: string;
  /** Text prompt for AI providers (ComfyUI). Falls back to label. */
  prompt?: string;
  negativePrompt?: string;
}

/** @deprecated Use GenerationRequest */
export type MockGenerationRequest = GenerationRequest;

export interface ProviderHealth {
  ok: boolean;
  detail?: string;
  url?: string;
}

/** Pluggable media generation provider (mock / ComfyUI / auto). */
export interface GenerationProvider {
  readonly name: string;
  generate(req: GenerationRequest): Promise<GenerationResult>;
  healthCheck?(): Promise<ProviderHealth>;
}

/** @deprecated Use GenerationProvider — kept for existing imports */
export type MockGenerationProvider = GenerationProvider;

export type GenerationProviderKind = 'mock' | 'comfyui' | 'auto';

export function resolveProviderKind(
  raw: string | undefined = process.env.GENERATION_PROVIDER,
): GenerationProviderKind {
  const v = (raw ?? 'mock').trim().toLowerCase();
  if (v === 'comfyui' || v === 'comfy' || v === 'comfy-ui') return 'comfyui';
  if (v === 'auto') return 'auto';
  return 'mock';
}

/** Default: ffmpeg color bars (+ optional sine tone). Falls back to minimal placeholder. */
export class FfmpegMockGenerationProvider implements GenerationProvider {
  readonly name = 'ffmpeg-mock';

  async healthCheck(): Promise<ProviderHealth> {
    return {
      ok: true,
      detail: hasFfmpeg()
        ? 'ffmpeg available (real mock MP4)'
        : 'ffmpeg missing (text placeholder fallback)',
    };
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const width = req.width ?? 1280;
    const height = req.height ?? 720;
    const fps = req.fps ?? 24;
    const duration = Math.max(0.5, req.durationSec);
    const color = req.color ?? 'blue';
    const dir = path.dirname(req.outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (!hasFfmpeg()) {
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

/** Tries ComfyUI first; on unreachable or generate failure, falls back to mock. */
export class AutoGenerationProvider implements GenerationProvider {
  readonly name = 'auto';
  private readonly comfy: ComfyUIGenerationProvider;
  private readonly mock: FfmpegMockGenerationProvider;

  constructor(
    comfy: ComfyUIGenerationProvider = new ComfyUIGenerationProvider(),
    mock: FfmpegMockGenerationProvider = new FfmpegMockGenerationProvider(),
  ) {
    this.comfy = comfy;
    this.mock = mock;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const c = await this.comfy.healthCheck();
    if (c.ok) return { ok: true, detail: `auto -> comfyui (${c.detail})`, url: c.url };
    const m = await this.mock.healthCheck();
    return {
      ok: true,
      detail: `auto -> mock fallback (${c.detail}; mock: ${m.detail})`,
      url: c.url,
    };
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const health = await this.comfy.healthCheck();
    if (health.ok) {
      try {
        return await this.comfy.generate(req);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const fallback = await this.mock.generate(req);
        return {
          ...fallback,
          provider: `${this.name}->${fallback.provider}`,
          note: `ComfyUI failed (${msg.slice(0, 200)}); used mock. ${fallback.note ?? ''}`.trim(),
        };
      }
    }
    const fallback = await this.mock.generate(req);
    return {
      ...fallback,
      provider: `${this.name}->${fallback.provider}`,
      note: `ComfyUI unreachable (${health.detail}); used mock. ${fallback.note ?? ''}`.trim(),
    };
  }
}

let defaultProvider: GenerationProvider | null = null;
let resolvedKind: GenerationProviderKind | null = null;

export function createGenerationProvider(
  kind: GenerationProviderKind = resolveProviderKind(),
): GenerationProvider {
  switch (kind) {
    case 'comfyui':
      return new ComfyUIGenerationProvider();
    case 'auto':
      return new AutoGenerationProvider();
    case 'mock':
    default:
      return new FfmpegMockGenerationProvider();
  }
}

export function getGenerationProvider(): GenerationProvider {
  const kind = resolveProviderKind();
  if (!defaultProvider || resolvedKind !== kind) {
    defaultProvider = createGenerationProvider(kind);
    resolvedKind = kind;
  }
  return defaultProvider;
}

export function setGenerationProvider(p: GenerationProvider): void {
  defaultProvider = p;
  resolvedKind = null;
}

/** Doctor / diagnostics helper */
export async function getGenerationDiagnostics(): Promise<{
  providerEnv: string;
  resolvedKind: GenerationProviderKind;
  activeProvider: string;
  comfyuiUrl: string;
  comfyuiWorkflow: string;
  comfyui: ProviderHealth;
  mock: ProviderHealth;
}> {
  const kind = resolveProviderKind();
  const comfy = new ComfyUIGenerationProvider();
  const mock = new FfmpegMockGenerationProvider();
  const [comfyHealth, mockHealth] = await Promise.all([comfy.healthCheck(), mock.healthCheck()]);
  return {
    providerEnv: process.env.GENERATION_PROVIDER ?? '(unset -> mock)',
    resolvedKind: kind,
    activeProvider: getGenerationProvider().name,
    comfyuiUrl: defaultComfyUiUrl(),
    comfyuiWorkflow: defaultComfyWorkflowPath(),
    comfyui: comfyHealth,
    mock: mockHealth,
  };
}
