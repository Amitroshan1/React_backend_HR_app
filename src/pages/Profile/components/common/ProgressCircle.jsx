import React from 'react';

export const ProgressCircle = ({ progressValue }) => {
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (progressValue / 100) * circumference;

    return (
        <div className="card progress-card" style={{ padding: '20px', textAlign: 'center' }}>
            <h3>Profile Completion</h3>
            <div style={{ position: 'relative', width: '120px', height: '120px', margin: '15px auto 5px' }}>
                <svg width="120" height="120" viewBox="0 0 120 120">
                    {/* Background Circle */}
                    <circle cx="60" cy="60" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
                    {/* Foreground Circle */}
                    <circle 
                        cx="60" cy="60" r={radius} 
                        fill="none" 
                        stroke="#10b981" 
                        strokeWidth="10" 
                        strokeDasharray={circumference} 
                        strokeDashoffset={offset} 
                        strokeLinecap="round" 
                        style={{ transition: 'stroke-dashoffset 0.5s ease-in-out', transform: 'rotate(-90deg)', transformOrigin: '60px 60px' }} 
                    />
                </svg>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontWeight: 'bold', fontSize: '24px', color: '#10b981' }}>
                    {progressValue}%
                </div>
            </div>
            <p className="sub" style={{ fontSize: '14px', color: '#6b7280' }}>
                {progressValue < 100 ? `You are ${100 - progressValue}% away from a complete profile.` : "Your profile is 100% complete! 🎉"}
            </p>
        </div>
    );
}