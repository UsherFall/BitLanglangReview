import { Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type InstrumentResponse = {
  instruments: string[];
};

export function LeaderCoinPanel({ coins, onAdd, onRemove, onClose }: {
  coins: string[];
  onAdd: (instrument: string) => void;
  onRemove: (instrument: string) => void;
  onClose: () => void;
}) {
  const [instruments, setInstruments] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [showCandidates, setShowCandidates] = useState(false);

  useEffect(() => {
    fetch('/api/free-replay/instruments')
      .then((response) => response.json())
      .then((data: InstrumentResponse) => setInstruments(Array.isArray(data.instruments) ? data.instruments : []))
      .catch(() => setInstruments([]));
  }, []);

  const filteredInstruments = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];
    return instruments
      .filter((item) => item.toLowerCase().includes(keyword))
      .slice(0, 20);
  }, [instruments, query]);

  function addFromQuery(next: string) {
    if (!next.trim()) return;
    onAdd(next.trim());
    setQuery('');
    setShowCandidates(false);
  }

  return (
    <div className="leader-coin-panel" aria-label="龙头币列表">
      <div className="leader-coin-header">
        <strong>龙头币</strong>
        <button type="button" className="other-coin-close" aria-label="关闭龙头币列表" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="leader-coin-search">
        <Search size={14} />
        <input
          value={query}
          placeholder="搜索币种，如 ETH"
          onChange={(event) => {
            setQuery(event.target.value);
            setShowCandidates(true);
          }}
          onFocus={() => setShowCandidates(true)}
          onBlur={() => window.setTimeout(() => setShowCandidates(false), 150)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && filteredInstruments[0]) {
              addFromQuery(filteredInstruments[0]);
            }
          }}
        />
        {showCandidates && filteredInstruments.length > 0 && (
          <div className="other-coin-candidates">
            {filteredInstruments.map((item) => (
              <button key={item} type="button" onMouseDown={(event) => { event.preventDefault(); addFromQuery(item); }}>
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="leader-coin-list">
        {coins.length === 0 ? (
          <p className="leader-coin-empty">还没有龙头币，搜索添加一个</p>
        ) : (
          coins.map((coin) => (
            <div key={coin} className="leader-coin-item">
              <span>{coin}</span>
              <button type="button" aria-label={`删除 ${coin}`} onClick={() => onRemove(coin)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
