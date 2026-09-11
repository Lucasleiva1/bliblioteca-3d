import type { AnimationAsset } from "./types";

export interface ThumbnailProgress {
  done: number;
  total: number;
  failed: number;
  running: boolean;
  paused: boolean;
}

export interface ThumbnailResult {
  thumbnailModified: number;
  thumbnailFailed: boolean;
}

export interface ThumbnailQueueDeps {
  render: (asset: AnimationAsset) => Promise<Uint8Array>;
  save: (asset: AnimationAsset, bytes: Uint8Array) => Promise<number>;
  markFailed: (asset: AnimationAsset, reason: string) => Promise<void>;
  onResult: (assetId: string, result: ThumbnailResult) => void;
  onProgress: (progress: ThumbnailProgress) => void;
  /** Pausa entre foto y foto para que la pantalla siga respondiendo. */
  restMs?: number;
}

export const needsThumbnail = (asset: AnimationAsset) => !asset.thumbnailModified && !asset.thumbnailFailed;

/** Fila de fotos pendientes: de a una, en segundo plano, con prioridad para lo nuevo y lo visible. */
export class ThumbnailQueue {
  private order: string[] = [];
  private readonly pending = new Map<string, AnimationAsset>();
  private done = 0;
  private failed = 0;
  private total = 0;
  private paused = false;
  private running = false;
  private generation = 0;

  constructor(private readonly deps: ThumbnailQueueDeps) {}

  /** Biblioteca recién abierta o reescaneada: la fila pasa a ser solo lo que falta. */
  reset(assets: AnimationAsset[]) {
    this.generation += 1;
    this.order = [];
    this.pending.clear();
    this.done = 0;
    this.failed = 0;
    this.total = 0;
    this.add(assets);
  }

  add(assets: AnimationAsset[], front = false) {
    const fresh = assets.filter((asset) => needsThumbnail(asset) && !this.pending.has(asset.id));
    for (const asset of fresh) this.pending.set(asset.id, asset);
    const ids = fresh.map((asset) => asset.id);
    this.order = front ? [...ids, ...this.order] : [...this.order, ...ids];
    this.total += fresh.length;
    if (front) this.prioritize(assets.map((asset) => asset.id));
    this.emit();
    void this.pump();
  }

  /** Lleva al frente las que ya estaban esperando (por ejemplo, las de la página visible). */
  prioritize(ids: string[]) {
    const wanted = ids.filter((id) => this.pending.has(id));
    if (!wanted.length) return;
    const first = new Set(wanted);
    this.order = [...wanted, ...this.order.filter((id) => !first.has(id))];
  }

  pause() {
    this.paused = true;
    this.emit();
  }

  resume() {
    this.paused = false;
    this.emit();
    void this.pump();
  }

  pendingIds() {
    return [...this.order];
  }

  private emit() {
    this.deps.onProgress({ done: this.done, total: this.total, failed: this.failed, running: this.running, paused: this.paused });
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    this.emit();
    while (!this.paused && this.order.length) {
      const id = this.order.shift() as string;
      const asset = this.pending.get(id);
      if (!asset) continue;
      const generation = this.generation;
      let result: ThumbnailResult;
      try {
        const bytes = await this.deps.render(asset);
        result = { thumbnailModified: await this.deps.save(asset, bytes), thumbnailFailed: false };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`Miniatura fallida: ${asset.path}`, reason);
        await this.deps.markFailed(asset, reason).catch(() => undefined);
        result = { thumbnailModified: 0, thumbnailFailed: true };
      }
      this.deps.onResult(id, result);
      if (generation === this.generation) {
        this.pending.delete(id);
        this.done += 1;
        if (result.thumbnailFailed) this.failed += 1;
      }
      this.emit();
      await new Promise((resolve) => setTimeout(resolve, this.deps.restMs ?? 40));
    }
    this.running = false;
    this.emit();
  }
}
