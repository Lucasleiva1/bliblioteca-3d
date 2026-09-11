import { useEffect, useState } from "react";
import { isDesktopRuntime, readThumbnail } from "./api";

const MAX_CACHED_IMAGES = 400;
const images = new Map<string, Promise<string>>();

function loadImage(path: string, modified: number) {
  const key = `${path}|${modified}`;
  const cached = images.get(key);
  if (cached) {
    images.delete(key);
    images.set(key, cached);
    return cached;
  }
  const loading = readThumbnail(path).then((buffer) => URL.createObjectURL(new Blob([buffer], { type: "image/webp" })));
  loading.catch(() => images.delete(key));
  images.set(key, loading);
  while (images.size > MAX_CACHED_IMAGES) {
    const [oldestKey, oldest] = images.entries().next().value as [string, Promise<string>];
    images.delete(oldestKey);
    void oldest.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
  return loading;
}

/** Devuelve la foto guardada en `_cache` lista para un <img>, o null mientras no exista. */
export function useThumbnailUrl(path: string, modified: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!modified || !isDesktopRuntime()) return;
    let active = true;
    void loadImage(path, modified).then((value) => { if (active) setUrl(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [modified, path]);
  return url;
}
