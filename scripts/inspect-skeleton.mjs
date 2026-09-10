import { readFile, readdir } from "node:fs/promises";
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

async function firstFbx(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await firstFbx(entryPath);
      if (nested) return nested;
    } else if (path.extname(entry.name).toLowerCase() === ".fbx") {
      return entryPath;
    }
  }
  return null;
}

const libraryRoot = path.resolve(process.argv[2] || "D:/biblioteca-3d");
const requested = process.argv[3];
const sourcePath = requested ? path.resolve(requested) : await firstFbx(libraryRoot);
if (!sourcePath) throw new Error(`No se encontraron FBX dentro de ${libraryRoot}`);

const source = await readFile(sourcePath);
const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const object = new FBXLoader().parse(buffer, `${path.dirname(sourcePath).replaceAll("\\", "/")}/`);
const bones = [];
object.traverse((child) => {
  if (child.isBone) bones.push({ name: child.name, parent: child.parent?.name || "" });
});

console.log(JSON.stringify({ file: sourcePath, bones }, null, 2));
