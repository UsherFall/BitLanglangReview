// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ScanScope } from '../src/domain/scan-scope';
import { DEFAULT_SCAN_PARAMS } from '../src/domain/scan-scope';
import { CoinScanPanel } from '../src/ui/CoinScanPanel';

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
const scopeButton = (label: string) => screen.getByRole('button', { name: label });
const numberInputs = () =>
  [...document.querySelectorAll<HTMLInputElement>('.coin-scan-params input[type="number"]')].map((input) => input.value);

describe('CoinScanPanel sub-modules (选品)', () => {
  it('marks the current sub-module and offers both', () => {
    renderPanel('crypto');

    expect(scopeButton('加密')).toHaveClass('selected');
    expect(scopeButton('股票')).not.toHaveClass('selected');
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
    expect(numberInputs()[0]).toBe(String(DEFAULT_SCAN_PARAMS.crypto.topN));

    fireEvent.click(scopeButton('股票'));

    expect(onScopeChange).toHaveBeenCalledWith('equity');
    expect(numberInputs()[0]).toBe(String(DEFAULT_SCAN_PARAMS.equity.topN));
    expect(numberInputs()[1]).toBe(String(DEFAULT_SCAN_PARAMS.equity.minQuoteVolume24h));
    // Switching sub-module never emits a result on its own.
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('drops back to 收敛结构 when switching to equities with 热度 selected', () => {
    render(<Harness />);
    fireEvent.change(methodSelect(), { target: { value: 'heat' } });
    expect(methodSelect().value).toBe('heat');

    fireEvent.click(scopeButton('股票'));

    expect(methodSelect().value).toBe('shrink');
    expect([...methodSelect().options].map((option) => option.value)).toEqual(['shrink']);
  });

  it('does not fire onScopeChange when the active sub-module is re-clicked', () => {
    const { onScopeChange } = renderPanel('crypto');

    fireEvent.click(scopeButton('加密'));

    expect(onScopeChange).not.toHaveBeenCalled();
  });
});
