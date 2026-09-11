import { describe, expect, it } from "vitest";
import { moveCategory, moveGroup, reconcileCategoryOrganization, removeGroup } from "./categoryOrganization";
import type { PhysicalCategory } from "./librarySections";
import type { CategoryOrganization } from "./types";

const physical = (key: string, section: "piece" | "animation" = "animation"): PhysicalCategory => ({
  key, name: key.split(":")[1], section, count: 1,
});

const organization: CategoryOrganization = {
  groups: [
    { id: "g1", section: "animation", name: "Combate", sortOrder: 10, collapsed: false },
    { id: "g2", section: "animation", name: "Movimiento", sortOrder: 20, collapsed: false },
  ],
  categories: [
    { categoryKey: "animation:ataque", section: "animation", groupId: "g1", sortOrder: 10 },
    { categoryKey: "animation:idle", section: "animation", groupId: "", sortOrder: 10 },
  ],
};

describe("organización visual de categorías físicas", () => {
  it("agrega categorías nuevas sin perder grupos y descarta categorías que ya no existen", () => {
    const next = reconcileCategoryOrganization([physical("animation:idle"), physical("animation:salto")], organization);
    expect(next.groups).toHaveLength(2);
    expect(next.categories.map((entry) => entry.categoryKey)).toEqual(["animation:idle", "animation:salto"]);
  });

  it("mueve una categoría dentro de un grupo sin tocar su clave física", () => {
    const next = moveCategory(organization, "animation:idle", "animation", "g1", "animation:ataque");
    expect(next.categories.find((entry) => entry.categoryKey === "animation:idle")).toMatchObject({ groupId: "g1", sortOrder: 10 });
    expect(next.categories.find((entry) => entry.categoryKey === "animation:ataque")?.sortOrder).toBe(20);
  });

  it("reordena grupos solamente dentro de su sección", () => {
    const next = moveGroup(organization, "animation", "g2", "g1");
    expect(next.groups.filter((group) => group.section === "animation").sort((a, b) => a.sortOrder - b.sortOrder).map((group) => group.id)).toEqual(["g2", "g1"]);
  });

  it("permite bajar un grupo hasta el final", () => {
    const next = moveGroup(organization, "animation", "g1", "");
    expect(next.groups.filter((group) => group.section === "animation").sort((a, b) => a.sortOrder - b.sortOrder).map((group) => group.id)).toEqual(["g2", "g1"]);
  });

  it("impide mezclar categorías de piezas con grupos de animaciones", () => {
    const withPiece = reconcileCategoryOrganization([physical("piece:casa", "piece")], organization);
    expect(moveCategory(withPiece, "piece:casa", "piece", "g1")).toBe(withPiece);
  });

  it("al borrar un grupo devuelve sus categorías a la lista sin grupo", () => {
    const next = removeGroup(organization, "g1");
    expect(next.groups.map((group) => group.id)).not.toContain("g1");
    expect(next.categories.find((entry) => entry.categoryKey === "animation:ataque")?.groupId).toBe("");
  });
});
