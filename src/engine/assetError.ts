/** Los errores de Three.js pueden incluir un buffer completo codificado en la URL. */
export function formatAssetError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const readable = message.replace(/data:[^\s"'<>]+/gi, "[datos integrados del modelo]").replace(/blob:[^\s"'<>]+/gi, "[recurso local del modelo]");
  return readable.length > 500 ? `${readable.slice(0, 497)}…` : readable;
}
