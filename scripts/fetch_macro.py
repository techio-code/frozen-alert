# -*- coding: utf-8 -*-
"""
apps/frozen-alert/scripts/fetch_macro.py

FrozenAlert 用マクロ指標デイリー取得スクリプト。
GitHub Actions から毎朝 08:45 JST に実行される。

出力:
    data/macro_latest.json  -- 最新1日分
    data/macro_history_30d.json -- 直近30日分（append・30日上限）

依存: yfinance requests beautifulsoup4 lxml
"""

import json
import os
import sys
import time
import re
from datetime import datetime, date, timezone, timedelta
from typing import Optional

# JST タイムゾーン
JST = timezone(timedelta(hours=9))

# ---------------------------------------------------------------------------
# 判定閾値（app.js THRESHOLD と一致）
# ---------------------------------------------------------------------------
FROZEN_VIX       = 25.0
FROZEN_NIKKEI_VI = 27.0
FROZEN_USDJPY    = 155.0
WARNING_VIX_LO   = 20.0
WARNING_VI_LO    = 23.0

# ---------------------------------------------------------------------------
# 出力パス（スクリプトから見た相対）
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
_APP_ROOT = os.path.dirname(_HERE)
DATA_DIR = os.path.join(_APP_ROOT, "data")

LATEST_PATH  = os.path.join(DATA_DIR, "macro_latest.json")
HISTORY_PATH = os.path.join(DATA_DIR, "macro_history_30d.json")

HISTORY_KEEP_DAYS = 30

# ---------------------------------------------------------------------------
# yfinance exponential backoff
# ---------------------------------------------------------------------------
_MAX_RETRIES    = 3
_BACKOFF_BASE   = 1.5


def _yf_fetch(symbol: str, period: str = "5d") -> Optional[object]:
    """yfinance から DataFrame を exponential backoff 付きで取得。"""
    try:
        import yfinance as yf
    except ImportError:
        return None

    for attempt in range(_MAX_RETRIES):
        try:
            df = yf.Ticker(symbol).history(period=period, auto_adjust=True)
            if df is not None and not df.empty:
                return df
        except Exception:
            pass
        wait = _BACKOFF_BASE ** attempt
        time.sleep(wait)
    return None


def _latest_close(symbol: str) -> Optional[float]:
    """単一ティッカーの最新終値を返す。"""
    df = _yf_fetch(symbol, period="5d")
    if df is None:
        return None
    closes = df["Close"].dropna()
    if closes.empty:
        return None
    return float(closes.iloc[-1])


# ---------------------------------------------------------------------------
# VIX Term Structure 推定
# ---------------------------------------------------------------------------

def _calc_vix_term_structure(vix_spot: Optional[float]) -> str:
    """
    VIX Term Structure を近似推定する。
    先物取得が不安定なため spot 水準で近似:
      VIX < 20 -> CONTANGO（正常）
      VIX > 25 -> BACKWARDATION（パニック）
      それ以外 -> UNKNOWN
    """
    if vix_spot is None:
        return "UNKNOWN"
    if vix_spot > FROZEN_VIX:
        return "BACKWARDATION"
    if vix_spot < WARNING_VIX_LO:
        return "CONTANGO"
    return "UNKNOWN"


# ---------------------------------------------------------------------------
# 日経VI 取得（investing.com スクレイピング）
# ---------------------------------------------------------------------------

_NIKKEI_VI_URL = "https://jp.investing.com/indices/nikkei-volatility"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
}


