import { describe, expect, it } from "vitest";
import { describeImportedFolder, importCategoryKey, mergeImportedAssets, sameLibraryRoot } from "./importReports";
import type { AnimationAsset, ImportedFolder } from "./types";

const asset = (id: string, relativePath = id): AnimationAsset => ({
  id,
  name: id,
  fileName: `${id}.fbx`,
  path: relativePath,
  relativePath,
  directory: "",
  format: "fbx",
  size: 1,
  modified: 1,
  thumbnailModified: 0,
  thumbnailFailed: false,
});

const folder = (overrides: Partial<ImportedFolder> = {}): ImportedFolder => ({
  name: "Armas medievales",
  categoryName: "Armas medievales",
  groupName: "Piezas",
  animation: false,
  merged: false,
  assets: [asset("espada", "Piezas\\Categoría\\Armas medievales\\espada.fbx")],
  ...overrides,
});

describe("carga desde Cargar Nuevo", () => {
  it("suma solo lo nuevo y no duplica lo que ya estaba", () => {
    const current = [asset("a"), asset("b")];
    const merged = mergeImportedAssets(current, [asset("b"), asset("c")]);
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(mergeImportedAssets(current, [])).toBe(current);
  });

  it("reconoce la misma biblioteca aunque cambie la forma de escribir la ruta", () => {
    expect(sameLibraryRoot("\\\\?\\D:\\biblioteca-3d", "D:/Biblioteca-3D/")).toBe(true);
    expect(sameLibraryRoot("D:\\biblioteca-3d", "E:\\biblioteca-3d")).toBe(false);
  });

  it("describe una categoría nueva y una que ya existía", () => {
    expect(describeImportedFolder(folder())).toBe("“Armas medievales” se cargó como categoría nueva (Piezas › Categoría › Armas medievales): 1 pieza nueva.");
    expect(describeImportedFolder(folder({ name: "Armas", categoryName: "armas", merged: true, assets: [asset("x"), asset("y")] })))
      .toBe("“Armas” se sumó a la categoría que ya existía (Piezas › Categoría › armas): 2 piezas nuevas.");
  });

  it("nombra el grupo donde entró y distingue animaciones", () => {
    expect(describeImportedFolder(folder({ name: "Kit", categoryName: "Kit", groupName: "contruccion" })))
      .toBe("“Kit” se cargó como categoría nueva (contruccion › Categoría › Kit): 1 pieza nueva.");
    expect(describeImportedFolder(folder({ name: "Combate", categoryName: "Combate", groupName: "Animaciones", animation: true, assets: [asset("a"), asset("b")] })))
      .toBe("“Combate” se cargó como categoría nueva (Animaciones › Categoría › Combate): 2 animaciones nuevas.");
  });

  it("apunta a la categoría física donde quedó la carga", () => {
    expect(importCategoryKey(folder())).toBe("piece:armas medievales");
    expect(importCategoryKey(folder({ assets: [] }))).toBe("");
  });
});
