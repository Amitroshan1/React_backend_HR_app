import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { compressImage } from "../Data";
import "./InventoryUploadLock.css";

const UploadCtx = createContext(null);

export function isUploadAbort(err) {
  return err?.name === "AbortError" || /aborted|cancelled/i.test(String(err?.message || ""));
}

export function throwIfUploadAborted(signal) {
  if (signal?.aborted) {
    const err = new Error("Upload cancelled");
    err.name = "AbortError";
    throw err;
  }
}

export async function fileToJpegDataUrl(file, signal) {
  throwIfUploadAborted(signal);
  const raw = await compressImage(file);
  throwIfUploadAborted(signal);
  if (typeof raw !== "string" || !raw.startsWith("data:")) {
    throw new Error("Could not read that file.");
  }
  if (!file.type?.startsWith("image/") && !raw.startsWith("data:image/")) {
    return raw;
  }
  const bitmap = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Use a JPG or PNG photo."));
    img.src = raw;
  });
  throwIfUploadAborted(signal);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width || 1, bitmap.height || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((bitmap.width || 1) * scale));
  canvas.height = Math.max(1, Math.round((bitmap.height || 1) * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  throwIfUploadAborted(signal);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export async function encodeInventoryFiles(files, { imagesOnly = false, signal, onProgress } = {}) {
  const list = Array.from(files || []);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    throwIfUploadAborted(signal);
    const file = list[i];
    const name = file.name || "file";
    const isImage = Boolean(file.type?.startsWith("image/"));
    if (imagesOnly && !isImage && file.type) {
      throw new Error(`${name} is not an image.`);
    }
    const data = isImage || imagesOnly
      ? await fileToJpegDataUrl(file, signal)
      : await compressImage(file);
    throwIfUploadAborted(signal);
    out.push({ data, name, isImage: isImage || String(data).startsWith("data:image/") });
    onProgress?.(((i + 1) / list.length) * 100);
  }
  return out;
}

export function InventoryUploadProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("Uploading…");
  const [progress, setProgress] = useState(0);
  const [indeterminate, setIndeterminate] = useState(true);
  const abortRef = useRef(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runUpload = useCallback(async (nextLabel, work) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLabel(nextLabel || "Uploading…");
    setProgress(0);
    setIndeterminate(true);
    setOpen(true);
    try {
      return await work({
        signal: ac.signal,
        setProgress: (value) => {
          if (value == null || value < 0) {
            setIndeterminate(true);
            return;
          }
          setIndeterminate(false);
          setProgress(Math.max(0, Math.min(100, Number(value) || 0)));
        },
        setLabel,
      });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setOpen(false);
      setProgress(0);
      setIndeterminate(true);
    }
  }, []);

  const value = useMemo(
    () => ({ runUpload, cancel, busy: open }),
    [runUpload, cancel, open],
  );

  return (
    <UploadCtx.Provider value={value}>
      {children}
      {open ? (
        <div className="inv-uplock" role="alertdialog" aria-busy="true" aria-live="polite">
          <div className="inv-uplock__card">
            <Loader2 className="inv-uplock__spin" size={28} />
            <p className="inv-uplock__label">{label}</p>
            <div className="inv-uplock__bar" aria-hidden>
              <span
                className={indeterminate ? "inv-uplock__fill is-indeterminate" : "inv-uplock__fill"}
                style={indeterminate ? undefined : { width: `${progress}%` }}
              />
            </div>
            <p className="inv-uplock__hint">
              {indeterminate ? "Working…" : `${Math.round(progress)}%`} · page is locked until this finishes
            </p>
            <button type="button" className="inv-uplock__cancel" onClick={cancel}>
              <X size={14} /> Cancel upload
            </button>
          </div>
        </div>
      ) : null}
    </UploadCtx.Provider>
  );
}

export function useInventoryUpload() {
  const ctx = useContext(UploadCtx);
  if (!ctx) {
    return {
      runUpload: async (_label, work) => work({
        signal: undefined,
        setProgress: () => {},
        setLabel: () => {},
      }),
      cancel: () => {},
      busy: false,
    };
  }
  return ctx;
}
