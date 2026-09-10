export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

export function formatDate(seconds: number) {
  if (!seconds) return "";
  return new Date(seconds * 1000).toLocaleDateString("es-AR");
}

export function parentFolderName(relativePath: string) {
  return relativePath.split(/[\\/]/).filter(Boolean).slice(0, -1).at(-1) ?? "";
}
