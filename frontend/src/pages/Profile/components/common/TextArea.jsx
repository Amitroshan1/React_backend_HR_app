import React from 'react';

export const TextArea = ({ label, value, onChange, name, readOnly = false, error, placeholder, maxLength, ...rest }) => {
    const len = (value || '').length;
    const atLimit = maxLength && len >= maxLength;
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
                maxLength={maxLength}
                {...rest}
            />
            {maxLength && (
                <p
                    className={`char-count ${atLimit ? 'char-count--limit' : ''}`}
                    style={{
                        fontSize: '12px',
                        color: atLimit ? '#b91c1c' : '#6b7280',
                        marginTop: '4px',
                    }}
                >
                    {len}/{maxLength} characters
                </p>
            )}
            {error && <p className="error-text">{error}</p>}
        </div>
    );
}