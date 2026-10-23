// 아침 알림 문구 만들기 — 화면(index.html)과 같은 채점·같은 말
const sVIX = (v: number) => (v >= 35 ? 2 : v >= 25 ? 1 : v >= 18 ? 0 : v >= 13 ? -1 : -2)
const sChg = (v: number) => (v >= 20 ? 2 : v >= 10 ? 1 : v >= -10 ? 0 : v >= -20 ? -1 : -2)
const s9 = (v: number) => (v >= 1.05 ? 2 : v >= 1.0 ? 1 : v >= 0.93 ? 0 : v >= 0.85 ? -1 : -2)
const s3 = (v: number) => (v >= 1.05 ? 2 : v >= 1.0 ? 1 : v >= 0.92 ? 0 : v >= 0.85 ? -1 : -2)
const sVV = (v: number) => (v >= 120 ? 2 : v >= 105 ? 1 : v >= 90 ? 0 : v >= 80 ? -1 : -2)
const sSK = (v: number) => (v >= 150 ? 2 : v >= 140 ? 1 : v >= 125 ? 0 : v >= 115 ? -1 : -2)

const HEAD: Record<string, string> = {
  strong_bull: "미국 공포가 크게 터졌다",
  bull: "미국 공포가 커지는 중",
  neutral: "평범한 날",
  bear: "시장이 안심하는 중",
  strong_bear: "다들 너무 안심하고 있다",
}
const DOW = ["일", "월", "화", "수", "목", "금", "토"]
const kdate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number)
  return `${m}월 ${d}일(${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`
}
export function nextWeekday(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  do t.setUTCDate(t.getUTCDate() + 1)
  while (t.getUTCDay() === 0 || t.getUTCDay() === 6)
  return t.toISOString().slice(0, 10)
}
export const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
const sg = (v: number, d = 1) => (v >= 0 ? "+" : "") + v.toFixed(d) + "%"

export async function loadInputs(base: string) {
  const get = async (p: string) => {
    const r = await fetch(base + p, { headers: { "cache-control": "no-cache" } })
    if (!r.ok) throw new Error(`${p} ${r.status}`)
    return r.json()
  }
  const data = await get("/api/options-data")
  let stats: any = null
  try {
    stats = await get("/api/stats")
  } catch {
    stats = await get("/stats-fallback.json").catch(() => null)
  }
  return { data, stats }
}

// 반환: 미국 날짜, 한국 날짜, 제목 뒤 소주제, 본문
export function buildBrief(data: any, stats: any) {
  const m = data.metrics, c = data.computed || {}
  const vix = m.vix?.price, vixChg = m.vix?.change_pct
  const sc = [sVIX(vix), sChg(vixChg), s9(c.vix9d_vix_ratio), s3(c.vix_vix3m_ratio), sVV(m.vvix?.price), sSK(m.skew?.price)]
  const total = sc.reduce((a, b) => a + b, 0)
  const align = Math.max(sc.filter((x) => x > 0).length, sc.filter((x) => x < 0).length)
  const key = total >= 6 && align >= 4 ? "strong_bull" : total >= 3 ? "bull" : total <= -6 && align >= 4 ? "strong_bear" : total <= -3 ? "bear" : "neutral"
  const usDate: string = m.vix?.date
  const krDate = nextWeekday(usDate)

  const lines: string[] = []
  lines.push(`${HEAD[key]} · VIX ${vix.toFixed(1)}(${sg(vixChg, 0)})`)

  const M = stats?.kr_model
  if (M && m.spx) {
    const g = M.kospi_gap_spx
    let t = `코스피 시가 ${sg(g.alpha + g.beta * m.spx.change_pct)} 예상`
    if (m.sox) {
      const ss = M.samsung_gap_sox, hy = M.hynix_gap_sox
      t += ` · 삼성 ${sg(ss.alpha + ss.beta * m.sox.change_pct)} · 하닉 ${sg(hy.alpha + hy.beta * m.sox.change_pct)}`
    }
    lines.push(t)
  }

  const S = stats?.signals?.[key], A = stats?.signals?.all, P = stats?.paths?.[key]
  if (S && A) {
    const up = S.kospi.next.up, base = A.kospi.next.up
    if (key === "strong_bull" || key === "bull") {
      lines.push(`→ 오를 확률 ${up}%(평소 ${base}%). 바닥은 보통 ${P ? Math.round(P.low_day_med) : "며칠"}거래일째, 첫날 줍기보다 지켜보기`)
    } else if (key === "strong_bear") {
      lines.push(`→ 단기엔 무난(${up}%), 4주 뒤 성적은 제일 약했던 구간`)
    } else if (key === "bear") {
      lines.push(`→ 큰 신호 없음. 코스피 오를 확률 ${up}%(평소 ${base}%)`)
    } else {
      lines.push(`→ 쏠림 없음. 옵션 신호 약하니 다른 근거로`)
    }
  }
  return { key, usDate, krDate, topic: `${kdate(krDate)} 한국 아침`, body: lines.join("\n") }
}
