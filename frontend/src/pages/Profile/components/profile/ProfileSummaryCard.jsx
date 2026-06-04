import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../utils/gradientStyles';
import { ProfileAvatar } from './ProfileAvatar';

export const ProfileSummaryCard = ({
    formData,
    currentAddress,
    avatarUrl,
    onImageChange,
    onEdit,
    showEditButton = true,
}) => {
    const locationLine = [currentAddress?.city, currentAddress?.pincode]
        .filter(Boolean)
        .join(', ');

    const designationTrimmed = (formData.designation || '').trim();
    const isPlaceholderDesignation =
        !designationTrimmed || designationTrimmed.toLowerCase() === 'not specified';
    const rolePrimary = isPlaceholderDesignation
        ? (formData.employeeId || '').trim()
        : designationTrimmed;
    const roleLine = [rolePrimary, formData.department].filter(Boolean).join(' · ');

    return (
        <div className="profile-summary-card card card--summary">
            <ProfileAvatar imageUrl={avatarUrl} onImageChange={onImageChange} />

            <h3 className="profile-summary-name">
                <span style={GRADIENT_HEADER_STYLE}>
                    {formData.fullName || 'Your name'}
                </span>
            </h3>
            <p className="profile-summary-role">
                {roleLine || 'Complete your profile'}
            </p>

            <hr className="profile-summary-divider" />

            <ul className="profile-summary-contacts">
                {formData.personalEmail && (
                    <li>
                        <span className="profile-summary-icon" aria-hidden>
                            @
                        </span>
                        {formData.personalEmail}
                    </li>
                )}
                {formData.mobile && (
                    <li>
                        <span className="profile-summary-icon" aria-hidden>
                            ☎
                        </span>
                        {formData.mobileCountryCode
                            ? `${formData.mobileCountryCode} ${formData.mobile}`
                            : formData.mobile}
                    </li>
                )}
                {locationLine && (
                    <li>
                        <span className="profile-summary-icon" aria-hidden>
                            ⌖
                        </span>
                        {locationLine}
                    </li>
                )}
            </ul>

            {showEditButton && onEdit && (
                <button type="button" className="profile-btn-gradient profile-btn-gradient--compact" onClick={onEdit}>
                    Edit profile
                </button>
            )}
        </div>
    );
};
