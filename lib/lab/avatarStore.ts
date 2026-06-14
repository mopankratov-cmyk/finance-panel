// In-memory store задач AI-аватар видео (HeyGen).
export interface AvatarTask {
  videoId: string;        // HeyGen video_id
  title: string;
  spoken: string;         // озвученный текст
  avatarId: string;
  voiceId: string;
  createdAt: number;
}
const store = new Map<string, AvatarTask>();
let _seq = 0;

export function newAvatarId(): string { _seq += 1; return `av${Date.now()}_${_seq}`; }
export function putAvatar(id: string, t: AvatarTask) {
  store.set(id, t);
  if (store.size > 100) for (const [k, v] of store) if (Date.now() - v.createdAt > 3600000) store.delete(k);
}
export function getAvatar(id: string): AvatarTask | null { return store.get(id) ?? null; }
