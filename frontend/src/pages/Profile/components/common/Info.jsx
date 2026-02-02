import React from 'react';

export const Info = ({ label, value }) => {
    const displayValue = value || '-';
    return (
        <div className="info-box">
            <p className="label">{label}</p>
            <p className="value">{displayValue}</p>
        </div>
    );
}