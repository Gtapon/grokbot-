import type { ProjectStore } from '../core/project.js';

export const mediaToolDefs = [
  {
    name: 'yachicut_import_media',
    description: 'Import a user video/image into project media/ (hash + ffprobe)',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        filePath: { type: 'string' },
        label: { type: 'string' },
        dedupe: { type: 'boolean' },
      },
      required: ['projectId', 'filePath'],
    },
  },
  {
    name: 'yachicut_update_clip',
    description: 'Update clip trim (in/out) and/or timeline start',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        clipId: { type: 'string' },
        inSec: { type: 'number' },
        outSec: { type: 'number' },
        startSec: { type: 'number' },
        label: { type: 'string' },
      },
      required: ['projectId', 'clipId'],
    },
  },
  {
    name: 'yachicut_move_clip',
    description: 'Reorder a clip on its track (direction up/down or absolute index)',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        clipId: { type: 'string' },
        direction: { type: 'string' },
        index: { type: 'number' },
        trackId: { type: 'string' },
      },
      required: ['projectId', 'clipId'],
    },
  },
  {
    name: 'yachicut_ai_edit',
    description:
      'AI edit with footage: link media to shot, place on timeline, decision-log; ComfyUI generate-from-media when supported',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        mediaId: { type: 'string' },
        shotId: { type: 'string' },
        shotTitle: { type: 'string' },
        prompt: { type: 'string' },
        place: { type: 'boolean' },
        tryGenerate: { type: 'boolean' },
      },
      required: ['projectId', 'mediaId'],
    },
  },
  {
    name: 'yachicut_suggest_edit',
    description: 'Auto-place imported media onto the timeline (simple assemble rules)',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        mediaIds: { type: 'array', items: { type: 'string' } },
        prompt: { type: 'string' },
        maxClips: { type: 'number' },
      },
      required: ['projectId'],
    },
  },
] as const;

export async function handleMediaTool(
  store: ProjectStore,
  name: string,
  a: Record<string, unknown>,
): Promise<unknown | null> {
  switch (name) {
    case 'yachicut_import_media':
      return store.importMedia(String(a.projectId), {
        filePath: String(a.filePath),
        label: a.label ? String(a.label) : undefined,
        dedupe: a.dedupe !== undefined ? Boolean(a.dedupe) : undefined,
      });
    case 'yachicut_update_clip':
      return store.updateClip(String(a.projectId), String(a.clipId), {
        inSec: a.inSec !== undefined ? Number(a.inSec) : undefined,
        outSec: a.outSec !== undefined ? Number(a.outSec) : undefined,
        startSec: a.startSec !== undefined ? Number(a.startSec) : undefined,
        label: a.label ? String(a.label) : undefined,
      });
    case 'yachicut_move_clip':
      return store.moveClip(String(a.projectId), String(a.clipId), {
        direction: a.direction ? (String(a.direction) as "up" | "down" | "left" | "right") : undefined,
        index: a.index !== undefined ? Number(a.index) : undefined,
        trackId: a.trackId ? String(a.trackId) : undefined,
      });
    case 'yachicut_ai_edit':
      return store.aiEditWithMedia(String(a.projectId), {
        mediaId: String(a.mediaId),
        shotId: a.shotId ? String(a.shotId) : undefined,
        shotTitle: a.shotTitle ? String(a.shotTitle) : undefined,
        prompt: a.prompt ? String(a.prompt) : undefined,
        place: a.place !== undefined ? Boolean(a.place) : undefined,
        tryGenerate: a.tryGenerate !== undefined ? Boolean(a.tryGenerate) : undefined,
      });
    case 'yachicut_suggest_edit':
      return store.suggestEdit(String(a.projectId), {
        mediaIds: Array.isArray(a.mediaIds) ? a.mediaIds.map(String) : undefined,
        prompt: a.prompt ? String(a.prompt) : undefined,
        maxClips: a.maxClips !== undefined ? Number(a.maxClips) : undefined,
      });
    default:
      return null;
  }
}
