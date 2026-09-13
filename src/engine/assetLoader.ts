import { convertFileSrc } from "@tauri-apps/api/core";
import * as THREE from "three";
import { BVHLoader } from "three/addons/loaders/BVHLoader.js";
import { repairQuaternionSpikes } from "./animationRepair";
import { FBXLoader } from "./fbx/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { readAssetPackage } from "../lib/api";
import { resolveTexturePath } from "../lib/assetPackage";
import type { AnimationAsset } from "../lib/types";

/** Imagen vacía para texturas que no existen: falla al instante en vez de pedir una ruta imposible. */
const MISSING_TEXTURE = "data:,";

function forEachMaterial(root: THREE.Object3D, visit: (material: THREE.Material) => void) {
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (Array.isArray(material)) material.forEach(visit);
    else if (material) visit(material);
  });
}

/**
 * Algunos exportadores marcan el material como 100 % transparente por error y el FBXLoader lo
 * obedece: la pieza queda invisible. En una biblioteca nunca tiene sentido un material invisible.
 */
function repairInvisibleMaterials(root: THREE.Object3D) {
  forEachMaterial(root, (material) => {
    if (material.opacity <= 0.01) {
      material.opacity = 1;
      material.transparent = false;
      material.needsUpdate = true;
    }
  });
}

/**
 * Una malla con varios materiales pero sin decir qué parte usa cada uno no se dibuja: Three.js
 * necesita esa asignación. Pasa con algunos FBX; se dibuja entera con el primer material.
 */
export function repairMaterialGroups(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !Array.isArray(mesh.material) || mesh.geometry.groups.length) return;
    const count = mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0;
    if (count) mesh.geometry.addGroup(0, count, 0);
  });
}

/** Una textura que no se pudo cargar se dibuja negra; sin ella, la pieza muestra su color base. */
export function dropMissingTextures(root: THREE.Object3D) {
  forEachMaterial(root, (material) => {
    const slots = material as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(slots)) {
      if (value instanceof THREE.Texture && !(value instanceof THREE.CubeTexture) && !value.image) {
        value.dispose();
        slots[key] = null;
        material.needsUpdate = true;
      }
    }
  });
}

export interface LoadedThreeAsset {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Se resuelve cuando terminaron de cargar las texturas que el modelo pidió (o fallaron). */
  texturesReady: Promise<void>;
}

/** Convierte un BVH de texto en una jerarquía de huesos animable por Three.js. */
export function parseBvhAsset(bytes: ArrayBuffer): LoadedThreeAsset {
  const result = new BVHLoader().parse(new TextDecoder().decode(bytes));
  const rootBone = result.skeleton.bones[0];
  if (!rootBone) throw new Error("El BVH no contiene un esqueleto válido");
  const root = new THREE.Group();
  root.name = "bvh-root";
  root.add(rootBone);
  return { root, clips: [result.clip], texturesReady: Promise.resolve() };
}

/** Cuenta las cargas pendientes de un LoadingManager, para esperar las texturas antes de sacar una foto. */
function trackPendingLoads(manager: THREE.LoadingManager) {
  let pending = 0;
  let waiters: Array<() => void> = [];
  const itemStart = manager.itemStart.bind(manager);
  const itemEnd = manager.itemEnd.bind(manager);
  manager.itemStart = (url) => {
    pending += 1;
    itemStart(url);
  };
  manager.itemEnd = (url) => {
    itemEnd(url);
    pending = Math.max(0, pending - 1);
    if (!pending) {
      const done = waiters;
      waiters = [];
      done.forEach((resolve) => resolve());
    }
  };
  return () => (pending ? new Promise<void>((resolve) => waiters.push(resolve)) : Promise.resolve());
}

export { repairQuaternionSpikes };

/** Carga el archivo y limpia de sus animaciones los cuadros sueltos imposibles (ver animationRepair). */
export async function loadThreeAsset(asset: AnimationAsset): Promise<LoadedThreeAsset> {
  const loaded = await readThreeAsset(asset);
  repairQuaternionSpikes(loaded.clips);
  return loaded;
}

async function readThreeAsset(asset: AnimationAsset): Promise<LoadedThreeAsset> {
  const { bytes, directory, resources, textures } = await readAssetPackage(asset.path);
  if (asset.format === "bvh") return parseBvhAsset(bytes);
  const manager = new THREE.LoadingManager();
  const settled = trackPendingLoads(manager);
  if (asset.format === "fbx") {
    manager.setURLModifier((url) => {
      if (/^(data|blob):/i.test(url)) return url;
      const found = resolveTexturePath(url, directory, textures);
      return found ? convertFileSrc(found) : MISSING_TEXTURE;
    });
    manager.addHandler(/\.tga$/i, new TGALoader(manager));
    const result = new FBXLoader(manager).parse(bytes, `${directory}/`);
    const root = result as THREE.Object3D;
    repairInvisibleMaterials(root);
    repairMaterialGroups(root);
    return { root, clips: result.animations, texturesReady: settled().then(() => dropMissingTextures(root)) };
  }

  const data = asset.format === "gltf" ? new TextDecoder().decode(bytes) : bytes;
  const resourceUrls = new Map<string, string>();
  for (const resource of resources) {
    const objectUrl = URL.createObjectURL(new Blob([resource.bytes], { type: resource.mimeType }));
    resourceUrls.set(resource.uri.replaceAll("\\", "/").replace(/^\.\//, ""), objectUrl);
  }
  manager.setURLModifier((url) => {
    const normalized = url.replaceAll("\\", "/").replace(/^\.\//, "");
    // Lo que no vino en el paquete es una imagen que no existe: se salta sin pedirla a ningún lado.
    return resourceUrls.get(normalized) ?? (/^(data|blob):/i.test(url) ? url : MISSING_TEXTURE);
  });
  try {
    const result = await new GLTFLoader(manager).parseAsync(data, "");
    return { root: result.scene as THREE.Object3D, clips: result.animations, texturesReady: settled() };
  } finally {
    resourceUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}

/** Un cuarto con luz para que los metales tengan algo que reflejar (lo usan el visor y las fotos). */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer) {
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const texture = generator.fromScene(room, 0.04).texture;
  room.dispose();
  generator.dispose();
  return texture;
}

export function hasMesh(root: THREE.Object3D) {
  return root.getObjectByProperty("isMesh", true) !== undefined;
}

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
    const skinned = object as THREE.SkinnedMesh;
    skinned.skeleton?.dispose();
  });
  root.removeFromParent();
}
