import React, { useEffect, useMemo, useState } from 'react';
import { getUserPhotoUrl, makeInitialsAvatar } from '../utils/userPhoto';

/**
 * User/employee avatar: shows uploaded photo when available, else initials.
 */
export function UserAvatar({
  user,
  photo,
  photoUrl,
  photo_url,
  name = '',
  className = '',
  imgClassName = '',
  alt,
  initialsBg = '#4CAF50',
  as = 'img',
}) {
  const displayName = name || user?.name || user?.fullName || '';
  const resolvedPhoto = useMemo(
    () => getUserPhotoUrl(user) || normalizeFromProps(photo_url, photoUrl, photo),
    [user, photo, photoUrl, photo_url],
  );
  const fallbackSrc = useMemo(
    () => makeInitialsAvatar(displayName, initialsBg),
    [displayName, initialsBg],
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [resolvedPhoto]);
  const src = resolvedPhoto && !failed ? resolvedPhoto : fallbackSrc;

  if (as === 'span') {
    return (
      <span className={className} aria-hidden>
        <img
          src={src}
          alt=""
          className={imgClassName}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
        />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? (displayName || 'User')}
      className={className || imgClassName}
      onError={() => setFailed(true)}
    />
  );
}

function normalizeFromProps(...values) {
  for (const v of values) {
    const u = getUserPhotoUrl({ photo: v, photo_url: v, photoUrl: v });
    if (u) return u;
  }
  return '';
}
