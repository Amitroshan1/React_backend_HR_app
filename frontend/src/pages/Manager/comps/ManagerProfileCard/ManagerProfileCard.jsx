import { UserAvatar } from "../../../../components/UserAvatar";
import "./ManagerProfileCard.css";

export function ManagerProfileCard({ profile, loading, showScope = true }) {
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

  const { name, email, mobile, designation, current_address, scope, assigned_scopes, photo_url } = profile;
  const normalizedAssignedScopes = Array.isArray(assigned_scopes)
    ? assigned_scopes
        .map((s) => ({
          emp_type: (s?.emp_type || "").trim(),
          circle: (s?.circle || "").trim(),
        }))
        .filter((s) => s.emp_type || s.circle)
    : [];
  const fallbackScope = [scope?.emp_type, scope?.circle].filter(Boolean).join(" · ");
  const scopeText = normalizedAssignedScopes.length
    ? normalizedAssignedScopes
        .map((s) => [s.emp_type, s.circle].filter(Boolean).join(" · "))
        .join(", ")
    : (fallbackScope || "—");
  return (
    <div className="manager-profile-card">
      <div className="manager-profile-card__photo-wrap">
        <UserAvatar
          user={profile}
          photo_url={photo_url}
          name={name}
          className="manager-profile-card__photo"
          alt={name || "Manager"}
          initialsBg="#2563eb"
        />
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
        {showScope && (
          <div className="manager-profile-card__row manager-profile-card__scope-row">
            <span className="manager-profile-card__label">Data visible for</span>
            <span className="manager-profile-card__value manager-profile-card__scope">{scopeText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
