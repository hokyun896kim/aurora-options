import type { Config } from "@netlify/functions"

// Aurora 시그널 성적표 + 한국 영향 모델
// - 2011년부터 매일 앱과 '똑같은' 채점으로 시그널을 매기고, 그 뒤 실제로 어떻게 됐는지 집계
// - 한국 시가 갭·반도체 갭·변동폭은 최근 1년(250거래일) 실측으로 매번 다시 맞춤
// 결과는 CDN에 12시간 캐시. 페이지는 실패하면 /stats-fallback.json 을 쓴다.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
const START = "2011-01-04"
const P1 = 1262304000 // 2010-01-01

type OHLC = { o: number; h: number; l: number; c: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(url: string, ms = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function cboe(name: string) {
  const res = await get(`https://cdn.cboe.com/api/global/us_indices/daily_prices/${name}_History.csv`)
  if (!res.ok) throw new Error(`cboe ${name} ${res.status}`)
  const out: Record<string, number> = {}
  for (const line of (await res.text()).trim().split(/\r?\n/).slice(1)) {
    const c = line.split(",")
    const [m, d, y] = c[0].split("/")
    const v = parseFloat(c[c.length - 1])
    if (y && y >= "2010" && isFinite(v)) out[`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`] = v
  }
  return out
}

async function yahoo(sym: string, tz: string) {
  let last: unknown
  for (let a = 0; a < 3; a++) {
    try {
      const host = a % 2 ? "query2" : "query1"
      const res = await get(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${P1}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`,
      )
      if (!res.ok) throw new Error(`yahoo ${sym} ${res.status}`)
      const r = (await res.json()).chart.result[0]
      const q = r.indicators.quote[0]
      const out: Record<string, OHLC> = {}
      ;(r.timestamp as number[]).forEach((t, i) => {
        if (q.close[i] == null || q.open[i] == null) return
        const d = new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: tz })
        out[d] = { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }
      })
      if (Object.keys(out).length < 500) throw new Error(`yahoo ${sym} short`)
      return out
    } catch (e) {
      last = e
      await sleep(1200 * (a + 1))
    }
  }
  throw last
}

// ── 앱(index.html)과 똑같은 채점 ──
const sVIX = (v: number) => (v >= 35 ? 2 : v >= 25 ? 1 : v >= 18 ? 0 : v >= 13 ? -1 : -2)
const sChg = (v: number) => (v >= 20 ? 2 : v >= 10 ? 1 : v >= -10 ? 0 : v >= -20 ? -1 : -2)
const s9 = (v: number) => (v >= 1.05 ? 2 : v >= 1.0 ? 1 : v >= 0.93 ? 0 : v >= 0.85 ? -1 : -2)
const s3 = (v: number) => (v >= 1.05 ? 2 : v >= 1.0 ? 1 : v >= 0.92 ? 0 : v >= 0.85 ? -1 : -2)
const sVV = (v: number) => (v >= 120 ? 2 : v >= 105 ? 1 : v >= 90 ? 0 : v >= 80 ? -1 : -2)
const sSK = (v: number) => (v >= 150 ? 2 : v >= 140 ? 1 : v >= 125 ? 0 : v >= 115 ? -1 : -2)
function signalOf(sc: number[]) {
  const total = sc.reduce((a, b) => a + b, 0)
  const align = Math.max(sc.filter((x) => x > 0).length, sc.filter((x) => x < 0).length)
  if (total >= 6 && align >= 4) return "strong_bull"
  if (total >= 3) return "bull"
  if (total <= -6 && align >= 4) return "strong_bear"
  if (total <= -3) return "bear"
  return "neutral"
}
const LABEL: Record<string, string> = {
  strong_bull: "강한 상방",
  bull: "약한 상방",
  neutral: "관망",
  bear: "약한 하방",
  strong_bear: "강한 하방",
}

const r2 = (v: number) => Math.round(v * 100) / 100
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function stat(xs: (number | undefined)[]) {
  const v = xs.filter((x): x is number => x != null && isFinite(x))
  if (!v.length) return null
  return { n: v.length, avg: r2(mean(v)), med: r2(median(v)), up: Math.round((v.filter((x) => x > 0).length / v.length) * 100) }
}
function regress(pairs: [number, number][]) {
  const n = pairs.length
  const mx = mean(pairs.map((p) => p[0]))
  const my = mean(pairs.map((p) => p[1]))
  let sxy = 0, sxx = 0, syy = 0
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  }
  const beta = sxy / sxx
  const alpha = my - beta * mx
  const resid = Math.sqrt(pairs.reduce((a, [x, y]) => a + (y - alpha - beta * x) ** 2, 0) / n)
  return { beta: r2(beta), alpha: r2(alpha), sigma: r2(resid), corr: r2(sxy / Math.sqrt(sxx * syy)), n }
}
const nextIdx = (sorted: string[], d: string) => {
  let lo = 0, hi = sorted.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (sorted[m] <= d) lo = m + 1
    else hi = m
  }
  return lo
}

export async function buildStats() {
  const [V, V9, V3, VV, SK] = await Promise.all(["VIX", "VIX9D", "VIX3M", "VVIX", "SKEW"].map(cboe))
  const SPX = await yahoo("^GSPC", "America/New_York")
  const SOX = await yahoo("^SOX", "America/New_York")
  const KS = await yahoo("^KS11", "Asia/Seoul")
  const SS = await yahoo("005930.KS", "Asia/Seoul")
  const HY = await yahoo("000660.KS", "Asia/Seoul")

  const spxD = Object.keys(SPX).sort()
  const spxI = new Map(spxD.map((d, i) => [d, i]))
  const soxD = Object.keys(SOX).sort()
  const soxI = new Map(soxD.map((d, i) => [d, i]))
  const krD = Object.keys(KS).sort()
  const vD = Object.keys(V).sort()

  type Row = {
    d: string; sig: string; vv: number; sk: number; vix: number
    spxChg: number; soxChg?: number; fw: Record<number, number>
    kr?: { d: string; gap: number; ret: number; rng: number; f5?: number; f20?: number }
    ss?: number; hy?: number
  }
  const rows: Row[] = []
  for (let i = 1; i < vD.length; i++) {
    const d = vD[i]
    if (d < START || !(d in V9) || !(d in V3) || !(d in VV) || !(d in SK) || !spxI.has(d)) continue
    const v = V[d]
    const sc = [sVIX(v), sChg((v / V[vD[i - 1]] - 1) * 100), s9(V9[d] / v), s3(v / V3[d]), sVV(VV[d]), sSK(SK[d])]
    const j = spxI.get(d)!
    if (j < 1) continue
    const c = SPX[d].c
    const fw: Record<number, number> = {}
    for (const k of [1, 5, 10, 20]) if (j + k < spxD.length) fw[k] = (SPX[spxD[j + k]].c / c - 1) * 100
    const row: Row = { d, sig: signalOf(sc), vv: VV[d], sk: SK[d], vix: v, spxChg: (c / SPX[spxD[j - 1]].c - 1) * 100, fw }
    const si = soxI.get(d)
    if (si) row.soxChg = (SOX[d].c / SOX[soxD[si - 1]].c - 1) * 100
    const k = nextIdx(krD, d)
    if (k > 0 && k < krD.length) {
      const kd = krD[k], pk = krD[k - 1], p = KS[pk].c, t = KS[kd]
      row.kr = { d: kd, gap: (t.o / p - 1) * 100, ret: (t.c / p - 1) * 100, rng: ((t.h - t.l) / p) * 100 }
      if (k + 4 < krD.length) row.kr.f5 = (KS[krD[k + 4]].c / p - 1) * 100
      if (k + 19 < krD.length) row.kr.f20 = (KS[krD[k + 19]].c / p - 1) * 100
      if (kd in SS && pk in SS) row.ss = (SS[kd].o / SS[pk].c - 1) * 100
      if (kd in HY && pk in HY) row.hy = (HY[kd].o / HY[pk].c - 1) * 100
    }
    rows.push(row)
  }

  const summarize = (sub: Row[]) => {
    // 사건 수: 거래일 15일 이상 떨어지면 다른 사건으로 센다
    let events = 0, lastI = -99
    for (const r of sub) {
      const i = spxI.get(r.d)!
      if (i - lastI > 15) events++
      lastI = i
    }
    return {
      days: sub.length,
      events,
      last: sub.length ? sub[sub.length - 1].d : null,
      spx: { d1: stat(sub.map((r) => r.fw[1])), d5: stat(sub.map((r) => r.fw[5])), d10: stat(sub.map((r) => r.fw[10])), d20: stat(sub.map((r) => r.fw[20])) },
      kospi: {
        gap: stat(sub.map((r) => r.kr?.gap)),
        next: stat(sub.map((r) => r.kr?.ret)),
        d5: stat(sub.map((r) => r.kr?.f5)),
        d20: stat(sub.map((r) => r.kr?.f20)),
        range: stat(sub.map((r) => r.kr?.rng)),
      },
    }
  }

  const signals: Record<string, unknown> = { all: summarize(rows) }
  for (const s of Object.keys(LABEL)) signals[s] = { label: LABEL[s], ...summarize(rows.filter((r) => r.sig === s)) }

  const quad = (r: Row) => (r.vv <= 95 ? (r.sk <= 135 ? "LL" : "LH") : r.sk <= 135 ? "HL" : "HH")
  const heatmap: Record<string, unknown> = {}
  for (const q of ["LL", "LH", "HL", "HH"]) heatmap[q] = summarize(rows.filter((r) => quad(r) === q))

  // 한국 영향 모델: 최근 250 한국 세션
  const recent = rows.filter((r) => r.kr).slice(-250)
  const pairs = (f: (r: Row) => [number | undefined, number | undefined]) =>
    recent.map(f).filter((p): p is [number, number] => p[0] != null && p[1] != null && isFinite(p[0]) && isFinite(p[1]))
  const rangeBy: { lo: number; hi: number; avg: number; n: number }[] = []
  for (const [lo, hi] of [[0, 15], [15, 20], [20, 25], [25, 35], [35, 999]]) {
    const xs = recent.filter((r) => r.vix >= lo && r.vix < hi).map((r) => r.kr!.rng)
    if (xs.length) rangeBy.push({ lo, hi, avg: r2(mean(xs)), n: xs.length })
  }
  const kr_model = {
    window: { from: recent[0]?.kr?.d, to: recent[recent.length - 1]?.kr?.d, sessions: recent.length },
    kospi_gap_spx: regress(pairs((r) => [r.spxChg, r.kr!.gap])),
    samsung_gap_sox: regress(pairs((r) => [r.soxChg, r.ss])),
    hynix_gap_sox: regress(pairs((r) => [r.soxChg, r.hy])),
    samsung_gap_spx: regress(pairs((r) => [r.spxChg, r.ss])),
    hynix_gap_spx: regress(pairs((r) => [r.spxChg, r.hy])),
    range_by_vix: rangeBy,
    range_all: r2(mean(recent.map((r) => r.kr!.rng))),
  }

  // ── 공포/안심 뒤 코스피 평균 경로 (사건 시작일만, 겹침 없이) ──
  // 0 = 미국 시그널 뜬 날 직전 한국 종가, 1~20 = 그 뒤 한국 세션 종가 누적 수익률(%)
  const H = 20
  const pathFrom = (d: string) => {
    const k = nextIdx(krD, d)
    if (k < 1 || k + H - 1 >= krD.length) return null
    const p = KS[krD[k - 1]].c
    const out = [0]
    for (let t = 0; t < H; t++) out.push((KS[krD[k + t]].c / p - 1) * 100)
    return out
  }
  const avgPath = (ps: number[][]) => ps[0].map((_, t) => r2(mean(ps.map((x) => x[t]))))
  const medPath = (ps: number[][]) => ps[0].map((_, t) => r2(median(ps.map((x) => x[t]))))
  const paths: Record<string, unknown> = {}
  const allP = rows.map((r) => pathFrom(r.d)).filter((x): x is number[] => !!x)
  paths.all = { n: allP.length, avg: avgPath(allP) }
  for (const s of Object.keys(LABEL)) {
    let lastI = -99
    const starts: string[] = []
    for (const r of rows) {
      if (r.sig !== s) continue
      const i = spxI.get(r.d)!
      if (i - lastI > 15) starts.push(r.d)
      lastI = i
    }
    const ps = starts.map(pathFrom).filter((x): x is number[] => !!x)
    if (ps.length >= 5) {
      const lowDay = (p: number[]) => p.indexOf(Math.min(...p))
      paths[s] = {
        n: ps.length,
        avg: avgPath(ps),
        med: medPath(ps),
        // 사건마다 바닥 찍은 날 중간값, 20세션 뒤 플러스로 끝난 비율
        low_day_med: median(ps.map(lowDay)),
        end_up: Math.round((ps.filter((p) => p[H] > 0).length / ps.length) * 100),
      }
    }
  }

  // ── 자가채점(재구성): 최근 250 한국 세션 ──
  // 각 날짜마다 '그날 이전' 데이터만으로 예상을 다시 만들고 실제와 비교한다 (미래 데이터 안 씀)
  //  · 시가 갭 모델: 직전 250세션 회귀  · 고저폭: 직전 250세션 같은 VIX 구간 평균
  //  · 코스피 오를 확률: 2011년부터 그 전날까지 같은 시그널의 기록
  const withKr = rows.filter((r) => r.kr)
  const TRACK = 250, WIN = 250
  type T = {
    d: string; us: string; key: string; total?: number
    p_up: number | null; base_up: number | null
    kospi: number[]; sigma: number; close: number; rng?: number[]; ss?: number[]; hy?: number[]
  }
  const track: T[] = []
  const fit = (sub: Row[], f: (r: Row) => [number | undefined, number | undefined]) => {
    const ps = sub.map(f).filter((p): p is [number, number] => p[0] != null && p[1] != null && isFinite(p[0]) && isFinite(p[1]))
    return ps.length > 50 ? regress(ps) : null
  }
  const BUCKETS = [[0, 15], [15, 20], [20, 25], [25, 35], [35, 999]]
  const cnt: Record<string, { n: number; up: number }> = {}
  const tot = { n: 0, up: 0 }
  const pending: Row[] = [] // 결과가 아직 '그날 이전'이 아닌 행 (같은 한국 세션으로 몰린 경우)
  for (let i = 0; i < withKr.length; i++) {
    const r = withKr[i]
    // r의 한국 세션보다 먼저 끝난 결과만 확률 집계에 넣는다
    while (pending.length && pending[0].kr!.d < r.kr!.d) {
      const x = pending.shift()!
      ;(cnt[x.sig] ||= { n: 0, up: 0 }).n++
      if (x.kr!.ret > 0) cnt[x.sig].up++
      tot.n++
      if (x.kr!.ret > 0) tot.up++
    }
    if (i >= Math.max(WIN, withKr.length - TRACK)) {
      const past = withKr.slice(i - WIN, i)
      const mk = fit(past, (x) => [x.spxChg, x.kr!.gap])
      if (mk) {
        const c = cnt[r.sig]
        const e: T = {
          d: r.kr!.d, us: r.d, key: r.sig,
          p_up: c && c.n >= 20 ? Math.round((c.up / c.n) * 100) : null,
          base_up: tot.n ? Math.round((tot.up / tot.n) * 100) : null,
          kospi: [r2(mk.alpha + mk.beta * r.spxChg), r2(r.kr!.gap)],
          sigma: mk.sigma,
          close: r2(r.kr!.ret),
        }
        const b = BUCKETS.find(([lo, hi]) => r.vix >= lo && r.vix < hi)!
        const same = past.filter((x) => x.vix >= b[0] && x.vix < b[1])
        const pool = same.length >= 10 ? same : past
        e.rng = [r2(mean(pool.map((x) => x.kr!.rng))), r2(r.kr!.rng)]
        if (r.soxChg != null) {
          const ms = fit(past, (x) => [x.soxChg, x.ss])
          const mh = fit(past, (x) => [x.soxChg, x.hy])
          if (ms && r.ss != null) e.ss = [r2(ms.alpha + ms.beta * r.soxChg), r2(r.ss)]
          if (mh && r.hy != null) e.hy = [r2(mh.alpha + mh.beta * r.soxChg), r2(r.hy)]
        }
        // 한국 연휴로 미국 여러 날이 같은 한국 세션에 몰리면 마지막 미국 날만 쓴다
        if (track.length && track[track.length - 1].d === e.d) track[track.length - 1] = e
        else track.push(e)
      }
    }
    pending.push(r)
  }
  const grade = (key: "kospi" | "ss" | "hy", n: number) => {
    const xs = track.slice(-n).map((t) => t[key]).filter((x): x is number[] => !!x)
    if (!xs.length) return null
    const dir = xs.filter(([p, a]) => Math.sign(p) === Math.sign(a)).length
    const err = mean(xs.map(([p, a]) => Math.abs(p - a)))
    return { n: xs.length, dir_hit: Math.round((dir / xs.length) * 100), mae: r2(err) }
  }
  const self_check = {
    recent: track.slice(-10).reverse(),
    d20: { kospi: grade("kospi", 20), ss: grade("ss", 20), hy: grade("hy", 20) },
    d60: { kospi: grade("kospi", 60), ss: grade("ss", 60), hy: grade("hy", 60) },
  }

  return {
    generated_at: new Date().toISOString(),
    period: { from: rows[0].d, to: rows[rows.length - 1].d, days: rows.length },
    signals,
    heatmap,
    kr_model,
    paths,
    self_check,
    track,
  }
}

export default async () => {
  try {
    const body = await buildStats()
    return new Response(JSON.stringify(body), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=0, must-revalidate",
        "netlify-cdn-cache-control": "public, durable, s-maxage=43200, stale-while-revalidate=86400",
      },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "netlify-cdn-cache-control": "no-store" },
    })
  }
}

export const config: Config = { path: "/api/stats" }
