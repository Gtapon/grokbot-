import React, { useCallback, useState } from "react";

type ApiFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type MediaBridgeProps = {
  projectId: string;
  assets: { id: string; label?: string; kind: string; durationSec?: number; contentHash: string; path: string }[];
  selectedClip: {
    id: string;
    startSec: number;
    inSec: number;
    outSec: number;
    label?: string;
  } | null;
  selectedMediaId: string | null;
  onSelectMedia: (id: string | null) => void;
  reload: () => Promise<void>;
  api: ApiFn;
  busy: boolean;
  setToast: (msg: string | null) => void;
  setError: (msg: string | null) => void;
};

/** Import dropzone, asset actions (Place / AI edit), and clip trim/reorder controls. */
export function MediaBridge(props: MediaBridgeProps) {
  const { projectId, assets, selectedClip, selectedMediaId, onSelectMedia, reload, api, busy, setToast, setError } = props;
  const [dragOver, setDragOver] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [trimIn, setTrimIn] = useState("");
  const [trimOut, setTrimOut] = useState("");
  const [trimStart, setTrimStart] = useState("");

  React.useEffect(() => {
    if (!selectedClip) return;
    setTrimIn(String(selectedClip.inSec));
    setTrimOut(String(selectedClip.outSec));
    setTrimStart(String(selectedClip.startSec));
  }, [selectedClip?.id, selectedClip?.inSec, selectedClip?.outSec, selectedClip?.startSec]);

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const file of list) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const contentBase64 = btoa(binary);
      await api("/api/projects/" + projectId + "/import-media-upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentBase64, label: file.name }),
      });
    }
    await reload();
    setToast("Imported " + list.length + " file(s)");
  }, [api, projectId, reload, setToast]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      importFiles(e.target.files).catch((err) => setError(String(err.message || err)));
      e.target.value = "";
    }
  };

  const el = React.createElement;
  const dropzone = el(
    "div",
    {
      className: "dropzone " + (dragOver ? "active" : ""),
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); },
      onDragLeave: () => setDragOver(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) {
          importFiles(e.dataTransfer.files).catch((err) => setError(String(err.message || err)));
        }
      },
    },
    el("div", { className: "dropzone-title" }, "Import videos"),
    el("div", { className: "muted" }, "Drag & drop or pick files"),
    el("input", { type: "file", accept: "video/*,image/*", multiple: true, disabled: busy, onChange: onPick }),
  );

  const assetCards = assets.map((a) =>
    el(
      "div",
      {
        key: a.id,
        className: "card" + (selectedMediaId === a.id ? " active" : ""),
        onClick: () => onSelectMedia(a.id),
        role: "button",
        tabIndex: 0,
      },
      el("div", { className: "title" }, a.label || a.id.slice(0, 8)),
      el("div", { className: "muted" }, a.kind + " · " + (a.durationSec ?? "?") + "s"),
      el("div", { className: "hash" }, a.contentHash.slice(0, 16) + "…"),
      el(
        "div",
        { className: "row", style: { marginTop: "0.35rem" } },
        el(
          "button",
          {
            disabled: busy,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              api("/api/projects/" + projectId + "/place-clip", {
                method: "POST",
                body: JSON.stringify({ mediaId: a.id }),
              })
                .then(() => reload())
                .then(() => setToast("Placed on timeline"))
                .catch((err) => setError(String(err.message || err)));
            },
          },
          "Place",
        ),
        el(
          "button",
          {
            className: "primary",
            disabled: busy,
            title: "この素材でAI編集",
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              api("/api/projects/" + projectId + "/ai-edit", {
                method: "POST",
                body: JSON.stringify({ mediaId: a.id, prompt: aiPrompt || undefined }),
              })
                .then(() => reload())
                .then(() => setToast("AI edit applied"))
                .catch((err) => setError(String(err.message || err)));
            },
          },
          "この素材でAI編集",
        ),
      ),
    ),
  );

  const promptRow = el(
    "div",
    { className: "row", style: { marginBottom: "0.5rem" } },
    el("input", {
      style: { flex: 1 },
      value: aiPrompt,
      placeholder: "Optional AI prompt",
      disabled: busy,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setAiPrompt(e.target.value),
    }),
  );

  let trimPanel: React.ReactNode = null;
  if (selectedClip) {
    trimPanel = el(
      "div",
      { className: "card trim-panel" },
      el("div", { className: "title" }, "Trim / reorder"),
      el(
        "div",
        { className: "row" },
        el("label", null, "in", el("input", { value: trimIn, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTrimIn(e.target.value) })),
        el("label", null, "out", el("input", { value: trimOut, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTrimOut(e.target.value) })),
        el("label", null, "start", el("input", { value: trimStart, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTrimStart(e.target.value) })),
        el(
          "button",
          {
            className: "primary",
            disabled: busy,
            onClick: () => {
              api("/api/projects/" + projectId + "/update-clip", {
                method: "POST",
                body: JSON.stringify({
                  clipId: selectedClip.id,
                  inSec: Number(trimIn),
                  outSec: Number(trimOut),
                  startSec: Number(trimStart),
                }),
              })
                .then(() => reload())
                .then(() => setToast("Clip updated"))
                .catch((err) => setError(String(err.message || err)));
            },
          },
          "Apply trim",
        ),
      ),
      el(
        "div",
        { className: "row", style: { marginTop: "0.4rem" } },
        el(
          "button",
          {
            disabled: busy,
            onClick: () => {
              api("/api/projects/" + projectId + "/move-clip", {
                method: "POST",
                body: JSON.stringify({ clipId: selectedClip.id, direction: "up" }),
              })
                .then(() => reload())
                .catch((err) => setError(String(err.message || err)));
            },
          },
          "Up",
        ),
        el(
          "button",
          {
            disabled: busy,
            onClick: () => {
              api("/api/projects/" + projectId + "/move-clip", {
                method: "POST",
                body: JSON.stringify({ clipId: selectedClip.id, direction: "down" }),
              })
                .then(() => reload())
                .catch((err) => setError(String(err.message || err)));
            },
          },
          "Down",
        ),
      ),
    );
  }

  return el(
    "div",
    { className: "media-bridge" },
    dropzone,
    promptRow,
    ...assetCards,
    trimPanel,
  );
}
