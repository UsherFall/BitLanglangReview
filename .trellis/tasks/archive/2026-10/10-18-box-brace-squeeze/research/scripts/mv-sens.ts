import fs from "node:fs";
import Database from "better-sqlite3";
import { detectBoxBrace } from "../src/domain/box-brace.ts";
const snaps = ["data/review.sqlite", "data/labeling.sqlite"].map((f) => new Database(f, { readonly: true }));
const snap = JSON.parse(fs.readFileSync("tools/labeling/out/candles.json", "utf8"));
const iso = (t: number) => new Date(t).toISOString().slice(0,10);
function bars(inst: string) { for (const db of snaps) { try { const r = db.prepare("select timestamp t, open o, high h, low l, close c from candles where instrument=? and timeframe='1D' order by timestamp").all(inst) as any[]; if (r.length >= 60) return r; } catch {} } const raw = snap.history?.[inst] ?? snap.candles[inst] ?? []; return raw.map((x: number[]) => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4] })); }
const day = (t: number) => Math.floor(t / 86400000);
for (const mv of [30, 40, 50]) {
  const perDay = new Map<number, Set<string>>();
  for (const inst of Object.keys(snap.candles)) {
    const b = bars(inst); if (b.length < 40) continue;
    for (let E = Math.max(35, b.length - 90); E < b.length; E++) {
      const c = b.slice(0, E + 1).map((x: any) => ({ instrument: inst, timeframe: "1D" as const, timestamp: x.t, open: x.o, high: x.h, low: x.l, close: x.c, volume: 0 }));
      const r = detectBoxBrace(c);
      if (!r || r.movePct < mv) continue;
      const d = day(b[E].t); if (!perDay.has(d)) perDay.set(d, new Set()); perDay.get(d)!.add(inst);
    }
  }
  const counts = [...perDay.values()].map((s) => s.size).sort((a, b) => a - b);
  console.log(`movePct>=${mv}: days ${counts.length} median ${counts[Math.floor(counts.length/2)]} p90 ${counts[Math.floor(counts.length*0.9)]} max ${counts[counts.length-1]} | 10/13 ${perDay.get(day(Date.UTC(2026,9,13)))?.size ?? 0}`);
}
