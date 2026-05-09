# -*- coding: utf-8 -*-
"""
apps/frozen-alert/scripts/backfill_history.py

過去30日分の VIX / USD/JPY / 日経225 を yfinance で一括取得して
data/macro_history_30d.json を初期生成するスクリプト。

日経VI / JGB10y は過去データ取得不可のため null。
初回1回だけ実行すれば OK。重複実行で上書き。

実行方法:
    py -3 apps/frozen-alert/scripts/backfill_history.py

依存: yfinance
"""

import json
import os
import sys
from datetime import datetime, date, timezone, timedelta
from typing import Optional

# ---------------------------------------------------------------------------
# パス設定
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
_APP_ROOT = os.path.dirname(_HERE)
DATA_DIR = os.path.join(_APP_ROOT, "data")
HISTORY_PATH = os.path.join(DATA_DIR, "macro_history_30d.json")

# ---------------------------------------------------------------------------
# 判定閾値（fetch_macro.py / app.js と同一）
# ---------------------------------------------------------------------------
FROZEN_VIX       = 25.0
FROZEN_NIKKEI_VI = 27.0
FROZEN_USDJPY    = 155.0
WARNING_VIX_LO   = 20.0
WARNING_VI_LO    = 23.0


def calc_judgment(vix: Optional[float], usdjpy: Optional[float]) -> str:
    """日経VI が null の場合の簡易判定（VIX + USD/JPY のみ）。"""
    if vix is not None and vix > FROZEN_VIX:
        return "FROZEN"
    if usdjpy is not None and usdjpy > FROZEN_USDJPY:
        return "FROZEN"
    if vix is not None and WARNING_VIX_LO <= vix <= FROZEN_VIX:
        return "WARNING"
    return "NORMAL"


def main():
    try:
        import yfinance as yf
    except ImportError:
        print("[backfill] yfinance が見つかりません。サンプル JSON を生成します。")
        _write_sample_fallback()
        return

    print("[backfill] yfinance で過去30日を取得中...")

    try:
        import pandas as pd
        vix_df   = yf.Ticker("^VIX").history(period="35d", auto_adjust=True)
        jpy_df   = yf.Ticker("JPY=X").history(period="35d", auto_adjust=True)
        n225_df  = yf.Ticker("^N225").history(period="35d", auto_adjust=True)
    except Exception as e:
        print(f"[backfill] 取得失敗: {e}  サンプル JSON を生成します。")
        _write_sample_fallback()
        return

    # 各 df を dict{date_str -> close} に変換
    def df_to_dict(df):
        result = {}
        for ts, row in df.iterrows():
            d = ts.date() if hasattr(ts, "date") else ts
            result[str(d)] = float(row["Close"])
        return result

    vix_map  = df_to_dict(vix_df)
    jpy_map  = df_to_dict(jpy_df)
    n225_map = df_to_dict(n225_df)

    # 直近30日の日付リスト（古い順）
    today = date.today()
    dates = []
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        dates.append(str(d))

    history = []
    for date_str in dates:
        vix    = vix_map.get(date_str)
        usdjpy = jpy_map.get(date_str)
        n225   = n225_map.get(date_str)

        # 営業日でないと取れない -> None のまま
        judgment = calc_judgment(vix, usdjpy)

        history.append({
            "date":      date_str,
            "vix":       round(vix, 2) if vix is not None else None,
            "nikkei_vi": None,   # 過去データ取得不可
            "usdjpy":    round(usdjpy, 2) if usdjpy is not None else None,
            "jgb_10y":   None,   # 過去データ取得不可
            "judgment":  judgment,
        })

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

    actual = sum(1 for h in history if h["vix"] is not None)
    print(f"[backfill] 完了: {len(history)}日分 (データ有: {actual}日) -> {HISTORY_PATH}")


def _write_sample_fallback():
    """yfinance 不可時のサンプル JSON 生成（app.js generateSampleHistory と同ロジック）。"""
    import math
    today = date.today()
    history = []
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        date_str = str(d)
        base  = 15 + (29 - i) * 0.5
        noise = math.sin(i * 1.7) * 3 + math.sin(i * 0.9) * 2
        vix   = round(max(12, base + noise), 2)
        vi    = round(vix * 1.05 + math.sin(i * 1.1) * 1.5, 2)
        jpy   = round(150 + math.sin(i * 0.5) * 3, 2)

        if vix > 25 or vi > 27:
            judgment = "FROZEN"
        elif vix > 20 or vi > 23:
            judgment = "WARNING"
        else:
            judgment = "NORMAL"

        history.append({
            "date":      date_str,
            "vix":       vix,
            "nikkei_vi": vi,
            "usdjpy":    jpy,
            "jgb_10y":   1.52,
            "judgment":  judgment,
        })

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"[backfill] サンプル JSON 生成完了 -> {HISTORY_PATH}")


if __name__ == "__main__":
    main()