def _fetch_nikkei_vi() -> Optional[float]:
    """
    investing.com __NEXT_DATA__ JSON から日経VI を取得する。
    失敗時は None を返す（呼び出し元がエラーリストに追加）。
    """
    try:
        import requests
        from bs4 import BeautifulSoup

        resp = requests.get(_NIKKEI_VI_URL, headers=_HEADERS, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        tag = soup.find("script", id="__NEXT_DATA__")
        if tag is None:
            return None
        data = json.loads(tag.string)
        # パス: props.pageProps.state.indexStore.instrument.price.last
        price = (
            data.get("props", {})
                .get("pageProps", {})
                .get("state", {})
                .get("indexStore", {})
                .get("instrument", {})
                .get("price", {})
                .get("last")
        )
        return float(price) if price is not None else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# JGB10y 取得（財務省 jgbcm.csv）
# ---------------------------------------------------------------------------

_MOF_CSV_URL = "https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv"
_JGB10Y_COL  = 10  # 0 始まり


def _reiwa_to_iso(s: str) -> Optional[str]:
    m = re.match(r"R(\d+)\.(\d+)\.(\d+)", s.strip())
    if not m:
        return None
    year = int(m.group(1)) + 2018
    return f"{year:04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


def _fetch_jgb10y() -> Optional[float]:
    """
    財務省 jgbcm.csv の最新行から 10年債利回りを取得する。
    失敗時は None を返す。
    """
    try:
        import requests

        resp = requests.get(_MOF_CSV_URL, headers=_HEADERS, timeout=15)
        resp.raise_for_status()
        text = resp.content.decode("shift_jis", errors="ignore")
        lines = [l for l in text.splitlines() if l.strip()]
        # 最終行が最新日付
        last = lines[-1].split(",")
        if len(last) <= _JGB10Y_COL:
            return None
        val = last[_JGB10Y_COL].strip()
        return float(val) if val else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 判定ロジック（app.js calcJudgment と一致）
# ---------------------------------------------------------------------------

def calc_judgment(vix, nikkei_vi, usdjpy) -> str:
    if vix is not None and vix > FROZEN_VIX:
        return "FROZEN"
    if nikkei_vi is not None and nikkei_vi > FROZEN_NIKKEI_VI:
        return "FROZEN"
    if usdjpy is not None and usdjpy > FROZEN_USDJPY:
        return "FROZEN"
    vix_warn = vix is not None and WARNING_VIX_LO <= vix <= FROZEN_VIX
    vi_warn  = nikkei_vi is not None and WARNING_VI_LO <= nikkei_vi <= FROZEN_NIKKEI_VI
    if vix_warn or vi_warn:
        return "WARNING"
    return "NORMAL"


# ---------------------------------------------------------------------------
# メイン取得処理
# ---------------------------------------------------------------------------

def fetch_all() -> dict:
    """全指標を取得して dict を返す。"""
    errors = []
    today_str = datetime.now(JST).strftime("%Y-%m-%d")
    fetched_at = datetime.now(JST).isoformat()

    # VIX
    vix = _latest_close("^VIX")
    if vix is None:
        errors.append("vix: yfinance ^VIX 取得失敗")

    # USD/JPY
    usdjpy = _latest_close("JPY=X")
    if usdjpy is None:
        errors.append("usdjpy: yfinance JPY=X 取得失敗")

    # 日経225
    nikkei225 = _latest_close("^N225")
    if nikkei225 is None:
        errors.append("nikkei225: yfinance ^N225 取得失敗")

    # 日経VI（investing.com スクレイピング）
    nikkei_vi = _fetch_nikkei_vi()
    if nikkei_vi is None:
        errors.append("nikkei_vi: investing.com 取得失敗")

    # JGB10y（財務省CSV）
    jgb_10y = _fetch_jgb10y()
    if jgb_10y is None:
        errors.append("jgb_10y: MOF CSV 取得失敗")

    vix_term = _calc_vix_term_structure(vix)
    judgment = calc_judgment(vix, nikkei_vi, usdjpy)

    return {
        "date":       today_str,
        "fetched_at": fetched_at,
        "judgment":   judgment,
        "vix":        vix,
        "nikkei_vi":  nikkei_vi,
        "usdjpy":     usdjpy,
        "jgb_10y":    jgb_10y,
        "nikkei225":  round(nikkei225) if nikkei225 is not None else None,
        "vix_term":   vix_term,
        "errors":     errors,
        "is_sample":  False,
    }


# ---------------------------------------------------------------------------
# 履歴 JSON 更新（30日上限）
# ---------------------------------------------------------------------------

def update_history(latest: dict) -> list:
    """
    macro_history_30d.json に today エントリを追加/上書きして返す。
    30日を超えた古いエントリは削除する。
    """
    os.makedirs(DATA_DIR, exist_ok=True)

    history = []
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH, encoding="utf-8") as f:
            history = json.load(f)

    # 今日分を除外してから追加（重複防止）
    history = [h for h in history if h.get("date") != latest["date"]]
    history.append({
        "date":      latest["date"],
        "vix":       latest["vix"],
        "nikkei_vi": latest["nikkei_vi"],
        "usdjpy":    latest["usdjpy"],
        "jgb_10y":   latest["jgb_10y"],
        "judgment":  latest["judgment"],
    })

    # 日付順 + 30日上限
    history.sort(key=lambda x: x["date"])
    if len(history) > HISTORY_KEEP_DAYS:
        history = history[-HISTORY_KEEP_DAYS:]

    return history


# ---------------------------------------------------------------------------
# エントリポイント
# ---------------------------------------------------------------------------

def main():
    print("[fetch_macro] 取得開始")
    os.makedirs(DATA_DIR, exist_ok=True)

    latest = fetch_all()

    # macro_latest.json 書き出し
    with open(LATEST_PATH, "w", encoding="utf-8") as f:
        json.dump(latest, f, ensure_ascii=False, indent=2)
    print(f"[fetch_macro] latest 書き出し完了: {LATEST_PATH}")

    # macro_history_30d.json 更新
    history = update_history(latest)
    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"[fetch_macro] history 書き出し完了: {HISTORY_PATH} ({len(history)}件)")

    if latest["errors"]:
        print(f"[fetch_macro] 取得失敗項目: {latest['errors']}")

    print(f"[fetch_macro] 判定: {latest['judgment']} (VIX={latest['vix']})")


if __name__ == "__main__":
    main()
