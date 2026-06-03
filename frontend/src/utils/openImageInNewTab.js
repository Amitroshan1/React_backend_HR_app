/**
 * Open an image URL in a new browser tab at full size (works for http(s), blob, and data URLs).
 */
export function openImageInNewTab(src) {
  const trimmed = String(src || "").trim();
  if (!trimmed) return false;

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    const opened = window.open(trimmed, "_blank", "noopener,noreferrer");
    if (!opened) window.alert("Please allow pop-ups to view the image.");
    return Boolean(opened);
  }

  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) {
    window.alert("Please allow pop-ups to view the image.");
    return false;
  }

  const safeSrc = trimmed
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Image preview</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    img {
      max-width: 100%;
      max-height: 100vh;
      object-fit: contain;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <img src="${safeSrc}" alt="Image preview" />
</body>
</html>`);
  w.document.close();
  return true;
}

/** Open the first image from a list in a new tab. */
export function openFirstImageInNewTab(photos) {
  const list = Array.isArray(photos) ? photos : [];
  const first = list.find((p) => String(p || "").trim());
  if (!first) return false;
  return openImageInNewTab(first);
}
