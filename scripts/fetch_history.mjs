// 백테스트용 원자료 수집: CBOE 변동성 지수 CSV + Yahoo 일봉(SPX, KOSPI, 삼성전자, SK하이닉스, SOX)
import { writeFileSync, mkdirSync } from "node:fs"
const OUT = process.argv[2] || "data"
mkdirSync(OUT, { recursive: true })
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cboe(name) {
  const res = await fetch(`https://cdn.cboe.com/api/global/us_indices/daily_prices/${name}_History.csv`, { headers: { "User-Agent": UA } })
  if (!res.ok) throw new Error(`cboe ${name} ${res.status}`)
  const rows = {}
  for (const line of (await res.text()).trim().split(/\r?\n/).slice(1)) {
    const c = line.split(",")
    const [m, d, y] = c[0].split("/")
    const v = parseFloat(c[c.length - 1])
    if (y && isFinite(v)) rows[`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`] = v
  }
  return rows
}

async function yahoo(sym, tz) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const host = attempt % 2 ? "query2" : "query1"
    const res = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=1262304000&period2=${Math.floor(Date.now() / 1000)}&interval=1d`, { headers: { "User-Agent": UA } })
    if (res.ok) {
      const r = (await res.json()).chart.result[0]
      const q = r.indicators.quote[0]
      const rows = {}
      r.timestamp.forEach((t, i) => {
        if (q.close[i] == null || q.open[i] == null) return
        const d = new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: tz })
        rows[d] = { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }
      })
      return rows
    }
    await sleep(3000 * (attempt + 1))
  }
  throw new Error(`yahoo ${sym} failed`)
}

const out = {}
for (const n of ["VIX", "VIX9D", "VIX3M", "VVIX", "SKEW"]) out[n] = await cboe(n)
for (const [k, sym, tz] of [["SPX", "^GSPC", "America/New_York"], ["SOX", "^SOX", "America/New_York"], ["KOSPI", "^KS11", "Asia/Seoul"], ["SAMSUNG", "005930.KS", "Asia/Seoul"], ["HYNIX", "000660.KS", "Asia/Seoul"]]) {
  out[k] = await yahoo(sym, tz)
  await sleep(1500)
}
for (const [k, v] of Object.entries(out)) {
  const ks = Object.keys(v).sort()
  console.log(k, ks.length, ks[0], "~", ks[ks.length - 1])
}
writeFileSync(`${OUT}/raw.json`, JSON.stringify(out))
