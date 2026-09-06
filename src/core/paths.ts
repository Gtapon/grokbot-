import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (yachicut-mvp/) */
export const REPO_ROOT = path.resolve(here, '../..');

export const DEFAULT_PROJECTS_DIR = path.join(REPO_ROOT, 'projects');

export function projectDir(projectsRoot: string, projectId: string): string {
  return path.join(projectsRoot, projectId);
}

export function projectJsonPath(projectsRoot: string, projectId: string): string {
  return path.join(projectDir(projectsRoot, projectId), 'project.json');
}

export function mediaDir(projectsRoot: string, projectId: string): string {
  return path.join(projectDir(projectsRoot, projectId), 'media');
}

export function exportDir(projectsRoot: string, projectId: string): string {
  return path.join(projectDir(projectsRoot, projectId), 'export');
}
