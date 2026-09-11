import { describe, expect, it } from "vitest";
import { classifyAsset, collectLibraryGroups, collectPhysicalCategories, findCompanionModelAsset, isAnimationSection } from "./librarySections";
import type { AnimationAsset, FolderNode } from "./types";

const asset = (relativePath: string): AnimationAsset => ({
  id: relativePath,
  name: relativePath,
  fileName: relativePath.split(/[\\/]/).at(-1) || relativePath,
  path: relativePath,
  relativePath,
  directory: "",
  format: "fbx",
  size: 1,
  modified: 1,
  thumbnailModified: 0,
  thumbnailFailed: false,
});

const folder = (name: string, children: FolderNode[] = [], animationCount = 0): FolderNode => ({
  name, children, path: name, relativePath: name, animationCount,
});

describe("clasificación física de la biblioteca", () => {
  it("un archivo suelto en la raíz sigue siendo animación sin categoría", () => {
    expect(classifyAsset("idle.fbx")).toEqual({ section: "animation", categoryKey: "", categoryName: "" });
  });

  it("cada carpeta de la raíz es un grupo con sus propias categorías", () => {
    expect(classifyAsset("contruccion\\Categoria\\Downtown City MegaKit[Standard]\\Exports\\FBX\\pared.fbx")).toEqual({
      section: "group:contruccion", categoryKey: "group:contruccion:downtown city megakit[standard]", categoryName: "Downtown City MegaKit[Standard]",
    });
    expect(classifyAsset("contruccion\\Varios\\poste.glb")).toEqual({ section: "group:contruccion", categoryKey: "", categoryName: "" });
    expect(isAnimationSection(classifyAsset("contruccion\\Varios\\poste.glb").section)).toBe(false);
    expect(isAnimationSection(classifyAsset("Animaciones\\Varios\\salto.fbx").section)).toBe(true);
  });

  it("un archivo suelto dentro de Categoría no inventa una categoría con su nombre", () => {
    expect(classifyAsset("Piezas\\Categoría\\silla.glb")).toEqual({ section: "piece", categoryKey: "", categoryName: "" });
  });

  it("clasifica Varios como contenido sin categoría", () => {
    expect(classifyAsset("Animaciones\\Varios\\salto.fbx").categoryKey).toBe("");
    expect(classifyAsset("Piezas\\Varios\\casa.glb")).toMatchObject({ section: "piece", categoryKey: "" });
  });

  it("convierte la primera carpeta dentro de Categorías en una categoría", () => {
    expect(classifyAsset("Animaciones\\Categoría\\Combate\\Espadas\\ataque.fbx")).toEqual({
      section: "animation", categoryKey: "animation:combate", categoryName: "Combate",
    });
    expect(classifyAsset("Piezas/Categorias/Packs de casas/chalet.glb")).toEqual({
      section: "piece", categoryKey: "piece:packs de casas", categoryName: "Packs de casas",
    });
  });

  it("agrupa y cuenta categorías repetidas", () => {
    const categories = collectPhysicalCategories([
      asset("Piezas\\Categoría\\Casas\\casa-1.glb"),
      asset("Piezas\\Categorias\\Casas\\casa-2.fbx"),
    ]);
    expect(categories).toEqual([{ key: "piece:casas", name: "Casas", section: "piece", count: 2 }]);
  });

  it("oculta los packs que no tienen ningún modelo que la app pueda leer", () => {
    const folders = [folder("contruccion", [folder("Categoria", [folder("3TD_FurniturePack", [], 0), folder("kenney_mini-arena", [], 1)])], 1)];
    const categories = collectPhysicalCategories([asset("contruccion\\Categoria\\kenney_mini-arena\\Models\\soldado.fbx")], folders);
    expect(categories).toEqual([{ key: "group:contruccion:kenney_mini-arena", name: "kenney_mini-arena", section: "group:contruccion", count: 1 }]);
  });

  it("lista los grupos con Piezas y Animaciones primero y cuenta sus elementos", () => {
    const groups = collectLibraryGroups(
      [asset("contruccion\\Categoria\\Kit\\a.fbx"), asset("contruccion\\Varios\\b.fbx"), asset("Piezas\\Varios\\c.glb")],
      [folder("Animaciones"), folder("contruccion"), folder("Piezas")],
    );
    expect(groups).toEqual([
      { section: "piece", name: "Piezas", count: 1 },
      { section: "animation", name: "Animaciones", count: 0 },
      { section: "group:contruccion", name: "contruccion", count: 2 },
    ]);
  });

  it("encuentra la malla compañera de una animación incluida en un pack de piezas", () => {
    const animation = asset("Piezas\\Categoría\\Personajes\\Perro\\Animations\\Run.fbx");
    const model = asset("Piezas\\Categoría\\Personajes\\Perro\\Mesh\\SK_GermanShepherd.fbx");
    const unrelated = asset("Piezas\\Categoría\\Personajes\\Otro\\Mesh\\SK_Otro.fbx");
    expect(findCompanionModelAsset(animation, [animation, unrelated, model])).toBe(model);
  });

  it("no inventa un modelo compañero fuera del mismo pack", () => {
    const animation = asset("Piezas\\Categoría\\Personajes\\Perro\\Animations\\Run.fbx");
    const unrelated = asset("Piezas\\Categoría\\Personajes\\Otro\\Mesh\\SK_Otro.fbx");
    expect(findCompanionModelAsset(animation, [animation, unrelated])).toBeNull();
  });
});
