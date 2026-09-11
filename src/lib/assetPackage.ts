import type { AssetPackage } from "./types";

interface PackageHeader {
  directory: string;
  textures?: string[];
  mainLength: number;
  resources: Array<{ uri: string; mimeType: string; length: number }>;
}

/** Lee el paquete binario de `read_asset_package`: largo de cabecera, cabecera JSON, modelo y dependencias. */
export function unpackAssetPackage(buffer: ArrayBuffer): AssetPackage {
  if (buffer.byteLength < 4) throw new Error("El paquete del modelo llegó vacío");
  const headerLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))) as PackageHeader;
  let offset = 4 + headerLength;
  const take = (length: number) => {
    if (offset + length > buffer.byteLength) throw new Error("El paquete del modelo llegó incompleto");
    const bytes = buffer.slice(offset, offset + length);
    offset += length;
    return bytes;
  };
  const bytes = take(header.mainLength);
  const resources = header.resources.map((resource) => ({ uri: resource.uri, mimeType: resource.mimeType, bytes: take(resource.length) }));
  return { bytes, directory: header.directory, textures: header.textures ?? [], resources };
}

const normalizeTexturePath = (value: string) => value.replaceAll("\\", "/").replace(/\/{2,}/g, "/").toLocaleLowerCase();
const fileNameOf = (value: string) => normalizeTexturePath(value).split("/").pop() ?? "";

/**
 * Elige la imagen real para la textura que pide un FBX. Primero la ruta exacta; si no existe (el
 * autor la guardó con la ruta de su computadora), busca el mismo nombre de archivo en las carpetas
 * vecinas y se queda con la más cercana a la carpeta del modelo.
 */
export function resolveTexturePath(requested: string, modelDirectory: string, candidates: string[]): string | null {
  const wanted = normalizeTexturePath(requested);
  const exact = candidates.find((candidate) => normalizeTexturePath(candidate) === wanted);
  if (exact) return exact;
  const name = fileNameOf(requested);
  if (!name) return null;
  const directory = normalizeTexturePath(modelDirectory).split("/");
  const closeness = (candidate: string) => {
    const parts = normalizeTexturePath(candidate).split("/");
    let shared = 0;
    while (shared < directory.length && parts[shared] === directory[shared]) shared += 1;
    return shared * 100 - parts.length;
  };
  return candidates
    .filter((candidate) => fileNameOf(candidate) === name)
    .sort((left, right) => closeness(right) - closeness(left))[0] ?? null;
}
