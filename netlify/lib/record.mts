// 기록 채점: 매일 아침 실제로 남긴 예상(실기록) + 그날 이전 데이터로 재구성한 예상(재구성)을
// 실제 한국 시가·종가와 맞춰본다.

export type Row = {
  d: string // 한국 날짜
  source: "live" | "recon"
  key: string
  p_up: number | null
  base_up: number | null
  pred: { kospi?: number; sigma?: number; ss?: number; hy?: number; rng?: number }
  act: { gap: number; close: number; rng?: number; ss?: number; hy?: number } | null
  g?: { gap_dir: boolean; in_band: boolean | null; call: "up" | "down" | null; call_hit: boolean | null; ss_dir?: boolean; hy_dir?: boolean }
  sent?: string | null
}

export const BAND = 1.5
const sgnEq = (a: number, b: number) => Math.sign(a) === Math.sign(b)

export function callOf(p: number | null, b: number | null): "up" | "down" | null {
  if (p == null || b == null) return null
  return p - b >= 4 ? "up" : p - b <= -4 ? "down" : null
}

function gradeRow(r: Row): Row {
  if (!r.act || r.pred.kospi == null) return r
  const call = callOf(r.p_up, r.base_up)
  r.g = {
    gap_dir: sgnEq(r.pred.kospi, r.act.gap),
    // 화면에 보여주는 범위(±1.5σ, 열에 일곱 기준)와 같은 기준으로 채점
    in_band: r.pred.sigma != null ? Math.abs(r.act.gap - r.pred.kospi) <= BAND * r.pred.sigma : null,
    call,
    call_hit: call ? (call === "up" ? r.act.close > 0 : r.act.close < 0) : null,
  }
  if (r.pred.ss != null && r.act.ss != null) r.g.ss_dir = sgnEq(r.pred.ss, r.act.ss)
  if (r.pred.hy != null && r.act.hy != null) r.g.hy_dir = sgnEq(r.pred.hy, r.act.hy)
  return r
}

export function summarize(rows: Row[]) {
  const done = rows.filter((r) => r.g)
  const pct = (xs: boolean[]) => (xs.length ? Math.round((xs.filter(Boolean).length / xs.length) * 100) : null)
  const calls = done.filter((r) => r.g!.call)
  const mae = done.length ? Math.round((done.reduce((a, r) => a + Math.abs(r.act!.gap - r.pred.kospi!), 0) / done.length) * 100) / 100 : null
  return {
    n: done.length,
    pending: rows.length - done.length,
    gap_dir: pct(done.map((r) => r.g!.gap_dir)),
    in_band: pct(done.filter((r) => r.g!.in_band != null).map((r) => r.g!.in_band!)),
    calls: calls.length,
    call_hit: pct(calls.map((r) => r.g!.call_hit!)),
    ss_dir: pct(done.filter((r) => r.g!.ss_dir != null).map((r) => r.g!.ss_dir!)),
    hy_dir: pct(done.filter((r) => r.g!.hy_dir != null).map((r) => r.g!.hy_dir!)),
    mae,
  }
}

// track: /api/stats 의 재구성 기록(실제값 포함), logs: Blobs 에 남긴 아침 기록
export function buildRecord(track: any[], logs: any[]) {
  const actBy = new Map<string, Row["act"]>()
  const rows = new Map<string, Row>()
  for (const t of track) {
    const act = { gap: t.kospi[1], close: t.close, rng: t.rng?.[1], ss: t.ss?.[1], hy: t.hy?.[1] }
    actBy.set(t.d, act)
    rows.set(t.d, {
      d: t.d, source: "recon", key: t.key, p_up: t.p_up, base_up: t.base_up,
      pred: { kospi: t.kospi[0], sigma: t.sigma, ss: t.ss?.[0], hy: t.hy?.[0], rng: t.rng?.[0] },
      act,
    })
  }
  // 실기록이 있으면 그날은 실기록으로 바꿔 끼운다 (그날 아침 앱이 실제로 한 말)
  for (const l of logs) {
    if (!l?.kr_date) continue
    rows.set(l.kr_date, {
      d: l.kr_date, source: "live", key: l.key, p_up: l.p_up, base_up: l.base_up,
      pred: l.pred || {}, act: actBy.get(l.kr_date) ?? null, sent: l.sent ?? null,
    })
  }
  const all = [...rows.values()].map(gradeRow).sort((a, b) => b.d.localeCompare(a.d))
  return {
    rows: all,
    summary: {
      all: summarize(all),
      live: summarize(all.filter((r) => r.source === "live")),
      recon: summarize(all.filter((r) => r.source === "recon")),
      d20: summarize(all.filter((r) => r.g).slice(0, 20)),
    },
    first_live: all.filter((r) => r.source === "live").at(-1)?.d ?? null,
  }
}
