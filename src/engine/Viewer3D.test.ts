import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseBvhAsset } from "./assetLoader";
import { createProceduralHumanoid, createViewerSkeletonHelper, representativeSkeletonRoot } from "./Viewer3D";

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

function kimodoStyleBvh() {
  const joint = (name: string, offset: string, children = "") => `JOINT ${name}\n{\nOFFSET ${offset}\nCHANNELS 3 Zrotation Yrotation Xrotation\n${children || "End Site\n{\nOFFSET 0 1 0\n}"}\n}\n`;
  const arm = (side: string, x: number) => joint(`${side}Shoulder`, `${x} 20 0`, joint(`${side}Arm`, `${x} 0 0`, joint(`${side}ForeArm`, `${x * 2} 0 0`, joint(`${side}Hand`, `${x * 2} 0 0`))));
  const leg = (side: string, x: number) => joint(`${side}Leg`, `${x} -5 0`, joint(`${side}Shin`, "0 -40 0", joint(`${side}Foot`, "0 -40 0", joint(`${side}ToeBase`, "0 -5 10"))));
  const head = joint("Neck1", "0 5 0", joint("Neck2", "0 5 0", joint("Head", "0 5 0", joint("HeadEnd", "0 15 0"))));
  const hierarchy = `HIERARCHY\nROOT Root\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\nJOINT Hips\n{\nOFFSET 0 100 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\n${joint("Spine1", "0 7 0", joint("Spine2", "0 7 0", joint("Chest", "0 7 0", head + arm("Left", 5) + arm("Right", -5))))}${leg("Left", 10)}${leg("Right", -10)}}\n}\n`;
  const channels = (hierarchy.match(/CHANNELS (\d)/g) ?? []).reduce((sum, entry) => sum + Number(entry.slice(-1)), 0);
  const frame = Array(channels).fill("0").join(" ");
  return new TextEncoder().encode(`${hierarchy}MOTION\nFrames: 2\nFrame Time: 0.033333\n${frame}\n${frame}\n`).buffer;
}

describe("animaciones BVH sin cuerpo", () => {
  it("arma el maniquí con los nombres de huesos de Kimodo (Neck1, LeftLeg/LeftShin, HeadEnd)", () => {
    const { root } = parseBvhAsset(kimodoStyleBvh());
    const mannequin = createProceduralHumanoid(root, "male");
    expect(mannequin).not.toBeNull();
    const names = mannequin!.group.children.map((child) => child.name);
    expect(names).toEqual(expect.arrayContaining(["head", "left-thigh", "left-calf", "right-foot", "left-forearm"]));
  });
});
