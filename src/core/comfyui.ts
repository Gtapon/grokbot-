import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hasFfmpeg, runFfmpeg } from './ffmpeg.js';
import { hashFile } from './hash.js';
import { REPO_ROOT } from './paths.js';
import type {
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
  ProviderHealth,
} from './generation.js';

export function defaultComfyUiUrl(): string {
  return (process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188').replace(/\/$/, '');
}

export function defaultComfyWorkflowPath(): string {
  return (
    process.env.COMFYUI_WORKFLOW ??
    path.join(REPO_ROOT, 'workflows', 'comfyui-default.json')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type ComfyWorkflowNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: { title?: string };
};

type ComfyYachicutMeta = {
  description?: string;
  promptNodeId?: string;
  promptInput?: string;
  negativeNodeId?: string;
  negativeInput?: string;
  widthNodeId?: string;
  heightNodeId?: string;
  seedNodeId?: string;
  seedInput?: string;
};

type ComfyWorkflowFile = {
  /** Optional YachiCut hints (stripped before submit) */
  _yachicut?: ComfyYachicutMeta;
  [nodeId: string]: ComfyWorkflowNode | ComfyYachicutMeta | undefined;
};

type ComfyHistoryOutputs = Record<
  string,
  {
    images?: { filename: string; subfolder?: string; type?: string }[];
    gifs?: { filename: string; subfolder?: string; type?: string }[];
    videos?: { filename: string; subfolder?: string; type?: string }[];
  }
>;

export interface ComfyUIGenerationProviderOptions {
  baseUrl?: string;
  workflowPath?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  clientId?: string;
}

/**
 * Talks to a local ComfyUI HTTP API.
 * Expects an API-format workflow JSON (see workflows/comfyui-default.json).
 * Users should export their own workflow from ComfyUI (Save (API Format)) and replace the template.
 */
export class ComfyUIGenerationProvider implements GenerationProvider {
  readonly name = 'comfyui';
  readonly baseUrl: string;
  readonly workflowPath: string;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly clientId: string;

  constructor(opts: ComfyUIGenerationProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? defaultComfyUiUrl()).replace(/\/$/, '');
    this.workflowPath = opts.workflowPath ?? defaultComfyWorkflowPath();
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.COMFYUI_TIMEOUT_MS ?? 180_000);
    this.pollIntervalMs = opts.pollIntervalMs ?? Number(process.env.COMFYUI_POLL_MS ?? 1500);
    this.clientId = opts.clientId ?? randomUUID();
  }

  async healthCheck(): Promise<ProviderHealth> {
    const url = `${this.baseUrl}/system_stats`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        return {
          ok: false,
          url: this.baseUrl,
          detail: `GET /system_stats -> HTTP ${res.status}`,
        };
      }
      const body = (await res.json().catch(() => null)) as {
        system?: { comfyui_version?: string };
      } | null;
      const ver = body?.system?.comfyui_version;
      return {
        ok: true,
        url: this.baseUrl,
        detail: ver ? `reachable (ComfyUI ${ver})` : 'reachable (/system_stats ok)',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        url: this.baseUrl,
        detail: `unreachable: ${msg}`,
      };
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const health = await this.healthCheck();
    if (!health.ok) {
      throw new Error(
        `ComfyUI unreachable at ${this.baseUrl} (${health.detail}). ` +
          `Start ComfyUI or set GENERATION_PROVIDER=mock|auto. See README.`,
      );
    }

    const width = req.width ?? 1280;
    const height = req.height ?? 720;
    const duration = Math.max(0.5, req.durationSec);
    const fps = req.fps ?? 24;
    const promptText =
      (req.prompt ?? req.label ?? 'YachiCut clip').trim() || 'YachiCut clip';
    const negative =
      req.negativePrompt ??
      process.env.COMFYUI_NEGATIVE_PROMPT ??
      'blurry, low quality, watermark, text';

    const dir = path.dirname(req.outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const workflow = this.loadAndPrepareWorkflow({
      prompt: promptText,
      negative,
      width,
      height,
      seed: Math.floor(Math.random() * 2 ** 31),
    });

    const promptId = await this.submitPrompt(workflow);
    const outputs = await this.pollUntilDone(promptId);
    const media = await this.downloadFirstOutput(outputs);

    const finalPath = await this.materializeOutput(media, req.outPath, {
      duration,
      fps,
      width,
      height,
    });

    return {
      path: finalPath,
      contentHash: hashFile(finalPath),
      durationSec: duration,
      width,
      height,
      provider: this.name,
      note: media.kind === 'image' ? 'ComfyUI image converted to still video' : 'ComfyUI media',
    };
  }

  private loadAndPrepareWorkflow(vars: {
    prompt: string;
    negative: string;
    width: number;
    height: number;
    seed: number;
  }): Record<string, ComfyWorkflowNode> {
    if (!existsSync(this.workflowPath)) {
      throw new Error(
        `ComfyUI workflow not found: ${this.workflowPath}. ` +
          `Export API-format JSON from ComfyUI into workflows/comfyui-default.json (see README).`,
      );
    }
    const raw = JSON.parse(readFileSync(this.workflowPath, 'utf8')) as ComfyWorkflowFile;
    const meta = raw._yachicut;
    const clone = JSON.parse(JSON.stringify(raw)) as ComfyWorkflowFile;
    delete clone._yachicut;

    const asText = JSON.stringify(clone)
      .replaceAll('{{PROMPT}}', JSON.stringify(vars.prompt).slice(1, -1))
      .replaceAll('{{NEGATIVE}}', JSON.stringify(vars.negative).slice(1, -1))
      .replaceAll('{{WIDTH}}', String(vars.width))
      .replaceAll('{{HEIGHT}}', String(vars.height))
      .replaceAll('{{SEED}}', String(vars.seed));
    const nodes = JSON.parse(asText) as Record<string, ComfyWorkflowNode>;

    const setInput = (nodeId: string | undefined, inputKey: string | undefined, value: unknown) => {
      if (!nodeId || !inputKey) return;
      const node = nodes[nodeId];
      if (!node) return;
      node.inputs = node.inputs ?? {};
      node.inputs[inputKey] = value;
    };
    setInput(meta?.promptNodeId, meta?.promptInput ?? 'text', vars.prompt);
    setInput(meta?.negativeNodeId, meta?.negativeInput ?? 'text', vars.negative);
    setInput(meta?.widthNodeId, 'width', vars.width);
    setInput(meta?.heightNodeId, 'height', vars.height);
    setInput(meta?.seedNodeId, meta?.seedInput ?? 'seed', vars.seed);

    for (const [, node] of Object.entries(nodes)) {
      if (!node || typeof node !== 'object' || !node.class_type) continue;
      const inputs = (node.inputs ??= {});
      if (node.class_type === 'CLIPTextEncode') {
        const text = inputs.text;
        if (
          typeof text === 'string' &&
          (text.includes('{{PROMPT}}') || text === '' || text === 'PROMPT')
        ) {
          const title = (node._meta?.title ?? '').toLowerCase();
          if (title.includes('negative')) inputs.text = vars.negative;
          else inputs.text = vars.prompt;
        }
      }
      if (node.class_type === 'EmptyLatentImage') {
        if (inputs.width === '{{WIDTH}}' || inputs.width === undefined) inputs.width = vars.width;
        if (inputs.height === '{{HEIGHT}}' || inputs.height === undefined) inputs.height = vars.height;
      }
      if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
        if (inputs.seed === '{{SEED}}' || inputs.seed === -1 || inputs.seed === undefined) {
          inputs.seed = vars.seed;
        }
      }
    }

    return nodes;
  }

  private async submitPrompt(workflow: Record<string, ComfyWorkflowNode>): Promise<string> {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      prompt_id?: string;
      error?: unknown;
      node_errors?: unknown;
      detail?: string;
    };
    if (!res.ok || !body.prompt_id) {
      const detail = JSON.stringify(body.error ?? body.node_errors ?? body.detail ?? body).slice(
        0,
        800,
      );
      throw new Error(`ComfyUI /prompt failed (HTTP ${res.status}): ${detail}`);
    }
    return body.prompt_id;
  }

  private async pollUntilDone(promptId: string): Promise<ComfyHistoryOutputs> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(`${this.baseUrl}/history/${promptId}`);
      if (!res.ok) {
        throw new Error(`ComfyUI /history/${promptId} -> HTTP ${res.status}`);
      }
      const hist = (await res.json()) as Record<
        string,
        {
          status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
          outputs?: ComfyHistoryOutputs;
        }
      >;
      const entry = hist[promptId];
      if (entry) {
        const status = entry.status?.status_str;
        const completed = entry.status?.completed === true || status === 'success';
        if (status === 'error') {
          throw new Error(
            `ComfyUI prompt ${promptId} failed: ${JSON.stringify(entry.status?.messages ?? entry).slice(0, 800)}`,
          );
        }
        if (completed || (entry.outputs && Object.keys(entry.outputs).length > 0)) {
          if (!entry.outputs || Object.keys(entry.outputs).length === 0) {
            throw new Error(`ComfyUI prompt ${promptId} completed with no outputs`);
          }
          return entry.outputs;
        }
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error(
      `ComfyUI prompt ${promptId} timed out after ${this.timeoutMs}ms. ` +
        `Increase COMFYUI_TIMEOUT_MS or check the ComfyUI queue.`,
    );
  }

  private async downloadFirstOutput(
    outputs: ComfyHistoryOutputs,
  ): Promise<{ kind: 'image' | 'video' | 'other'; bytes: Buffer; filename: string }> {
    type FileRef = { filename: string; subfolder?: string; type?: string };
    const images: FileRef[] = [];
    const videos: FileRef[] = [];
    for (const nodeOut of Object.values(outputs)) {
      if (nodeOut.images) images.push(...nodeOut.images);
      if (nodeOut.gifs) videos.push(...nodeOut.gifs);
      if (nodeOut.videos) videos.push(...nodeOut.videos);
    }
    const pick = videos[0] ?? images[0];
    if (!pick) {
      throw new Error('ComfyUI returned outputs but no images/videos to download');
    }
    const params = new URLSearchParams({
      filename: pick.filename,
      subfolder: pick.subfolder ?? '',
      type: pick.type ?? 'output',
    });
    const res = await fetch(`${this.baseUrl}/view?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`ComfyUI /view failed HTTP ${res.status} for ${pick.filename}`);
    }
    const ab = await res.arrayBuffer();
    const bytes = Buffer.from(ab);
    const lower = pick.filename.toLowerCase();
    const kind: 'image' | 'video' | 'other' =
      videos[0] === pick || /\.(mp4|webm|mov|gif)$/.test(lower)
        ? 'video'
        : /\.(png|jpe?g|webp|bmp)$/.test(lower)
          ? 'image'
          : 'other';
    return { kind, bytes, filename: pick.filename };
  }

  private async materializeOutput(
    media: { kind: 'image' | 'video' | 'other'; bytes: Buffer; filename: string },
    outPath: string,
    opts: { duration: number; fps: number; width: number; height: number },
  ): Promise<string> {
    if (media.kind === 'video' || media.kind === 'other') {
      writeFileSync(outPath, media.bytes);
      return outPath;
    }

    const ext = path.extname(media.filename) || '.png';
    const imgPath = outPath.replace(/\.mp4$/i, '') + ext;
    writeFileSync(imgPath, media.bytes);

    if (!hasFfmpeg()) {
      copyFileSync(imgPath, outPath);
      return outPath;
    }

    const r = runFfmpeg([
      '-loop',
      '1',
      '-i',
      imgPath,
      '-c:v',
      'libx264',
      '-t',
      String(opts.duration),
      '-pix_fmt',
      'yuv420p',
      '-vf',
      `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2`,
      '-r',
      String(opts.fps),
      outPath,
    ]);
    if (!r.ok) {
      copyFileSync(imgPath, outPath);
    }
    return outPath;
  }
}
