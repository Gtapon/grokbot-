import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ProjectStore } from '../core/project.js';
import { hasFfmpeg, hasFfprobe } from '../core/ffmpeg.js';
import { REPO_ROOT } from '../core/paths.js';
import { installMediaRoutes } from './media-routes.js';

const PORT = Number(process.env.PORT || 8787);
const store = new ProjectStore();
const app = express();

app.use(cors());
app.use(express.json({ limit: '512mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ffmpeg: hasFfmpeg(), ffprobe: hasFfprobe() });
});

app.get('/api/projects', (_req, res) => {
  res.json(store.listProjects());
});

app.post('/api/projects', (req, res) => {
  try {
    const name = String(req.body?.name || 'Untitled');
    const p = store.createProject(name);
    res.status(201).json(p);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    res.json(store.load(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/projects/:id/status', (req, res) => {
  try {
    res.json(store.status(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/projects/:id/shots', (req, res) => {
  try {
    const shot = store.addShot(req.params.id, {
      title: String(req.body?.title || 'Shot'),
      description: req.body?.description,
      durationSec: req.body?.durationSec,
    });
    res.status(201).json(shot);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/projects/:id/generate-clip', async (req, res) => {
  try {
    const result = await store.generateClip(req.params.id, {
      shotId: req.body?.shotId,
      durationSec: req.body?.durationSec,
      label: req.body?.label,
      color: req.body?.color,
      prompt: req.body?.prompt,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/projects/:id/place-clip', (req, res) => {
  try {
    const clip = store.placeClip(req.params.id, req.body ?? {});
    res.status(201).json(clip);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

installMediaRoutes(app, store);

app.post('/api/projects/:id/decide', (req, res) => {
  try {
    const { targetType, targetId, decision, note } = req.body ?? {};
    if (targetType === 'shot') {
      res.json(store.decideShot(req.params.id, targetId, decision, note));
    } else if (targetType === 'clip') {
      res.json(store.decideClip(req.params.id, targetId, decision, note));
    } else {
      res.status(400).json({ error: 'targetType must be shot or clip' });
    }
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/projects/:id/export', async (req, res) => {
  try {
    res.json(await store.exportProject(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Serve media files for preview */
app.get('/api/projects/:id/media/:filename', (req, res) => {
  const file = path.join(store.projectsRoot, req.params.id, 'media', req.params.filename);
  if (!existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.sendFile(file);
});

app.get('/api/projects/:id/export-file/:filename', (req, res) => {
  const file = path.join(store.projectsRoot, req.params.id, 'export', req.params.filename);
  if (!existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.sendFile(file);
});

// Static UI when built
const uiDir = path.join(REPO_ROOT, 'dist/ui');
if (existsSync(uiDir)) {
  app.use(express.static(uiDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(uiDir, 'index.html'));
  });
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(
    `YachiCut API http://127.0.0.1:${PORT} (ffmpeg=${hasFfmpeg()} ffprobe=${hasFfprobe()})`,
  );
});
