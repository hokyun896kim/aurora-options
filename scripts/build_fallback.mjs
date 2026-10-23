// /api/stats 결과를 public/stats-fallback.json 으로 저장 (서버 수집이 막힐 때 페이지가 쓰는 예비본)
// 실행: node --experimental-strip-types scripts/build_fallback.mjs
import { writeFileSync } from "node:fs"
const { buildStats } = await import("../netlify/functions/stats.mts")
const s = await buildStats()
writeFileSync(new URL("../public/stats-fallback.json", import.meta.url), JSON.stringify(s))
console.log("saved", s.period)
