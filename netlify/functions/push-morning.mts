import type { Config, Context } from "@netlify/functions"
import { allSubs, send, nextSeq, SITE } from "../lib/push.mts"
import { loadInputs, buildBrief, todayKST } from "../lib/brief.mts"

// 평일 아침 7:30(한국 시간) 예약 발송
// cron은 UTC: 22:30 일~목 = 한국 07:30 월~금 (한국은 서머타임 없음)
// 어젯밤 미국이 쉬었으면(새 데이터 없음) 보내지 않는다.
export default async (_req: Request, context: Context) => {
  const subs = await allSubs()
  if (!subs.length) return

  const { data, stats } = await loadInputs(context.site?.url || SITE)
  const b = buildBrief(data, stats)
  if (b.krDate !== todayKST()) {
    console.log(`skip: 미국 ${b.usDate} 데이터 → 한국 ${b.krDate}, 오늘 ${todayKST()} (미국 휴장)`)
    return
  }

  const seq = await nextSeq()
  const results = await Promise.all(
    subs.map((s) => send(s, { title: `[오로라 #${seq} · ${b.topic}]`, body: b.body, url: "/", tag: "aurora-morning" })),
  )
  console.log(`#${seq} ${b.krDate}: ${results.join(", ")}`)
}

export const config: Config = { schedule: "30 22 * * 0-4" }
