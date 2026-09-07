/** YachiCut MVP project model */

export type Decision = 'pending' | 'accepted' | 'rejected';

export type TrackKind = 'video' | 'audio';

export interface DecisionEntry {
  id: string;
  at: string; // ISO
  targetType: 'shot' | 'clip' | 'media';
  targetId: string;
  decision: Decision;
  note?: string;
}

export interface MediaAsset {
  id: string;
  path: string;
  kind: 'video' | 'audio' | 'image' | 'other';
  contentHash: string;
  durationSec?: number;
  width?: number;
  height?: number;
  createdAt: string;
  label?: string;
  /** Original source path when imported from user footage */
  sourcePath?: string;
}

export interface Shot {
  id: string;
  index: number;
  title: string;
  description?: string;
  durationSec: number;
  /** Linked media asset id once generated / attached */
  mediaId?: string;
  decision: Decision;
  /** Optional preferred clip on timeline */
  clipId?: string;
  /** Optional AI edit prompt stored for this shot */
  aiPrompt?: string;
}

export interface Clip {
  id: string;
  trackId: string;
  mediaId: string;
  /** Timeline start (seconds) */
  startSec: number;
  /** Source in/out points */
  inSec: number;
  outSec: number;
  label?: string;
  decision: Decision;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  clips: Clip[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  fps: number;
  width: number;
  height: number;
  rootDir: string;
}

export interface Project {
  meta: ProjectMeta;
  storyboard: Shot[];
  tracks: Track[];
  assets: MediaAsset[];
  decisions: DecisionEntry[];
}

export interface ProjectStatus {
  projectId: string;
  name: string;
  totalShots: number;
  acceptedShots: number;
  rejectedShots: number;
  pendingShots: number;
  missingMediaShots: number;
  completionPct: number;
  totalClips: number;
  assetCount: number;
}

export interface GenerateClipOptions {
  shotId?: string;
  durationSec?: number;
  label?: string;
  color?: string;
  withTone?: boolean;
  /** Prompt for AI generation providers (ComfyUI). Defaults to shot description/title. */
  prompt?: string;
  negativePrompt?: string;
}

export interface ImportMediaOptions {
  /** Absolute or relative path to source file */
  filePath: string;
  label?: string;
  /** When true, skip copy if same contentHash already exists */
  dedupe?: boolean;
}

export interface UpdateClipOptions {
  inSec?: number;
  outSec?: number;
  startSec?: number;
  label?: string;
  decision?: Decision;
}

export interface MoveClipOptions {
  /** Swap with neighbor on the same track */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Absolute index on the current (or target) track */
  index?: number;
  /** Move to another track */
  trackId?: string;
}

export interface AiEditWithMediaOptions {
  mediaId: string;
  shotId?: string;
  /** Create a new shot titled from this if no shotId */
  shotTitle?: string;
  prompt?: string;
  /** Place (or re-place) on timeline; default true */
  place?: boolean;
  trackId?: string;
  startSec?: number;
  inSec?: number;
  outSec?: number;
  /** Attempt ComfyUI generate-from-media when provider=comfyui; default true */
  tryGenerate?: boolean;
}
