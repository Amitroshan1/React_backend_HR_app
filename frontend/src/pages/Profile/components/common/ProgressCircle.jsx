import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../utils/gradientStyles';

export const ProgressCircle = ({ progressValue, sections = [] }) => {
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (progressValue / 100) * circumference;
    const incompleteCount = sections.filter((s) => !s.complete).length;

    return (
        <div className="card progress-card">
            <h3>
                <span style={GRADIENT_HEADER_STYLE}>Profile completion</span>
            </h3>
            <div className="progress-circle-ring">
                <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
                    <circle cx="60" cy="60" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
                    <circle
                        cx="60"
                        cy="60"
                        r={radius}
                        fill="none"
                        stroke={progressValue >= 100 ? '#10b981' : '#3b82f6'}
                        strokeWidth="10"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className="progress-circle-arc"
                    />
                </svg>
                <div className="progress-circle-value">{progressValue}%</div>
            </div>
            <p className="progress-circle-caption">
                {progressValue >= 100
                    ? 'Your profile is fully complete.'
                    : incompleteCount > 0
                      ? `${incompleteCount} section${incompleteCount !== 1 ? 's' : ''} below need updates.`
                      : `You are ${100 - progressValue}% away from a complete profile.`}
            </p>
        </div>
    );
};
