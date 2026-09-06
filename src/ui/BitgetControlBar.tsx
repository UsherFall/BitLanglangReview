import { useEffect, useState, type FormEvent } from 'react';

type SyncResult = { fetchedRows?: number; uniqueRows?: number };

type Props = {
  /** Called after a successful sync so the trade queue refetches. */
  onDataChanged: () => void;
};

const RANGE_OPTIONS = [
  { label: '最近 7 天', days: 7 },
  { label: '最近 30 天', days: 30 },
  { label: '最近 90 天', days: 90 },
];

/** 侧栏顶部的小配置/同步条，仅出现在 Bitget 复盘模式。密钥只写本机文件，任何响应不回显。 */
export function BitgetControlBar({ onDataChanged }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [days, setDays] = useState(90);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/bitget/config')
      .then((response) => response.json())
      .then((body: { configured?: boolean }) => {
        if (!cancelled) setConfigured(body.configured === true);
      })
      .catch(() => {
        if (!cancelled) setError('无法读取 Bitget 配置状态');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!apiKey.trim() || !secret.trim() || !passphrase.trim()) {
      setError('apiKey、secret、passphrase 都需要填写');
      return;
    }
    const response = await fetch('/api/bitget/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey.trim(), secret: secret.trim(), passphrase: passphrase.trim() }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; configured?: boolean } | null;
    if (!response.ok || !body?.configured) {
      setError(body?.error ?? '保存失败');
      return;
    }
    setConfigured(true);
    setApiKey('');
    setSecret('');
    setPassphrase('');
    setNotice('密钥已保存（仅本机）');
  }

  async function handleSync() {
    setError('');
    setNotice('');
    setSyncing(true);
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    try {
      const response = await fetch('/api/bitget/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startTime }),
      });
      const body = (await response.json().catch(() => null)) as (SyncResult & { error?: string }) | null;
      if (!response.ok || !body || body.error) {
        setError(body?.error ?? '同步失败，请检查 API key 权限与 IP 白名单');
        return;
      }
      const count = body.uniqueRows ?? body.fetchedRows ?? 0;
      setNotice(`同步完成：拉取 ${body.fetchedRows ?? 0} 条，新增/更新 ${count} 笔已平仓仓位`);
      onDataChanged();
    } catch {
      setError('同步请求失败');
    } finally {
      setSyncing(false);
    }
  }

  async function handleClear() {
    setError('');
    setNotice('');
    await fetch('/api/bitget/config', { method: 'DELETE' });
    setConfigured(false);
  }

  if (configured === null) {
    return <div className="bitget-control bitget-status">加载 Bitget 配置…</div>;
  }

  if (configured === false) {
    return (
      <div className="bitget-control">
        <form className="bitget-form" onSubmit={(event) => void handleSave(event)}>
          <input type="text" placeholder="API Key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
          <input type="password" placeholder="Secret" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" />
          <input type="password" placeholder="Passphrase" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="off" />
          <button type="submit" className="save-button">保存密钥</button>
        </form>
        <p className="bitget-hint">创建 Bitget API Key 时请勾选只读权限（不需交易/提现权限），并建议绑定 IP。密钥仅保存在本机 data/bitget-keys.json。</p>
        {error && <p className="bitget-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="bitget-control">
      <div className="bitget-sync-row">
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          {RANGE_OPTIONS.map((option) => <option key={option.days} value={option.days}>{option.label}</option>)}
        </select>
        <button type="button" className="save-button" disabled={syncing} onClick={() => void handleSync()}>
          {syncing ? '同步中…' : '同步仓位'}
        </button>
        <button type="button" className="bitget-clear" title="清除本机 Bitget 密钥" onClick={() => void handleClear()}>清除密钥</button>
      </div>
      {error && <p className="bitget-error">{error}</p>}
      {notice && <p className="bitget-status">{notice}</p>}
    </div>
  );
}
