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
    ...rest
}) => {
    const id = React.useMemo(
        () => `input-${name}-${uniqueIdCounter++}`,
        [name]
    );

    const hasValue = value !== undefined && value !== null && value !== '';

    return (
        <div className={`form-group floating-field ${error ? 'has-error' : ''}`}>
            
            {/* Input */}
            <input
                id={id}
                name={name}
                type={type}
                value={value}
                onChange={onChange}
                className="form-control"
                placeholder=" "   // REQUIRED for floating label
                {...rest}
            />

            {/* Floating Label */}
            {label && (
                <label
                    htmlFor={id}
                    className={`input-label ${hasValue ? 'label-float' : ''}`}
                >
                    {label}
                    {rest.isMandatory && (
                        <span className="mandatory-star">*</span>
                    )}
                </label>
            )}

            {/* Error */}
            {error && <div className="error-message">{error}</div>}
        </div>
    );
}


