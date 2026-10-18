import fs from "node:fs";
import Database from "better-sqlite3";
import { detectBoxBrace } from "../src/domain/box-brace.ts";
const reviewDb = new Database("data/review.sqlite", { readonly: true });
const labelingDb = new Database("data/labeling.sqlite", { readonly: true });
const snap = JSON.parse(fs.readFileSync("tools/labeling/out/candles.json", "utf8"));
const anchor = 1792037040000;
const iso = (t: number) => new Date(t).toISOString().slice(0,10);
const universe = Object.keys(snap.candles);
function bars(inst: string) {
  for (const db of [reviewDb, labelingDb]) { try { const r = db.prepare("select timestamp t, open o, high h, low l, close c from candles where instrument=? and timeframe='1D' order by timestamp").all(inst) as any[]; if (r.length >= 60) return r; } catch {} }
  const raw = snap.history?.[inst] ?? snap.candles[inst] ?? []; return raw.map((x: number[]) => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4] }));
}
const day = (t: number) => Math.floor(t / 86400000);
const perDay = new Map<number, Set<string>>();
let total = 0;
for (const inst of universe) {
  const b = bars(inst); if (b.length < 40) continue;
  const start = Math.max(35, b.length - 90);
  for (let E = start; E < b.length; E++) {
    const c = b.slice(0, E + 1).map((x: any) => ({ instrument: inst, timeframe: "1D" as const, timestamp: x.t, open: x.o, high: x.h, low: x.l, close: x.c, volume: 0 }));
    const r = detectBoxBrace(c);
    if (!r) continue;
    total += 1;
    const d = day(b[E].t);
    if (!perDay.has(d)) perDay.set(d, new Set());
    perDay.get(d)!.add(inst);
  }
}
const counts = [...perDay.values()].map((s) => s.size).sort((a, b) => a - b);
const q = (p: number) => counts[Math.floor(p * (counts.length - 1))];
console.log(`universe ${universe.length}, scan-days ${perDay.size}, signals ${total}`);
console.log(`distinct instruments per day — min ${counts[0]} median ${q(0.5)} p90 ${q(0.9)} max ${counts[counts.length-1]}`);
const last = perDay.get(day(Date.UTC(2026, 9, 13)));
console.log(`on 2026-10-13: ${last ? last.size : 0} instruments`);
