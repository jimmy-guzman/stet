/**
 * Cell-granular thumb for a hand-drawn vertical scrollbar over a windowed, uniform-height-1 list
 * (the sidebar, problems panel, and search results, which mount only the visible slice so OpenTUI's
 * native scrollbox has no content to measure a thumb from). Returns undefined when the content
 * fits: the column then paints nothing but stays reserved, so growth never shifts layout.
 */
export function scrollbarThumb(rowCount: number, viewport: number, scrollTop: number) {
  if (viewport <= 0 || rowCount <= viewport) {
    return undefined;
  }
  const size = Math.max(1, Math.round((viewport * viewport) / rowCount));
  const maxTop = viewport - size;
  const maxScroll = rowCount - viewport;
  const top = maxScroll === 0 ? 0 : Math.round((maxTop * scrollTop) / maxScroll);
  return { size, top: Math.max(0, Math.min(top, maxTop)) };
}
