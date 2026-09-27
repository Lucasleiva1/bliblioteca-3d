import { describe, expect, it } from "vitest";
import { formatAssetError } from "./assetError";
import config from "../../src-tauri/tauri.conf.json";

describe("errores del visor", () => {
  it("no imprime buffers integrados ni URLs temporales", () => {
    const error = new Error(`THREE.GLTFLoader: Failed to load buffer "data:application/octet-stream;base64,${"AAAA".repeat(10000)}"`);
    expect(formatAssetError(error)).toBe('THREE.GLTFLoader: Failed to load buffer "[datos integrados del modelo]"');
    expect(formatAssetError("Failed to fetch blob:http://tauri.localhost/id")).toBe("Failed to fetch [recurso local del modelo]");
  });

  it("conserva errores útiles y limita el tamaño de otros mensajes", () => {
    expect(formatAssetError("Falta la dependencia personaje.bin")).toBe("Falta la dependencia personaje.bin");
    expect(formatAssetError("x".repeat(2000)).length).toBeLessThanOrEqual(500);
  });

  it("permite cargar buffers GLTF integrados y recursos locales bajo la CSP nativa", () => {
    const connect = config.app.security.csp.split(";").find((directive) => directive.trim().startsWith("connect-src"))!.trim().split(/\s+/);
    expect(connect).toContain("data:");
    expect(connect).toContain("blob:");
    expect(connect).not.toContain("*");
    expect(connect).not.toContain("https:");
  });
});
