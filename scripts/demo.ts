import { ProjectStore } from "../src/core/project.js";
import { hasFfmpeg } from "../src/core/ffmpeg.js";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/core/paths.js";

async function main() {
  console.log("=== YachiCut MVP demo ===");
  console.log("ffmpeg available:", hasFfmpeg());
  const store = new ProjectStore();
  const project = store.createProject("Demo Cut");
  const pid = project.meta.id;
  console.log("created project", pid);

  const s1 = store.addShot(pid, { title: "Opening title", durationSec: 2 });
  const s2 = store.addShot(pid, { title: "Main action", durationSec: 3 });
  console.log("shots:", s1.id, s2.id);

  // Prefer import + AI path (always fast). Optional mock generate when DEMO_GENERATE=1.
  const sampleDir = path.join(REPO_ROOT, "projects", "_demo_samples");
  mkdirSync(sampleDir, { recursive: true });
  const sampleA = path.join(sampleDir, "user_a.mp4");
  const sampleB = path.join(sampleDir, "user_b.mp4");
  writeFileSync(sampleA, Buffer.from("YACHICUT_DEMO_FOOTAGE_A"));
  writeFileSync(sampleB, Buffer.from("YACHICUT_DEMO_FOOTAGE_B"));
  const a1 = store.importMedia(pid, { filePath: sampleA, label: "opening_cam" });
  const a2 = store.importMedia(pid, { filePath: sampleB, label: "action_cam" });
  console.log("imported:", a1.id, a2.id);

  const ai1 = await store.aiEditWithMedia(pid, {
    mediaId: a1.id,
    shotId: s1.id,
    prompt: "wide establishing",
  });
  const ai2 = await store.aiEditWithMedia(pid, {
    mediaId: a2.id,
    shotId: s2.id,
    prompt: "handheld action",
  });
  console.log("ai-edit clips:", ai1.clip.id, ai2.clip.id);

  store.updateClip(pid, ai1.clip.id, { inSec: 0, outSec: 1.5, startSec: 0 });
  store.moveClip(pid, ai2.clip.id, { direction: "up" });
  console.log("trim + reorder done");

  if (process.env.DEMO_GENERATE === "1") {
    const g = await store.generateClip(pid, { shotId: s1.id, color: "blue", durationSec: 1, withTone: false });
    console.log("generated:", g.clip.id);
  } else {
    console.log("skip generateClip (set DEMO_GENERATE=1 to enable)");
  }

  store.decideShot(pid, s1.id, "accepted", "looks good");
  store.decideShot(pid, s2.id, "rejected", "redo later");
  store.decideClip(pid, ai1.clip.id, "accepted");
  console.log("status:", store.status(pid));
  console.log("export:", await store.exportProject(pid));
  console.log("=== demo complete ===");
}
main().catch((err) => { console.error(err); process.exit(1); });
