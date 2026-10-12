// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MARKET_DATA_SOURCE, defaultScanParams, type ScanScope } from '../src/domain/scan-scope';
import { CoinScanPanel } from '../src/ui/CoinScanPanel';

/**
 * Stubs `fetch` for the panel's two call sites. `/api/scan/config` answers the
 * server's startup source (the selector's bootstrap), `/api/scan` an empty scan
 * result. The panel mounts a config fetch, so EVERY render needs a stub — the
 * jsdom environment has no working relative-URL fetch.
 */
function stubFetch(config: { source?: unknown } = {}) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.startsWith('/api/scan/config')
        ? config
        : { scanned: [], qualifiedCount: 0, params: { method: 'shrink' }, scannedAt: '2026-10-12T00:00:00.000Z' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(scope: 'crypto' | 'equity' = 'crypto') {
  const onScopeChange = vi.fn();
  const onScanned = vi.fn();
  render(<CoinScanPanel scope={scope} onScopeChange={onScopeChange} onScanned={onScanned} />);
  return { onScopeChange, onScanned };
}

/** Mirrors App: the scope is owned by the parent and fed back into the panel. */
function Harness() {
  const [scope, setScope] = useState<ScanScope>('crypto');
  return <CoinScanPanel scope={scope} onScopeChange={setScope} onScanned={vi.fn()} />;
}

const methodSelect = () => screen.getByRole('combobox') as HTMLSelectElement;
/** The 品种 / 行情源 rows are both button groups, so one lookup serves both. */
const panelButton = (label: string) => screen.getByRole('button', { name: label });
const numberInputs = () =>
  [...document.querySelectorAll<HTMLInputElement>('.coin-scan-params input[type="number"]')].map((input) => input.value);
/** The defaults each pair should produce, so the assertions track the table. */
const cryptoDefaults = (source = DEFAULT_MARKET_DATA_SOURCE) => defaultScanParams(source, 'crypto');

describe('CoinScanPanel sub-modules (选品)', () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks the current sub-module and offers both', () => {
    renderPanel('crypto');

    expect(panelButton('加密')).toHaveClass('selected');
    expect(panelButton('股票')).not.toHaveClass('selected');
  });

  it('offers 热度 in the crypto sub-module and hides it for equities', () => {
    renderPanel('crypto');
    expect([...methodSelect().options].map((option) => option.value)).toEqual(['shrink', 'heat']);
  });

  it('hides 热度 in the equity sub-module', () => {
    renderPanel('equity');

    expect([...methodSelect().options].map((option) => option.value)).toEqual(['shrink']);
  });

  it('reports a scope change and resets the scope-specific parameters', () => {
    const { onScopeChange, onScanned } = renderPanel('crypto');
    expect(numberInputs()[0]).toBe(String(cryptoDefaults().topN));

    fireEvent.click(panelButton('股票'));

    expect(onScopeChange).toHaveBeenCalledWith('equity');
    expect(numberInputs()[0]).toBe(String(defaultScanParams(DEFAULT_MARKET_DATA_SOURCE, 'equity').topN));
    expect(numberInputs()[1]).toBe(String(defaultScanParams(DEFAULT_MARKET_DATA_SOURCE, 'equity').minQuoteVolume24h));
    // Switching sub-module never emits a result on its own.
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('drops back to 收敛结构 when switching to equities with 热度 selected', () => {
    render(<Harness />);
    fireEvent.change(methodSelect(), { target: { value: 'heat' } });
    expect(methodSelect().value).toBe('heat');

    fireEvent.click(panelButton('股票'));

    expect(methodSelect().value).toBe('shrink');
    expect([...methodSelect().options].map((option) => option.value)).toEqual(['shrink']);
  });

  it('does not fire onScopeChange when the active sub-module is re-clicked', () => {
    const { onScopeChange } = renderPanel('crypto');

    fireEvent.click(panelButton('加密'));

    expect(onScopeChange).not.toHaveBeenCalled();
  });
});

