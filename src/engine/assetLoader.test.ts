import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { dropMissingTextures, parseBvhAsset, repairMaterialGroups, repairQuaternionSpikes } from "./assetLoader";

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

  it("carga un BVH como esqueleto con su animación", () => {
    const source = `HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
  JOINT Chest
  {
    OFFSET 0 10 0
    CHANNELS 3 Zrotation Xrotation Yrotation
    End Site
    {
      OFFSET 0 10 0
    }
  }
}
MOTION
Frames: 2
Frame Time: 0.0333333
0 0 0 0 0 0 0 0 0
0 0 0 10 0 0 5 0 0`;
    const encoded = new TextEncoder().encode(source);
    const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
    const result = parseBvhAsset(bytes);
    expect(result.root.getObjectByProperty("isBone", true)).toBeDefined();
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].duration).toBeGreaterThan(0);
  });

  it("elimina un giro aislado de casi 180 grados entre poses continuas", () => {
    const quaternion = (degrees: number, axis = new THREE.Vector3(1, 0, 0)) => new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees));
    const values = new Float32Array([
      ...quaternion(0).toArray(),
      ...quaternion(10).toArray(),
      ...quaternion(170, new THREE.Vector3(0, 1, 0)).toArray(),
      ...quaternion(20).toArray(),
    ]);
    // Una captura de movimiento guarda un cuadro cada 1/30 s.
    const track = new THREE.QuaternionKeyframeTrack("UpperLegL.quaternion", [0, 1 / 30, 2 / 30, 3 / 30], values);
    const clip = new THREE.AnimationClip("salto defectuoso", 0.1, [track]);
    expect(repairQuaternionSpikes([clip])).toBe(1);
    const repaired = new THREE.Quaternion().fromArray(track.values, 8);
    expect(THREE.MathUtils.radToDeg(quaternion(10).angleTo(repaired))).toBeLessThan(8);
    expect(THREE.MathUtils.radToDeg(quaternion(20).angleTo(repaired))).toBeLessThan(8);
  });

  it("no toca las poses separadas de una animación hecha a mano", () => {
    const quaternion = (degrees: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(degrees));
    const original = [...quaternion(0).toArray(), ...quaternion(90).toArray(), ...quaternion(0).toArray()];
    const track = new THREE.QuaternionKeyframeTrack("Brazo.quaternion", [0, 0.5, 1], original);
    expect(repairQuaternionSpikes([new THREE.AnimationClip("saludo", 1, [track])])).toBe(0);
    expect(Array.from(track.values)).toEqual(Array.from(new Float32Array(original)));
  });

  it("corrige un pie que se da vuelta durante tres cuadros y vuelve", () => {
    const quaternion = (degrees: number, axis = new THREE.Vector3(1, 0, 0)) => new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees));
    const flipped = new THREE.Vector3(0, 1, 0);
    const values = [0, 5, 170, 175, 172, 10, 12].flatMap((degrees, index) => quaternion(degrees, index >= 2 && index <= 4 ? flipped : undefined).toArray());
    const track = new THREE.QuaternionKeyframeTrack("FootR.quaternion", [0, 1, 2, 3, 4, 5, 6].map((frame) => frame / 30), values);
    expect(repairQuaternionSpikes([new THREE.AnimationClip("pie dado vuelta", 0.2, [track])])).toBe(3);
    for (const index of [2, 3, 4]) {
      const repaired = new THREE.Quaternion().fromArray(track.values, index * 4);
      expect(THREE.MathUtils.radToDeg(quaternion(5).angleTo(repaired))).toBeLessThan(10);
    }
  });

  it("no toca un giro rápido que se mantiene", () => {
    const quaternion = (degrees: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(degrees));
    const values = [0, 60, 62, 61, 63].flatMap((degrees) => quaternion(degrees).toArray());
    const track = new THREE.QuaternionKeyframeTrack("Hips.quaternion", [0, 1, 2, 3, 4].map((frame) => frame / 30), values);
    expect(repairQuaternionSpikes([new THREE.AnimationClip("giro", 0.14, [track])])).toBe(0);
  });
});
