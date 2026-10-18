import fs from "node:fs";
import Database from "better-sqlite3";
import { detectBoxBrace } from "../src/domain/box-brace.ts";
const db = new Database("data/review.sqlite", { readonly: true });
const snap = JSON.parse(fs.readFileSync("tools/labeling/out/candles.json", "utf8"));
const iso = (t: number) => new Date(t).toISOString().slice(0,10);
function bars(inst: string) { try { const r = db.prepare("select timestamp t, open o, high h, low l, close c from candles where instrument=? and timeframe='1D' order by timestamp").all(inst) as any[]; if (r.length >= 90) return r; } catch {} const raw = snap.history?.[inst] ?? snap.candles[inst] ?? []; return raw.map((x: number[]) => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4] })); }
// profile of boxes on the 26 labeled stretches (scan day = breakout - 1)
function boxAt(inst: string, date: string) { const b = bars(inst); const E = b.findIndex((x:any)=>iso(x.t)>=date); if (E < 30) return null; const c = b.slice(0,E+1).map((x:any)=>({ instrument: inst, timeframe:"1D" as const, timestamp:x.t, open:x.o, high:x.h, low:x.l, close:x.c, volume:0 })); return detectBoxBrace(c); }
const segs: [string,string][] = [["ZECUSDT","2026-08-16"],["ZECUSDT","2026-08-31"],["OPUSDT","2026-09-15"],["STRKUSDT","2026-09-30"],["TIAUSDT","2026-10-07"],["BEAMUSDT","2026-10-02"],["AXLUSDT","2026-10-04"],["XMRUSDT","2026-08-20"],["OPGUSDT","2026-10-06"],["STXUSDT","2026-10-11"],["PYTHUSDT","2026-10-11"],["BERAUSDT","2026-10-13"],["NIGHTUSDT","2026-10-11"],["AZTECUSDT","2026-10-11"],["SIGNUSDT","2026-10-13"],["FLUXUSDT","2026-10-13"],["INJUSDT","2026-10-11"]];
const rows = segs.map(([i,d]) => boxAt(i,d)).filter(Boolean) as any[];
console.log("labeled boxes:", rows.length);
const med = (v: number[]) => v.sort((a,b)=>a-b)[Math.floor(v.length/2)];
console.log("squeeze", rows.map(r=>+r.squeeze.toFixed(2)).sort((a,b)=>a-b).join(","));
console.log("movePct", rows.map(r=>Math.round(r.movePct)).sort((a,b)=>a-b).join(","));
console.log("bars", rows.map(r=>r.bars).sort((a,b)=>a-b).join(","));
