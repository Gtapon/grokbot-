import React, { useCallback, useEffect, useMemo, useState } from "react";

type Decision = "pending" | "accepted" | "rejected";

interface Shot {
  id: string;
  index: number;
  title: string;
  description?: string;
  durationSec: number;
  mediaId?: string;
  clipId?: string;
  decision: Decision;
}

interface Clip {
  id: string;
  trackId: string;
  mediaId: string;
  startSec: number;
  inSec: number;
  outSec: number;
  label?: string;
  decision: Decision;
}

interface Track {
  id: string;
  name: string;
  kind: "video" | "audio";
  clips: Clip[];
}

interface MediaAsset {
  id: string;
  path: string;
  kind: string;
  contentHash: string;
  durationSec?: number;
  label?: string;
}

interface Project {
  meta: { id: string; name: string; fps: number; width: number; height: number };
  storyboard: Shot[];
  tracks: Track[];
  assets: MediaAsset[];
  decisions: { id: string; at: string; targetType: string; targetId: string; decision: Decision; note?: string }[];
}

interface ProjectStatus {
  completionPct: number;
  totalShots: number;
  acceptedShots: number;
  rejectedShots: number;
  pendingShots: number;
  missingMediaShots: number;
  totalClips: number;
  assetCount: number;
}

interface Listed {
  id: string;
  name: string;
  updatedAt: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

function mediaUrl(projectId: string, asset: MediaAsset): string {
  const filename = asset.path.split(/[/\\]/).pop() || "";
  return "/api/projects/" + projectId + "/media/" + encodeURIComponent(filename);
}

export function App() {
  const [projects, setProjects] = useState<Listed[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [newName, setNewName] = useState("Demo Cut");
  const [shotTitle, setShotTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    refreshList().catch((e) => setError(String(e.message || e)));
  }, [refreshList]);

  const selectedShot = useMemo(
    () => project?.storyboard.find((s) => s.id === selectedShotId) ?? null,
    [project, selectedShotId],
  );

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

  async function wrap(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Yachi<span>Cut</span> <span className="muted">MVP</span></div>
        <div className="row">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New project name" />
          <button className="primary" disabled={busy} onClick={() => wrap(async () => {
            const p = await api<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name: newName || "Untitled" }) });
            await refreshList();
            await loadProject(p.meta.id);
          })}>New project</button>
          <select value={projectId} onChange={(e) => { const id = e.target.value; if (id) wrap(() => loadProject(id)); }}>
            <option value="">Select project…</option>
            {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
          <button disabled={!projectId || busy} onClick={() => wrap(async () => {
            const r = await api<{ exportDir: string; mediaPath?: string; note?: string }>("/api/projects/" + projectId + "/export", { method: "POST", body: "{}" });
            alert("Exported to:\n" + r.exportDir + "\n" + (r.mediaPath ? "Media: " + r.mediaPath : "") + "\n" + (r.note || ""));
          })}>Export</button>
        </div>
      </header>

      {!project ? (
        <div style={{ padding: "2rem" }} className="muted">
          Create or select a project to begin. Run API on :8787 (Vite proxies /api).
          {error && <div className="error">{error}</div>}
        </div>
      ) : (
        <div className="layout">
          <aside className="panel">
            <h2>Storyboard</h2>
            {status && (
              <div className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{status.completionPct}%</strong>
                  <span className="muted">{status.acceptedShots}/{status.totalShots} accepted</span>
                </div>
                <div className="progress"><i style={{ width: status.completionPct + "%" }} /></div>
                <div className="muted">pending {status.pendingShots} · rejected {status.rejectedShots} · missing media {status.missingMediaShots}</div>
              </div>
            )}
            <div className="row" style={{ marginBottom: "0.5rem" }}>
              <input style={{ flex: 1 }} value={shotTitle} onChange={(e) => setShotTitle(e.target.value)} placeholder="Shot title" />
              <button disabled={busy || !shotTitle.trim()} onClick={() => wrap(async () => {
                await api("/api/projects/" + projectId + "/shots", { method: "POST", body: JSON.stringify({ title: shotTitle.trim(), durationSec: 3 }) });
                setShotTitle("");
                await loadProject(projectId);
              })}>Add</button>
            </div>
            {project.storyboard.map((s) => (
              <div key={s.id} className={"card " + (selectedShotId === s.id ? "active" : "")} style={{ cursor: "pointer" }}
                onClick={() => { setSelectedShotId(s.id); if (s.clipId) setSelectedClipId(s.clipId); }}>
                <div className="title">#{s.index + 1} {s.title}</div>
                <div className="row">
                  <span className={"badge " + s.decision}>{s.decision}</span>
                  {!s.mediaId && <span className="badge missing">missing media</span>}
                  <span className="muted">{s.durationSec}s</span>
                </div>
                <div className="row" style={{ marginTop: "0.4rem" }}>
                  <button disabled={busy} onClick={(e) => { e.stopPropagation(); wrap(async () => {
                    await api("/api/projects/" + projectId + "/generate-clip", { method: "POST", body: JSON.stringify({ shotId: s.id }) });
                    await loadProject(projectId);
                  }); }}>Generate</button>
                  <button className="good" disabled={busy} onClick={(e) => { e.stopPropagation(); wrap(async () => {
                    await api("/api/projects/" + projectId + "/decide", { method: "POST", body: JSON.stringify({ targetType: "shot", targetId: s.id, decision: "accepted" }) });
                    await loadProject(projectId);
                  }); }}>Accept</button>
                  <button className="bad" disabled={busy} onClick={(e) => { e.stopPropagation(); wrap(async () => {
                    await api("/api/projects/" + projectId + "/decide", { method: "POST", body: JSON.stringify({ targetType: "shot", targetId: s.id, decision: "rejected" }) });
                    await loadProject(projectId);
                  }); }}>Reject</button>
                </div>
              </div>
            ))}
          </aside>

          <main className="panel">
            <h2>Preview & Timeline</h2>
            <div className="preview">
              {previewAsset ? (
                <video key={previewAsset.id} controls src={mediaUrl(projectId, previewAsset)} />
              ) : (
                <div className="empty">Select a shot/clip with media to preview</div>
              )}
            </div>
            <div className="timeline">
              {project.tracks.map((t) => (
                <div key={t.id} className="track">
                  <div className="track-label">{t.name} · {t.kind}</div>
                  <div className="clips">
                    {t.clips.length === 0 && <span className="muted">No clips</span>}
                    {t.clips.map((c) => (
                      <div key={c.id}
                        className={"clip " + (selectedClipId === c.id ? "selected " : "") + c.decision}
                        onClick={() => {
                          setSelectedClipId(c.id);
                          const shot = project.storyboard.find((s) => s.clipId === c.id);
                          if (shot) setSelectedShotId(shot.id);
                        }}
                        title={(c.label || c.id) + " @ " + c.startSec + "s"}>
                        <div>{c.label || "clip"}</div>
                        <div className="muted">{c.startSec.toFixed(1)}s · {(c.outSec - c.inSec).toFixed(1)}s</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {(selectedShot || selectedClip) && (
              <div className="card" style={{ marginTop: "0.75rem" }}>
                <div className="title">Selection</div>
                {selectedShot && <div className="muted">Shot: {selectedShot.title} ({selectedShot.decision})</div>}
                {selectedClip && (
                  <div className="row" style={{ marginTop: "0.4rem" }}>
                    <button className="good" disabled={busy} onClick={() => wrap(async () => {
                      await api("/api/projects/" + projectId + "/decide", { method: "POST", body: JSON.stringify({ targetType: "clip", targetId: selectedClip.id, decision: "accepted" }) });
                      await loadProject(projectId);
                    })}>Accept clip</button>
                    <button className="bad" disabled={busy} onClick={() => wrap(async () => {
                      await api("/api/projects/" + projectId + "/decide", { method: "POST", body: JSON.stringify({ targetType: "clip", targetId: selectedClip.id, decision: "rejected" }) });
                      await loadProject(projectId);
                    })}>Reject clip</button>
                  </div>
                )}
              </div>
            )}
            {error && <div className="error">{error}</div>}
          </main>

          <aside className="panel">
            <h2>Assets</h2>
            {project.assets.length === 0 && <div className="muted">No assets yet</div>}
            {project.assets.map((a) => (
              <div key={a.id} className="card">
                <div className="title">{a.label || a.id.slice(0, 8)}</div>
                <div className="muted">{a.kind} · {a.durationSec ?? "?"}s</div>
                <div className="hash">{a.contentHash.slice(0, 16)}…</div>
              </div>
            ))}
            <h2 style={{ marginTop: "1rem" }}>Decision log</h2>
            {project.decisions.length === 0 && <div className="muted">No decisions yet</div>}
            {[...project.decisions].reverse().slice(0, 20).map((d) => (
              <div key={d.id} className="card">
                <span className={"badge " + d.decision}>{d.decision}</span>{" "}
                <span className="muted">{d.targetType} · {new Date(d.at).toLocaleString()}</span>
                {d.note && <div className="muted">{d.note}</div>}
              </div>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
