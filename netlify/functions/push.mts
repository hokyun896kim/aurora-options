import type { Config, Context } from "@netlify/functions"
import { vapidKeys, saveSub, deleteSub, getSub, send, SITE } from "../lib/push.mts"
import { loadInputs, buildBrief } from "../lib/brief.mts"

// 폰 알림 등록 API
// GET  /api/push/key          서명 공개키
// POST /api/push/subscribe    {subscription}  이 폰 등록
// POST /api/push/unsubscribe  {endpoint}      이 폰 해제
// POST /api/push/test         {endpoint}      등록된 이 폰에만 지금 브리핑 한 번 보내기
export default async (req: Request, context: Context) => {
  const path = new URL(req.url).pathname
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })

  try {
    if (path.endsWith("/key")) return json({ publicKey: (await vapidKeys()).publicKey })

    if (req.method !== "POST") return json({ error: "POST only" }, 405)
    const body = await req.json().catch(() => ({}))

    if (path.endsWith("/subscribe")) {
      const sub = body?.subscription
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth || !/^https:\/\//.test(sub.endpoint)) return json({ error: "bad subscription" }, 400)
      await saveSub({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } })
      return json({ ok: true })
    }
    if (path.endsWith("/unsubscribe")) {
      if (body?.endpoint) await deleteSub(body.endpoint)
      return json({ ok: true })
    }
    if (path.endsWith("/test")) {
      const sub = body?.endpoint ? await getSub(body.endpoint) : null
      if (!sub) return json({ error: "이 폰은 아직 등록이 안 됐다" }, 404)
      const { data, stats } = await loadInputs(context.site?.url || SITE)
      const b = buildBrief(data, stats)
      const r = await send(sub, { title: `[오로라 테스트 · ${b.topic}]`, body: b.body, url: "/", tag: "aurora-test" })
      return json({ result: r })
    }
    return json({ error: "not found" }, 404)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
}

export const config: Config = { path: ["/api/push/key", "/api/push/subscribe", "/api/push/unsubscribe", "/api/push/test"] }
