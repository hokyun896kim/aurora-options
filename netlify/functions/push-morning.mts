import type { Config, Context } from "@netlify/functions"
import { allSubs, send, nextSeq, saveLog, SITE } from "../lib/push.mts"
import { loadInputs, buildBrief, todayKST } from "../lib/brief.mts"

// 평일 아침 7:30(한국 시간) 예약 발송
// cron은 UTC: 22:30 일~목 = 한국 07:30 월~금 (한국은 서머타임 없음)
// 어젯밤 미국이 쉬었으면(새 데이터 없음) 기록도 발송도 안 한다.
export default async (_req: Request, context: Context) => {
  const { data, stats } = await loadInputs(context.site?.url || SITE)
  const b = buildBrief(data, stats)
  if (b.krDate !== todayKST()) {
    console.log(`skip: 미국 ${b.usDate} 데이터 → 한국 ${b.krDate}, 오늘 ${todayKST()} (미국 휴장)`)
    return
  }

  // 1) 알림 받는 폰이 없어도 그날 아침 예상은 무조건 기록 (나중에 실제와 채점)
  const subs = await allSubs()
  const seq = subs.length ? await nextSeq() : null
  await saveLog(b.krDate, { ...b.snap, sent: seq ? `[오로라 #${seq} · ${b.topic}]` : null })
  if (!subs.length) return

  // 2) 알림 발송
  const results = await Promise.all(
    subs.map((s) => send(s, { title: `[오로라 #${seq} · ${b.topic}]`, body: b.body, url: "/", tag: "aurora-morning" })),
  )
  console.log(`#${seq} ${b.krDate}: ${results.join(", ")}`)
}

export const config: Config = { schedule: "30 22 * * 0-4" }
