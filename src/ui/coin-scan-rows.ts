import type { ScanRow } from '../domain/coin-scan';

/**
 * Display ordering for the 选品 results table with manually demoted instruments
 * sunk to the bottom.
 *
 * The SERVER owns the ranking (`qualifiedCount` desc → `bestScore` desc) and the
 * UI renders it as-is. Demotion is a LOCAL manual marker, so it is layered on top
 * without re-ranking anything: every not-demoted row keeps its server order, and
 * the demoted rows follow in their original server order as well. A stable
 * partition, not a sort — the relative order inside each group is untouched.
 */
export function orderScanRows(rows: readonly ScanRow[], demoted: readonly string[]): ScanRow[] {
  const demotedSet = new Set(demoted);
  const active: ScanRow[] = [];
  const parked: ScanRow[] = [];
  for (const row of rows) {
    if (demotedSet.has(row.instrument)) parked.push(row);
    else active.push(row);
  }
  return [...active, ...parked];
}
