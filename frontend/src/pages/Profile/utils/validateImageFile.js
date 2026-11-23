/** True if the browser can decode the file as a raster image. */
export function isDecodableImageFile(file) {
    if (!file) return Promise.resolve(false);
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        const done = (ok) => {
            URL.revokeObjectURL(url);
            resolve(Boolean(ok));
        };
        img.onload = () => done(img.naturalWidth > 0 && img.naturalHeight > 0);
        img.onerror = () => done(false);
        img.src = url;
    });
}

export function isLikelyImageFile(file) {
    if (!file) return false;
    if (String(file.type || "").startsWith("image/")) return true;
    return /\.(jpe?g|png|gif|webp)$/i.test(file.name || "");
}
