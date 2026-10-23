// 푸시 공용: 서명 키(VAPID)·구독 저장·발송
// 키는 처음 필요할 때 서버가 스스로 만들어 Netlify Blobs에만 보관한다. 코드·깃허브·환경변수 어디에도 없음.
import webpush from "web-push"
import { getStore } from "@netlify/blobs"
import { createHash } from "node:crypto"

// 사이트 주소: 넷리파이가 주는 값을 우선 쓰고, 없을 때만 고정값 (사이트 이름을 바꿔도 따라감)
export const SITE = (globalThis as any).Netlify?.env?.get("URL") || "https://us-vix-dashboard.netlify.app"
const store = () => getStore({ name: "aurora-push", consistency: "strong" })

type Keys = { publicKey: string; privateKey: string }
let cached: Keys | null = null

export async function vapidKeys(): Promise<Keys> {
  if (cached) return cached
  const s = store()
  let k = (await s.get("vapid", { type: "json" })) as Keys | null
  if (!k) {
    await s.setJSON("vapid", webpush.generateVAPIDKeys(), { onlyIfNew: true })
    k = (await s.get("vapid", { type: "json" })) as Keys
  }
  cached = k
  webpush.setVapidDetails(SITE, k.publicKey, k.privateKey)
  return k
}

const subKey = (endpoint: string) => "subs/" + createHash("sha256").update(endpoint).digest("hex").slice(0, 40)

export async function saveSub(sub: webpush.PushSubscription) {
  await store().setJSON(subKey(sub.endpoint), { ...sub, saved_at: new Date().toISOString() })
}
export async function deleteSub(endpoint: string) {
  await store().delete(subKey(endpoint))
}
export async function getSub(endpoint: string) {
  return (await store().get(subKey(endpoint), { type: "json" })) as webpush.PushSubscription | null
}
export async function allSubs() {
  const s = store()
  const { blobs } = await s.list({ prefix: "subs/" })
  const out: webpush.PushSubscription[] = []
  for (const b of blobs) {
    const v = (await s.get(b.key, { type: "json" })) as webpush.PushSubscription | null
    if (v?.endpoint) out.push(v)
  }
  return out
}

// 매일 아침 예상 기록 (log/YYYY-MM-DD = 한국 날짜). 같은 날 다시 돌면 덮어쓴다
export async function saveLog(krDate: string, snap: unknown) {
  await store().setJSON("log/" + krDate, { ...(snap as object), recorded_at: new Date().toISOString() })
}
export async function allLogs() {
  const s = store()
  const { blobs } = await s.list({ prefix: "log/" })
  const out: any[] = []
  for (const b of blobs) {
    const v = await s.get(b.key, { type: "json" })
    if (v) out.push(v)
  }
  return out
}

// 아침 알림 순번 (예약 함수 하나만 쓰므로 단순 저장으로 충분)
export async function nextSeq() {
  const s = store()
  const cur = Number((await s.get("seq")) || 0) + 1
  await s.set("seq", String(cur))
  return cur
}

export type Payload = { title: string; body: string; url?: string; tag?: string }

export async function send(sub: webpush.PushSubscription, p: Payload) {
  await vapidKeys()
  try {
    await webpush.sendNotification(sub, JSON.stringify(p), { TTL: 6 * 3600, urgency: "normal" })
    return "sent"
  } catch (e: any) {
    // 폰에서 앱을 지웠거나 알림을 끈 구독은 정리
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      await deleteSub(sub.endpoint)
      return "gone"
    }
    return "error:" + (e?.statusCode || e?.message || "unknown")
  }
}
