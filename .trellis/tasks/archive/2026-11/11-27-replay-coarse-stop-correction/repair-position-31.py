#!/usr/bin/env python3
"""One-off, guarded repair for BTCUSDT 2021-02-28 12:00 / position-31.

Default: dry-run. --apply creates a SQLite-online backup and updates one row.
--verify reads the repaired state without writing. --database permits a rehearsal
on a copied database; the production default is data/review.sqlite.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
DEFAULT_DB = REPO / 'data' / 'review.sqlite'
INSTRUMENT = 'BTCUSDT'
START_TIME = '2021-02-28 12:00'
ORIGINAL_SHA256 = '724f6e7829918e68064d965ff7b4363640021f82120c9fc4951627b98013aa72'
ENTRY_TIME = 1616744700000
CURSOR_TIME = 1616744700
PROGRESS_TIME = 1616745600
ENTRY_PRICE = 53156.5
STOP_PRICE = 52403
EXPECTED_REALIZED = 2286.557380899826
EXPECTED_AVAILABLE = 1848.688526756152


def connect(path: Path, read_only: bool = False) -> sqlite3.Connection:
    uri = f'file:{path.as_posix()}?mode=ro' if read_only else str(path)
    connection = sqlite3.connect(uri, uri=read_only)
    connection.row_factory = sqlite3.Row
    return connection


def target_row(connection: sqlite3.Connection) -> sqlite3.Row:
    row = connection.execute(
        'select * from free_replay_sessions where instrument=? and start_time=?',
        (INSTRUMENT, START_TIME),
    ).fetchone()
    if row is None:
        raise RuntimeError('目标会话不存在')
    return row


def paper_of(row: sqlite3.Row) -> dict[str, Any]:
    value = json.loads(row['paper_trading_json'])
    if not isinstance(value, dict):
        raise RuntimeError('paper_trading_json 不是对象')
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def fill_map(paper: dict[str, Any]) -> dict[str, dict[str, Any]]:
    trades = paper.get('trades')
    require(isinstance(trades, list), 'trades 不是数组')
    return {trade.get('id'): trade for trade in trades if isinstance(trade, dict)}


def validate_original(row: sqlite3.Row) -> dict[str, Any]:
    raw = row['paper_trading_json']
    digest = hashlib.sha256(raw.encode()).hexdigest()
    require(digest == ORIGINAL_SHA256, f'原始 Paper blob 已变化：{digest}')
    require(row['timeframe'] == '15m', '目标 timeframe 不是原始 15m')
    require(row['cursor_time'] == CURSOR_TIME and row['progress_time'] == PROGRESS_TIME, '目标游标/进度已变化')
    paper = paper_of(row)
    require(paper.get('active') is True, 'Paper Trading 不是 active')
    require(paper.get('position') is None, 'position 已不是 null，拒绝覆盖')
    require(paper.get('nextId') == 37, 'nextId 不是 37')
    require(paper.get('pendingEntry') is None and paper.get('pendingExit') is None, '存在非原始 pending 订单')
    fills = fill_map(paper)
    require(len(paper['trades']) == 12, '原始成交数量不是 12')
    require(set(fill for fill in fills if fill in {'fill-35', 'fill-36'}) == {'fill-35', 'fill-36'}, '缺少 fill-35/36')
    require([trade['id'] for trade in paper['trades'][-2:]] == ['fill-35', 'fill-36'], '最后两笔不是 fill-35/36')
    require(not any(trade.get('positionId') == 'position-31' for trade in paper['trades'][:-2]), 'position-31 还有更早成交')

    first, second = fills['fill-35'], fills['fill-36']
    for fill in (first, second):
        require(fill.get('positionId') == 'position-31', '误损 fill 的 positionId 不匹配')
        require(fill.get('direction') == 'long', '误损 fill 不是多头')
        require(fill.get('entryPrice') == ENTRY_PRICE and fill.get('exitPrice') == STOP_PRICE, '误损价格不匹配')
        require(fill.get('entryTime') == ENTRY_TIME and fill.get('exitTime') == PROGRESS_TIME * 1000, '误损时间不匹配')
        require(fill.get('positionOpenPrice') == ENTRY_PRICE and fill.get('positionOpenTime') == ENTRY_TIME, '回合开仓锚点不匹配')
    require(first.get('leverage') == 1 and second.get('leverage') == 10, '原始杠杆不是 1x/10x')
    require(first.get('margin') == 821.6393452249565, '第一仓原始保证金不匹配')
    require(first.get('notional') == 821.6393452249565, '第一仓原始名义价值不匹配')
    require(first.get('quantity') == 0.015456987296472803, '第一仓原始数量不匹配')
    require(second.get('margin') == 616.2295089187173, '第二仓原始保证金不匹配')
    require(second.get('notional') == 6162.295089187173, '第二仓原始名义价值不匹配')
    require(second.get('quantity') == 0.11592740472354601, '第二仓原始数量不匹配')
    require(math.isclose(first['pnl'] + second['pnl'], -98.99813938708418, abs_tol=1e-12), '误损盈亏合计不匹配')
    return paper


def repaired_paper(original: dict[str, Any]) -> dict[str, Any]:
    fills = fill_map(original)
    first, second = fills['fill-35'], fills['fill-36']
    first_notional = first['notional'] * 10
    first_quantity = first_notional / ENTRY_PRICE
    quantity = first_quantity + second['quantity']
    margin = first['margin'] + second['margin']
    notional = first_notional + second['notional']
    require(math.isclose(first_quantity, 0.15456987296472804, abs_tol=1e-18), '第一仓纠正数量偏差')
    require(math.isclose(quantity, 0.27049727768827403, abs_tol=1e-18), '合并数量偏差')
    require(math.isclose(margin, 1437.8688541436738, abs_tol=1e-12), '合并保证金偏差')
    require(math.isclose(notional, 14378.688541436739, abs_tol=1e-9), '合并名义价值偏差')

    leg = {
        'id': 'leg-32',
        'entryPrice': ENTRY_PRICE,
        'entryTime': ENTRY_TIME,
        'quantity': quantity,
        'margin': margin,
        'notional': notional,
        'leverage': 10,
        'stopPrice': STOP_PRICE,
    }
    position = {
        'id': 'position-31',
        'direction': 'long',
        'originPrice': ENTRY_PRICE,
        'originTime': ENTRY_TIME,
        'entryPrice': ENTRY_PRICE,
        'entryTime': ENTRY_TIME,
        'quantity': quantity,
        'margin': margin,
        'notional': notional,
        'leverage': 10,
        'legs': [leg],
    }
    repaired = dict(original)
    repaired['position'] = position
    repaired['trades'] = [trade for trade in original['trades'] if trade.get('id') not in {'fill-35', 'fill-36'}]
    return repaired


def close(actual: float, expected: float, tolerance: float = 1e-9) -> bool:
    return math.isclose(actual, expected, rel_tol=0, abs_tol=tolerance)


def validate_repaired(row: sqlite3.Row, expected_prior_trades: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    require(row['timeframe'] == '15m', '修复后 timeframe 改变')
    require(row['cursor_time'] == CURSOR_TIME and row['progress_time'] == PROGRESS_TIME, '修复后游标/进度改变')
    paper = paper_of(row)
    require(paper.get('active') is True and paper.get('nextId') == 37, '修复后 active/nextId 不匹配')
    require(paper.get('pendingEntry') is None and paper.get('pendingExit') is None, '修复后 pending 不为空')
    position = paper.get('position')
    require(isinstance(position, dict), '修复后没有持仓')
    require(position.get('id') == 'position-31' and position.get('direction') == 'long', '修复后持仓 ID/方向不匹配')
    require(position.get('entryPrice') == ENTRY_PRICE and position.get('entryTime') == ENTRY_TIME, '修复后开仓价/时间不匹配')
    require(position.get('originPrice') == ENTRY_PRICE and position.get('originTime') == ENTRY_TIME, '修复后回合锚点不匹配')
    require(position.get('leverage') == 10, '修复后杠杆不是 10x')
    require(close(position.get('quantity'), 0.27049727768827403, 1e-15), '修复后数量不匹配')
    require(close(position.get('margin'), 1437.8688541436738, 1e-9), '修复后保证金不匹配')
    require(close(position.get('notional'), 14378.688541436739, 1e-6), '修复后名义价值不匹配')
    legs = position.get('legs')
    require(isinstance(legs, list) and len(legs) == 1, '修复后不是一个合并仓')
    leg = legs[0]
    require(leg.get('id') == 'leg-32' and leg.get('stopPrice') == STOP_PRICE, '合并仓 ID/止损不匹配')
    for field in ('quantity', 'margin', 'notional'):
        require(close(leg.get(field), position[field], 1e-6), f'合并仓 {field} 与聚合值不一致')
    fills = fill_map(paper)
    require('fill-35' not in fills and 'fill-36' not in fills, '误损 fill 仍存在')
    require(not any(trade.get('positionId') == 'position-31' for trade in paper['trades']), '开放回合仍有已平仓 fill')
    require(len(paper['trades']) == 10, '修复后历史成交不是 10 笔')
    if expected_prior_trades is not None:
        require(paper['trades'] == expected_prior_trades, '此前成交内容发生变化')
    realized = sum(trade['pnl'] for trade in paper['trades'])
    available = max(0, 1000 + realized - position['margin'])
    require(close(realized, EXPECTED_REALIZED, 1e-9), f'已实现盈亏不匹配：{realized}')
    require(close(available, EXPECTED_AVAILABLE, 1e-9), f'可用保证金不匹配：{available}')
    return {'realizedPnl': realized, 'availableMargin': available, 'position': position, 'tradeCount': len(paper['trades'])}


def other_session_rows(connection: sqlite3.Connection) -> list[sqlite3.Row]:
    return connection.execute(
        '''select instrument,start_time,candle_source,timeframe,data_anchor_time,start_cursor_time,start_progress_time,
                  progress_time,cursor_time,paper_trading_json,review_status,updated_at
           from free_replay_sessions where not (instrument=? and start_time=?)
           order by instrument,start_time''',
        (INSTRUMENT, START_TIME),
    ).fetchall()


def rows_equal(left: list[sqlite3.Row], right: list[sqlite3.Row]) -> bool:
    return [tuple(row) for row in left] == [tuple(row) for row in right]


def backup_database(path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    destination = path.with_name(f'{path.stem}.bak-{stamp}-position-31{path.suffix}')
    source = connect(path, read_only=True)
    target = sqlite3.connect(destination)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='backup and update the target row')
    parser.add_argument('--verify', action='store_true', help='read-only validation of repaired state')
    parser.add_argument('--database', type=Path, default=DEFAULT_DB, help='database path (use a copy for rehearsal)')
    args = parser.parse_args()
    if args.apply and args.verify:
        parser.error('--apply and --verify are mutually exclusive')
    path = args.database.resolve()

    if args.verify:
        connection = connect(path, read_only=True)
        try:
            result = validate_repaired(target_row(connection))
            print(json.dumps(result, ensure_ascii=False, indent=2))
        finally:
            connection.close()
        return 0

    connection = connect(path, read_only=True)
    try:
        original = validate_original(target_row(connection))
        repaired = repaired_paper(original)
        print('DRY-RUN: only fill-35/fill-36 are removed; one position-31/leg-32 is restored.')
        print(json.dumps(repaired['position'], ensure_ascii=False, indent=2))
        if not args.apply:
            return 0
    finally:
        connection.close()

    backup = backup_database(path)
    print(f'BACKUP: {backup}')
    connection = connect(path)
    try:
        connection.execute('begin immediate')
        row = target_row(connection)
        original = validate_original(row)
        original_blob = row['paper_trading_json']
        other_before = other_session_rows(connection)
        repaired = repaired_paper(original)
        updated_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        cursor = connection.execute(
            '''update free_replay_sessions
               set paper_trading_json=?,updated_at=?
               where instrument=? and start_time=? and paper_trading_json=?
                 and timeframe='15m' and cursor_time=? and progress_time=?''',
            (json.dumps(repaired, ensure_ascii=False, separators=(',', ':')), updated_at,
             INSTRUMENT, START_TIME, original_blob, CURSOR_TIME, PROGRESS_TIME),
        )
        require(cursor.rowcount == 1, f'目标更新行数不是 1：{cursor.rowcount}')
        validate_repaired(target_row(connection), original['trades'][:-2])
        require(rows_equal(other_before, other_session_rows(connection)), '其他会话发生变化')
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    verification = connect(path, read_only=True)
    try:
        result = validate_repaired(target_row(verification))
        print('COMMITTED AND VERIFIED')
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        verification.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
