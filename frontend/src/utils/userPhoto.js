/**
 * Normalize profile photo paths from API (relative /static/uploads/...).
 */
export function normalizePhotoUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let path = url.trim();
  if (!path) return '';
  if (path.startsWith('/public/')) path = path.replace('/public/', '/');
  if (path.startsWith('http://') || path.startsWith('https://')) {
    try {
      const u = new URL(path);
      path = u.pathname || path;
    } catch {
      /* keep */
    }
  }
  return path;
}

/** First non-empty photo field on a user/employee object. */
export function getUserPhotoUrl(user) {
  if (!user) return '';
  const raw = user.photo_url || user.photoUrl || user.photo || '';
  return normalizePhotoUrl(raw);
}

/** Canvas initials avatar (fallback when no upload). */
export function makeInitialsAvatar(name = '', bg = '#4CAF50') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0]?.[0] || '?').toUpperCase();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 52px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, 64, 64);
  return canvas.toDataURL('image/png');
}
