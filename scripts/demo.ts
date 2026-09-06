import { ProjectStore } from "../src/core/project.js";
import { hasFfmpeg } from "../src/core/ffmpeg.js";

async function main() {
  console.log("=== YachiCut MVP demo ===");
  console.log("ffmpeg available:", hasFfmpeg());
  const store = new ProjectStore();
  const project = store.createProject("Demo Cut");
  console.log("created project", project.meta.id);
  const s1 = store.addShot(project.meta.id, { title: "Opening title", durationSec: 2 });
  const s2 = store.addShot(project.meta.id, { title: "Main action", durationSec: 3 });
  const s3 = store.addShot(project.meta.id, { title: "Closing", durationSec: 2 });
  console.log("shots:", s1.id, s2.id, s3.id);
  const g1 = await store.generateClip(project.meta.id, { shotId: s1.id, color: "blue" });
  const g2 = await store.generateClip(project.meta.id, { shotId: s2.id, color: "green" });
  const g3 = await store.generateClip(project.meta.id, { shotId: s3.id, color: "purple" });
  console.log("generated:", g1.clip.id, g2.clip.id, g3.clip.id);
  store.decideShot(project.meta.id, s1.id, "accepted", "looks good");
  store.decideShot(project.meta.id, s2.id, "rejected", "redo later");
  store.decideClip(project.meta.id, g1.clip.id, "accepted");
  console.log("status:", store.status(project.meta.id));
  console.log("export:", await store.exportProject(project.meta.id));
  console.log("=== demo complete ===");
}
main().catch((err) => { console.error(err); process.exit(1); });
