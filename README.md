# FrozenAlert

> 個人投資家が毎朝10秒で「今日は買っていいか」を確認できる市場の体温計
> VIX・日経VI・USD/JPY・JGB10y を毎朝08:45 JST に自動取得 → FROZEN/WARNING/NORMAL を判定

**公開予定**: 2026-05-14（派生記事「AI×投資 OSS 10本」と同時）
**チームてちお 22 本目アプリ**

---

## 🎯 コンセプト

「データセンターの管制室」— 機能美・静謐・信頼感。射幸心ではなく「冷静な撤退判断」を支援する。

- 既存 21 アプリは全て「生成・入力支援」系
- 本アプリは唯一「**禁止信号を出す**」逆転発想
- 判定ワード（FROZEN等）を JetBrains Mono 40px で画面中央に鎮座

---

## 🚀 ローカル開発

`file://` URL では Chart.js / Fonts CDN が動かないため、HTTP サーバー起動必須:

```bash
cd apps/frozen-alert
py -3 -m http.server 8765
```

→ ブラウザで `http://localhost:8765` を開く

---

## 📦 ファイル構成

```
apps/frozen-alert/
├── index.html                       # メイン UI（Chart.js + Fonts CDN 依存）
├── app.js                           # 判定ロジック・fetch・グラフ描画（サンプル fallback あり）
├── style.css                        # DESIGN.md 準拠のスタイル
├── data/
│   ├── macro_latest.json            # 当日最新（毎朝 GitHub Actions で更新）
│   └── macro_history_30d.json       # 過去30日履歴
├── scripts/
│   ├── fetch_macro.py               # macro_collector のコア複製（VIX・日経VI・USD/JPY・JGB10y 取得）
│   └── backfill_history.py          # 過去30日バックフィル（初回1回実行）
└── .github/workflows/
    └── collect_macro.yml            # 毎朝 08:45 JST 自動実行
```

---

## 🔧 本番運用

### 初回セットアップ（1回のみ）

```bash
cd apps/frozen-alert
pip install yfinance requests beautifulsoup4 lxml
py -3 scripts/backfill_history.py    # 過去30日 VIX/JPY/N225 取得 → data/macro_history_30d.json
py -3 scripts/fetch_macro.py         # 当日分取得 → data/macro_latest.json
```

### 本番デプロイ後

GitHub Actions が **毎朝 08:45 JST**（cron `45 23 * * *` UTC）に自動で:

1. `scripts/fetch_macro.py` 実行
2. `data/macro_latest.json` 更新
3. `data/macro_history_30d.json` に当日分 append
4. `git commit & push` で GitHub Pages に反映

ユーザーは `data/macro_latest.json` を fetch するだけで最新判定を取得。

---

## 🎨 判定ロジック

`app.js` / `scripts/fetch_macro.py` で同一の閾値を使用（macro_collector.py 準拠）:

| 状態 | 条件 |
|------|------|
| **FROZEN** | VIX > 25 OR 日経VI > 27 OR USD/JPY > 155 |
| **WARNING** | VIX 20-25 OR 日経VI 23-27 |
| **NORMAL** | 全てクリア |

詳細: [drafts/spec-frozen-widget-2026-05-09.md](../../drafts/spec-frozen-widget-2026-05-09.md)

---

## ⚠️ 免責事項

本アプリは投資助言ではありません。データはあくまで参考であり、判断はご自身の責任で行ってください。

- データソース: yfinance（VIX・USD/JPY・N225）/ investing.com（日経VI）/ 財務省 jgbcm.csv（JGB10y）
- いずれも公開データ・無料利用
- 取得失敗時は前日のキャッシュを表示

---

## 🔗 関連

- 仕様書: [drafts/spec-frozen-widget-2026-05-09.md](../../drafts/spec-frozen-widget-2026-05-09.md)
- デザイン仕様: [drafts/design-frozen-widget-2026-05-09.md](../../drafts/design-frozen-widget-2026-05-09.md)
- Claude Design 元プロンプト: [drafts/claude-design-prompt-frozen-alert.md](../../drafts/claude-design-prompt-frozen-alert.md)
- 投資戦略家ロジック: [.claude/agents/investor.md](../../.claude/agents/investor.md)
- macro_collector 本体: [tools/kabu/scoring/macro_collector.py](../../tools/kabu/scoring/macro_collector.py)
