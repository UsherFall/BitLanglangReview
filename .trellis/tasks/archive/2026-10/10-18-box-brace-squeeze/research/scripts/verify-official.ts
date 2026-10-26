import fs from "node:fs";
import { detectBoxBrace } from "../src/domain/box-brace.ts";
import Database from "better-sqlite3";
const reviewDb = new Database("data/review.sqlite", { readonly: true });
const labelingDb = new Database("data/labeling.sqlite", { readonly: true });
const snap = JSON.parse(fs.readFileSync("tools/labeling/out/candles.json", "utf8"));
function fromDb(db: any, inst: string) { try { return db.prepare("select timestamp t, open o, high h, low l, close c from candles where instrument=? and timeframe='1D' order by timestamp").all(inst); } catch { return []; } }
function fromSnap(inst: string) { const raw = snap.history?.[inst] ?? snap.candles[inst] ?? []; return raw.map(([t,o,h,l,c]: number[]) => ({ t, o, h, l, c })); }
function bars(inst: string) { for (const db of [reviewDb, labelingDb]) { const b = fromDb(db, inst); if (b.length >= 90) return b; } return fromSnap(inst); }
const iso = (b: any) => new Date(b.t).toISOString().slice(0,10);
const segs: [string,string,string|null][] = [
  ["ZECUSDT","2026-05-20","2026-08-17"],["ZECUSDT","2026-08-26","2026-09-01"],["OPUSDT","2026-08-21","2026-09-16"],
  ["STRKUSDT","2026-09-25","2026-10-01"],["TIAUSDT","2026-10-03","2026-10-05"],
  ["BEAMUSDT","2026-09-28","2026-10-02"],["BATUSDT","2026-09-28","2026-09-30"],["AXLUSDT","2026-10-03","2026-10-05"],
  ["XMRUSDT","2026-08-16","2026-08-20"],["XMRUSDT","2026-08-09","2026-08-13"],["OPGUSDT","2026-10-02","2026-10-07"],
  ["STXUSDT","2026-08-31",null],["BTWUSDT","2026-09-03",null],["PYTHUSDT","2026-09-04",null],["BERAUSDT","2026-08-31",null],
  ["AEROUSDT","2026-09-09",null],["NEARUSDT","2026-08-25",null],["NIGHTUSDT","2026-08-19",null],["LINEAUSDT","2026-08-23",null],
  ["AZTECUSDT","2026-09-18",null],["SIGNUSDT","2026-09-10",null],["FLUXUSDT","2026-09-29",null],["INJUSDT","2026-04-18",null],
];
let hits = 0, misses: string[] = [];
for (const [inst, start, end] of segs) {
  const b = bars(inst); if (b.length < 20) { misses.push(inst + "(nodata)"); continue; }
  const si = b.findIndex((x:any)=>iso(x)>=start); const ei = end ? b.findIndex((x:any)=>iso(x)>=end) : b.length-1;
  if (si < 0 || ei < 0) { misses.push(inst + "(nodata)"); continue; }
  const E = end ? Math.max(si+4, ei-1) : b.length-1;
  const candles = b.slice(0, E+1).map((x:any) => ({ instrument: inst, timeframe: "1D" as const, timestamp: x.t, open: x.o, high: x.h, low: x.l, close: x.c, volume: 0 }));
  const box = detectBoxBrace(candles);
  if (box) hits++; else misses.push(`${inst} ${start}-${end ?? "open"}`);
}
console.log(`official detector hit rate: ${hits}/${segs.length}`);
console.log("misses:", misses.join(", ") || "none");
