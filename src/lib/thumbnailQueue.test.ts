import { describe, expect, it } from "vitest";
import { ThumbnailQueue, type ThumbnailProgress, type ThumbnailResult } from "./thumbnailQueue";
import type { AnimationAsset } from "./types";

const asset = (id: string, overrides: Partial<AnimationAsset> = {}): AnimationAsset => ({
  id,
  name: id,
  fileName: `${id}.fbx`,
  path: `D:/biblioteca/${id}.fbx`,
  relativePath: `${id}.fbx`,
  directory: "D:/biblioteca",
  format: "fbx",
  size: 1,
  modified: 1,
  thumbnailModified: 0,
  thumbnailFailed: false,
  ...overrides,
});

function harness(options: { failing?: string[]; blockFirst?: boolean } = {}) {
  const rendered: string[] = [];
  const results = new Map<string, ThumbnailResult>();
  const failedMarks: string[] = [];
  let progress: ThumbnailProgress = { done: 0, total: 0, failed: 0, running: false, paused: false };
  let release: () => void = () => undefined;
  const gate = options.blockFirst ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
  let idle: () => void = () => undefined;
  const queue = new ThumbnailQueue({
    restMs: 0,
    render: async (item) => {
      if (!rendered.length) await gate;
      rendered.push(item.id);
      if (options.failing?.includes(item.id)) throw new Error("sin geometría");
      return new Uint8Array([1]);
    },
    save: async () => 1234,
    markFailed: async (item) => { failedMarks.push(item.id); },
    onResult: (id, result) => results.set(id, result),
    onProgress: (value) => {
      progress = value;
      if (!value.running) idle();
    },
  });
  const settled = () => new Promise<void>((resolve) => {
    if (!progress.running && !queue.pendingIds().length) resolve();
    else idle = resolve;
  });
  return { queue, rendered, results, failedMarks, progress: () => progress, settled, release };
}

describe("fila de miniaturas", () => {
  it("fotografía solo lo que falta y reutiliza lo que ya tiene foto", async () => {
    const test = harness();
    test.queue.reset([asset("a"), asset("b", { thumbnailModified: 99 }), asset("c", { thumbnailFailed: true }), asset("d")]);
    await test.settled();
    expect(test.rendered).toEqual(["a", "d"]);
    expect(test.progress()).toMatchObject({ done: 2, total: 2, failed: 0, running: false });
    expect(test.results.get("a")).toEqual({ thumbnailModified: 1234, thumbnailFailed: false });
  });

  it("si una pieza falla, la marca y sigue con las demás", async () => {
    const test = harness({ failing: ["b"] });
    test.queue.reset([asset("a"), asset("b"), asset("c")]);
    await test.settled();
    expect(test.rendered).toEqual(["a", "b", "c"]);
    expect(test.failedMarks).toEqual(["b"]);
    expect(test.results.get("b")).toEqual({ thumbnailModified: 0, thumbnailFailed: true });
    expect(test.progress()).toMatchObject({ done: 3, total: 3, failed: 1 });
  });

  it("lo nuevo que llega por Cargar Nuevo pasa al frente de la fila", async () => {
    const test = harness({ blockFirst: true });
    test.queue.reset([asset("a"), asset("b"), asset("c")]);
    test.queue.add([asset("nueva")], true);
    test.release();
    await test.settled();
    expect(test.rendered).toEqual(["a", "nueva", "b", "c"]);
    expect(test.progress().total).toBe(4);
  });

  it("adelanta las piezas visibles y respeta la pausa", async () => {
    const test = harness({ blockFirst: true });
    test.queue.reset([asset("a"), asset("b"), asset("c"), asset("d")]);
    test.queue.prioritize(["d"]);
    test.queue.pause();
    test.release();
    await test.settled();
    expect(test.rendered).toEqual(["a"]);
    expect(test.progress()).toMatchObject({ paused: true, done: 1 });
    test.queue.resume();
    await test.settled();
    expect(test.rendered).toEqual(["a", "d", "b", "c"]);
  });
});
