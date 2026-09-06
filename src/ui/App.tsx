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

type BusyAction =
  | null
  | "new-project"
  | "load-project"
  | "export"
  | "add-shot"
  | `generate:${string}`
  | `decide-shot:${string}:${Decision}`
  | `decide-clip:${string}:${Decision}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
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
  const [projects, setProjects] = useState<Listed[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [newName, setNewName] = useState("Demo Cut");
  const [shotTitle, setShotTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorRetry, setErrorRetry] = useState<(() => Promise<void>) | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [generatingShotId, setGeneratingShotId] = useState<string | null>(null);

  const busy = busyAction !== null;

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

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

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

  const shotByClipId = useMemo(() => {
    const map = new Map<string, Shot>();
    if (!project) return map;
    for (const s of project.storyboard) {
      if (s.clipId) map.set(s.clipId, s);
    }
    return map;
  }, [project]);

  const missingShots = useMemo(
    () => project?.storyboard.filter((s) => !s.mediaId) ?? [],
    [project],
  );

  const pendingShots = useMemo(
    () => project?.storyboard.filter((s) => s.decision === "pending") ?? [],
    [project],
  );

  const previewAsset = useMemo(() => {
    if (!project) return null;
    const mediaId = selectedClip?.mediaId || selectedShot?.mediaId;
    if (!mediaId) return null;
    return project.assets.find((a) => a.id === mediaId) ?? null;
  }, [project, selectedClip, selectedShot]);

  const isGeneratingSelected =
    !!generatingShotId && (generatingShotId === selectedShotId || generatingShotId === selectedShot?.id);

  function selectShot(shot: Shot) {
    setSelectedShotId(shot.id);
    if (shot.clipId) setSelectedClipId(shot.clipId);
    else setSelectedClipId(null);
  }

  function selectClip(clip: Clip) {
    setSelectedClipId(clip.id);
    const shot = shotByClipId.get(clip.id);
    if (shot) setSelectedShotId(shot.id);
  }

  async function wrap(action: BusyAction, fn: () => Promise<void>, opts?: { successToast?: string; retry?: () => Promise<void> }) {
    setBusyAction(action);
    setError(null);
    setErrorRetry(null);
    try {
      await fn();
      if (opts?.successToast) setToast(opts.successToast);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (opts?.retry) setErrorRetry(() => opts.retry!);
    } finally {
      setBusyAction(null);
    }
  }

  function previewEmptyMessage(): { title: string; detail: string } {
    if (isGeneratingSelected || generatingShotId) {
      return {
        title: "Generating clip…",
        detail: "Preview will appear when media is ready. Storyboard and timeline stay in sync.",
      };
    }
    if (!selectedShot && !selectedClip) {
      return {
        title: "Nothing selected",
        detail: "Click a storyboard shot or a timeline clip to preview.",
      };
    }
    if (selectedShot && !selectedShot.mediaId) {
      return {
        title: "No media for this shot",
        detail: `Shot #${selectedShot.index + 1} “${selectedShot.title}” has no generated clip yet. Use Generate.`,
      };
    }
    return {
      title: "Media unavailable",
      detail: "Selected item has no playable asset.",
    };
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Yachi<span>Cut</span> <span className="muted">MVP</span></div>
        <div className="row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New project name"
            disabled={busy}
            aria-label="New project name"
          />
          <button
            className="primary"
            disabled={busy}
            aria-busy={busyAction === "new-project"}
            onClick={() => wrap("new-project", async () => {
              const p = await api<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name: newName || "Untitled" }) });
              await refreshList();
              await loadProject(p.meta.id);
              setSelectedShotId(null);
              setSelectedClipId(null);
            }, { successToast: "Project created" })}
          >
            {busyAction === "new-project" ? "Creating…" : "New project"}
          </button>
          <select
            value={projectId}
            disabled={busy}
            aria-label="Select project"
            onChange={(e) => {
              const id = e.target.value;
              if (id) {
                wrap("load-project", async () => {
                  await loadProject(id);
                  setSelectedShotId(null);
                  setSelectedClipId(null);
                }, { retry: () => loadProject(id) });
              }
            }}
          >
            <option value="">Select project…</option>
            {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
          <button
            disabled={!projectId || busy}
            title={!projectId ? "Select a project first" : "Export timeline + media"}
            aria-busy={busyAction === "export"}
            onClick={() => wrap("export", async () => {
              const r = await api<{ exportDir: string; mediaPath?: string; note?: string }>("/api/projects/" + projectId + "/export", { method: "POST", body: "{}" });
              alert("Exported to:\n" + r.exportDir + "\n" + (r.mediaPath ? "Media: " + r.mediaPath : "") + "\n" + (r.note || ""));
            }, {
              successToast: "Export finished",
              retry: async () => {
                await api("/api/projects/" + projectId + "/export", { method: "POST", body: "{}" });
              },
            })}
          >
            {busyAction === "export" ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>

      {toast && <div className="toast" role="status">{toast}</div>}

      {error && (
        <div className="error-banner" role="alert">
          <div className="error-banner-body">
            <strong>Something went wrong</strong>
            <span>{error}</span>
          </div>
          <div className="row">
            {errorRetry && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  const retry = errorRetry;
                  setError(null);
                  setErrorRetry(null);
                  if (retry) wrap("load-project", retry);
                }}
              >
                Retry
              </button>
            )}
            <button
              className="ghost"
              disabled={busy}
              onClick={() => { setError(null); setErrorRetry(null); }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!project ? (
        <div className="empty-screen">
          <div className="empty-card">
            <h1>Start a cut</h1>
            <p className="muted">Create or select a project to begin. Run API on :8787 (Vite proxies /api).</p>
            <ol className="hint-list">
              <li>Create a project or pick one from the menu</li>
              <li>Add storyboard shots, then Generate clips</li>
              <li>Accept / reject shots — timeline mirrors the storyboard</li>
            </ol>
          </div>
        </div>
      ) : (
        <div className="layout">
          <aside className="panel storyboard-panel">
            <div className="panel-head">
              <h2>Storyboard</h2>
              <span className="panel-meta">{project.storyboard.length} shots</span>
            </div>

            {status && (
              <div className="card progress-card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="progress-label">Completion</div>
                    <strong className="progress-pct">{status.completionPct}%</strong>
                  </div>
                  <div className="progress-stats">
                    <span className="stat good">{status.acceptedShots} ok</span>
                    <span className="stat warn">{status.pendingShots} pending</span>
                    <span className="stat bad">{status.rejectedShots} rejected</span>
                  </div>
                </div>
                <div className="progress" aria-label={`Completion ${status.completionPct}%`}>
                  <i style={{ width: Math.min(100, Math.max(0, status.completionPct)) + "%" }} />
                </div>
                <div className="gap-row">
                  <span className="muted">Accepted {status.acceptedShots}/{status.totalShots}</span>
                  {status.missingMediaShots > 0 ? (
                    <span className="badge missing">{status.missingMediaShots} missing media</span>
                  ) : (
                    <span className="badge accepted">All shots have media</span>
                  )}
                </div>
                {missingShots.length > 0 && (
                  <div className="gap-list">
                    <div className="gap-title">Gaps to fill</div>
                    {missingShots.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="gap-item"
                        onClick={() => selectShot(s)}
                        title="Select missing shot"
                      >
                        <span className="shot-index">#{s.index + 1}</span>
                        <span className="gap-item-title">{s.title}</span>
                        <span className="badge missing">no media</span>
                      </button>
                    ))}
                  </div>
                )}
                {pendingShots.length > 0 && missingShots.length === 0 && (
                  <div className="muted" style={{ marginTop: "0.4rem" }}>
                    {pendingShots.length} shot{pendingShots.length === 1 ? "" : "s"} still pending review
                  </div>
                )}
              </div>
            )}

            <div className="row add-shot-row">
              <input
                style={{ flex: 1 }}
                value={shotTitle}
                onChange={(e) => setShotTitle(e.target.value)}
                placeholder="Shot title"
                disabled={busy}
                aria-label="Shot title"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shotTitle.trim() && !busy) {
                    (e.target as HTMLInputElement).blur();
                    document.getElementById("add-shot-btn")?.click();
                  }
                }}
              />
              <button
                id="add-shot-btn"
                disabled={busy || !shotTitle.trim()}
                title={!shotTitle.trim() ? "Enter a title first" : "Add shot to storyboard"}
                aria-busy={busyAction === "add-shot"}
                onClick={() => wrap("add-shot", async () => {
                  await api("/api/projects/" + projectId + "/shots", {
                    method: "POST",
                    body: JSON.stringify({ title: shotTitle.trim(), durationSec: 3 }),
                  });
                  setShotTitle("");
                  await loadProject(projectId);
                }, { successToast: "Shot added" })}
              >
                {busyAction === "add-shot" ? "Adding…" : "Add"}
              </button>
            </div>

            {project.storyboard.length === 0 && (
              <div className="empty-inline">No shots yet. Add a title above to build the storyboard.</div>
            )}

            {project.storyboard.map((s) => {
              const linked = s.clipId ? "linked" : "unlinked";
              const isSelected = selectedShotId === s.id;
              const clipSelected = !!(s.clipId && selectedClipId === s.clipId);
              const isGen = generatingShotId === s.id || busyAction === `generate:${s.id}`;
              return (
                <div
                  key={s.id}
                  className={
                    "card shot-card " +
                    (isSelected ? "active " : "") +
                    (clipSelected ? "timeline-synced " : "") +
                    linked
                  }
                  role="button"
                  tabIndex={0}
                  onClick={() => selectShot(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectShot(s);
                    }
                  }}
                >
                  <div className="shot-card-head">
                    <span className="shot-index" aria-hidden>#{s.index + 1}</span>
                    <div className="title">{s.title}</div>
                  </div>
                  <div className="row shot-meta">
                    <span className={"badge " + s.decision}>{decisionLabel(s.decision)}</span>
                    {!s.mediaId && <span className="badge missing">missing media</span>}
                    {s.clipId ? (
                      <span className="badge linked">on timeline</span>
                    ) : (
                      <span className="badge">not on timeline</span>
                    )}
                    <span className="muted">{s.durationSec}s</span>
                  </div>
                  {isGen && <div className="inline-status">Generating clip…</div>}
                  <div className="row shot-actions">
                    <button
                      disabled={busy}
                      title="Generate media for this shot"
                      aria-busy={busyAction === `generate:${s.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setGeneratingShotId(s.id);
                        wrap(`generate:${s.id}`, async () => {
                          await api("/api/projects/" + projectId + "/generate-clip", {
                            method: "POST",
                            body: JSON.stringify({ shotId: s.id }),
                          });
                          await loadProject(projectId);
                          setSelectedShotId(s.id);
                        }, {
                          successToast: `Generated #${s.index + 1}`,
                          retry: async () => {
                            setGeneratingShotId(s.id);
                            try {
                              await api("/api/projects/" + projectId + "/generate-clip", {
                                method: "POST",
                                body: JSON.stringify({ shotId: s.id }),
                              });
                              await loadProject(projectId);
                            } finally {
                              setGeneratingShotId(null);
                            }
                          },
                        }).finally(() => setGeneratingShotId(null));
                      }}
                    >
                      {busyAction === `generate:${s.id}` ? "Generating…" : "Generate"}
                    </button>
                    <button
                      className="good"
                      disabled={busy}
                      aria-busy={busyAction === `decide-shot:${s.id}:accepted`}
                      onClick={(e) => {
                        e.stopPropagation();
                        wrap(`decide-shot:${s.id}:accepted`, async () => {
                          await api("/api/projects/" + projectId + "/decide", {
                            method: "POST",
                            body: JSON.stringify({ targetType: "shot", targetId: s.id, decision: "accepted" }),
                          });
                          await loadProject(projectId);
                        }, { successToast: `Accepted #${s.index + 1}` });
                      }}
                    >
                      Accept
                    </button>
                    <button
                      className="bad"
                      disabled={busy}
                      aria-busy={busyAction === `decide-shot:${s.id}:rejected`}
                      onClick={(e) => {
                        e.stopPropagation();
                        wrap(`decide-shot:${s.id}:rejected`, async () => {
                          await api("/api/projects/" + projectId + "/decide", {
                            method: "POST",
                            body: JSON.stringify({ targetType: "shot", targetId: s.id, decision: "rejected" }),
                          });
                          await loadProject(projectId);
                        }, { successToast: `Rejected #${s.index + 1}` });
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </aside>

          <main className="panel main-panel">
            <div className="panel-head">
              <h2>Preview & Timeline</h2>
              <span className="panel-meta sync-hint">
                {selectedShot
                  ? `Shot #${selectedShot.index + 1}` +
                    (selectedClip ? " ↔ timeline clip" : " · no clip yet")
                  : selectedClip
                    ? "Timeline clip selected"
                    : "Select to sync"}
              </span>
            </div>

            <div className={"preview " + (isGeneratingSelected || generatingShotId ? "is-loading" : "")}>
              {previewAsset && !isGeneratingSelected ? (
                <>
                  <div className="preview-chrome">
                    <span className="preview-label">
                      {selectedShot
                        ? `Preview · Shot #${selectedShot.index + 1} · ${selectedShot.title}`
                        : "Preview · Timeline clip"}
                    </span>
                    {previewAsset.label && <span className="muted">{previewAsset.label}</span>}
                  </div>
                  <video key={previewAsset.id} controls src={mediaUrl(projectId, previewAsset)} />
                </>
              ) : (
                (() => {
                  const msg = previewEmptyMessage();
                  return (
                    <div className="empty preview-empty">
                      {(isGeneratingSelected || generatingShotId) && <div className="spinner" aria-hidden />}
                      <div className="empty-title">{msg.title}</div>
                      <div className="muted">{msg.detail}</div>
                    </div>
                  );
                })()
              )}
            </div>

            <div className="timeline-section">
              <div className="timeline-head">
                <h3>Timeline</h3>
                <span className="muted">Clips mirror storyboard shots · click either side to sync selection</span>
              </div>
              <div className="timeline">
                {project.tracks.map((t) => (
                  <div key={t.id} className="track">
                    <div className="track-label">
                      <span>{t.name}</span>
                      <span className="track-kind">{t.kind}</span>
                      <span className="muted">{t.clips.length} clip{t.clips.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="clips">
                      {t.clips.length === 0 && (
                        <div className="empty-inline track-empty">No clips yet — Generate from a storyboard shot</div>
                      )}
                      {t.clips.map((c) => {
                        const linkedShot = shotByClipId.get(c.id);
                        const isSelected = selectedClipId === c.id;
                        const shotActive = !!(linkedShot && selectedShotId === linkedShot.id);
                        return (
                          <div
                            key={c.id}
                            className={
                              "clip " +
                              (isSelected ? "selected " : "") +
                              (shotActive ? "shot-synced " : "") +
                              c.decision
                            }
                            onClick={() => selectClip(c)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                selectClip(c);
                              }
                            }}
                            title={
                              (c.label || c.id) +
                              " @ " +
                              c.startSec +
                              "s" +
                              (linkedShot ? ` · Shot #${linkedShot.index + 1} ${linkedShot.title}` : "")
                            }
                          >
                            <div className="clip-top">
                              {linkedShot ? (
                                <span className="shot-index micro">#{linkedShot.index + 1}</span>
                              ) : (
                                <span className="shot-index micro muted">—</span>
                              )}
                              <span className={"badge " + c.decision}>{decisionLabel(c.decision)}</span>
                            </div>
                            <div className="clip-label">{c.label || linkedShot?.title || "clip"}</div>
                            <div className="muted">
                              {c.startSec.toFixed(1)}s · {(c.outSec - c.inSec).toFixed(1)}s
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {(selectedShot || selectedClip) && (
              <div className="card selection-card">
                <div className="title">Selection</div>
                <div className="selection-grid">
                  {selectedShot && (
                    <div className="selection-block">
                      <div className="selection-kicker">Storyboard</div>
                      <div>
                        <span className="shot-index">#{selectedShot.index + 1}</span>{" "}
                        {selectedShot.title}
                      </div>
                      <div className="row" style={{ marginTop: "0.35rem" }}>
                        <span className={"badge " + selectedShot.decision}>{decisionLabel(selectedShot.decision)}</span>
                        {!selectedShot.mediaId && <span className="badge missing">missing media</span>}
                        {selectedShot.clipId ? (
                          <span className="badge linked">synced to timeline</span>
                        ) : (
                          <span className="badge">not on timeline</span>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedClip && (
                    <div className="selection-block">
                      <div className="selection-kicker">Timeline clip</div>
                      <div>{selectedClip.label || selectedClip.id.slice(0, 8)}</div>
                      <div className="muted">
                        start {selectedClip.startSec.toFixed(1)}s · dur{" "}
                        {(selectedClip.outSec - selectedClip.inSec).toFixed(1)}s
                      </div>
                      <div className="row" style={{ marginTop: "0.4rem" }}>
                        <button
                          className="good"
                          disabled={busy}
                          aria-busy={busyAction === `decide-clip:${selectedClip.id}:accepted`}
                          onClick={() => wrap(`decide-clip:${selectedClip.id}:accepted`, async () => {
                            await api("/api/projects/" + projectId + "/decide", {
                              method: "POST",
                              body: JSON.stringify({ targetType: "clip", targetId: selectedClip.id, decision: "accepted" }),
                            });
                            await loadProject(projectId);
                          }, { successToast: "Clip accepted" })}
                        >
                          Accept clip
                        </button>
                        <button
                          className="bad"
                          disabled={busy}
                          aria-busy={busyAction === `decide-clip:${selectedClip.id}:rejected`}
                          onClick={() => wrap(`decide-clip:${selectedClip.id}:rejected`, async () => {
                            await api("/api/projects/" + projectId + "/decide", {
                              method: "POST",
                              body: JSON.stringify({ targetType: "clip", targetId: selectedClip.id, decision: "rejected" }),
                            });
                            await loadProject(projectId);
                          }, { successToast: "Clip rejected" })}
                        >
                          Reject clip
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>

          <aside className="panel">
            <div className="panel-head">
              <h2>Assets</h2>
              <span className="panel-meta">{project.assets.length}</span>
            </div>
            {project.assets.length === 0 && <div className="empty-inline">No assets yet — generate a clip first</div>}
            {project.assets.map((a) => (
              <div key={a.id} className="card">
                <div className="title">{a.label || a.id.slice(0, 8)}</div>
                <div className="muted">{a.kind} · {a.durationSec ?? "?"}s</div>
                <div className="hash">{a.contentHash.slice(0, 16)}…</div>
              </div>
            ))}
            <div className="panel-head" style={{ marginTop: "1rem" }}>
              <h2>Decision log</h2>
              <span className="panel-meta">{project.decisions.length}</span>
            </div>
            {project.decisions.length === 0 && <div className="empty-inline">No decisions yet</div>}
            {[...project.decisions].reverse().slice(0, 20).map((d) => (
              <div key={d.id} className="card">
                <span className={"badge " + d.decision}>{decisionLabel(d.decision)}</span>{" "}
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
