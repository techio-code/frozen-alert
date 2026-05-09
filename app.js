/**
 * FrozenAlert v2 — app.js
 * fetch(data/macro_latest.json) → 判定切替 → Chart.js グラフ描画
 *
 * v2 変更点:
 *   - #judgment-answer-text (買えません/慎重に/買えます) 追加
 *   - [data-metric-status] 判定ドット更新
 *   - #action-list 状態別チェックリスト切替
 *   - #history-summary (#frozen-days / #warning-days / #normal-days)
 *   - ヘルプモーダル開閉 + 3タブ切替
 *   - Chart.js: 折れ線 → 棒グラフ（判定色色分け）
 *
 * v1 フック（後方互換・維持）:
 *   #judgment-display / #judgment-reason / #update-time
 *   [data-metric="vix/nikkei-vi/usdjpy/jgb10y"] / #history-chart
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// 定数: 判定閾値（macro_collector.py と整合）
// ─────────────────────────────────────────────────────────────
const THRESHOLD = {
  FROZEN_VIX:       25.0,
  FROZEN_NIKKEI_VI: 27.0,
  FROZEN_USDJPY:    155.0,
  WARNING_VIX_LO:   20.0,
  WARNING_VIX_HI:   25.0,
  WARNING_VI_LO:    23.0,
  WARNING_VI_HI:    27.0,
};

// ─────────────────────────────────────────────────────────────
// 定数: 状態定義（v2 拡張）
// ─────────────────────────────────────────────────────────────
const STATES = {
  FROZEN: {
    key: 'FROZEN',
    color: '#1A56A0',
    bg: 'rgba(26, 86, 160, 0.08)',
    border: 'rgba(26, 86, 160, 0.3)',
    label: 'FROZEN',
    answerText: '買えません',
    reason: 'VIX が警戒水準（25超）です。ポジション保有のみ推奨。',
    actions: [
      '新規購入は全て見送る',
      '保有中のポジションを点検する',
      'VIX が 25 を下回るまで待機',
    ],
    iconType: 'x',
  },
  WARNING: {
    key: 'WARNING',
    color: '#D97706',
    bg: 'rgba(217, 119, 6, 0.08)',
    border: 'rgba(217, 119, 6, 0.3)',
    label: 'WARNING',
    answerText: '慎重に',
    reason: 'VIX が注意水準（20〜25）です。小ロットのみ検討可。',
    actions: [
      '新規購入は小ロットに限る',
      '損切りラインを事前に決めておく',
      'VIX・日経VI を毎日確認する',
    ],
    iconType: 'warning',
  },
  NORMAL: {
    key: 'NORMAL',
    color: '#047857',
    bg: 'rgba(4, 120, 87, 0.08)',
    border: 'rgba(4, 120, 87, 0.3)',
    label: 'NORMAL',
    answerText: '買えます',
    reason: '全指標が通常水準です。通常通り判断可能。',
    actions: [
      '通常の判断基準で投資可能',
      'ポートフォリオのバランスを確認',
      '次回 FROZEN に備えてルールを確認',
    ],
    iconType: 'check',
  },
};

// ─────────────────────────────────────────────────────────────
// 定数: アクションアイコン SVG
// ─────────────────────────────────────────────────────────────
const ACTION_ICON_SVG = `<svg class="action-check-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/>
  <path d="M5 8.2L7 10L11 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// ─────────────────────────────────────────────────────────────
// 定数: 判定アイコン SVG 生成
// ─────────────────────────────────────────────────────────────
function buildJudgmentIconSVG(type) {
  if (type === 'x') {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
      <line x1="8" y1="8" x2="16" y2="16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="16" y1="8" x2="8" y2="16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
  }
  if (type === 'warning') {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 4L22 20H2L12 4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <line x1="12" y1="10" x2="12" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="12" cy="17.5" r="0.8" fill="currentColor"/>
    </svg>`;
  }
  // check
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
    <path d="M7.5 12.5L10.5 15.5L16.5 9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ─────────────────────────────────────────────────────────────
// fallback サンプルデータ（FROZEN 状態）
// ─────────────────────────────────────────────────────────────
const SAMPLE_LATEST = {
  date: '2026-05-09',
  fetched_at: '2026-05-09T08:45:00+09:00',
  judgment: 'FROZEN',
  vix: 17.19,
  nikkei_vi: 34.16,
  usdjpy: 156.62,
  jgb_10y: null,
  nikkei225: 62714,
  vix_term: 'CONTANGO',
  errors: ['jgb_10y: MOF CSV 取得失敗'],
  is_sample: true,
};

const SAMPLE_HISTORY = generateSampleHistory();

// ─────────────────────────────────────────────────────────────
// グラフインスタンス（Chart.js）
// ─────────────────────────────────────────────────────────────
let historyChart = null;

// ─────────────────────────────────────────────────────────────
// 判定ロジック（macro_collector.py 準拠）
// ─────────────────────────────────────────────────────────────
function calcJudgment(ind) {
  const vix = ind.vix;
  const vi  = ind.nikkei_vi;
  const jpy = ind.usdjpy;

  if (vix != null && vix > THRESHOLD.FROZEN_VIX)       return 'FROZEN';
  if (vi  != null && vi  > THRESHOLD.FROZEN_NIKKEI_VI) return 'FROZEN';
  if (jpy != null && jpy > THRESHOLD.FROZEN_USDJPY)    return 'FROZEN';

  const vixWarn = vix != null && vix >= THRESHOLD.WARNING_VIX_LO && vix <= THRESHOLD.WARNING_VIX_HI;
  const viWarn  = vi  != null && vi  >= THRESHOLD.WARNING_VI_LO  && vi  <= THRESHOLD.WARNING_VI_HI;
  if (vixWarn || viWarn) return 'WARNING';

  return 'NORMAL';
}

// ─────────────────────────────────────────────────────────────
// 判定根拠テキスト生成（v2: シンプル1行）
// ─────────────────────────────────────────────────────────────
function buildReasonText(ind, judgment) {
  const state = STATES[judgment] || STATES.FROZEN;
  const vix = ind.vix;
  const vi  = ind.nikkei_vi;
  const jpy = ind.usdjpy;

  if (judgment === 'FROZEN') {
    const triggers = [];
    if (vix != null && vix > THRESHOLD.FROZEN_VIX) {
      triggers.push(`VIX ${vix.toFixed(2)}（閾値 ${THRESHOLD.FROZEN_VIX}）`);
    }
    if (vi != null && vi > THRESHOLD.FROZEN_NIKKEI_VI) {
      triggers.push(`日経VI ${vi.toFixed(2)}（閾値 ${THRESHOLD.FROZEN_NIKKEI_VI}）`);
    }
    if (jpy != null && jpy > THRESHOLD.FROZEN_USDJPY) {
      triggers.push(`USD/JPY ${jpy.toFixed(2)}（閾値 ${THRESHOLD.FROZEN_USDJPY}）`);
    }
    if (triggers.length > 0) {
      return `${triggers.join('、')} が警戒水準を超過。ポジション保有のみ推奨。`;
    }
    return state.reason;
  }

  if (judgment === 'WARNING') {
    if (vix != null) {
      return `VIX ${vix.toFixed(2)}（注意水準 ${THRESHOLD.WARNING_VIX_LO}〜${THRESHOLD.WARNING_VIX_HI}）。小ロットのみ検討可。`;
    }
    return state.reason;
  }

  if (vix != null) {
    return `全指標が通常水準（VIX ${vix.toFixed(2)}）。通常通り判断可能。`;
  }
  return state.reason;
}

// ─────────────────────────────────────────────────────────────
// 指標別の判定ドットクラスを返す
// ─────────────────────────────────────────────────────────────
function getMetricDotClass(metric, ind) {
  const vix = ind.vix;
  const vi  = ind.nikkei_vi;
  const jpy = ind.usdjpy;
  const jgb = ind.jgb_10y;

  switch (metric) {
    case 'vix':
      if (vix == null) return 'dot-normal';
      if (vix > THRESHOLD.FROZEN_VIX) return 'dot-frozen';
      if (vix > THRESHOLD.WARNING_VIX_LO) return 'dot-warning';
      return 'dot-normal';
    case 'nikkei-vi':
      if (vi == null) return 'dot-normal';
      if (vi > THRESHOLD.FROZEN_NIKKEI_VI) return 'dot-frozen';
      if (vi > THRESHOLD.WARNING_VI_LO) return 'dot-warning';
      return 'dot-normal';
    case 'usdjpy':
      if (jpy == null) return 'dot-normal';
      if (jpy > THRESHOLD.FROZEN_USDJPY) return 'dot-frozen';
      if (jpy > 150) return 'dot-warning';
      return 'dot-normal';
    case 'jgb10y':
      if (jgb == null) return 'dot-normal';
      if (jgb > 1.5) return 'dot-warning';
      return 'dot-normal';
    default:
      return 'dot-normal';
  }
}

// ─────────────────────────────────────────────────────────────
// UI 更新: data-status 属性（CSS 切替用）
// ─────────────────────────────────────────────────────────────
function applyStatus(judgmentKey) {
  const statusVal = judgmentKey.toLowerCase();
  document.body.setAttribute('data-status', statusVal);
  // v2 互換: #judgment-banner が存在すれば更新
  const banner = document.getElementById('judgment-banner');
  if (banner) banner.setAttribute('data-status', statusVal);
  const actionList = document.getElementById('action-list');
  if (actionList) actionList.setAttribute('data-status', statusVal);
}

// ─────────────────────────────────────────────────────────────
// UI 更新: ヒーローセクション
// ─────────────────────────────────────────────────────────────
function renderHero(ind, judgment) {
  const state = STATES[judgment] || STATES.FROZEN;

  // アイコン
  const iconEl = document.getElementById('judgment-icon');
  if (iconEl) iconEl.innerHTML = buildJudgmentIconSVG(state.iconType);

  // 判定ワード（v1 フック維持）
  const displayEl = document.getElementById('judgment-display');
  if (displayEl) displayEl.textContent = state.label;

  // 判定答えテキスト（v2 新規）
  const answerEl = document.getElementById('judgment-answer-text');
  if (answerEl) answerEl.textContent = state.answerText;

  // 判定理由
  const reasonEl = document.getElementById('judgment-reason');
  if (reasonEl) reasonEl.textContent = buildReasonText(ind, judgment);
}

// ─────────────────────────────────────────────────────────────
// UI 更新: 指標行（v3: 縦リスト .metric-row + .metric-row-value）
// ─────────────────────────────────────────────────────────────
function renderMetrics(ind, judgment) {
  function setMetric(metric, valueText) {
    const row = document.querySelector(`[data-metric="${metric}"]`);
    if (!row) return;
    // v3: .metric-row-value（縦リスト）または v2 .metric-value のどちらにも対応
    const valueEl = row.querySelector('.metric-row-value') || row.querySelector('.metric-value');
    if (valueEl) valueEl.textContent = valueText;
    const dotEl = row.querySelector('[data-metric-status]');
    if (dotEl) {
      const dotClass = getMetricDotClass(metric, ind);
      dotEl.className = `metric-status-dot ${dotClass}`;
    }
  }

  const vix = ind.vix;
  const vi  = ind.nikkei_vi;
  const jpy = ind.usdjpy;
  const jgb = ind.jgb_10y;

  setMetric('vix',       vix != null ? vix.toFixed(2) : '--.-');
  setMetric('nikkei-vi', vi  != null ? vi.toFixed(2)  : '--.-');
  setMetric('usdjpy',    jpy != null ? jpy.toFixed(2) : '---.-');
  setMetric('jgb10y',    jgb != null ? jgb.toFixed(3) + '%' : '-.--%');
}

// ─────────────────────────────────────────────────────────────
// UI 更新: 推奨アクション（v3: テキストのみ・ダッシュは CSS ::before）
// ─────────────────────────────────────────────────────────────
function renderActions(judgment) {
  const state = STATES[judgment] || STATES.FROZEN;
  const items = document.querySelectorAll('#action-list .action-item');
  items.forEach((el, i) => {
    if (state.actions[i]) {
      el.textContent = state.actions[i];
    }
  });
}

// ─────────────────────────────────────────────────────────────
// UI 更新: タイムスタンプ（ヘッダー + ヒーロー内ステータス行）
// ─────────────────────────────────────────────────────────────
function renderTimestamp(fetchedAt) {
  const el      = document.getElementById('update-time');
  const heroEl  = document.getElementById('hero-update-time');
  let timeStr = '--:--';
  if (fetchedAt) {
    try {
      const d = new Date(fetchedAt);
      const jst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
      const hh = String(jst.getHours()).padStart(2, '0');
      const mm = String(jst.getMinutes()).padStart(2, '0');
      timeStr = `${hh}:${mm}`;
    } catch {
      timeStr = '--:--';
    }
  }
  if (el)     el.textContent     = timeStr;
  if (heroEl) heroEl.textContent = `${timeStr} 更新`;
}

// ─────────────────────────────────────────────────────────────
// UI 更新: 履歴統計サマリ（v2 新規）
// ─────────────────────────────────────────────────────────────
function renderHistorySummary(history) {
  const slice = history.slice(-30);
  let frozenDays = 0, warningDays = 0, normalDays = 0;
  slice.forEach(d => {
    if (d.judgment === 'FROZEN') frozenDays++;
    else if (d.judgment === 'WARNING') warningDays++;
    else normalDays++;
  });

  const frozenEl  = document.getElementById('frozen-days');
  const warningEl = document.getElementById('warning-days');
  const normalEl  = document.getElementById('normal-days');
  if (frozenEl)  frozenEl.textContent  = frozenDays;
  if (warningEl) warningEl.textContent = warningDays;
  if (normalEl)  normalEl.textContent  = normalDays;
}

// ─────────────────────────────────────────────────────────────
// Chart.js: 30日履歴グラフ（v2: 棒グラフ・判定色色分け）
// ─────────────────────────────────────────────────────────────
function renderHistoryChart(history) {
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;

  const slice = history.slice(-30);
  const labels = slice.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  });

  // 各バーに判定色を割り当て
  const barColors = slice.map(d => {
    if (d.judgment === 'FROZEN')  return 'rgba(26, 86, 160, 0.75)';
    if (d.judgment === 'WARNING') return 'rgba(217, 119, 6, 0.75)';
    return 'rgba(4, 120, 87, 0.65)';
  });

  const borderColors = slice.map(d => {
    if (d.judgment === 'FROZEN')  return '#1A56A0';
    if (d.judgment === 'WARNING') return '#D97706';
    return '#047857';
  });

  const vixData = slice.map(d => d.vix != null ? d.vix : 0);

  if (historyChart) {
    historyChart.destroy();
    historyChart = null;
  }

  historyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'VIX',
          data: vixData,
          backgroundColor: barColors,
          borderColor: borderColors,
          borderWidth: 0,
          borderRadius: 2,
        },
        {
          // FROZEN閾値ライン（type: 'line' を overlay）
          type: 'line',
          label: 'FROZEN閾値',
          data: slice.map(() => THRESHOLD.FROZEN_VIX),
          borderColor: 'rgba(26, 86, 160, 0.4)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderDash: [5, 4],
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#2D2D2D',
          titleFont: { family: 'JetBrains Mono', size: 10 },
          bodyFont:  { family: 'JetBrains Mono', size: 10 },
          padding: 8,
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 1) return null;
              const v = ctx.parsed.y;
              const j = slice[ctx.dataIndex] ? slice[ctx.dataIndex].judgment : '';
              return v ? `VIX ${v.toFixed(2)} — ${j}` : null;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            font: { family: 'JetBrains Mono', size: 9 },
            color: '#888',
            maxTicksLimit: 8,
            maxRotation: 0,
          },
          grid: { display: false },
        },
        y: {
          min: 0,
          max: 50,
          ticks: {
            font: { family: 'JetBrains Mono', size: 9 },
            color: '#888',
            stepSize: 10,
          },
          grid: { color: 'rgba(0, 0, 0, 0.04)' },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// サンプル30日履歴を生成（初回表示 / フォールバック用）
// ─────────────────────────────────────────────────────────────
function generateSampleHistory() {
  const history = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const base  = 15 + (29 - i) * 0.5;
    const noise = (Math.sin(i * 1.7) * 3 + Math.sin(i * 0.9) * 2);
    const vix   = Math.max(12, +(base + noise).toFixed(2));
    const vi    = +(vix * 1.05 + Math.sin(i * 1.1) * 1.5).toFixed(2);
    const jpy   = +(150 + Math.sin(i * 0.5) * 3).toFixed(2);

    let judgment = 'NORMAL';
    if (vix > 25 || vi > 27) judgment = 'FROZEN';
    else if (vix > 20 || vi > 23) judgment = 'WARNING';

    history.push({ date: dateStr, vix, nikkei_vi: vi, usdjpy: jpy, jgb_10y: 1.52, judgment });
  }
  return history;
}

// ─────────────────────────────────────────────────────────────
// エラーバナー表示制御
// ─────────────────────────────────────────────────────────────
function showErrorBanner(msg) {
  const el = document.getElementById('error-banner');
  if (!el) return;
  el.querySelector('span').textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

// ─────────────────────────────────────────────────────────────
// メイン描画
// ─────────────────────────────────────────────────────────────
function renderAll(latest, history) {
  const judgment = latest.judgment || calcJudgment(latest);

  applyStatus(judgment);
  renderHero(latest, judgment);
  renderMetrics(latest, judgment);
  renderActions(judgment);
  renderTimestamp(latest.fetched_at);
  renderHistorySummary(history);
  renderHistoryChart(history);
}

// ─────────────────────────────────────────────────────────────
// ヘルプモーダル制御（v2 新規）
// ─────────────────────────────────────────────────────────────
function initHelpModal() {
  const modal    = document.getElementById('help-modal');
  const closeBtn = document.getElementById('help-modal-close');
  const tabs     = document.querySelectorAll('.help-tab');
  const contents = {
    'metrics':       document.getElementById('help-content-metrics'),
    'frozen-action': document.getElementById('help-content-frozen-action'),
    'chart':         document.getElementById('help-content-chart'),
  };

  function openModal() {
    if (!modal) return;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  function switchTab(tabKey) {
    tabs.forEach(t => {
      const isActive = t.getAttribute('data-tab') === tabKey;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    Object.entries(contents).forEach(([key, el]) => {
      if (!el) return;
      if (key === tabKey) {
        el.removeAttribute('hidden');
        el.style.opacity = '0';
        requestAnimationFrame(() => { el.style.opacity = '1'; });
      } else {
        el.setAttribute('hidden', '');
      }
    });
  }

  // トリガー: 指標セクション
  const triggerMetrics = document.getElementById('help-trigger-metrics');
  if (triggerMetrics) {
    triggerMetrics.addEventListener('click', () => {
      switchTab('metrics');
      openModal();
    });
  }

  // トリガー: グラフ
  const triggerChart = document.getElementById('help-trigger-chart');
  if (triggerChart) {
    triggerChart.addEventListener('click', () => {
      switchTab('chart');
      openModal();
    });
  }

  // 閉じるボタン
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  // オーバーレイクリックで閉じる
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // ESCキーで閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.classList.contains('open')) closeModal();
  });

  // タブ切替
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.getAttribute('data-tab'));
    });
  });
}

// ─────────────────────────────────────────────────────────────
// データ取得
// ─────────────────────────────────────────────────────────────
async function fetchData() {
  let latest  = null;
  let history = null;

  try {
    const res = await fetch('./data/macro_latest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    latest = await res.json();
  } catch {
    // フォールバック後で適用
  }

  try {
    const res = await fetch('./data/macro_history_30d.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    history = await res.json();
  } catch {
    // フォールバック後で適用
  }

  if (!latest)  { latest  = SAMPLE_LATEST; }
  if (!history) { history = SAMPLE_HISTORY; }

  // 今日のデータが history になければ追加
  if (latest && history) {
    const todayStr = latest.date;
    const existsToday = history.some(h => h.date === todayStr);
    if (!existsToday) {
      history = [...history, {
        date:      latest.date,
        vix:       latest.vix,
        nikkei_vi: latest.nikkei_vi,
        usdjpy:    latest.usdjpy,
        jgb_10y:   latest.jgb_10y,
        judgment:  latest.judgment || calcJudgment(latest),
      }];
    }
  }

  renderAll(latest, history);

  if (latest.is_sample === true) {
    showErrorBanner('データ取得失敗 — サンプルデータを表示しています');
  }
}

// ─────────────────────────────────────────────────────────────
// 初期化
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // ヘルプモーダル初期化
  initHelpModal();

  // サンプルデータで即時描画
  renderAll(SAMPLE_LATEST, SAMPLE_HISTORY);

  // 実データを非同期取得して上書き
  fetchData().catch(() => {
    // サンプル表示のまま継続（is_sample=true でトースト済み）
  });
});
