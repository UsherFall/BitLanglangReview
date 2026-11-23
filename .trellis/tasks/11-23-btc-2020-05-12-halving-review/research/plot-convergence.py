#!/usr/bin/env python3
"""Render pre/post-entry BTC charts and descriptive convergence metrics.

Research-only: automatic metrics describe windows; they do NOT decide whether a
structure is converged. Raw candles live in git-ignored research/out/.
"""
from __future__ import annotations

import json
from pathlib import Path
from datetime import datetime, timezone, timedelta

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import matplotlib.dates as mdates

BASE = Path(".trellis/tasks/11-23-btc-2020-05-12-halving-review/research")
OUT = BASE / "out"
HOUR = 3_600_000
IDS = [
    "position-1", "position-7", "position-10", "position-13", "position-19",
    "position-22", "position-25", "position-28", "position-31", "position-34",
    "position-37", "position-43", "position-46",
]
TAG_BY_ID = {
    "position-1": "wide support convergence - rebound long",
    "position-7": "box convergence - continuation long",
    "position-10": "high box convergence - early short",
    "position-13": "bottom convergence - reversal long",
    "position-19": "small box convergence - follow long",
    "position-22": "small box breakout (timing audit)",
    "position-25": "high box convergence - continuation long",
    "position-28": "fakeout + rebound convergence - short",
    "position-31": "lower-high rebound convergence - short",
    "position-34": "1H high convergence - early short",
    "position-37": "trendline convergence - rebound long",
    "position-43": "range but no directional edge (counterexample)",
    "position-46": "bottom low-vol convergence - 1H strength",
}


def load_candles(tf: str):
    return json.loads((OUT / f"binance-btcusdt-{tf}.json").read_text(encoding="utf-8"))["candles"]


def window(candles, n, end=None):
    selected = candles if end is None else candles[-end:]
    return selected[-n:]


def amplitude(candles):
    if not candles:
        return None
    mean_close = sum(c["close"] for c in candles) / len(candles)
    return (max(c["high"] for c in candles) - min(c["low"] for c in candles)) / mean_close


def median(values):
    values = sorted(values)
    n = len(values)
    if not n:
        return None
    return values[n // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2


def metrics(candles):
    # Callers pass only bars fully closed before entry.
    result = {}
    for n in (5, 10, 20):
        recent = window(candles, n)
        previous = candles[-2 * n:-n]
        result[f"range{n}Pct"] = amplitude(recent) * 100
        result[f"range{n}VsPrior{n}"] = (
            amplitude(recent) / amplitude(previous) if amplitude(previous) else None
        )
        result[f"positionIn{n}"] = (
            (recent[-1]["close"] - min(c["low"] for c in recent))
            / (max(c["high"] for c in recent) - min(c["low"] for c in recent))
        )
        result[f"netDrift{n}Pct"] = (recent[-1]["close"] / recent[0]["close"] - 1) * 100
        travel = sum(abs(candles[i]["close"] - candles[i - 1]["close"]) for i in range(len(candles) - n + 1, len(candles)))
        result[f"efficiency{n}"] = abs(recent[-1]["close"] - recent[0]["close"]) / travel if travel else None
    recent20 = window(candles, 20)
    prior20 = candles[-40:-20]
    recent90 = window(candles, 90)
    result["s20"] = amplitude(recent20) / amplitude(prior20) if amplitude(prior20) else None
    result["n20"] = amplitude(recent20) / amplitude(recent90) if amplitude(recent90) else None
    med_recent = median([(c["high"] - c["low"]) / c["close"] for c in recent20])
    med_prior = median([(c["high"] - c["low"]) / c["close"] for c in prior20])
    result["medianBarRange20VsPrior20"] = med_recent / med_prior if med_prior else None
    return result


def beijing(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc) + timedelta(hours=8)


def draw_candles(ax, candles, entry_time, entry_price, tf_ms, pre_count, post_count):
    before = [c for c in candles if c["timestamp"] < entry_time]
    anchor = len(before)
    selected = before[max(0, anchor - pre_count):anchor]
    entry_index = len(selected)
    after = candles[anchor:anchor + post_count]
    selected.extend(after)
    width_days = tf_ms / 86_400_000 * 0.68
    entry_date = mdates.date2num(beijing(entry_time).replace(tzinfo=None))
    for c in selected:
        x = mdates.date2num(beijing(c["timestamp"]).replace(tzinfo=None))
        is_entry_bar = c["timestamp"] <= entry_time < c["closeTime"]
        is_pre = c["closeTime"] < entry_time
        if is_entry_bar:
            color = "#d99000"
            alpha = 0.95
        elif is_pre:
            color = "#16845b" if c["close"] >= c["open"] else "#c44545"
            alpha = 0.9
        else:
            color = "#9aa0a6"
            alpha = 0.35
        ax.vlines(x, c["low"], c["high"], color=color, linewidth=0.75, alpha=alpha)
        lower = min(c["open"], c["close"])
        height = abs(c["close"] - c["open"])
        if height == 0:
            height = entry_price * 0.00005
        ax.add_patch(Rectangle((x - width_days / 2, lower), width_days, height,
                               facecolor=color, edgecolor=color, alpha=alpha, linewidth=0.5))
    ax.axvline(entry_date, color="#1769aa", linestyle="--", linewidth=1.1)
    ax.axhline(entry_price, color="#1769aa", linestyle=":", linewidth=0.9)
    ax.axvspan(entry_date, mdates.date2num(beijing(selected[-1]["closeTime"]).replace(tzinfo=None)),
               color="#9aa0a6", alpha=0.08)
    ax.grid(alpha=0.15)
    ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=8))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
    ax.tick_params(axis="x", labelsize=7)
    ax.tick_params(axis="y", labelsize=8)


def main():
    analysis = json.loads((BASE / "analysis.json").read_text(encoding="utf-8"))
    rounds = {r["positionId"]: r for r in analysis["rounds"]}
    candles = {tf: load_candles(tf) for tf in ("1h", "4h")}
    output = {"caveat": "Metrics describe pre-entry closed bars only; none is an automatic convergence verdict.", "rounds": {}}
    for position_id in IDS:
        r = rounds[position_id]
        entry = r["entryTime"]
        output["rounds"][position_id] = {
            "entryTimeBeijing": r["entryTimeBeijing"],
            "tags": r["review"]["tags"],
            "note": r["review"]["note"],
            "direction": r["direction"],
            "preEntry": {},
        }
        fig, axes = plt.subplots(2, 1, figsize=(13, 8), constrained_layout=True)
        for ax, tf, tf_ms, pre_count, post_count in zip(
            axes, ("4h", "1h"), (4 * HOUR, HOUR), (60, 96), (18, 30)
        ):
            closed = [c for c in candles[tf] if c["closeTime"] < entry]
            output["rounds"][position_id]["preEntry"][tf] = metrics(closed)
            draw_candles(ax, candles[tf], entry, r["entryPrice"], tf_ms, pre_count, post_count)
            ax.set_title(f"{tf.upper()} | colored=closed before entry; amber=entry bar; gray=after entry", fontsize=9)
        tag = TAG_BY_ID.get(position_id, "/".join(r["review"]["tags"]))
        fig.suptitle(f"{position_id} | {tag} | {r['direction']} | entry {r['entryTimeBeijing']} Beijing @ {r['entryPrice']}", fontsize=11)
        fig.savefig(OUT / f"convergence-{position_id}.png", dpi=160)
        plt.close(fig)
    (BASE / "convergence-metrics.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(IDS)} chart pairs and convergence-metrics.json")


if __name__ == "__main__":
    main()
