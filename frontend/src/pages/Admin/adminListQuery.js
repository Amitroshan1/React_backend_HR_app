/** Case-insensitive match against any of the given cell values. */
export function matchesListQuery(query, values) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value || '').toLowerCase().includes(needle));
}
