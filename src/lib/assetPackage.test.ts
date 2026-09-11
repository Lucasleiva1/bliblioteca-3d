import { describe, expect, it } from "vitest";
import { resolveTexturePath, unpackAssetPackage } from "./assetPackage";

function pack(header: object, ...parts: string[]) {
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify(header));
  const body = parts.map((part) => encoder.encode(part));
  const total = 4 + headerBytes.length + body.reduce((sum, part) => sum + part.length, 0);
  const buffer = new Uint8Array(total);
  new DataView(buffer.buffer).setUint32(0, headerBytes.length, true);
  buffer.set(headerBytes, 4);
  let offset = 4 + headerBytes.length;
  for (const part of body) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return buffer.buffer;
}

const text = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

describe("paquete binario del modelo", () => {
  it("separa el modelo y sus dependencias en orden", () => {
    const result = unpackAssetPackage(pack({
      directory: "D:/biblioteca/armas",
      mainLength: 5,
      resources: [{ uri: "datos.bin", mimeType: "application/octet-stream", length: 3 }, { uri: "tex.png", mimeType: "image/png", length: 7 }],
    }, "MODEL", "BIN", "PNGDATA"));
    expect(result.directory).toBe("D:/biblioteca/armas");
    expect(text(result.bytes)).toBe("MODEL");
    expect(result.resources.map((resource) => [resource.uri, text(resource.bytes)])).toEqual([["datos.bin", "BIN"], ["tex.png", "PNGDATA"]]);
  });

  it("trae la lista de texturas cercanas y tolera paquetes viejos sin ella", () => {
    expect(unpackAssetPackage(pack({ directory: "", textures: ["D:/kit/t.png"], mainLength: 1, resources: [] }, "M")).textures).toEqual(["D:/kit/t.png"]);
    expect(unpackAssetPackage(pack({ directory: "", mainLength: 1, resources: [] }, "M")).textures).toEqual([]);
  });

  it("avisa si el paquete llegó cortado", () => {
    expect(() => unpackAssetPackage(pack({ directory: "", mainLength: 10, resources: [] }, "CORTO"))).toThrow("incompleto");
  });
});

describe("búsqueda de texturas de un FBX", () => {
  const model = "D:/Piezas/Categoría/ciudad/Kit/Exports/FBX (Unity)";
  const candidates = [
    "D:\\Piezas\\Categoría\\ciudad\\Kit\\Exports\\FBX (Unity)\\Textures\\colormap.png",
    "D:\\Piezas\\Categoría\\ciudad\\Kit\\Exports\\glTF (Godot)\\T_RedBrick_BaseColor.png",
    "D:\\Piezas\\Categoría\\ciudad\\Kit\\Otro\\Viejo\\Profundo\\T_RedBrick_BaseColor.png",
  ];

  it("usa la ruta exacta cuando la textura está donde el FBX dice", () => {
    expect(resolveTexturePath(`${model}/Textures\\colormap.png`, model, candidates)).toBe(candidates[0]);
  });

  it("encuentra por nombre una textura guardada con la ruta de otra computadora, eligiendo la más cercana", () => {
    expect(resolveTexturePath(`${model}/C:\\Dropbox\\Work\\Blends\\T_RedBrick_BaseColor.png`, model, candidates)).toBe(candidates[1]);
  });

  it("devuelve null si la textura no está en ningún lado", () => {
    expect(resolveTexturePath(`${model}/madera.png`, model, candidates)).toBeNull();
  });
});
