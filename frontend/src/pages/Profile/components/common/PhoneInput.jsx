import React, { useMemo } from 'react';

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

    const hasValue = value !== undefined && value !== null && value !== '';

    const handleCodeChange = (e) => {
        onChange({
            target: {
                name: countryCodeName,
                value: e.target.value
            }
        });
    };

    const handleNumberChange = (e) => {
        const numericValue = e.target.value.replace(/\D/g, '').slice(0, 10);
        onChange({
            target: {
                name: name,
                value: numericValue
            }
        });
    };

    return (
        <div className={`form-group floating-field phone-input-group ${error ? 'has-error' : ''}`}>
            {label && (
                <label
                    htmlFor={id}
                    className={`input-label ${hasValue || countryCode ? 'label-float' : ''}`}
                    style={{ left: '0' }}
                >
                    {label}
                    {isMandatory && <span className="mandatory-star">*</span>}
                </label>
            )}

            <div className="phone-input-wrapper" style={{ display: 'flex', gap: '8px' }}>
                <select
                    name={countryCodeName}
                    value={countryCode || '+91'}
                    onChange={handleCodeChange}
                    className="form-control country-code-select"
                    style={{
                        width: '110px',
                        flexShrink: 0,
                        paddingRight: '8px',
                        cursor: 'pointer',
                    }}
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
                    pattern="[0-9]*"
                    maxLength={10}
                    value={value || ''}
                    onChange={handleNumberChange}
                    className="form-control"
                    placeholder="10-digit number"
                    style={{ flex: 1 }}
                />
            </div>

            {helpText && (
                <div className="input-help-text" style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                    {helpText}
                </div>
            )}

            {error && <div className="error-message">{error}</div>}
        </div>
    );
};
