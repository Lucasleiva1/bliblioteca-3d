import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Focus,
  Grid3X3,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  SkipBack,
  StepBack,
  StepForward,
} from "lucide-react";
import { readAssetBytes } from "../lib/api";
import type { AnimationAsset } from "../lib/types";

type PlaybackState = "empty" | "loading" | "ready" | "playing" | "paused" | "error";

interface ViewerRuntime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  clock: THREE.Clock;
  mixer: THREE.AnimationMixer | null;
  root: THREE.Object3D | null;
  skeleton: THREE.SkeletonHelper | null;
  clips: THREE.AnimationClip[];
  activeClip: number;
  mannequin: MannequinRuntime | null;
  hasModelMesh: boolean;
}

interface MannequinRuntime {
  group: THREE.Group;
  joints: Array<{ bone: THREE.Bone; mesh: THREE.Mesh }>;
  segments: Array<{ from: THREE.Bone; to: THREE.Bone; mesh: THREE.Mesh }>;
  updates: Array<() => void>;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TARGET_CHARACTER_HEIGHT = 1.8;

function boneKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^mixamorig/, "");
}

function boundsIncludingBones(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone) box.expandByPoint(object.getWorldPosition(new THREE.Vector3()));
  });
  return box;
}

function normalizeForViewer(root: THREE.Object3D) {
  let box = boundsIncludingBones(root);
  if (box.isEmpty()) return;
  const height = box.getSize(new THREE.Vector3()).y;
  if (Number.isFinite(height) && height > 0.0001) {
    const scale = THREE.MathUtils.clamp(TARGET_CHARACTER_HEIGHT / height, 0.0001, 10_000);
    root.scale.multiplyScalar(scale);
    box = boundsIncludingBones(root);
  }
  if (Number.isFinite(box.min.y)) {
    root.position.y -= box.min.y;
    root.updateMatrixWorld(true);
  }
}

