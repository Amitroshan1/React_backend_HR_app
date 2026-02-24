/** Shared gradient styles - wrap header text in <span style={GRADIENT_HEADER_STYLE}> to isolate from clickable parent */
export const GRADIENT_HEADER_STYLE = {
  background: 'linear-gradient(to right, #4f46e5, #3b82f6, #10b981)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  fontWeight: 700,
  display: 'inline-block',
};
