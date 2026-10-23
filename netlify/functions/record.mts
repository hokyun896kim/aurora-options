import type { Config, Context } from "@netlify/functions"
import { allLogs, SITE } from "../lib/push.mts"
import { buildRecord } from "../lib/record.mts"

// GET /api/record — 실기록 + 재구성 채점 결과
export default async (_req: Request, context: Context) => {
  const base = context.site?.url || SITE
  try {
    let stats: any = null
    for (const p of ["/api/stats", "/stats-fallback.json"]) {
      const r = await fetch(base + p).catch(() => null)
      if (r?.ok) {
        stats = await r.json()
        if (stats?.track) break
      }
    }
    const logs = await allLogs().catch(() => [])
    const out = buildRecord(stats?.track || [], logs)
    return new Response(JSON.stringify({ generated_at: new Date().toISOString(), stats_at: stats?.generated_at, ...out }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=0, must-revalidate",
        "netlify-cdn-cache-control": "public, durable, s-maxage=600, stale-while-revalidate=3600",
      },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "content-type": "application/json" } })
  }
}

export const config: Config = { path: "/api/record" }
