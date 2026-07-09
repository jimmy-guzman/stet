/** Linear-interpolate two `#rrggbb` hex colors; `t` is clamped to [0, 1]. */
export function lerpHex(from: string, to: string, t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  const channel = (offset: number) => {
    const a = Number.parseInt(from.slice(offset, offset + 2), 16);
    const b = Number.parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * clamped)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}
