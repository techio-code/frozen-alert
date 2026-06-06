#!/bin/bash
# SessionStart hook: 自律改善レビューを毎セッション開始時に自動で読み込ませる。
# レビュー本体 (feedback_proactive-improvement-review.md) を additionalContext として注入し、
# チームてちおが「指示待ち」に戻らず能動的に自己点検するようにする。
set -euo pipefail

REVIEW_FILE="${CLAUDE_PROJECT_DIR:-.}/feedback_proactive-improvement-review.md"

if [ ! -f "$REVIEW_FILE" ]; then
  # レビュー本体が無ければ何もしない（フックは安全に no-op）
  exit 0
fi

CONTEXT=$(cat "$REVIEW_FILE")

# jq で安全に JSON エンコードして additionalContext に渡す
jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: ("【自律改善レビュー】このセッションでは以下のルールに従い、指示を待たずに能動的に自己点検・提案すること。\n\n" + $ctx)
  }
}'
