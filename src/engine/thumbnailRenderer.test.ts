import { describe, expect, it } from "vitest";
import { chooseCameraDirection, isCharacterShape, measurePhoto, photoProblem, selectExpressivePose } from "./thumbnailRenderer";

function photo(fill: (index: number) => [number, number, number, number], pixels = 1000) {
  const data = new Uint8Array(pixels * 4);
  for (let index = 0; index < pixels; index += 1) data.set(fill(index), index * 4);
  return data;
}

describe("control de calidad de la foto", () => {
  it("rechaza una foto vacía", () => {
    expect(photoProblem(measurePhoto(photo(() => [0, 0, 0, 0]), 1))).toContain("vacía");
  });

  it("rechaza una silueta negra", () => {
    const silhouette = photo((index) => (index < 400 ? [3, 3, 3, 255] : [0, 0, 0, 0]));
    expect(photoProblem(measurePhoto(silhouette, 1))).toContain("negra");
  });

  it("acepta una pieza oscura que igual tiene luz", () => {
    const darkWithLight = photo((index) => (index < 300 ? (index % 10 === 0 ? [90, 90, 90, 255] : [8, 8, 8, 255]) : [0, 0, 0, 0]));
    expect(photoProblem(measurePhoto(darkWithLight, 1))).toBeNull();
  });
});

describe("encuadre", () => {
  it("un personaje parado se fotografía de frente", () => {
    const shape = { size: { x: 0.8, y: 1.8, z: 0.4 }, skinned: true };
    expect(isCharacterShape(shape)).toBe(true);
    const direction = chooseCameraDirection(shape);
    expect(direction.z).toBeGreaterThan(0.9);
  });

  it("un animal de cuatro patas no cuenta como personaje parado", () => {
    expect(isCharacterShape({ size: { x: 0.4, y: 0.6, z: 1.2 }, skinned: true })).toBe(false);
  });

  it("una escopeta larga y fina se ve de costado, no de punta", () => {
    const rifleAlongZ = chooseCameraDirection({ size: { x: 0.06, y: 0.2, z: 1.1 }, skinned: false });
    expect(Math.abs(rifleAlongZ.x)).toBeGreaterThan(Math.abs(rifleAlongZ.z));
  });

  it("una baldosa plana se mira desde arriba", () => {
    expect(chooseCameraDirection({ size: { x: 2, y: 0.1, z: 2 }, skinned: false }).y).toBeGreaterThan(0.7);
  });
});

describe("selección automática de pose", () => {
  it("elige el momento con mayor cambio y extensión corporal", () => {
    const selected = selectExpressivePose([
      { time: 0.1, displacement: 0.02, span: 1, change: 0.02 },
      { time: 0.5, displacement: 0.46, span: 1.24, change: 0.08 },
      { time: 0.8, displacement: 0.2, span: 0.92, change: 0.28 },
    ]);
    expect(selected?.time).toBe(0.5);
  });

  it("no falla si el clip no produjo candidatos válidos", () => {
    expect(selectExpressivePose([])).toBeNull();
  });
});
