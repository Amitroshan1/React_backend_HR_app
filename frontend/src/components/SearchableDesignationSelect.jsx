import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import {
  addCustomDesignation,
  fetchDesignationCatalog,
  mergeDesignationLists,
} from '../utils/designationCatalog';
import './SearchableDesignationSelect.css';

const MIN_ADD_LENGTH = 2;

export function SearchableDesignationSelect({
  value = '',
  onChange,
  disabled = false,
  required = false,
  id = 'designation-select',
  placeholder = 'Search or select designation',
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);

  const reloadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchDesignationCatalog();
      setOptions(mergeDesignationLists(list, value ? [value] : []));
    } finally {
      setLoading(false);
    }
  }, [value]);

  useEffect(() => {
    reloadOptions();
  }, [reloadOptions]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const query = search.trim();
  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((item) => item.toLowerCase().includes(q));
  }, [options, query]);

  const hasExactMatch = useMemo(() => {
    if (!query) return false;
    const q = query.toLowerCase();
    return options.some((item) => item.toLowerCase() === q);
  }, [options, query]);

  const showAddNew = query.length >= MIN_ADD_LENGTH && !hasExactMatch;

  const displayValue = open ? search : (value || '');

  const selectValue = (next) => {
    onChange?.(next);
    setSearch('');
    setOpen(false);
    setOptions((prev) => mergeDesignationLists(prev, [next]));
  };

  const handleAddNew = () => {
    const next = query.replace(/\s+/g, ' ').trim();
    if (next.length < MIN_ADD_LENGTH) return;
    addCustomDesignation(next);
    selectValue(next);
  };

  return (
    <div
      className={`searchable-designation${disabled ? ' is-disabled' : ''}${open ? ' is-open' : ''}`}
      ref={rootRef}
    >
      <div className="searchable-designation__control">
        <span className="searchable-designation__icon-wrap" aria-hidden>
          <Search size={15} />
        </span>
        <input
          id={id}
          type="text"
          className="searchable-designation__input"
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
          required={required && !value}
          autoComplete="off"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={`${id}-listbox`}
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
            setSearch(value || '');
          }}
          onChange={(e) => {
            if (disabled) return;
            setSearch(e.target.value);
            setOpen(true);
            if (!e.target.value.trim()) {
              onChange?.('');
            }
          }}
        />
        <button
          type="button"
          className="searchable-designation__toggle"
          tabIndex={-1}
          disabled={disabled}
          aria-label={open ? 'Close designation list' : 'Open designation list'}
          onClick={() => {
            if (disabled) return;
            setOpen((prev) => {
              const next = !prev;
              if (next) setSearch(value || '');
              else setSearch('');
              return next;
            });
          }}
        >
          <ChevronDown size={18} aria-hidden />
        </button>
      </div>

      {open && !disabled ? (
        <div className="searchable-designation__menu" id={`${id}-listbox`} role="listbox">
          {loading ? (
            <p className="searchable-designation__hint">Loading designations…</p>
          ) : null}
          {!loading && filtered.length === 0 && !showAddNew ? (
            <p className="searchable-designation__hint">No designations match your search.</p>
          ) : null}
          {filtered.map((item) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={value === item}
              className={`searchable-designation__option${value === item ? ' is-selected' : ''}`}
              onClick={() => selectValue(item)}
            >
              {item}
            </button>
          ))}
          {showAddNew ? (
            <button
              type="button"
              className="searchable-designation__option searchable-designation__option--add"
              onClick={handleAddNew}
            >
              <Plus size={16} aria-hidden />
              Add &ldquo;{query}&rdquo;
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
