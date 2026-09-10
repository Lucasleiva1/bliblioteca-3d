import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

globalThis.window ??= globalThis;
globalThis.document ??= {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    set src(_value) {},
  }),
};

const root = path.resolve(process.argv[2] || "D:/biblioteca-3d");

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
  }));
  return nested.flat();
}

const files = (await filesBelow(root)).filter((file) => path.extname(file).toLowerCase() === ".fbx");
const results = [];

for (const file of files) {
  try {
    const source = await readFile(file);
    const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    const object = new FBXLoader().parse(buffer, `${path.dirname(file).replaceAll("\\", "/")}/`);
    let meshes = 0;
    let skinnedMeshes = 0;
    let bones = 0;
    object.traverse((child) => {
      if (child.isMesh) meshes += 1;
      if (child.isSkinnedMesh) skinnedMeshes += 1;
      if (child.isBone) bones += 1;
    });
    results.push({
      file: path.relative(root, file),
      bytes: source.byteLength,
      clips: object.animations.map((clip) => ({ name: clip.name, duration: Number(clip.duration.toFixed(3)), tracks: clip.tracks.length })),
      meshes,
      skinnedMeshes,
      bones,
    });
  } catch (error) {
    results.push({ file: path.relative(root, file), error: String(error) });
  }
}

const summary = {
  root,
  files: results.length,
  readable: results.filter((item) => !item.error).length,
  failed: results.filter((item) => item.error).length,
  withMesh: results.filter((item) => item.meshes > 0).length,
  withSkeleton: results.filter((item) => item.bones > 0).length,
  withClips: results.filter((item) => item.clips?.length > 0).length,
};

const report = process.argv.includes("--summary")
  ? { summary, notable: results.filter((item) => item.error || item.meshes > 0) }
  : { summary, results };
console.log(JSON.stringify(report, null, 2));
