#!/usr/bin/env node
import { Command } from 'commander';
import { ProjectStore } from '../core/project.js';
import { hasFfmpeg } from '../core/ffmpeg.js';
import {
  getGenerationDiagnostics,
  getGenerationProvider,
  resolveProviderKind,
} from '../core/generation.js';

const store = new ProjectStore();
const program = new Command();

program
  .name('yachicut')
  .description('YachiCut MVP — AI-operable video editor CLI')
  .version('0.1.0');

program
  .command('create')
  .description('Create a new project')
  .argument('<name>', 'project name')
  .action((name: string) => {
    const p = store.createProject(name);
    console.log(JSON.stringify({ id: p.meta.id, name: p.meta.name, root: p.meta.rootDir }, null, 2));
  });

program
  .command('list')
  .description('List projects')
  .action(() => {
    console.log(JSON.stringify(store.listProjects(), null, 2));
  });

program
  .command('add-shot')
  .description('Add a storyboard shot')
  .requiredOption('-p, --project <id>', 'project id')
  .requiredOption('-t, --title <title>', 'shot title')
  .option('-d, --description <text>', 'description (also used as ComfyUI prompt)')
  .option('--duration <sec>', 'duration seconds', '3')
  .action((opts) => {
    const shot = store.addShot(opts.project, {
      title: opts.title,
      description: opts.description,
      durationSec: Number(opts.duration),
    });
    console.log(JSON.stringify(shot, null, 2));
  });

program
  .command('generate-clip')
  .description(
    'Generate a clip via the active generation provider and place it on the timeline. ' +
      'Provider is selected with GENERATION_PROVIDER=mock|comfyui|auto (default: mock). ' +
      'Mock uses ffmpeg color bars; comfyui talks to COMFYUI_URL (default http://127.0.0.1:8188) ' +
      'using workflows/comfyui-default.json; auto tries ComfyUI then falls back to mock. ' +
      'Shot description/title (or --prompt) is sent as the ComfyUI text prompt.',
  )
  .requiredOption('-p, --project <id>', 'project id')
  .option('-s, --shot <id>', 'link to shot id')
  .option('--duration <sec>', 'duration override')
  .option('--label <label>', 'label')
  .option('--color <color>', 'ffmpeg color name (mock provider)')
  .option('--prompt <text>', 'generation prompt (ComfyUI; defaults to shot description/title)')
  .action(async (opts) => {
    const result = await store.generateClip(opts.project, {
      shotId: opts.shot,
      durationSec: opts.duration ? Number(opts.duration) : undefined,
      label: opts.label,
      color: opts.color,
      prompt: opts.prompt,
    });
    console.log(
      JSON.stringify(
        {
          provider: getGenerationProvider().name,
          providerKind: resolveProviderKind(),
          ...result,
        },
        null,
        2,
      ),
    );
  });

program
  .command('place-clip')
  .description('Place an existing media asset as a clip')
  .requiredOption('-p, --project <id>', 'project id')
  .requiredOption('-m, --media <id>', 'media asset id')
  .option('--track <id>', 'track id')
  .option('--start <sec>', 'timeline start')
  .option('--in <sec>', 'source in')
  .option('--out <sec>', 'source out')
  .option('--shot <id>', 'link shot')
  .option('--label <label>', 'label')
  .action((opts) => {
    const clip = store.placeClip(opts.project, {
      mediaId: opts.media,
      trackId: opts.track,
      startSec: opts.start !== undefined ? Number(opts.start) : undefined,
      inSec: opts.in !== undefined ? Number(opts.in) : undefined,
      outSec: opts.out !== undefined ? Number(opts.out) : undefined,
      shotId: opts.shot,
      label: opts.label,
    });
    console.log(JSON.stringify(clip, null, 2));
  });

program
  .command('accept')
  .description('Accept a shot or clip')
  .requiredOption('-p, --project <id>', 'project id')
  .option('--shot <id>', 'shot id')
  .option('--clip <id>', 'clip id')
  .option('--note <text>', 'note')
  .action((opts) => {
    if (opts.shot) {
      console.log(JSON.stringify(store.decideShot(opts.project, opts.shot, 'accepted', opts.note), null, 2));
    } else if (opts.clip) {
      console.log(JSON.stringify(store.decideClip(opts.project, opts.clip, 'accepted', opts.note), null, 2));
    } else {
      console.error('Provide --shot or --clip');
      process.exit(1);
    }
  });

program
  .command('reject')
  .description('Reject a shot or clip')
  .requiredOption('-p, --project <id>', 'project id')
  .option('--shot <id>', 'shot id')
  .option('--clip <id>', 'clip id')
  .option('--note <text>', 'note')
  .action((opts) => {
    if (opts.shot) {
      console.log(JSON.stringify(store.decideShot(opts.project, opts.shot, 'rejected', opts.note), null, 2));
    } else if (opts.clip) {
      console.log(JSON.stringify(store.decideClip(opts.project, opts.clip, 'rejected', opts.note), null, 2));
    } else {
      console.error('Provide --shot or --clip');
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Project status / completion')
  .requiredOption('-p, --project <id>', 'project id')
  .action((opts) => {
    console.log(JSON.stringify(store.status(opts.project), null, 2));
  });

program
  .command('show')
  .description('Dump full project JSON')
  .requiredOption('-p, --project <id>', 'project id')
  .action((opts) => {
    console.log(JSON.stringify(store.load(opts.project), null, 2));
  });

program
  .command('export')
  .description('Export project JSON + concatenated timeline media')
  .requiredOption('-p, --project <id>', 'project id')
  .action(async (opts) => {
    const result = await store.exportProject(opts.project);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('doctor')
  .description('Check environment (ffmpeg, generation provider, ComfyUI reachability)')
  .action(async () => {
    const gen = await getGenerationDiagnostics();
    console.log(
      JSON.stringify(
        {
          ffmpeg: hasFfmpeg(),
          projectsRoot: store.projectsRoot,
          generation: gen,
        },
        null,
        2,
      ),
    );
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
