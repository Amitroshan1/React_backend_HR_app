/**
 * Open an image URL in a new browser tab at full size (http(s), blob, and data URLs).
 */

function dataUrlToBlobUrl(dataUrl) {
  const parts = String(dataUrl).split(",");
  if (parts.length < 2) return null;
  const mime = parts[0].match(/:(.*?);/)?.[1] || "image/png";
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/**
 * Open a URL in a new tab via a temporary anchor click.
 * Avoids window.open() return-value false positives (modern browsers return null
 * for _blank even when the tab opens successfully).
 */
function openUrlInNewTab(url) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Open an image URL in a new browser tab at full size.
 */
export function openImageInNewTab(src) {
  const trimmed = String(src || "").trim();
  if (!trimmed) return false;

  let objectUrl = null;

  try {
    let openUrl = trimmed;
    if (trimmed.startsWith("data:")) {
      objectUrl = dataUrlToBlobUrl(trimmed);
      if (!objectUrl) return false;
      openUrl = objectUrl;
    }

    openUrlInNewTab(openUrl);

    if (objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
    }
    return true;
  } catch (err) {
    console.error("[openImageInNewTab]", err);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return false;
  }
}

/** Open the first image from a list in a new tab. */
export function openFirstImageInNewTab(photos) {
  const list = Array.isArray(photos) ? photos : [];
  const first = list.find((p) => String(p || "").trim());
  if (!first) return false;
  return openImageInNewTab(first);
}
