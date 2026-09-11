import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { dropMissingTextures, repairMaterialGroups } from "./assetLoader";

describe("reparaciones al cargar modelos", () => {
  it("una malla con varios materiales y sin asignación se dibuja entera con el primero", () => {
    const geometry = new THREE.BoxGeometry().toNonIndexed();
    geometry.clearGroups();
    const mesh = new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    repairMaterialGroups(mesh);
    expect(geometry.groups).toEqual([{ start: 0, count: geometry.attributes.position.count, materialIndex: 0 }]);
  });

  it("no toca mallas que ya dicen qué material usa cada parte", () => {
    const geometry = new THREE.BoxGeometry();
    const groups = geometry.groups.length;
    repairMaterialGroups(new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]));
    expect(geometry.groups.length).toBe(groups);
  });

  it("quita las texturas que no llegaron a cargar para que no se vean negras", () => {
    const loaded = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: loaded });
    dropMissingTextures(new THREE.Mesh(new THREE.BoxGeometry(), material));
    expect(material.map).toBeNull();
    expect(material.normalMap).toBe(loaded);
  });
});