describe('CoinScanPanel 行情源 (data source)', () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers all three sources and starts on the shared default', () => {
    renderPanel('crypto');

    expect(panelButton('币安')).toBeInTheDocument();
    expect(panelButton('OKX')).toBeInTheDocument();
    expect(panelButton('Bitget')).toHaveClass('selected');
    expect(numberInputs()[1]).toBe(String(cryptoDefaults('bitget').minQuoteVolume24h));
  });

  it('adopts the server startup source on mount and re-derives the defaults', async () => {
    stubFetch({ source: 'binance' });
    renderPanel('crypto');

    await waitFor(() => expect(panelButton('币安')).toHaveClass('selected'));
    expect(panelButton('Bitget')).not.toHaveClass('selected');
    expect(numberInputs()[0]).toBe(String(cryptoDefaults('binance').topN));
    expect(numberInputs()[1]).toBe(String(cryptoDefaults('binance').minQuoteVolume24h));
  });

  it('keeps the default source when the config endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    renderPanel('crypto');

    // No unhandled rejection, and the selector stays on the shared default.
    await waitFor(() => expect(panelButton('Bitget')).toHaveClass('selected'));
  });

  it('re-derives the volume floor from the selected source (the floor is graded per source)', () => {
    renderPanel('crypto');
    expect(numberInputs()[1]).toBe(String(cryptoDefaults('bitget').minQuoteVolume24h));

    fireEvent.click(panelButton('OKX'));
    expect(panelButton('OKX')).toHaveClass('selected');
    expect(numberInputs()[1]).toBe(String(cryptoDefaults('okx').minQuoteVolume24h));

    fireEvent.click(panelButton('币安'));
    expect(numberInputs()[1]).toBe(String(cryptoDefaults('binance').minQuoteVolume24h));
  });

  it('uses the scope in effect when a slow config response lands (not the mount-time scope)', async () => {
    // The panel owns no scope: it is a parent prop. A response that arrives after
    // the user moved to equities must not restore the crypto defaults.
    let releaseConfig: (() => void) | null = null;
    const emptyScan = { scanned: [], qualifiedCount: 0, params: { method: 'shrink' }, scannedAt: '2026-10-12T00:00:00.000Z' };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (!url.startsWith('/api/scan/config')) return Promise.resolve({ ok: true, json: async () => emptyScan });
        return new Promise((resolve) => {
          releaseConfig = () => resolve({ ok: true, json: async () => ({ source: 'binance' }) });
        });
      }),
    );
    render(<Harness />);
    // Let the mount effect issue the config request; it stays in flight.
    await waitFor(() => expect(releaseConfig).not.toBeNull());

    fireEvent.click(panelButton('股票'));
    expect(numberInputs()[1]).toBe(String(defaultScanParams(DEFAULT_MARKET_DATA_SOURCE, 'equity').minQuoteVolume24h));

    releaseConfig!();
    await waitFor(() => expect(panelButton('币安')).toHaveClass('selected'));
    expect(numberInputs()[0]).toBe(String(defaultScanParams('binance', 'equity').topN));
    expect(numberInputs()[1]).toBe(String(defaultScanParams('binance', 'equity').minQuoteVolume24h));
  });

  it('sends the selected source, and that source\'s defaults, with the scan request', async () => {
    const fetchMock = stubFetch();
    renderPanel('crypto');

    fireEvent.click(panelButton('币安'));
    fireEvent.click(screen.getByRole('button', { name: '扫描' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/scan?'))).toBe(true));
    const scanUrls = fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/scan?'));
    // Exactly one scan request — the config bootstrap must not be counted as one.
    expect(scanUrls).toHaveLength(1);
    const query = new URLSearchParams(scanUrls[0].slice(scanUrls[0].indexOf('?') + 1));
    expect(query.get('source')).toBe('binance');
    expect(query.get('minQuoteVolume24h')).toBe(String(cryptoDefaults('binance').minQuoteVolume24h));
    expect(query.get('minScore')).toBe('0.6');
  });
});
