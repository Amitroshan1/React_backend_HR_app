import React, { useMemo, useState } from 'react';

const COUNTRY_CODES = [
    { code: '+91', country: 'India', flag: '🇮🇳' },
    { code: '+1', country: 'USA', flag: '🇺🇸' },
    { code: '+44', country: 'UK', flag: '🇬🇧' },
    { code: '+61', country: 'Australia', flag: '🇦🇺' },
    { code: '+971', country: 'UAE', flag: '🇦🇪' },
    { code: '+65', country: 'Singapore', flag: '🇸🇬' },
    { code: '+49', country: 'Germany', flag: '🇩🇪' },
    { code: '+33', country: 'France', flag: '🇫🇷' },
    { code: '+81', country: 'Japan', flag: '🇯🇵' },
    { code: '+86', country: 'China', flag: '🇨🇳' },
    { code: '+7', country: 'Russia', flag: '🇷🇺' },
    { code: '+55', country: 'Brazil', flag: '🇧🇷' },
    { code: '+27', country: 'South Africa', flag: '🇿🇦' },
    { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦' },
    { code: '+974', country: 'Qatar', flag: '🇶🇦' },
];

let uniqueIdCounter = 0;

export const PhoneInput = ({
    label,
    name,
    value,
    countryCode,
    countryCodeName,
    onChange,
    error,
    isMandatory,
    helpText,
}) => {
    const id = useMemo(() => `phone-${name}-${uniqueIdCounter++}`, [name]);
    const [focused, setFocused] = useState(false);

    const displayValue =
        value !== undefined && value !== null ? String(value).replace(/\D/g, '').slice(0, 10) : '';
    const hasValue = displayValue.length > 0;
    const floatLabel = hasValue || focused || Boolean(countryCode);

    const emitChange = (fieldName, fieldValue) => {
        if (!onChange) return;
        onChange({
            target: {
                name: fieldName,
                value: fieldValue,
            },
        });
    };

    const handleCodeChange = (e) => {
        emitChange(countryCodeName, e.target.value);
    };

    const handleNumberChange = (e) => {
        const raw = e.target.value;
        const parts = String(raw).split('.');
        const intPart = (parts[0] || '').replace(/\D/g, '');
        emitChange(name, intPart.slice(0, 10));
    };

    return (
        <div className={`form-group floating-field phone-input-group ${error ? 'has-error' : ''}`}>
            <div className="phone-input-wrapper">
                <select
                    name={countryCodeName}
                    value={countryCode || '+91'}
                    onChange={handleCodeChange}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    className="form-control country-code-select"
                    aria-label={`${label || name} country code`}
                >
                    {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>
                            {c.flag} {c.code}
                        </option>
                    ))}
                </select>

                <input
                    id={id}
                    name={name}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={10}
                    value={displayValue}
                    onChange={handleNumberChange}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    className="form-control phone-number-input"
                    placeholder=" "
                />
            </div>

            {label && (
                <label
                    htmlFor={id}
                    className={`input-label ${floatLabel ? 'label-float' : ''}`}
                >
                    {label}
                    {isMandatory && <span className="mandatory-star">*</span>}
                </label>
            )}

            {helpText && (
                <div className="input-help-text" style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                    {helpText}
                </div>
            )}

            {error && <div className="error-message">{error}</div>}
        </div>
    );
};
