import React from 'react';

// Unique ID generator (unchanged)
let uniqueIdCounter = 0;

export const Input = ({
    label,
    name,
    value,
    onChange,
    type = 'text',
    error,
    isMandatory,
    helpText,
    ...rest
}) => {
    const id = React.useMemo(
        () => `input-${name}-${uniqueIdCounter++}`,
        [name]
    );

    const hasValue = value !== undefined && value !== null && value !== '';

    return (
        <div className={`form-group floating-field ${error ? 'has-error' : ''}`}>
            {label && (
                <label
                    htmlFor={id}
                    className={`input-label ${hasValue ? 'label-float' : ''}`}
                >
                    {label}
                    {isMandatory && (
                        <span className="mandatory-star">*</span>
                    )}
                </label>
            )}

            <input
                id={id}
                name={name}
                type={type}
                value={value || ''}
                onChange={onChange}
                className="form-control"
                placeholder=" "
                {...rest}
            />

            {/* Help text - not a DOM prop */}
            {helpText && <div className="input-help-text" style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{helpText}</div>}

            {/* Error */}
            {error && <div className="error-message">{error}</div>}
        </div>
    );
}


