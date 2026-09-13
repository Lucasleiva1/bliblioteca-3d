import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createViewerSkeletonHelper, representativeSkeletonRoot } from "./Viewer3D";

describe("visualización estable de esqueletos", () => {
  it("elige una sola jerarquía cuando un FBX trae armatures duplicados y anidados", () => {
    const scene = new THREE.Group();
    const armature = new THREE.Group();
    const outerRoot = new THREE.Bone();
    outerRoot.name = "Root";
    const outerHips = new THREE.Bone();
    outerHips.name = "Hips";
    const innerRoot = new THREE.Bone();
    innerRoot.name = "Root";
    const innerHips = new THREE.Bone();
    innerHips.name = "Hips";
    outerRoot.add(outerHips, innerRoot);
    innerRoot.add(innerHips);
    armature.add(outerRoot);
    scene.add(armature);

    const outerMesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const innerMesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    outerMesh.bind(new THREE.Skeleton([outerRoot, outerHips]));
    innerMesh.bind(new THREE.Skeleton([innerRoot, innerHips]));
    scene.add(outerMesh, innerMesh);

    expect(representativeSkeletonRoot(scene)).toBe(outerRoot);
    const helper = createViewerSkeletonHelper(scene);
    expect(helper.bones).toEqual([outerRoot, outerHips]);
    expect(helper.geometry.getAttribute("position").count).toBe(2);
    expect((helper.material as THREE.LineBasicMaterial).depthTest).toBe(false);
  });
});
