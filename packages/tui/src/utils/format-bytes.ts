// Human-readable byte size (`0 B`, `945 B`, `4.5 KB`, `12 MB`), 1024-base to match
// How file managers report a file's size. One fractional digit below 10, none above,
// So the label stays short and stable.
export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log2(bytes) / 10), units.length);
  const value = bytes / 1024 ** exponent;
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${units[exponent - 1]}`;
}
