import { installImportOps } from './media-ops-import.js';
import { installTrimOps } from './media-ops-trim.js';
import { installAiOps } from './media-ops-ai.js';

export function installMediaOps(Store: { prototype: any }): void {
  const proto = Store.prototype;
  installImportOps(proto);
  installTrimOps(proto);
  installAiOps(proto);
}
