import { describe, expect, it } from "vitest";
import { synchronizeRotationCurves } from "./rotationCurves.js";

describe("rotaciones FBX con distinta cantidad de claves por eje", () => {
  it("combina los ejes por tiempo y no por su posición en la lista", () => {
    const synced = synchronizeRotationCurves({
      x: { times: [0, 1, 2], values: [0, 10, 20] },
      y: { times: [0, 2], values: [0, 40] },
      z: { times: [0, 1, 2], values: [5, 5, 5] },
    });
    expect(synced.y.times).toEqual([0, 1, 2]);
    expect(synced.y.values).toEqual([0, 20, 40]);
    expect(synced.x.values).toEqual([0, 10, 20]);
  });

  it("antes de la primera clave y después de la última un eje conserva su valor", () => {
    const synced = synchronizeRotationCurves({
      x: { times: [0, 1, 2], values: [1, 2, 3] },
      y: { times: [1], values: [7] },
      z: { times: [0, 2], values: [0, 0] },
    });
    expect(synced.y.values).toEqual([7, 7, 7]);
  });
});
