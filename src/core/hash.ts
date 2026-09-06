import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function hashFile(filePath: string): string {
  if (!existsSync(filePath)) return '';
  return hashBuffer(readFileSync(filePath));
}

export function shortHash(h: string, n = 12): string {
  return h.slice(0, n);
}
