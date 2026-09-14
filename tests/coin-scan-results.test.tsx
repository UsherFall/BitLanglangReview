// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { scanTimeframes, type ScanResponse, type ScanRow, type StructureResult } from '../src/domain/coin-scan';
import { CoinScanResults } from '../src/ui/CoinScanPanel';

function structure(qualified: boolean): StructureResult {
  return {
    structure: qualified ? 'convergence' : null,
    position: 0.5,
    score: qualified ? 0.8 : 0.2,
    touchCount: 0,
    qualified,
  };
}

function scanRow(): ScanRow {
  const structures = {} as ScanRow['structures'];
  for (const [index, timeframe] of scanTimeframes.entries()) {
    structures[timeframe] = structure(index === 0);
  }
  return {
    instrument: 'AAAUSDT',
    lastPrice: 12.5,
    change24h: 1.25,
    quoteVolume24h: 2e9,
    structures,
    convergedTimeframes: [scanTimeframes[0]],
    qualifiedCount: 1,
    bestScore: 0.8,
    qualified: true,
  };
}

function scanResponse(): ScanResponse {
  return {
    scanned: [scanRow()],
    qualifiedCount: 1,
    params: { method: 'shrink', topN: 60, minQuoteVolume24h: 10_000_000 },
    scannedAt: '2026-09-11T00:00:00.000Z',
    skippedInstruments: ['BBBUSDT', 'CCCUSDT'],
  };
}

function renderResults() {
  return render(<CoinScanResults result={scanResponse()} leaderCoins={[]} onToggleLeaderCoin={vi.fn()} />);
}

describe('CoinScanResults', () => {
  it('keeps the skipped-instrument hint inside the detail header', () => {
    const { container } = renderResults();

    const hint = container.querySelector('.coin-scan-skip-hint');
    expect(hint).not.toBeNull();
    expect(hint?.closest('.detail-header')).not.toBeNull();
    // Structural/name assertions only: several Chinese literals in this checkout
    // are mojibake, so avoid coupling to the exact sentence (quality-guidelines).
    expect(hint?.textContent).toContain('BBBUSDT');
    expect(hint?.textContent).toContain('CCCUSDT');
    expect(hint?.textContent).toContain(`${scanResponse().skippedInstruments?.length}`);
  });

  it('leaves only the header and the table as results-grid children when instruments were skipped', () => {
    const { container } = renderResults();

    // The old standalone <p> was a third grid item and got stretched by the
    // `minmax(360px, 1fr)` row; folding it into the header leaves two items.
    expect(container.childElementCount).toBe(2);
    expect(container.querySelector('.coin-scan-table-wrap')?.closest('.detail-header')).toBeNull();
  });
});
