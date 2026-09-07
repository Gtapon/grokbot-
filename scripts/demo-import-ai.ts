import { ProjectStore } from "../src/core/project.js";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/core/paths.js";

async function main() {
  console.log("=== import / trim / AI demo ===");
  const store = new ProjectStore();
  const project = store.createProject("Import AI Demo");
  const pid = project.meta.id;
  console.log("project", pid);

  const sampleDir = path.join(REPO_ROOT, "projects", "_demo_samples");
  mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, "user_footage.bin");
  writeFileSync(samplePath, Buffer.from("YACHICUT_DEMO_FOOTAGE"));
  const imported = store.importMedia(pid, { filePath: samplePath, label: "user_footage" });
  console.log("imported", imported.id, imported.kind, imported.contentHash.slice(0, 12));

  const imported2 = store.importMedia(pid, {
    filePath: samplePath,
    label: "user_footage_dup",
  });
  console.log("dedupe same hash?", imported2.id === imported.id);

  const ai = await store.aiEditWithMedia(pid, {
    mediaId: imported.id,
    prompt: "golden hour assemble",
  });
  console.log("ai-edit", { shot: ai.shot.id, clip: ai.clip.id, skipped: ai.generationSkippedReason });

  const trimmed = store.updateClip(pid, ai.clip.id, { inSec: 0, outSec: 1.25, startSec: 0.5 });
  console.log("trimmed", trimmed.inSec, trimmed.outSec, trimmed.startSec);

  // place a second clip then reorder
  const clip2 = store.placeClip(pid, { mediaId: imported.id, label: "second" });
  store.moveClip(pid, clip2.id, { direction: "up" });
  const p = store.load(pid);
  const v = p.tracks.find((t) => t.kind === "video")!;
  console.log("order after move", v.clips.map((c) => c.label || c.id.slice(0, 6)));

  const suggest = store.suggestEdit(pid, { mediaIds: [imported.id], prompt: "bulk", maxClips: 1 });
  console.log("suggest", suggest.note);
  console.log("status", store.status(pid));
  console.log("=== ok ===");
}
main().catch((e) => { console.error(e); process.exit(1); });
