/**
 * retention 鍒ゆ嵁鐨勯瞾妫掓€ф壂鎻忥紙10/19 缁爺锛屽洖绛斻€岃兘涓嶈兘鐓х潃璺戠殑銆嶅疄鐜伴棶棰橈級
 *
 * 鍥哄畾鏉′欢锛氱獥鍙ｆ寜鏀剁洏浠峰畾璧风偣锛坙oMode='close'锛屼笉鍚綋鏃ユ湭瀹屾垚K绾跨殑褰辩嚎锛夛紝
 * 闄ら潪鍙︽敞銆傜簿鍑嗙巼瀹氫箟 = **褰撳ぉ璇ユ埅鏂甫鍐呯殑 Y 鏁?梅 甯﹀搴?*锛屼篃灏辨槸鐢ㄦ埛
 * 鐪嬪埌鐨勯偅涓垪琛ㄩ噷鏈夊灏戞槸鐪熸爣杩?Y 鐨勶紙鍩虹嚎 12.6%锛夈€? *
 * 鎶ヤ粈涔堬細
 *   A. 鍗曢敋鐐?2026-10-13锛氬悇 W 脳 鍚勬埅鏂殑绮惧噯鐜囷紙鍒嗘瘝鍥哄畾 = 鍚屼竴澶╁悓涓€涓甫]
 *   B. 澶氶敋鐐癸紙10-09..10-13锛夛細鎶娿€岄敋鐐规棩鎸戝緱濂姐€嶆姽鎺? *   C. lo 鍙?LOW vs CLOSE锛屼互鍙?CLOSE 璧风偣涓嬬殑銆岃秼鍔块棬銆嶏紙璧风偣鍒颁粖澶?鈮?+X%锛? *   D. 33 娈电敤鎴锋爣娉ㄥソ鍖洪棿閫愭棩鍥炴斁瑕嗙洊
 *   E. 姣忔棩鍊欓€夐噺
 *   F. 杩戜技瀹炵洏褰㈡€侊細鏃ョ嚎 top X% 鈭?璇ュ竵 4H 鎴潰 top Y%锛堢湡瀹炴壂鎻忚繕瑕?5 妗ｉ兘鍚堟牸锛? *
 * Run: POOL_DIR=<dir> [WITH_4H=<dir>] node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR ?? '.scratch/pool';
if (!fs.existsSync(POOL_DIR)) {
  console.error(`pool dir missing: ${POOL_DIR}`);
  process.exit(2);
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const LOOKS = [30, 40, 60, 80, 120];
const WINDOW = 60; // the rule under test unless a row says otherwise
const CUTS = [0.05, 0.1, 0.15, 0.2];

function loadDir(dir, minBars) {
  const out = new Map();
  if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(raw) || raw.length < minBars) continue;
    out.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
  }
  return out;
}

const daily = loadDir(POOL_DIR, 100);
console.log(`daily pool: ${daily.size} instruments; dir ${POOL_DIR}`);

function retention(arr, E, look, loMode = 'close') {
  const from = Math.max(0, E - look + 1);
  const w = arr.slice(from, E + 1);
  if (w.length < 30) return null;
  let loIdx = 0;
  for (let i = 1; i < w.length; i++) {
    const cur = loMode === 'close' ? w[i].c : w[i].l;
    const best = loMode === 'close' ? w[loIdx].c : w[loIdx].l;
    if (cur < best) loIdx = i;
  }
  const lo = loMode === 'close' ? w[loIdx].c : w[loIdx].l;
  let hi = -Infinity;
  for (let i = loIdx; i < w.length; i++) if (w[i].h > hi) hi = w[i].h;
  if (!(hi > lo) || !(lo > 0) || !(hi > 0)) return null;
  const close = arr[E].c;
  return {
    r: (close - lo) / (hi - lo),
    legPct: (hi / lo - 1) * 100,
    offHigh: (1 - close / hi) * 100,
    legBars: w.length - loIdx,
    startToLast: (close / lo - 1) * 100,
  };
}

const parseCsv = (text) => {
  const rows = [];
  let cell = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.replace(/^\uFEFF/, '')));
};

const labels = parseCsv(
  fs.readFileSync('.trellis/tasks/archive/2026-10/10-15-structure-fullness/research/labels-285.csv', 'utf8'),
)
  .slice(1)
  .filter((r) => r.length >= 4)
  .map(([instrument, , , label]) => ({ instrument, y: label.trim() === 'Y' ? 1 : 0 }));
console.log(`labels ${labels.length}, Y ${labels.reduce((a, l) => a + l.y, 0)}, base ${((labels.reduce((a, l) => a + l.y, 0) / labels.length) * 100).toFixed(1)}%`);
const missing = [...new Set(labels.map((l) => l.instrument))].filter((i) => !daily.has(i));
console.log(`labels without pool data: ${missing.length} ${missing.join(', ')}`);

const csv43 = parseCsv(fs.readFileSync('.trellis/tasks/10-18-box-brace-squeeze/research/labels-43-toppin.csv', 'utf8'));
const h43 = csv43[0];
const iInst43 = h43.indexOf('instrument');
const iNote43 = h43.indexOf('note');
const STRETCHES = [];
for (const r of csv43.slice(1)) {
  for (const clause of String(r[iNote43] ?? "").split(String.fromCharCode(0xff0c, 0x2c, 0xff1b, 0x3b, 0x3002))) {
    const ds = [...clause.matchAll(/(\d{1,2})-(\d{1,2})/g)].map((m) => `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
    if (ds.length < 2 || ds[0] === ds[1]) continue;
    STRETCHES.push({ instrument: r[iInst43], start: ds[0], end: ds[1] });
  }
}
const nextDay = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

function crossSection(look, loMode, filter) {
  const byDate = new Map();
  for (const [inst, arr] of daily) {
    for (let E = look; E < arr.length; E++) {
      const m = retention(arr, E, look, loMode);
      if (!m) continue;
      if (filter && !filter(m)) continue;
      const d = iso(arr[E].t);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push({ inst, ...m });
    }
  }
  for (const list of byDate.values()) list.sort((a, b) => b.r - a.r);
  return byDate;
}

/** Precision of ONE band = (#Y inside the band) / (band width). */
function bandHit(byDate, date, cut) {
  const list = byDate.get(date) ?? [];
  const nCut = Math.max(1, Math.round(list.length * cut));
  const band = list.slice(0, nCut);
  const names = new Set(band.map((x) => x.inst));
  let y = 0;
  for (const l of labels) if (l.y && names.has(l.instrument)) y++;
  // How many LABELLED names the band holds is also useful (band 鈭?labels).
  const labelled = labels.filter((l) => names.has(l.instrument));
  return { y, band: nCut, labelled: labelled.length, prec: (y / nCut) * 100 };
}

