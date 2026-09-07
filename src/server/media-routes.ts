import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import type { ProjectStore } from '../core/project.js';

/** Register import / trim / reorder / AI-edit routes on the API app. */
export function installMediaRoutes(app: Express, store: ProjectStore): void {
  /** Path-based import: { path, label?, dedupe? } */
  app.post('/api/projects/:id/import-media', (req, res) => {
    try {
      const filePath = req.body?.path ?? req.body?.filePath;
      if (!filePath) {
        return res.status(400).json({ error: 'Provide path (or use /import-media-upload)' });
      }
      const asset = store.importMedia(req.params.id, {
        filePath: String(filePath),
        label: req.body?.label ? String(req.body.label) : undefined,
        dedupe: req.body?.dedupe,
      });
      res.status(201).json(asset);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * Browser upload:
   * - JSON { filename, contentBase64, label? } (uses global json parser)
   * - multipart/form-data field "file" (raw body + simple boundary parser)
   */
  app.post('/api/projects/:id/import-media-upload', (req, res, next) => {
    const ctype = String(req.headers['content-type'] || '');
    if (ctype.includes('multipart/form-data') || ctype.includes('application/octet-stream')) {
      return express.raw({ type: () => true, limit: '200mb' })(req, res, next);
    }
    next();
  }, (req, res) => {
    try {
      const projectId = req.params.id;
      const ctype = String(req.headers['content-type'] || '');

      if (ctype.includes('multipart/form-data')) {
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
        const parsed = parseMultipart(raw, ctype);
        if (!parsed) return res.status(400).json({ error: 'Could not parse multipart file field' });
        const asset = store.importMediaBuffer(projectId, {
          filename: parsed.filename,
          data: parsed.data,
          label: parsed.label,
        });
        return res.status(201).json(asset);
      }

      if (ctype.includes('application/octet-stream')) {
        const filename = String(req.query.filename || `upload_${randomUUID()}.bin`);
        const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
        if (!data.length) return res.status(400).json({ error: 'Empty body' });
        const asset = store.importMediaBuffer(projectId, { filename, data });
        return res.status(201).json(asset);
      }

      const body = req.body ?? {};
      const filename = String(body.filename || 'upload.bin');
      const b64 = String(body.contentBase64 || '');
      if (!b64) return res.status(400).json({ error: 'contentBase64 required (or send multipart file)' });
      const data = Buffer.from(b64, 'base64');
      const asset = store.importMediaBuffer(projectId, {
        filename,
        data,
        label: body.label ? String(body.label) : undefined,
      });
      res.status(201).json(asset);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.patch('/api/projects/:id/clips/:clipId', (req, res) => {
    try {
      const clip = store.updateClip(req.params.id, req.params.clipId, {
        inSec: req.body?.inSec,
        outSec: req.body?.outSec,
        startSec: req.body?.startSec,
        label: req.body?.label,
        decision: req.body?.decision,
      });
      res.json(clip);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/projects/:id/clips/:clipId/move', (req, res) => {
    try {
      const clip = store.moveClip(req.params.id, req.params.clipId, {
        direction: req.body?.direction,
        index: req.body?.index,
        trackId: req.body?.trackId,
      });
      res.json(clip);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/projects/:id/update-clip', (req, res) => {
    try {
      const clipId = String(req.body?.clipId || '');
      if (!clipId) return res.status(400).json({ error: 'clipId required' });
      const clip = store.updateClip(req.params.id, clipId, {
        inSec: req.body?.inSec,
        outSec: req.body?.outSec,
        startSec: req.body?.startSec,
        label: req.body?.label,
        decision: req.body?.decision,
      });
      res.json(clip);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/projects/:id/move-clip', (req, res) => {
    try {
      const clipId = String(req.body?.clipId || '');
      if (!clipId) return res.status(400).json({ error: 'clipId required' });
      const clip = store.moveClip(req.params.id, clipId, {
        direction: req.body?.direction,
        index: req.body?.index,
        trackId: req.body?.trackId,
      });
      res.json(clip);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/projects/:id/ai-edit', async (req, res) => {
    try {
      const mediaId = String(req.body?.mediaId || '');
      if (!mediaId) return res.status(400).json({ error: 'mediaId required' });
      const result = await store.aiEditWithMedia(req.params.id, {
        mediaId,
        shotId: req.body?.shotId,
        shotTitle: req.body?.shotTitle,
        prompt: req.body?.prompt,
        place: req.body?.place,
        trackId: req.body?.trackId,
        startSec: req.body?.startSec,
        inSec: req.body?.inSec,
        outSec: req.body?.outSec,
        tryGenerate: req.body?.tryGenerate,
      });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/projects/:id/suggest-edit', (req, res) => {
    try {
      const result = store.suggestEdit(req.params.id, {
        mediaIds: req.body?.mediaIds,
        prompt: req.body?.prompt,
        maxClips: req.body?.maxClips,
      });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** Minimal multipart parser for a single file field named "file" (and optional "label"). */
function parseMultipart(
  buf: Buffer,
  contentType: string,
): { filename: string; data: Buffer; label?: string } | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return null;
  const boundary = m[1] || m[2];
  const parts = buf.toString('binary').split(`--${boundary}`);
  let filename = 'upload.bin';
  let data: Buffer | null = null;
  let label: string | undefined;
  for (const part of parts) {
    if (!part || part === '--\r\n' || part === '--') continue;
    const sep = part.indexOf('\r\n\r\n');
    if (sep < 0) continue;
    const header = part.slice(0, sep);
    let body = part.slice(sep + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    const nameMatch = /name="([^"]+)"/i.exec(header);
    const fileMatch = /filename="([^"]*)"/i.exec(header);
    const name = nameMatch?.[1];
    if (fileMatch && (name === 'file' || name === 'media' || fileMatch[1])) {
      filename = fileMatch[1] || filename;
      data = Buffer.from(body, 'binary');
    } else if (name === 'label') {
      label = body.replace(/\r\n$/, '');
    }
  }
  if (!data) return null;
  return { filename, data, label };
}
