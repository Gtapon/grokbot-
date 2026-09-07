#!/usr/bin/env node
/**
 * YachiCut MCP stdio server — same ops as CLI for AI agents.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ProjectStore } from '../core/project.js';
import { hasFfmpeg } from '../core/ffmpeg.js';
import { getGenerationDiagnostics } from '../core/generation.js';
import { handleMediaTool, mediaToolDefs } from './media-tools.js';

const store = new ProjectStore();

const tools = [
  {
    name: 'yachicut_create_project',
    description: 'Create a new YachiCut project',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'yachicut_list_projects',
    description: 'List all projects',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'yachicut_add_shot',
    description: 'Add a storyboard shot',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        durationSec: { type: 'number' },
      },
      required: ['projectId', 'title'],
    },
  },
  {
    name: 'yachicut_generate_clip',
    description:
      'Generate clip via GENERATION_PROVIDER (mock|comfyui|auto) and place on timeline. ComfyUI uses shot description/prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        shotId: { type: 'string' },
        durationSec: { type: 'number' },
        label: { type: 'string' },
        color: { type: 'string' },
        prompt: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'yachicut_place_clip',
    description: 'Place existing media asset as a timeline clip',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        mediaId: { type: 'string' },
        trackId: { type: 'string' },
        startSec: { type: 'number' },
        inSec: { type: 'number' },
        outSec: { type: 'number' },
        shotId: { type: 'string' },
        label: { type: 'string' },
      },
      required: ['projectId', 'mediaId'],
    },
  },
  {
    name: 'yachicut_accept',
    description: 'Accept a shot or clip',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        shotId: { type: 'string' },
        clipId: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'yachicut_reject',
    description: 'Reject a shot or clip',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        shotId: { type: 'string' },
        clipId: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'yachicut_status',
    description: 'Get project completion status',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'yachicut_show',
    description: 'Dump full project JSON',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'yachicut_export',
    description: 'Export project JSON + concatenated media',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'yachicut_doctor',
    description: 'Check ffmpeg, projects root, generation provider, and ComfyUI reachability',
    inputSchema: { type: 'object', properties: {} },
  },
  ...mediaToolDefs,
] as const;

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    isError: true,
  };
}

const server = new Server(
  { name: 'yachicut-mvp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    const media = await handleMediaTool(store, name, a);
    if (media !== null) return jsonResult(media);

    switch (name) {
      case 'yachicut_create_project': {
        const p = store.createProject(String(a.name));
        return jsonResult({ id: p.meta.id, name: p.meta.name, root: p.meta.rootDir });
      }
      case 'yachicut_list_projects':
        return jsonResult(store.listProjects());
      case 'yachicut_add_shot':
        return jsonResult(
          store.addShot(String(a.projectId), {
            title: String(a.title),
            description: a.description ? String(a.description) : undefined,
            durationSec: a.durationSec !== undefined ? Number(a.durationSec) : undefined,
          }),
        );
      case 'yachicut_generate_clip':
        return jsonResult(
          await store.generateClip(String(a.projectId), {
            shotId: a.shotId ? String(a.shotId) : undefined,
            durationSec: a.durationSec !== undefined ? Number(a.durationSec) : undefined,
            label: a.label ? String(a.label) : undefined,
            color: a.color ? String(a.color) : undefined,
            prompt: a.prompt ? String(a.prompt) : undefined,
          }),
        );
      case 'yachicut_place_clip':
        return jsonResult(
          store.placeClip(String(a.projectId), {
            mediaId: String(a.mediaId),
            trackId: a.trackId ? String(a.trackId) : undefined,
            startSec: a.startSec !== undefined ? Number(a.startSec) : undefined,
            inSec: a.inSec !== undefined ? Number(a.inSec) : undefined,
            outSec: a.outSec !== undefined ? Number(a.outSec) : undefined,
            shotId: a.shotId ? String(a.shotId) : undefined,
            label: a.label ? String(a.label) : undefined,
          }),
        );
      case 'yachicut_accept': {
        if (a.shotId)
          return jsonResult(
            store.decideShot(String(a.projectId), String(a.shotId), 'accepted', a.note ? String(a.note) : undefined),
          );
        if (a.clipId)
          return jsonResult(
            store.decideClip(String(a.projectId), String(a.clipId), 'accepted', a.note ? String(a.note) : undefined),
          );
        throw new Error('Provide shotId or clipId');
      }
      case 'yachicut_reject': {
        if (a.shotId)
          return jsonResult(
            store.decideShot(String(a.projectId), String(a.shotId), 'rejected', a.note ? String(a.note) : undefined),
          );
        if (a.clipId)
          return jsonResult(
            store.decideClip(String(a.projectId), String(a.clipId), 'rejected', a.note ? String(a.note) : undefined),
          );
        throw new Error('Provide shotId or clipId');
      }
      case 'yachicut_status':
        return jsonResult(store.status(String(a.projectId)));
      case 'yachicut_show':
        return jsonResult(store.load(String(a.projectId)));
      case 'yachicut_export':
        return jsonResult(await store.exportProject(String(a.projectId)));
      case 'yachicut_doctor':
        return jsonResult({
          ffmpeg: hasFfmpeg(),
          projectsRoot: store.projectsRoot,
          generation: await getGenerationDiagnostics(),
        });
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errResult(err);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
