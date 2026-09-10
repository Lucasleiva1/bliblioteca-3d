import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

if (!("ProgressEvent" in globalThis)) {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    constructor(type, init = {}) {
      super(type);
      this.lengthComputable = Boolean(init.lengthComputable);
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  };
}

const source = await readFile(new URL("../tests/fixtures/animated-triangle.gltf", import.meta.url), "utf8");
const result = await new GLTFLoader().parseAsync(source, "");

assert.equal(result.scene.children.length, 1, "La escena debe contener el objeto de prueba");
assert.equal(result.animations.length, 1, "El archivo debe exponer un clip");
assert.equal(result.animations[0].name, "Subir");
assert.equal(result.animations[0].duration, 1);

console.log("Fixture GLTF: escena y clip de 1 segundo cargados correctamente.");
