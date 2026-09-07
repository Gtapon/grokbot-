import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MediaBridge } from "./MediaBridge";

type Decision = "pending" | "accepted" | "rejected";
interface Shot { id: string; index: number; title: string; durationSec: number; mediaId?: string; clipId?: string; decision: Decision; }
interface Clip { id: string; trackId: string; mediaId: string; startSec: number; inSec: number; outSec: number; label?: string; decision: Decision; }
interface Track { id: string; name: string; kind: "video" | "audio"; clips: Clip[]; }
interface MediaAsset { id: string; path: string; kind: string; contentHash: string; durationSec?: number; label?: string; }
interface Project {
  meta: { id: string; name: string; fps: number; width: number; height: number };
  storyboard: Shot[];
  tracks: Track[];
  assets: MediaAsset[];
  decisions: { id: string; at: string; targetType: string; targetId: string; decision: Decision; note?: string }[];
}
interface ProjectStatus {
  completionPct: number; totalShots: number; acceptedShots: number; rejectedShots: number;
  pendingShots: number; missingMediaShots: number; totalClips: number; assetCount: number;
}
interface Listed { id: string; name: string; updatedAt: string; }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json", ...(init?.headers || {}) }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText || "Request failed");
  return data as T;
}

function mediaUrl(projectId: string, asset: MediaAsset): string {
  const filename = asset.path.split(/[/\\]/).pop() || "";
  return "/api/projects/" + projectId + "/media/" + encodeURIComponent(filename);
}

function decisionLabel(d: Decision): string {
  if (d === "accepted") return "Accepted";
  if (d === "rejected") return "Rejected";
  return "Pending";
}

