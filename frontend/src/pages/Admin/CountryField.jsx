import { useId, useState } from 'react';

export const DEFAULT_COUNTRIES = ['India', 'USA', 'Uganda', 'UAE', 'Dubai', 'China'];

export default function CountryField({ value = '', onChange, required = false }) {
  const id = useId();
  const [customMode, setCustomMode] = useState(
    Boolean(value && !DEFAULT_COUNTRIES.includes(value)),
  );

  return (
    <div className="cust-field cust-country-field">
      <label htmlFor={`${id}-select`}>Country{required ? ' *' : ''}</label>
      {!customMode ? (
        <select
          id={`${id}-select`}
          value={value}
          required={required}
          onChange={(event) => {
            if (event.target.value === '__custom__') {
              setCustomMode(true);
              onChange('');
            } else {
              onChange(event.target.value);
            }
          }}
        >
          <option value="">Choose a country</option>
          {DEFAULT_COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
          <option value="__custom__">Add another country…</option>
        </select>
      ) : (
        <>
          <input
            id={`${id}-custom`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            maxLength={100}
            required={required}
            placeholder="Enter country name"
          />
          <button
            type="button"
            className="cust-country-field__toggle"
            onClick={() => {
              setCustomMode(false);
              onChange('');
            }}
          >
            Choose from the country list
          </button>
        </>
      )}
      {customMode && <span className="cust-field__hint">Enter a country not shown in the list.</span>}
    </div>
  );
}
