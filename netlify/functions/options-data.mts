import type { Config } from "@netlify/functions"

// Aurora 옵션 시그널용 데이터 수집기
// 1순위 Yahoo Finance 차트 API, 실패 시 CBOE 공식 CSV(변동성 지수) / Stooq CSV(SPX)로 백업.
// 결과는 CDN에 10분 캐시 → 페이지 열 때마다 최신값(최대 10분 지연)이 자동으로 들어온다.

type Bar = { date: string; close: number }
type Series = { key: string; bars: Bar[]; source: string }

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

const TARGETS = [
  { key: "vix", yahoo: "^VIX", cboe: "VIX" },
  { key: "vix9d", yahoo: "^VIX9D", cboe: "VIX9D" },
  { key: "vix3m", yahoo: "^VIX3M", cboe: "VIX3M" },
  { key: "vvix", yahoo: "^VVIX", cboe: "VVIX" },
  { key: "skew", yahoo: "^SKEW", cboe: "SKEW" },
  { key: "spx", yahoo: "^GSPC", cboe: null as string | null },
]

const nyDate = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" })

async function fetchWithTimeout(url: string, ms = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function fromYahoo(symbol: string): Promise<Bar[]> {
  const sym = encodeURIComponent(symbol)
  let lastErr: unknown
  for (const host of ["query1", "query2"]) {
    try {
      const res = await fetchWithTimeout(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?range=1y&interval=1d&includePrePost=false`,
      )
      if (!res.ok) throw new Error(`yahoo ${res.status}`)
      const j = await res.json()
      const r = j?.chart?.result?.[0]
      const ts: number[] = r?.timestamp ?? []
      const cl: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? []
      const map = new Map<string, number>()
      ts.forEach((t, i) => {
        const c = cl[i]
        if (c != null && isFinite(c)) map.set(nyDate(t), c)
      })
      // 장중이면 마지막 봉 종가 대신 실시간 가격 사용
      const live = r?.meta?.regularMarketPrice
      const liveT = r?.meta?.regularMarketTime
      if (live != null && liveT) map.set(nyDate(liveT), live)
      const bars = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, close]) => ({ date, close }))
      if (bars.length < 2) throw new Error("yahoo empty")
      return bars
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

function parseCsv(text: string, dateFmt: "mdy" | "ymd"): Bar[] {
  const lines = text.trim().split(/\r?\n/).slice(1)
  const out: Bar[] = []
  for (const line of lines) {
    const cols = line.split(",")
    if (cols.length < 2) continue
    let d = cols[0].trim()
    if (dateFmt === "mdy") {
      const [m, dd, y] = d.split("/")
      if (!y) continue
      d = `${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`
    }
    // CBOE: 마지막 열이 종가(OHLC 파일은 CLOSE, 단일값 파일은 지수값) / Stooq: Close는 5번째 열
    const raw = dateFmt === "ymd" ? cols[4] : cols[cols.length - 1]
    const c = parseFloat(raw)
    if (isFinite(c)) out.push({ date: d, close: c })
  }
  return out.slice(-260)
}

async function fromCboe(name: string): Promise<Bar[]> {
  const res = await fetchWithTimeout(
    `https://cdn.cboe.com/api/global/us_indices/daily_prices/${name}_History.csv`,
  )
  if (!res.ok) throw new Error(`cboe ${res.status}`)
  const bars = parseCsv(await res.text(), "mdy")
  if (bars.length < 2) throw new Error("cboe empty")
  return bars
}

async function fromStooqSpx(): Promise<Bar[]> {
  const res = await fetchWithTimeout("https://stooq.com/q/d/l/?s=%5Espx&i=d")
  if (!res.ok) throw new Error(`stooq ${res.status}`)
  const bars = parseCsv(await res.text(), "ymd")
  if (bars.length < 2) throw new Error("stooq empty")
  return bars
}

// 기본은 공식 일별 종가(CBOE / Stooq), 그 위에 Yahoo 값(장중 실시간 포함)을 덮어쓴다.
// 한쪽이 막혀도 다른 쪽으로 돌아가고, 지표끼리 날짜가 어긋나는 일을 줄인다.
async function load(t: (typeof TARGETS)[number]): Promise<Series | null> {
  const [base, yahoo] = await Promise.allSettled([
    t.cboe ? fromCboe(t.cboe) : fromStooqSpx(),
    fromYahoo(t.yahoo),
  ])
  const map = new Map<string, number>()
  const used: string[] = []
  if (base.status === "fulfilled") {
    base.value.forEach((b) => map.set(b.date, b.close))
    used.push(t.cboe ? "cboe" : "stooq")
  }
  if (yahoo.status === "fulfilled") {
    yahoo.value.forEach((b) => map.set(b.date, b.close))
    used.push("yahoo")
  }
  if (map.size < 2) return null
  const bars = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, close]) => ({ date, close })).slice(-260)
  return { key: t.key, bars, source: used.join("+") }
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d

export default async () => {
  const loaded = await Promise.all(TARGETS.map(load))
  const series: Record<string, Series> = {}
  loaded.forEach((s) => s && (series[s.key] = s))

  const metrics: Record<string, unknown> = {}
  for (const [key, s] of Object.entries(series)) {
    const b = s.bars
    const last = b[b.length - 1]
    const prev = b[b.length - 2]
    metrics[key] = {
      price: round(last.close, 2),
      prev_close: round(prev.close, 2),
      change_pct: round((last.close / prev.close - 1) * 100, 2),
      date: last.date,
      source: s.source,
    }
  }

  const m = metrics as Record<string, { price: number } | undefined>
  const computed: Record<string, number> = {}
  if (m.vix && m.vix9d) computed.vix9d_vix_ratio = round(m.vix9d.price / m.vix.price)
  if (m.vix && m.vix3m) computed.vix_vix3m_ratio = round(m.vix.price / m.vix3m.price)

  // 과거 일별 히스토리(최근 120거래일) — 페이지의 타임라인·유사 패턴을 첫날부터 채우기 위함
  const byDate = (key: string) => new Map((series[key]?.bars ?? []).map((x) => [x.date, x.close]))
  const V = byDate("vix"), V9 = byDate("vix9d"), V3 = byDate("vix3m"), VV = byDate("vvix"), SK = byDate("skew"), SP = byDate("spx")
  const vixDates = (series.vix?.bars ?? []).map((x) => x.date)
  const history: Record<string, unknown>[] = []
  for (let i = 1; i < vixDates.length; i++) {
    const d = vixDates[i]
    const vix = V.get(d)!
    const prevVix = V.get(vixDates[i - 1])!
    const row: Record<string, unknown> = { date: d, vix: round(vix, 2), vixChg: round((vix / prevVix - 1) * 100, 2) }
    if (V9.has(d)) row.vix9dRatio = round(V9.get(d)! / vix)
    if (V3.has(d)) row.vix3mRatio = round(vix / V3.get(d)!)
    if (VV.has(d)) row.vvix = round(VV.get(d)!, 2)
    if (SK.has(d)) row.skew = round(SK.get(d)!, 2)
    if (SP.has(d)) {
      row.spx = round(SP.get(d)!, 2)
      const pd = vixDates[i - 1]
      if (SP.has(pd)) row.spxChg = round((SP.get(d)! / SP.get(pd)! - 1) * 100, 2)
    }
    history.push(row)
  }

  const now = new Date()
  const body = {
    generated_at: now.toISOString(),
    generated_at_kst: new Date(now.getTime() + 9 * 3600 * 1000).toISOString().replace("Z", "+09:00"),
    success_count: Object.keys(metrics).length,
    total_count: TARGETS.length,
    metrics,
    computed,
    history: history.slice(-120),
  }

  const ok = body.success_count > 0
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 502,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": ok
        ? "public, durable, s-maxage=600, stale-while-revalidate=1800"
        : "no-store",
    },
  })
}

export const config: Config = { path: "/api/options-data" }