const ANCHORS = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];

console.log('\nA. anchor 2026-10-13, loMode=close 鈥?Y inside the band / band width');
for (const cut of CUTS) {
  const cells = LOOKS.map((w) => {
    const h = bandHit(crossSection(w, 'close', null), '2026-10-13', cut);
    return `W=${w}: ${h.y}/${h.band}=${h.prec.toFixed(1)}%`.padStart(20);
  });
  console.log(`   top ${(cut * 100).toFixed(0).padStart(2)}% |` + cells.join(' |'));
}

console.log('\nB. 5 anchors (10-09..10-13) averaged, loMode=close');
for (const cut of CUTS) {
  const cells = LOOKS.map((w) => {
    const byDate = crossSection(w, 'close', null);
    let y = 0, band = 0;
    for (const d of ANCHORS) { const h = bandHit(byDate, d, cut); y += h.y; band += h.band; }
    return `W=${w}: ${((y / band) * 100).toFixed(1)}%`.padStart(14);
  });
  console.log(`   top ${(cut * 100).toFixed(0).padStart(2)}% |` + cells.join(' |'));
}

console.log('\nC. W=60, top 10%, 5 anchors 鈥?loMode and the up-leg momentum gate');
for (const loMode of ['low', 'close']) {
  for (const gate of [null, 10, 15]) {
    const byDate = crossSection(WINDOW, loMode, gate === null ? null : (m) => m.startToLast >= gate);
    let y = 0, band = 0, pool = 0;
    for (const d of ANCHORS) { const h = bandHit(byDate, d, 0.1); y += h.y; band += h.band; pool += (byDate.get(d) ?? []).length; }
    const tag = gate === null ? 'no gate          ' : `start鈫抧ow>=${String(gate).padStart(2)}%`;
    console.log(`   lo=${loMode.padEnd(5)} ${tag} | pool/day ${(pool / ANCHORS.length).toFixed(0).padStart(3)} | top10% ${((y / band) * 100).toFixed(1)}% (${y}/${band})`);
  }
}

