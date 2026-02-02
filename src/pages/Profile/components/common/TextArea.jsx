import React from 'react';

export const TextArea = ({ label, value, onChange, name, readOnly = false, error, placeholder }) => {
    return (
        <div className="input-box">
            <label>{label}</label>
            <textarea
                value={value}
                onChange={onChange}
                name={name}
                readOnly={readOnly}
                placeholder={placeholder}
                className={error ? 'input-error' : ''}
                rows="3"
            />
            {error && <p className="error-text">{error}</p>}
        </div>
    );
}