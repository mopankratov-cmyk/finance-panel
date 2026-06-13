// In-memory store задач видео-сториборда лабы.
export interface VideoTask {
  hfJobId: string;
  scenario_title: string;
  beats: string[];
  script: string;
  baseImage: string;
  createdAt: number;
}
const store = new Map<string, VideoTask>();
let _seq = 0;
let _last: string | null = null;

export function newVideoId(): string { _seq += 1; return `v${Date.now()}_${_seq}`; }
export function putVideo(id: string, t: VideoTask) {
  store.set(id, t); _last = id;
  if (store.size > 100) for (const [k, v] of store) if (Date.now() - v.createdAt > 3600000) store.delete(k);
}
export function getVideo(id: string): VideoTask | null { return store.get(id) ?? null; }
export function lastVideo(): VideoTask | null { return _last ? store.get(_last) ?? null : null; }
