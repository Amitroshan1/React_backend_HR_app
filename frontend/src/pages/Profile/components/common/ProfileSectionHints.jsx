import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../utils/gradientStyles';

/**
 * Checklist of profile sections with missing-field hints (aligned with backend requirements).
 */
export const ProfileSectionHints = ({
    sections = [],
    totalPercent = 0,
    onSectionClick,
    compact = false,
}) => {
    const incomplete = sections.filter((s) => !s.complete);

    return (
        <div className={`profile-hints card ${compact ? 'profile-hints--compact' : ''}`}>
            <div className="profile-hints-header">
                <h3>
                    <span style={GRADIENT_HEADER_STYLE}>Complete your profile</span>
                </h3>
                <span className="profile-hints-pct">{totalPercent}%</span>
            </div>

            {totalPercent === 100 ? (
                <p className="profile-hints-done">All sections are complete.</p>
            ) : (
                <p className="profile-hints-intro">
                    {incomplete.length} section{incomplete.length !== 1 ? 's' : ''} still need attention:
                </p>
            )}

            <ul className="profile-hints-list">
                {sections.map((section) => (
                    <li
                        key={section.id}
                        className={`profile-hints-item ${
                            section.complete ? 'profile-hints-item--done' : 'profile-hints-item--todo'
                        }`}
                    >
                        <div className="profile-hints-item-head">
                            <span
                                className="profile-hints-status"
                                aria-hidden
                                title={section.complete ? 'Complete' : 'Incomplete'}
                            >
                                {section.complete ? '✓' : '○'}
                            </span>
                            <span className="profile-hints-label">{section.label}</span>
                            {!section.complete && onSectionClick && (
                                <button
                                    type="button"
                                    className="profile-hints-fix-btn"
                                    onClick={() => onSectionClick(section.editKey)}
                                >
                                    Update
                                </button>
                            )}
                        </div>
                        {!section.complete && section.missing?.length > 0 && (
                            <ul className="profile-hints-missing">
                                {section.missing.slice(0, compact ? 3 : 8).map((hint) => (
                                    <li key={hint}>{hint}</li>
                                ))}
                                {section.missing.length > (compact ? 3 : 8) && (
                                    <li className="profile-hints-more">
                                        +{section.missing.length - (compact ? 3 : 8)} more
                                    </li>
                                )}
                            </ul>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
};