function createProceduralHumanoid(root: THREE.Object3D, bodyType: "male" | "female"): MannequinRuntime | null {
  root.updateMatrixWorld(true);
  const bones = new Map<string, THREE.Bone>();
  root.traverse((object) => {
    if (!(object as THREE.Bone).isBone) return;
    const key = boneKey(object.name);
    if (!bones.has(key)) bones.set(key, object as THREE.Bone);
  });
  const bone = (...names: string[]) => names.map((name) => bones.get(name)).find(Boolean);
  const hips = bone("hips", "pelvis");
  const spine = bone("spine");
  const spine1 = bone("spine1") ?? spine;
  const spine2 = bone("spine2", "chest") ?? spine1;
  const neck = bone("neck");
  const head = bone("head");
  const headTop = bone("headtopend", "headtop");
  if (!hips || !spine1 || !spine2 || !neck || !head) return null;

  const leftArm = bone("leftarm", "leftupperarm");
  const rightArm = bone("rightarm", "rightupperarm");
  const height = Math.max(boundsIncludingBones(root).getSize(new THREE.Vector3()).y, TARGET_CHARACTER_HEIGHT);
  const female = bodyType === "female";
  const material = new THREE.MeshStandardMaterial({
    color: 0xc6d3ff,
    emissive: 0x24345d,
    emissiveIntensity: 0.26,
    roughness: 0.42,
    metalness: 0.02,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  group.name = `viewer-mannequin-${bodyType}`;
  group.renderOrder = 2;
  const updates: Array<() => void> = [];

  const addMesh = (name: string, detail = 24) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, detail, Math.max(12, Math.round(detail * 0.66))), material);
    mesh.name = name;
    mesh.renderOrder = 2;
    group.add(mesh);
    return mesh;
  };

  const torsoUp = new THREE.Vector3(0, 1, 0);
  const torsoRight = new THREE.Vector3(1, 0, 0);
  const torsoForward = new THREE.Vector3(0, 0, 1);
  const torsoMatrix = new THREE.Matrix4();
  const torsoQuaternion = new THREE.Quaternion();
  const leftPosition = new THREE.Vector3();
  const rightPosition = new THREE.Vector3();
  const hipsPosition = new THREE.Vector3();
  const neckPosition = new THREE.Vector3();
  const updateTorsoFrame = () => {
    hips.getWorldPosition(hipsPosition);
    neck.getWorldPosition(neckPosition);
    torsoUp.subVectors(neckPosition, hipsPosition).normalize();
    if (leftArm && rightArm) {
      leftArm.getWorldPosition(leftPosition);
      rightArm.getWorldPosition(rightPosition);
      torsoRight.subVectors(rightPosition, leftPosition).normalize();
    } else torsoRight.set(1, 0, 0);
    torsoForward.crossVectors(torsoRight, torsoUp).normalize();
    if (torsoForward.lengthSq() < 0.5) torsoForward.set(0, 0, 1);
    torsoRight.crossVectors(torsoUp, torsoForward).normalize();
    torsoMatrix.makeBasis(torsoRight, torsoUp, torsoForward);
    torsoQuaternion.setFromRotationMatrix(torsoMatrix);
  };

  const addCore = (name: string, from: THREE.Bone, to: THREE.Bone, center: number, width: number, bodyHeight: number, depth: number, verticalOffset = 0) => {
    const mesh = addMesh(name, 28);
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    updates.push(() => {
      updateTorsoFrame();
      from.getWorldPosition(start);
      to.getWorldPosition(end);
      mesh.position.copy(start).lerp(end, center).addScaledVector(torsoUp, verticalOffset);
      mesh.quaternion.copy(torsoQuaternion);
      mesh.scale.set(width * 0.5, bodyHeight * 0.5, depth * 0.5);
    });
  };

  const addSegment = (name: string, from: THREE.Bone | undefined, to: THREE.Bone | undefined, width: number, depth: number, overlap = 1.12) => {
    if (!from || !to) return;
    const mesh = addMesh(name);
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const direction = new THREE.Vector3();
    updates.push(() => {
      from.getWorldPosition(start);
      to.getWorldPosition(end);
      direction.subVectors(end, start);
      const length = Math.max(direction.length(), height * 0.01);
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
      mesh.scale.set(width * 0.5, length * overlap * 0.5, depth * 0.5);
    });
  };

  const addJoint = (name: string, anchor: THREE.Bone | undefined, width: number, bodyHeight: number, depth: number) => {
    if (!anchor) return;
    const mesh = addMesh(name, 20);
    const position = new THREE.Vector3();
    updates.push(() => {
      anchor.getWorldPosition(position);
      mesh.position.copy(position);
      mesh.quaternion.identity();
      mesh.scale.set(width * 0.5, bodyHeight * 0.5, depth * 0.5);
    });
  };

  const addExtension = (name: string, previous: THREE.Bone | undefined, anchor: THREE.Bone | undefined, width: number, bodyLength: number, depth: number) => {
    if (!previous || !anchor) return;
    const mesh = addMesh(name, 20);
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const direction = new THREE.Vector3();
    updates.push(() => {
      previous.getWorldPosition(start);
      anchor.getWorldPosition(end);
      direction.subVectors(end, start).normalize();
      mesh.position.copy(end).addScaledVector(direction, bodyLength * 0.28);
      mesh.quaternion.setFromUnitVectors(Y_AXIS, direction);
      mesh.scale.set(width * 0.5, bodyLength * 0.5, depth * 0.5);
    });
  };

  const addFoot = (name: string, ankle: THREE.Bone | undefined, toe: THREE.Bone | undefined, fallbackLeg: THREE.Bone | undefined) => {
    if (!ankle) return;
    const mesh = addMesh(name, 22);
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const side = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    updates.push(() => {
      updateTorsoFrame();
      ankle.getWorldPosition(start);
      if (toe) toe.getWorldPosition(end);
      else if (fallbackLeg) {
        fallbackLeg.getWorldPosition(end);
        end.subVectors(start, end).normalize().multiplyScalar(height * 0.12).add(start);
      } else end.copy(start).addScaledVector(torsoForward, height * 0.12);
      forward.subVectors(end, start).normalize();
      side.crossVectors(torsoUp, forward).normalize();
      if (side.lengthSq() < 0.5) side.copy(torsoRight);
      forward.crossVectors(side, torsoUp).normalize();
      matrix.makeBasis(side, torsoUp, forward);
      mesh.quaternion.setFromRotationMatrix(matrix);
      mesh.position.copy(start).lerp(end, 0.62).addScaledVector(forward, height * 0.018);
      mesh.scale.set(height * 0.034, height * 0.025, Math.max(start.distanceTo(end) * 0.68, height * 0.065));
    });
  };

  addCore("chest", spine1, neck, 0.58, height * (female ? 0.235 : 0.275), height * 0.235, height * (female ? 0.13 : 0.145));
  addCore("abdomen", hips, spine2, 0.52, height * (female ? 0.158 : 0.188), height * 0.205, height * (female ? 0.105 : 0.12));
  addCore("pelvis", hips, spine1, 0, height * (female ? 0.235 : 0.205), height * (female ? 0.145 : 0.135), height * (female ? 0.15 : 0.14), -height * 0.025);
  addSegment("neck", neck, head, height * (female ? 0.052 : 0.06), height * 0.055, 1.25);

  if (headTop) {
    const mesh = addMesh("head", 28);
    const base = new THREE.Vector3();
    const top = new THREE.Vector3();
    const direction = new THREE.Vector3();
    updates.push(() => {
      head.getWorldPosition(base);
      headTop.getWorldPosition(top);
      direction.subVectors(top, base);
      mesh.position.copy(base).lerp(top, 0.53);
      mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
      mesh.scale.set(height * 0.047, height * 0.064, height * 0.052);
    });
  } else addExtension("head", neck, head, height * 0.094, height * 0.128, height * 0.104);

  for (const side of ["left", "right"] as const) {
    const upperArm = bone(`${side}arm`, `${side}upperarm`);
    const foreArm = bone(`${side}forearm`, `${side}lowerarm`);
    const hand = bone(`${side}hand`);
    const upperLeg = bone(`${side}upleg`, `${side}thigh`);
    const lowerLeg = bone(`${side}leg`, `${side}calf`, `${side}lowerleg`);
    const foot = bone(`${side}foot`);
    const toe = bone(`${side}toebase`, `${side}toeend`, `${side}toe`);

    addJoint(`${side}-shoulder`, upperArm, height * (female ? 0.066 : 0.077), height * 0.074, height * (female ? 0.067 : 0.075));
    addSegment(`${side}-upper-arm`, upperArm, foreArm, height * (female ? 0.052 : 0.062), height * (female ? 0.05 : 0.06));
    addJoint(`${side}-elbow`, foreArm, height * (female ? 0.046 : 0.052), height * 0.05, height * (female ? 0.043 : 0.05));
    addSegment(`${side}-forearm`, foreArm, hand, height * (female ? 0.041 : 0.047), height * (female ? 0.039 : 0.045));
    addExtension(`${side}-hand`, foreArm, hand, height * (female ? 0.045 : 0.052), height * 0.102, height * 0.027);
    addJoint(`${side}-hip`, upperLeg, height * (female ? 0.082 : 0.072), height * 0.092, height * (female ? 0.082 : 0.074));
    addSegment(`${side}-thigh`, upperLeg, lowerLeg, height * (female ? 0.08 : 0.083), height * (female ? 0.083 : 0.086), 1.1);
    addJoint(`${side}-knee`, lowerLeg, height * (female ? 0.058 : 0.063), height * 0.066, height * 0.062);
    addSegment(`${side}-calf`, lowerLeg, foot, height * (female ? 0.058 : 0.063), height * (female ? 0.061 : 0.066), 1.08);
    addJoint(`${side}-ankle`, foot, height * 0.045, height * 0.052, height * 0.047);
    addFoot(`${side}-foot`, foot, toe, lowerLeg);
  }

  return { group, joints: [], segments: [], updates };
}