console.log('\nD. user-marked stretches covered day by day (loMode=close)');
for (const w of LOOKS) {
  const byDate = crossSection(w, 'close', null);
  const cells = CUTS.map((cut) => {
    let covered = 0;
    for (const s of STRETCHES) {
      if (!daily.has(s.instrument)) continue;
      for (let d = s.start; d <= nextDay(s.end); d = nextDay(d)) {
        const list = byDate.get(d) ?? [];
        const rk = list.findIndex((x) => x.inst === s.instrument);
        if (rk >= 0 && rk < Math.max(1, Math.round(list.length * cut))) { covered++; break; }
      }
    }
    return `top${(cut * 100).toFixed(0)}% ${covered}/${STRETCHES.length}`.padStart(14);
  });
  console.log(`   W=${String(w).padStart(3)} |` + cells.join(' |'));
}

console.log('\nE. names/day, last 120 days');
{
  const byDate = crossSection(WINDOW, 'close', null);
  const dates = [...byDate.keys()].sort().slice(-120);
  for (const cut of CUTS) {
    let n = 0;
    for (const d of dates) n += Math.max(1, Math.round((byDate.get(d)?.length ?? 0) * cut));
    console.log(`   top ${(cut * 100).toFixed(0).padStart(2)}%: ${(n / dates.length).toFixed(0)} names/day`);
  }
}

if (process.env.WITH_4H) {
  const h4All = loadDir(process.env.WITH_4H, 60);
  console.log(`\nF. live-shape proxy: daily top 10% AND the coin's 4H series top Y% (4H pool ${h4All.size})`);
  const H4_LOOK = 42;
  const h4ByDate = new Map();
  for (const [inst, arr] of h4All) {
    for (let E = H4_LOOK; E < arr.length; E++) {
      const m = retention(arr, E, H4_LOOK, 'low');
      if (!m) continue;
      const d = iso(arr[E].t);
      if (!h4ByDate.has(d)) h4ByDate.set(d, []);
      h4ByDate.get(d).push({ inst, r: m.r });
    }
  }
  for (const list of h4ByDate.values()) list.sort((a, b) => b.r - a.r);
  const byDate = crossSection(WINDOW, 'close', null);
  for (const yPct of [0.1, 0.2, 0.3, 0.5, 1.0]) {
    let y = 0, band = 0;
    for (const d of ANCHORS) {
      const h4 = h4ByDate.get(d) ?? [];
      const h4Cut = Math.max(1, Math.round(h4.length * yPct));
      const h4Rank = new Map(h4.map((x, i) => [x.inst, i]));
      const day = byDate.get(d) ?? [];
      const dCut = Math.max(1, Math.round(day.length * 0.1));
      const names = new Set(
        day.slice(0, dCut).filter((x) => h4Rank.has(x.inst) && h4Rank.get(x.inst) < h4Cut).map((x) => x.inst),
      );
      band += names.size;
      for (const l of labels) if (l.y && names.has(l.instrument)) y++;
    }
    console.log(`   4H top ${(yPct * 100).toFixed(0).padStart(3)}% | rows/day ${(band / ANCHORS.length).toFixed(0).padStart(3)} | precision ${((y / band) * 100).toFixed(1)}%`);
  }
  console.log('   (proxy only: the live scan also demands 5m/15m/1H convergence, which dailies cannot model)');
}

