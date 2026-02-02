import React from 'react';

let uniqueIdCounter = 0;

export const SelectInput = ({
    label,
    name,
    value,
    onChange,
    options = [],
    error,
    ...rest
}) => {
    const id = React.useMemo(
        () => `select-${name}-${uniqueIdCounter++}`,
        [name]
    );

    const hasValue = value !== undefined && value !== '';

    return (
        <div className={`form-group ${error ? 'has-error' : ''}`}>
            <select
                id={id}
                name={name}
                value={value || ''}
                onChange={onChange}
                className="form-control"
                {...rest}
            >
                <option value="" hidden />
                {options.map(opt => (
                    <option key={opt} value={opt}>
                        {opt}
                    </option>
                ))}
            </select>

            {label && (
                <label
                    htmlFor={id}
                    className={`input-label ${hasValue ? 'label-float' : ''}`}
                >
                    {label}
                </label>
            )}

            {error && <div className="error-message">{error}</div>}
        </div>
    );
}

