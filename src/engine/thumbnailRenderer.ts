import * as THREE from "three";
import { createStudioEnvironment, disposeObject, dropMissingTextures, hasMesh, loadThreeAsset } from "./assetLoader";
import type { AnimationAsset } from "../lib/types";

/** Se dibuja al doble y se reduce, así los bordes quedan suaves sin depender del antialias. */
const RENDER_SIZE = 512;
export const THUMBNAIL_SIZE = 256;
const WEBP_QUALITY = 0.82;
const TEXTURE_WAIT_MS = 4000;
const EXPOSURE = 1.05;
/** Segunda toma más iluminada para piezas oscuras de verdad (pelo negro, plástico oscuro). */
const RESCUE_EXPOSURE = 2.8;

/** Qué tanto de la foto ocupa la pieza y qué parte de ella tiene luz, a partir de los píxeles RGBA. */
export function measurePhoto(pixels: Uint8Array, step = 4) {
  let covered = 0;
  let lit = 0;
  let sampled = 0;
  for (let index = 0; index < pixels.length; index += 4 * step) {
    sampled += 1;
    if (pixels[index + 3] < 16) continue;
    covered += 1;
    const luminance = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
    if (luminance > 24) lit += 1;
  }
  return { coverage: sampled ? covered / sampled : 0, litShare: covered ? lit / covered : 0 };
}

/** Descarta fotos que no sirven para reconocer la pieza, con un motivo en criollo. */
export function photoProblem({ coverage, litShare }: { coverage: number; litShare: number }): string | null {
  if (coverage < 0.002) return "La foto salió vacía: la pieza no se ve";
  if (litShare < 0.01) return "La foto salió negra: le faltan las texturas o los colores";
  return null;
}

export interface ShapeInfo {
  size: { x: number; y: number; z: number };
  skinned: boolean;
}

/** Personaje: tiene esqueleto y está parado (más alto que ancho). Un perro, que es más largo que alto, va como objeto. */
export function isCharacterShape({ size, skinned }: ShapeInfo) {
  return skinned && size.y >= Math.max(size.x, size.z) * 0.9;
}

/**
 * Dirección desde el centro de la pieza hacia la cámara.
 * Personajes: de frente (+Z, como Mixamo y glTF), apenas girados para que tengan volumen.
 * Objetos: mirando la cara más grande (el eje más fino apunta a la cámara), en tres cuartos.
 */
export function chooseCameraDirection(shape: ShapeInfo): THREE.Vector3 {
  if (isCharacterShape(shape)) return new THREE.Vector3(0.2, 0.12, 1).normalize();
  const { x, y, z } = shape.size;
  const largest = Math.max(x, y, z, 1e-6);
  const smallest = Math.min(x, y, z);
  if (smallest / largest > 0.6) return new THREE.Vector3(0.62, 0.42, 0.66).normalize();
  if (y === smallest) return new THREE.Vector3(0.3, 0.85, 0.45).normalize();
  if (x === smallest) return new THREE.Vector3(1, 0.42, 0.5).normalize();
  return new THREE.Vector3(0.5, 0.42, 1).normalize();
}

function isSkinned(root: THREE.Object3D) {
  let skinned = false;
  root.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  return skinned;
}

/** Paredes y planos de una sola cara desaparecen si la cámara los mira de atrás; en la foto se ven las dos. */
function showBothFaces(root: THREE.Object3D) {
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      item.side = THREE.DoubleSide;
      item.needsUpdate = true;
    }
  });
}

/** Rescate para FBX que marcan la transparencia al revés: todo opaco, sin máscaras de recorte. */
function forceOpaque(root: THREE.Object3D) {
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      const slots = item as unknown as Record<string, unknown>;
      item.transparent = false;
      item.opacity = 1;
      item.alphaTest = 0;
      if ("alphaMap" in slots) slots.alphaMap = null;
      item.needsUpdate = true;
    }
  });
}

function applyFirstFrame(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const clip = clips.find((item) => Number.isFinite(item.duration) && item.duration > 0);
  if (!clip || !isSkinned(root)) return;
  try {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.setTime(0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty() || !Number.isFinite(box.min.x + box.max.x + box.min.y + box.max.y)) mixer.stopAllAction();
  } catch {
    // Si la animación no encaja con el modelo, queda la pose original.
  }
  root.updateMatrixWorld(true);
}

/** Puntos que encierran lo visible: las esquinas de cada malla, más ajustadas que la caja total. */
function framingPoints(root: THREE.Object3D) {
  const points: THREE.Vector3[] = [];
  const box = new THREE.Box3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    box.makeEmpty().expandByObject(mesh);
    if (box.isEmpty()) return;
    for (const px of [box.min.x, box.max.x]) for (const py of [box.min.y, box.max.y]) for (const pz of [box.min.z, box.max.z]) points.push(new THREE.Vector3(px, py, pz));
  });
  return points;
}

class ThumbnailRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly key = new THREE.DirectionalLight(0xffffff, 2.6);
  private readonly fill = new THREE.DirectionalLight(0xdfe8ff, 0.9);
  private readonly rim = new THREE.DirectionalLight(0xffe2c4, 1.5);
  private readonly output = document.createElement("canvas");

  constructor() {
    const canvas = document.createElement("canvas");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;
    this.scene.environment = createStudioEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.7;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x30363b, 1.1));
    for (const light of [this.key, this.fill, this.rim]) {
      this.scene.add(light);
      this.scene.add(light.target);
    }
    this.output.width = THUMBNAIL_SIZE;
    this.output.height = THUMBNAIL_SIZE;
  }

  async render(asset: AnimationAsset, companion: AnimationAsset | null): Promise<Uint8Array> {
    const loaded = await loadThreeAsset(asset);
    let root = loaded.root;
    let texturesReady = loaded.texturesReady;
    if (!hasMesh(root) && companion) {
      try {
        const model = await loadThreeAsset(companion);
        if (hasMesh(model.root)) {
          disposeObject(root);
          root = model.root;
          texturesReady = model.texturesReady;
        } else {
          disposeObject(model.root);
        }
      } catch {
        // Sin modelo compañero se informa abajo como pieza sin forma visible.
      }
    }
    try {
      if (!hasMesh(root)) throw new Error("No tiene forma visible: es solo animación y no se encontró su modelo");
      await Promise.race([texturesReady, new Promise((resolve) => window.setTimeout(resolve, TEXTURE_WAIT_MS))]);
      dropMissingTextures(root);
      showBothFaces(root);
      applyFirstFrame(root, loaded.clips);
      this.scene.add(root);
      root.updateMatrixWorld(true);
      this.frame(root);
      let problem = this.shoot(EXPOSURE);
      if (problem?.includes("vacía")) {
        forceOpaque(root);
        problem = this.shoot(EXPOSURE);
      }
      // Como las texturas faltantes ya se quitan antes, una pieza que sigue negra con doble luz es
      // oscura de verdad (pelo negro, plástico oscuro): su silueta es la foto correcta.
      if (problem?.includes("negra")) {
        this.shoot(RESCUE_EXPOSURE);
        problem = null;
      }
      if (problem) throw new Error(problem);
      return await this.encode();
    } finally {
      disposeObject(root);
    }
  }

  private frame(root: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new Error("La pieza no tiene tamaño");
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1e-4);
    const direction = chooseCameraDirection({ size, skinned: isSkinned(root) });

    const camera = this.camera;
    camera.up.set(0, 1, 0);
    if (Math.abs(direction.y) > 0.98) camera.up.set(0, 0, -1);
    camera.position.copy(center).addScaledVector(direction, radius * 4);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);

    const inverse = camera.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const point of framingPoints(root)) {
      point.applyMatrix4(inverse);
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
    }
    const half = Math.max(maxX - minX, maxY - minY) * 0.55;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    camera.left = centerX - half;
    camera.right = centerX + half;
    camera.top = centerY + half;
    camera.bottom = centerY - half;
    camera.near = Math.max(1e-4, -maxZ - radius * 0.1);
    camera.far = -minZ + radius * 0.1;
    camera.updateProjectionMatrix();

    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const place = (light: THREE.DirectionalLight, toward: THREE.Vector3) => {
      light.position.copy(center).addScaledVector(toward.normalize(), radius * 4);
      light.target.position.copy(center);
      light.target.updateMatrixWorld();
    };
    place(this.key, direction.clone().add(up.clone().multiplyScalar(0.9)).add(right.clone().multiplyScalar(-0.7)));
    place(this.fill, direction.clone().add(right.clone().multiplyScalar(0.9)).add(up.clone().multiplyScalar(-0.1)));
    place(this.rim, direction.clone().multiplyScalar(-1).add(up.clone().multiplyScalar(0.7)));
  }

  /** Saca la foto con esa exposición y devuelve qué tiene de malo, o null si sirve. */
  private shoot(exposure: number) {
    this.renderer.toneMappingExposure = exposure;
    this.renderer.render(this.scene, this.camera);
    return photoProblem(this.measure());
  }

  private measure() {
    const gl = this.renderer.getContext();
    const pixels = new Uint8Array(RENDER_SIZE * RENDER_SIZE * 4);
    gl.readPixels(0, 0, RENDER_SIZE, RENDER_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return measurePhoto(pixels);
  }

  private async encode(): Promise<Uint8Array> {
    const context = this.output.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la imagen");
    const glow = context.createRadialGradient(THUMBNAIL_SIZE / 2, THUMBNAIL_SIZE * 0.42, 8, THUMBNAIL_SIZE / 2, THUMBNAIL_SIZE / 2, THUMBNAIL_SIZE * 0.72);
    glow.addColorStop(0, "#23282c");
    glow.addColorStop(1, "#0b0d0e");
    context.fillStyle = glow;
    context.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(this.renderer.domElement, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const blob = await new Promise<Blob | null>((resolve) => this.output.toBlob(resolve, "image/webp", WEBP_QUALITY));
    if (!blob || blob.type !== "image/webp") throw new Error("Este equipo no pudo generar la imagen WebP");
    return new Uint8Array(await blob.arrayBuffer());
  }
}

let shared: ThumbnailRenderer | null = null;

/** Un solo dibujante para toda la app, separado del visor principal. */
export function renderThumbnail(asset: AnimationAsset, companion: AnimationAsset | null) {
  shared ??= new ThumbnailRenderer();
  return shared.render(asset, companion);
}