function updateMannequin(mannequin: MannequinRuntime) {
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const direction = new THREE.Vector3();
  for (const joint of mannequin.joints) joint.mesh.position.copy(joint.bone.getWorldPosition(from));
  for (const segment of mannequin.segments) {
    segment.from.getWorldPosition(from);
    segment.to.getWorldPosition(to);
    direction.subVectors(to, from);
    const length = direction.length();
    segment.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    if (length > 0.0001) segment.mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
    segment.mesh.scale.set(1, Math.max(length, 0.0001), 1);
  }
  for (const update of mannequin.updates) update();
}

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

function disposeObject(root: THREE.Object3D) {
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

function disposeHelper(helper: THREE.SkeletonHelper) {
  helper.geometry.dispose();
  const material = helper.material;
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0:00.00";
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

export default function Viewer3D({
  asset,
  characterBody,
  characterBones,
  autoplay,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
}: {
  asset: AnimationAsset | null;
  characterBody: "male" | "female";
  characterBones: boolean;
  autoplay: boolean;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const loadGeneration = useRef(0);
  const [state, setState] = useState<PlaybackState>("empty");
  const stateRef = useRef<PlaybackState>("empty");
  const [error, setError] = useState<string | null>(null);
  const [clips, setClips] = useState<THREE.AnimationClip[]>([]);
  const [clipIndex, setClipIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [showMesh, setShowMesh] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(characterBones);
  const [showGrid, setShowGrid] = useState(true);
  const speedRef = useRef(1);
  const loopRef = useRef(true);
  const showSkeletonRef = useRef(false);
  const showMeshRef = useRef(true);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { showSkeletonRef.current = showSkeleton; }, [showSkeleton]);
  useEffect(() => { showMeshRef.current = showMesh; }, [showMesh]);
  useEffect(() => { setShowSkeleton(characterBones); }, [characterBones]);

  const setSkeletonPreference = useCallback((value: boolean) => {
    setShowSkeleton(value);
    localStorage.setItem("biblioteca-3d-character-bones", String(value));
    window.dispatchEvent(new Event("biblioteca-3d-character-change"));
  }, []);

  const frameObject = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.root) return;
    runtime.root.updateMatrixWorld(true);
    if (runtime.mannequin) {
      updateMannequin(runtime.mannequin);
      runtime.mannequin.group.updateMatrixWorld(true);
    }
    const box = runtime.hasModelMesh
      ? new THREE.Box3().setFromObject(runtime.root)
      : boundsIncludingBones(runtime.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.25);
    runtime.controls.target.copy(center);
    runtime.camera.position.set(center.x + radius * 0.62, center.y + radius * 0.22, center.z + radius * 2.25);
    runtime.camera.near = Math.max(0.001, radius / 1000);
    runtime.camera.far = Math.max(1000, radius * 100);
    runtime.camera.updateProjectionMatrix();
    runtime.controls.update();
  }, []);

  const stopPlayback = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.mixer || !runtime.clips.length) return;
    runtime.mixer.stopAllAction();
    runtime.mixer.setTime(0);
    const action = runtime.mixer.clipAction(runtime.clips[runtime.activeClip]);
    action.reset().play();
    action.paused = true;
    setTime(0);
    setState("paused");
  }, []);

  const stepFrame = useCallback((direction: -1 | 1) => {
    const runtime = runtimeRef.current;
    const clip = runtime?.clips[runtime.activeClip];
    if (!runtime?.mixer || !clip) return;
    const action = runtime.mixer.clipAction(clip);
    if (!action.isRunning()) action.play();
    action.paused = true;
    const next = THREE.MathUtils.clamp(runtime.mixer.time + direction / 30, 0, clip.duration);
    const previousScale = runtime.mixer.timeScale;
    runtime.mixer.timeScale = 1;
    runtime.mixer.setTime(next);
    runtime.mixer.timeScale = previousScale;
    setTime(next);
    setState("paused");
  }, []);

  const playPause = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.mixer || !runtime.clips.length) return;
    const action = runtime.mixer.clipAction(runtime.clips[runtime.activeClip]);
    if (state === "playing") {
      action.paused = true;
      setState("paused");
    } else {
      if (!action.isRunning()) action.play();
      action.paused = false;
      setState("playing");
    }
  }, [state]);

  const chooseClip = useCallback((index: number) => {
    const runtime = runtimeRef.current;
    if (!runtime?.mixer || !runtime.clips[index]) return;
    runtime.mixer.stopAllAction();
    runtime.activeClip = index;
    const action = runtime.mixer.clipAction(runtime.clips[index]);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.play();
    setClipIndex(index);
    setTime(0);
    setState("playing");
  }, [loop]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111315);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 5000);
    camera.position.set(2.2, 1.6, 3.8);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1, 0);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x262a30, 2.2);
    const key = new THREE.DirectionalLight(0xffe7ca, 2.7);
    key.position.set(4, 7, 5);
    const rim = new THREE.DirectionalLight(0x8aaeff, 1.4);
    rim.position.set(-4, 3, -4);
    const grid = new THREE.GridHelper(20, 20, 0x6e5845, 0x303438);
    grid.name = "viewer-grid";
    scene.add(hemi, key, rim, grid);
    const runtime: ViewerRuntime = {
      renderer, scene, camera, controls, clock: new THREE.Clock(), mixer: null,
      root: null, skeleton: null, clips: [], activeClip: 0, mannequin: null, hasModelMesh: false,
    };
    runtimeRef.current = runtime;
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let frame = 0;
    let lastUiUpdate = 0;
    const render = (stamp: number) => {
      const delta = Math.min(runtime.clock.getDelta(), 0.1);
      if (runtime.mixer && stateRef.current === "playing") runtime.mixer.update(delta * speedRef.current);
      if (runtime.mannequin) updateMannequin(runtime.mannequin);
      controls.update();
      renderer.render(scene, camera);
      if (runtime.mixer && stamp - lastUiUpdate > 80) {
        lastUiUpdate = stamp;
        const duration = runtime.clips[runtime.activeClip]?.duration ?? 0;
        setTime(duration > 0 ? runtime.mixer.time % duration : 0);
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      loadGeneration.current += 1;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      runtime.mixer?.stopAllAction();
      if (runtime.root) disposeObject(runtime.root);
      if (runtime.skeleton) disposeHelper(runtime.skeleton);
      if (runtime.mannequin) disposeObject(runtime.mannequin.group);
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.scene.getObjectByName("viewer-grid")!.visible = showGrid;
    runtime.root?.traverse((object) => {
      if ((object as THREE.Mesh).isMesh || (object as THREE.SkinnedMesh).isSkinnedMesh) object.visible = showMesh;
    });
    if (runtime.skeleton) runtime.skeleton.visible = showSkeleton;
    if (runtime.mannequin) runtime.mannequin.group.visible = showMesh && !runtime.hasModelMesh;
  }, [showGrid, showMesh, showSkeleton]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const generation = ++loadGeneration.current;
    runtime.mixer?.stopAllAction();
    if (runtime.root) disposeObject(runtime.root);
    if (runtime.skeleton) {
      runtime.skeleton.removeFromParent();
      disposeHelper(runtime.skeleton);
    }
    if (runtime.mannequin) disposeObject(runtime.mannequin.group);
    runtime.root = null;
    runtime.mixer = null;
    runtime.skeleton = null;
    runtime.clips = [];
    runtime.mannequin = null;
    runtime.hasModelMesh = false;
    setClips([]);
    setClipIndex(0);
    setTime(0);
    setError(null);
    if (!asset) {
      setState("empty");
      return;
    }
    setState("loading");
    void readAssetBytes(asset.path).then(async ({ bytes, directory, resources }) => {
      const buffer = Uint8Array.from(bytes).buffer;
      let root: THREE.Object3D;
      let loadedClips: THREE.AnimationClip[];
      if (asset.format === "fbx") {
        const result = new FBXLoader().parse(buffer, `${directory}/`);
        root = result;
        loadedClips = result.animations;
      } else {
        const data = asset.format === "gltf" ? new TextDecoder().decode(buffer) : buffer;
        const manager = new THREE.LoadingManager();
        const resourceUrls = new Map<string, string>();
        for (const resource of resources) {
          const objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(resource.bytes)], { type: resource.mimeType }));
          resourceUrls.set(resource.uri.replaceAll("\\", "/").replace(/^\.\//, ""), objectUrl);
        }
        manager.setURLModifier((url) => {
          const normalized = url.replaceAll("\\", "/").replace(/^\.\//, "");
          return resourceUrls.get(normalized) ?? url;
        });
        let result;
        try {
          result = await new GLTFLoader(manager).parseAsync(data, "");
        } finally {
          resourceUrls.forEach((url) => URL.revokeObjectURL(url));
        }
        root = result.scene;
        loadedClips = result.animations;
      }
      if (generation !== loadGeneration.current || !runtimeRef.current) {
        disposeObject(root);
        return;
      }
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          const sourceMaterial = mesh.material;
          const hadMultipleMaterials = Array.isArray(sourceMaterial);
          const materials: THREE.Material[] = hadMultipleMaterials ? sourceMaterial : [sourceMaterial];
          const transparentMaterials = materials.map((source) => {
            const material = source.clone();
            material.transparent = true;
            material.opacity = 0.42;
            material.depthWrite = false;
            return material;
          });
          mesh.material = hadMultipleMaterials ? transparentMaterials : transparentMaterials[0];
        }
      });
      normalizeForViewer(root);
      runtime.hasModelMesh = root.getObjectByProperty("isMesh", true) !== undefined;
      if (!runtime.hasModelMesh) {
        root.position.y += TARGET_CHARACTER_HEIGHT * 0.026;
        root.updateMatrixWorld(true);
      }
      runtime.root = root;
      runtime.clips = loadedClips.filter((clip) => Number.isFinite(clip.duration) && clip.duration > 0);
      runtime.activeClip = 0;
      runtime.scene.add(root);
      const mannequin = !runtime.hasModelMesh ? createProceduralHumanoid(root, characterBody) : null;
      if (generation !== loadGeneration.current || !runtimeRef.current) {
        if (mannequin) disposeObject(mannequin.group);
        return;
      }
      if (mannequin) {
        mannequin.group.visible = showMeshRef.current && !runtime.hasModelMesh;
        runtime.mannequin = mannequin;
        runtime.scene.add(mannequin.group);
        updateMannequin(mannequin);
      }
      const skeleton = new THREE.SkeletonHelper(root);
      skeleton.visible = showSkeletonRef.current;
      runtime.skeleton = skeleton;
      runtime.scene.add(skeleton);
      runtime.mixer = new THREE.AnimationMixer(root);
      setClips(runtime.clips);
      if (runtime.clips.length) {
        const action = runtime.mixer.clipAction(runtime.clips[0]);
        action.setLoop(loopRef.current ? THREE.LoopRepeat : THREE.LoopOnce, loopRef.current ? Infinity : 1);
        action.clampWhenFinished = !loopRef.current;
        action.play();
        action.paused = !autoplay;
        setState(autoplay ? "playing" : "paused");
      } else {
        setState("ready");
      }
      frameObject();
    }).catch((loadError) => {
      if (generation !== loadGeneration.current) return;
      setError(String(loadError));
      setState("error");
    });
  }, [asset, autoplay, characterBody, frameObject]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.mixer || !runtime.clips.length) return;
    const action = runtime.mixer.clipAction(runtime.clips[runtime.activeClip]);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
  }, [loop]);

  const duration = clips[clipIndex]?.duration ?? 0;
  return (
    <section className="viewer-panel" aria-label="Visor 3D">
      <div className="viewer-toolbar">
        <button className={showMesh ? "active" : ""} aria-pressed={showMesh} onClick={() => setShowMesh((value) => !value)} title="Mostrar u ocultar personaje o maniquí translúcido"><Box size={16} /><span>Personaje</span></button>
        <button className={showSkeleton ? "active" : ""} aria-pressed={showSkeleton} onClick={() => setSkeletonPreference(!showSkeleton)} title="Mostrar u ocultar esqueleto"><ScanLine size={16} /><span>Esqueleto</span></button>
        <button className={showGrid ? "active" : ""} aria-pressed={showGrid} onClick={() => setShowGrid((value) => !value)} title="Mostrar u ocultar cuadrícula"><Grid3X3 size={16} /><span>Grid</span></button>
        <span className="toolbar-spacer" />
        <button onClick={onPrevious} disabled={!canPrevious} title="Animacion anterior"><ChevronLeft size={16} /></button>
        <button onClick={onNext} disabled={!canNext} title="Animacion siguiente"><ChevronRight size={16} /></button>
        <button onClick={frameObject} disabled={!asset} title="Centrar y encuadrar"><Focus size={16} /></button>
        <button onClick={frameObject} disabled={!asset} title="Restablecer cámara"><RotateCcw size={16} /></button>
      </div>
      <div className="viewer-canvas" ref={hostRef}>
        {state === "empty" && <div className="viewer-message"><Box size={46} /><strong>Elegí una animación</strong><span>FBX, GLB o GLTF</span></div>}
        {state === "loading" && <div className="viewer-message"><span className="loader" /><strong>Cargando {asset?.fileName}</strong></div>}
        {state === "error" && <div className="viewer-message error"><strong>No se pudo abrir esta animación</strong><span>{error}</span></div>}
        {state === "ready" && clips.length === 0 && <div className="viewer-message compact"><strong>El archivo no contiene clips de animación</strong></div>}
      </div>
      <div className="transport">
        <button onClick={stopPlayback} disabled={!clips.length} title="Detener y volver al inicio"><SkipBack size={17} /></button>
        <button onClick={() => stepFrame(-1)} disabled={!clips.length} title="Retroceder un cuadro"><StepBack size={17} /></button>
        <button className="transport-main" onClick={playPause} disabled={!clips.length} title={state === "playing" ? "Pausar" : "Reproducir"}>
          {state === "playing" ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={() => stepFrame(1)} disabled={!clips.length} title="Avanzar un cuadro"><StepForward size={17} /></button>
        <select value={clipIndex} onChange={(event) => chooseClip(Number(event.target.value))} disabled={!clips.length} aria-label="Clip de animación">
          {clips.length ? clips.map((clip, index) => <option key={`${clip.name}-${index}`} value={index}>{clip.name || `Clip ${index + 1}`}</option>) : <option>Sin clips</option>}
        </select>
        <span className="time-label">{formatTime(time)}</span>
        <input className="timeline" type="range" min="0" max={duration || 1} step="0.001" value={Math.min(time, duration || 1)} disabled={!clips.length} aria-label="Línea de tiempo" onChange={(event) => {
          const next = Number(event.target.value);
          const runtime = runtimeRef.current;
          if (!runtime?.mixer) return;
          const previousScale = runtime.mixer.timeScale;
          runtime.mixer.timeScale = 1;
          runtime.mixer.setTime(next);
          runtime.mixer.timeScale = previousScale;
          setTime(next);
        }} />
        <span className="time-label">{formatTime(duration)}</span>
        <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Velocidad">
          {[0.25, 0.5, 1, 1.5, 2].map((value) => <option value={value} key={value}>{value}x</option>)}
        </select>
        <label className="loop-toggle"><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /> Loop</label>
      </div>
    </section>
  );
}

