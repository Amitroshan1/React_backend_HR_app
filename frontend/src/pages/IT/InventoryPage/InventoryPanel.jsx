import "./InventoryDashboard.css";

export function InventoryPanel({
  eyebrow,
  title,
  subtitle,
  recordCount,
  recordLabel = "records",
  filterBadge,
  filters,
  children,
  footer,
  variant,
}) {
  return (
    <section
      className={`inv-overview-panel${variant ? ` inv-overview-panel--${variant}` : ""}`}
    >
      <header className="inv-overview-panel__hero">
        <div className="inv-overview-panel__title-block">
          {eyebrow ? <span className="inv-overview-panel__eyebrow">{eyebrow}</span> : null}
          <h2 className="inv-overview-panel__title">{title}</h2>
          {subtitle ? <p className="inv-overview-panel__subtitle">{subtitle}</p> : null}
          {filterBadge}
        </div>
        {recordCount != null ? (
          <div className="inv-overview-panel__stat">
            <span className="inv-overview-panel__stat-num">{recordCount}</span>
            <span className="inv-overview-panel__stat-label">{recordLabel}</span>
          </div>
        ) : null}
      </header>
      {filters}
      <div className="inv-overview-panel__body">{children}</div>
      {footer ? <div className="inv-overview-panel__footer">{footer}</div> : null}
    </section>
  );
}

export function InventoryFiltersInner({ children }) {
  return <div className="inv-overview-filters-inner">{children}</div>;
}

export function InventoryFilterSearch({
  value,
  onChange,
  placeholder = "Search…",
}) {
  return (
    <div className="inv-search-wrap inv-search-wrap--overview">
      <span className="inv-search-icon" aria-hidden>
        🔍
      </span>
      <input
        className="inv-search-input"
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="inv-search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export function InventoryCategoryTabs({
  tabs,
  active,
  onChange,
  getCount,
  label = "Category",
}) {
  if (!tabs?.length) return null;

  return (
    <div className="inv-overview-filter-block">
      <span className="inv-overview-filter-label">{label}</span>
      <div className="inv-category-filter-row" role="group" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={
              active === tab
                ? "inv-cat-filter-chip inv-cat-filter-chip--active"
                : "inv-cat-filter-chip"
            }
            onClick={() => onChange(tab)}
          >
            {tab}
            {tab !== "All" && getCount ? (
              <span className="inv-chip-count">{getCount(tab)}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