export function App() {
  const el = React.createElement;
  const [projects, setProjects] = useState<Listed[]>([]);
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [newName, setNewName] = useState("Demo Cut");
  const [shotTitle, setShotTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    const list = await api<Listed[]>("/api/projects");
    setProjects(list);
    return list;
  }, []);

  const loadProject = useCallback(async (id: string) => {
    const [p, s] = await Promise.all([
      api<Project>("/api/projects/" + id),
      api<ProjectStatus>("/api/projects/" + id + "/status"),
    ]);
    setProject(p);
    setStatus(s);
    setProjectId(id);
  }, []);

  useEffect(() => { refreshList().catch((e) => setError(String(e.message || e))); }, [refreshList]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const selectedShot = useMemo(() => project?.storyboard.find((s) => s.id === selectedShotId) ?? null, [project, selectedShotId]);
  const selectedClip = useMemo(() => {
    if (!project || !selectedClipId) return null;
    for (const t of project.tracks) {
      const c = t.clips.find((x) => x.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [project, selectedClipId]);

  const previewAsset = useMemo(() => {
    if (!project) return null;
    const mediaId = selectedClip?.mediaId || selectedShot?.mediaId;
    if (!mediaId) return null;
    return project.assets.find((a) => a.id === mediaId) ?? null;
  }, [project, selectedClip, selectedShot]);

  async function wrap(fn: () => Promise<void>, ok?: string) {
    setBusy(true); setError(null);
    try { await fn(); if (ok) setToast(ok); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const children: React.ReactNode[] = [
    el("header", { className: "topbar" },
      el("div", { className: "brand" }, "Yachi", el("span", null, "Cut"), " ", el("span", { className: "muted" }, "MVP")),
      el("div", { className: "row" },
        el("input", { value: newName, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value), placeholder: "New project name", disabled: busy }),
        el("button", { className: "primary", disabled: busy, onClick: () => wrap(async () => {
          const p = await api<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name: newName || "Untitled" }) });
          await refreshList(); await loadProject(p.meta.id);
        }, "Project created") }, "New project"),
        el("select", { value: projectId, disabled: busy, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          const id = e.target.value; if (id) wrap(async () => { await loadProject(id); });
        }}, el("option", { value: "" }, "Select project…"), ...projects.map((p) => el("option", { key: p.id, value: p.id }, p.name))),
        el("button", { disabled: !projectId || busy, onClick: () => wrap(async () => {
          const r = await api<{ exportDir: string; mediaPath?: string; note?: string }>("/api/projects/" + projectId + "/export", { method: "POST", body: "{}" });
          alert("Exported to:\n" + r.exportDir);
        }, "Export finished") }, "Export"),
      ),
    ),
  ];
  if (toast) children.push(el("div", { className: "toast", role: "status" }, toast));
  if (error) children.push(el("div", { className: "error-banner", role: "alert" }, el("strong", null, "Error: "), error));

  if (!project) {
    children.push(el("div", { className: "empty-screen" }, el("div", { className: "empty-card" },
      el("h1", null, "Start a cut"),
      el("p", { className: "muted" }, "Create or select a project. Import footage, trim clips, or use 「この素材でAI編集」."),
    )));
  } else {
    const shots = project.storyboard.map((s) => el("div", {
      key: s.id, className: "card shot-card " + (selectedShotId === s.id ? "active" : ""),
      onClick: () => { setSelectedShotId(s.id); if (s.clipId) setSelectedClipId(s.clipId); },
    },
      el("div", { className: "title" }, "#" + (s.index + 1) + " " + s.title),
      el("div", { className: "row" },
        el("span", { className: "badge " + s.decision }, decisionLabel(s.decision)),
        el("button", { disabled: busy, onClick: (e: React.MouseEvent) => { e.stopPropagation(); wrap(async () => {
          await api("/api/projects/" + projectId + "/generate-clip", { method: "POST", body: JSON.stringify({ shotId: s.id }) });
          await loadProject(projectId);
        }, "Generated"); }}, "Generate"),
        el("button", { className: "good", disabled: busy, onClick: (e: React.MouseEvent) => { e.stopPropagation(); wrap(async () => {
          await api("/api/projects/" + projectId + "/decide", { method: "POST", body: JSON.stringify({ targetType: "shot", targetId: s.id, decision: "accepted" }) });
          await loadProject(projectId);
        }); }}, "Accept"),
      ),
    ));

    children.push(el("div", { className: "layout" },
      el("aside", { className: "panel storyboard-panel" },
        el("div", { className: "panel-head" }, el("h2", null, "Storyboard"), status ? el("span", { className: "panel-meta" }, status.completionPct + "%") : null),
        el("div", { className: "row add-shot-row" },
          el("input", { style: { flex: 1 }, value: shotTitle, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setShotTitle(e.target.value), placeholder: "Shot title", disabled: busy }),
          el("button", { disabled: busy || !shotTitle.trim(), onClick: () => wrap(async () => {
            await api("/api/projects/" + projectId + "/shots", { method: "POST", body: JSON.stringify({ title: shotTitle.trim(), durationSec: 3 }) });
            setShotTitle(""); await loadProject(projectId);
          }, "Shot added") }, "Add"),
        ),
        ...shots,
      ),
      el("main", { className: "panel main-panel" },
        el("div", { className: "panel-head" }, el("h2", null, "Preview & Timeline")),
        el("div", { className: "preview" },
          previewAsset
            ? el("video", { key: previewAsset.id, controls: true, src: mediaUrl(projectId, previewAsset) })
            : el("div", { className: "empty preview-empty" }, "Select a shot/clip or import media"),
        ),
        el("div", { className: "timeline" },
          ...project.tracks.map((t) => el("div", { key: t.id, className: "track" },
            el("div", { className: "track-label" }, t.name),
            el("div", { className: "clips" },
              ...t.clips.map((c) => el("div", {
                key: c.id,
                className: "clip " + (selectedClipId === c.id ? "selected" : ""),
                draggable: true,
                onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData("text/clip-id", c.id); },
                onDragOver: (e: React.DragEvent) => e.preventDefault(),
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault();
                  const from = e.dataTransfer.getData("text/clip-id");
                  if (!from || from === c.id) return;
                  const ids = t.clips.map((x) => x.id);
                  const toIndex = ids.indexOf(c.id);
                  wrap(async () => {
                    await api("/api/projects/" + projectId + "/move-clip", {
                      method: "POST",
                      body: JSON.stringify({ clipId: from, index: toIndex }),
                    });
                    await loadProject(projectId);
                  });
                },
                onClick: () => setSelectedClipId(c.id),
              }, c.label || c.id.slice(0, 8), el("div", { className: "muted" }, c.startSec.toFixed(1) + "s")),
            )),
          )),
        ),
      ),
      el("aside", { className: "panel" },
        el("div", { className: "panel-head" }, el("h2", null, "Assets"), el("span", { className: "panel-meta" }, String(project.assets.length))),
        el(MediaBridge, {
          projectId, assets: project.assets, selectedClip, selectedMediaId,
          onSelectMedia: setSelectedMediaId,
          reload: async () => { await loadProject(projectId); },
          api, busy, setToast, setError,
        }),
        el("div", { className: "panel-head", style: { marginTop: "1rem" } }, el("h2", null, "Decision log")),
        ...[...project.decisions].reverse().slice(0, 12).map((d) => el("div", { key: d.id, className: "card" },
          el("span", { className: "badge " + d.decision }, decisionLabel(d.decision)),
          " ",
          el("span", { className: "muted" }, d.targetType),
          d.note ? el("div", { className: "muted" }, d.note) : null,
        )),
      ),
    ));
  }

  return el("div", { className: "app" }, ...children);
}
