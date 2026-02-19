import "./ManagerProfileCard.css";

export function ManagerProfileCard({ profile, loading }) {
  if (loading) {
    return (
      <div className="manager-profile-card manager-profile-card--loading">
        <div className="manager-profile-card__photo manager-profile-card__photo--skeleton" />
        <div className="manager-profile-card__details">
          <div className="manager-profile-card__skeleton-line" style={{ width: "40%" }} />
          <div className="manager-profile-card__skeleton-line" style={{ width: "60%" }} />
          <div className="manager-profile-card__skeleton-line" style={{ width: "35%" }} />
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const { name, email, mobile, designation, current_address, scope, photo_url } = profile;
  const scopeText = [scope?.emp_type, scope?.circle].filter(Boolean).join(" · ") || "—";
  const defaultAvatarUrl = name
    ? `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2563eb&color=fff&size=120`
    : "https://ui-avatars.com/api/?name=Manager&background=2563eb&color=fff&size=120";

  return (
    <div className="manager-profile-card">
      <div className="manager-profile-card__photo-wrap">
        {photo_url ? (
          <img
            src={photo_url}
            alt={name || "Manager"}
            className="manager-profile-card__photo"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = defaultAvatarUrl;
            }}
          />
        ) : (
          <img
            src={defaultAvatarUrl}
            alt={name || "Manager"}
            className="manager-profile-card__photo"
          />
        )}
      </div>
      <div className="manager-profile-card__details">
        {name && (
          <div className="manager-profile-card__row">
            <span className="manager-profile-card__label">Name</span>
            <span className="manager-profile-card__value">{name}</span>
          </div>
        )}
        {email && (
          <div className="manager-profile-card__row">
            <span className="manager-profile-card__label">Email</span>
            <span className="manager-profile-card__value">{email}</span>
          </div>
        )}
        {mobile && (
          <div className="manager-profile-card__row">
            <span className="manager-profile-card__label">Phone</span>
            <span className="manager-profile-card__value">{mobile}</span>
          </div>
        )}
        {designation && (
          <div className="manager-profile-card__row">
            <span className="manager-profile-card__label">Department</span>
            <span className="manager-profile-card__value">{designation}</span>
          </div>
        )}
        {current_address && (
          <div className="manager-profile-card__row">
            <span className="manager-profile-card__label">Current address</span>
            <span className="manager-profile-card__value manager-profile-card__address">{current_address}</span>
          </div>
        )}
        <div className="manager-profile-card__row manager-profile-card__scope-row">
          <span className="manager-profile-card__label">Data visible for</span>
          <span className="manager-profile-card__value manager-profile-card__scope">{scopeText}</span>
        </div>
      </div>
    </div>
  );
}
