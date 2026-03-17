/**
 * 顧客満足度入力Webアプリ — app.js
 * =====================================================
 * 機能:
 *  - SurveyID の自動生成（YYYYMMDD-HHMMSS）
 *  - 総合評価スコア（7項目 / 半点刻み 1〜5）の入力
 *  - 案件（ケース）の追加・編集・削除
 *  - 入力整合性チェック（整合バリデーション含む）
 *  - JSON 生成・コピー・ダウンロード
 *  - メール作成（mailto）
 */

"use strict";

/* ============================================================
   定数
   ============================================================ */
const FIXED = {
  SURVEY_YEAR:      "2025",
  FISCAL_HALF:      "2H",
  MAIL_TO:          "nc-csat@xxxxx.co.jp",
  MAILTO_MAX_LEN:   8000,  // mailto URI の一般的な最大長目安
};

const SCORE_OPTIONS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1];

const EVAL_ITEMS = [
  { key: "productQualityScore",    label: "製品品質",          no: "①" },
  { key: "generalDefectScore",     label: "一般不具合発生状況", no: "②" },
  { key: "initialResponseScore",   label: "初期対応",           no: "③" },
  { key: "correctiveActionScore",  label: "処置の適正度",       no: "④" },
  { key: "analysisSpeedScore",     label: "調査報告スピード",   no: "⑤" },
  { key: "analysisQualityScore",   label: "調査報告の質",       no: "⑥" },
  { key: "customerHandlingScore",  label: "顧客応対",           no: "⑦" },
];

const SCORE_ITEM_LABELS = {
  productQualityScore:   "Product Quality",
  generalDefectScore:    "General Defect",
  initialResponseScore:  "Initial Response",
  correctiveActionScore: "Corrective Action",
  analysisSpeedScore:    "Analysis Speed",
  analysisQualityScore:  "Analysis Quality",
  customerHandlingScore: "Customer Handling",
};

/* ============================================================
   状態
   ============================================================ */
let state = {
  surveyId:      "",
  revision:      1,
  cases:         [],
  nextCaseNo:    1,
  editingCaseId: null,
};

/* ============================================================
   ユーティリティ
   ============================================================ */

/** タイムスタンプ形式のSurveyIDを生成する */
function generateSurveyId() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

/** トースト通知を表示する */
function showToast(msg, duration = 3000) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), duration);
}

/** 評価項目キーからスコア値（数値 or null）を取得する */
function getScore(key) {
  const sel = document.getElementById(`score_${key}`);
  if (!sel || !sel.value) return null;
  return parseFloat(sel.value);
}

/** ケース番号を2桁ゼロ埋め文字列に変換する */
function formatCaseId(no) {
  return String(no).padStart(2, "0");
}

/** HTML エスケープ */
function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ============================================================
   初期化
   ============================================================ */
function init() {
  state.surveyId = generateSurveyId();

  document.getElementById("surveyID").value   = state.surveyId;
  document.getElementById("surveyYear").value = FIXED.SURVEY_YEAR;
  document.getElementById("fiscalHalf").value = FIXED.FISCAL_HALF;
  document.getElementById("revision").value   = state.revision;

  renderEvalTable();

  document.getElementById("btn-revision-up").addEventListener("click", incrementRevision);
  document.getElementById("btn-case-save").addEventListener("click", saveCase);
  document.getElementById("btn-case-cancel").addEventListener("click", cancelEdit);
  document.getElementById("btn-validate").addEventListener("click", () => validate(true));
  document.getElementById("btn-generate-json").addEventListener("click", generateJSON);
  document.getElementById("btn-send").addEventListener("click", sendMail);
  document.getElementById("btn-copy-json").addEventListener("click", copyJSON);
  document.getElementById("btn-download-json").addEventListener("click", downloadJSON);
}

/* ============================================================
   総合評価テーブル
   ============================================================ */
function renderEvalTable() {
  const tbody = document.getElementById("eval-tbody");
  tbody.innerHTML = "";

  EVAL_ITEMS.forEach(item => {
    const tr = document.createElement("tr");
    tr.id = `eval-row-${item.key}`;

    const scoreOptions = SCORE_OPTIONS
      .map(v => `<option value="${v}">${v}</option>`)
      .join("");

    tr.innerHTML = `
      <td style="font-weight:700;text-align:center;">${item.no}</td>
      <td style="font-weight:600;">${item.label}</td>
      <td>
        <select id="score_${item.key}" class="score-select" aria-label="${item.label} スコア">
          <option value="">-- 選択 --</option>
          ${scoreOptions}
        </select>
        <div class="required-cases-note" id="scoreNote_${item.key}" style="display:none;">
          ※ 5以外の評価には根拠案件が必要です
        </div>
      </td>
      <td>
        <div class="case-tags" id="caseTags_${item.key}"></div>
      </td>
    `;
    tbody.appendChild(tr);

    document.getElementById(`score_${item.key}`).addEventListener("change", () => {
      updateScoreNote(item.key);
      refreshCaseTags();
    });
  });
}

/** スコア注記と行強調を更新する */
function updateScoreNote(key) {
  const score = getScore(key);
  const note  = document.getElementById(`scoreNote_${key}`);
  if (note) {
    note.style.display = (score !== null && score !== 5) ? "block" : "none";
  }
}

/** 評価テーブルの根拠案件タグを更新する */
function refreshCaseTags() {
  EVAL_ITEMS.forEach(item => {
    const tagsDiv = document.getElementById(`caseTags_${item.key}`);
    if (!tagsDiv) return;
    tagsDiv.innerHTML = "";
    state.cases
      .filter(c => c.relatedScoreItem === item.key)
      .forEach(c => {
        const tag = document.createElement("span");
        tag.className = "case-tag";
        tag.textContent = `CASE-${formatCaseId(c.id)}`;
        tagsDiv.appendChild(tag);
      });
  });
}

/* ============================================================
   案件管理
   ============================================================ */

/** 案件フォームをクリアする */
function clearCaseForm() {
  ["cf-relatedScoreItem", "cf-component", "cf-issueType"].forEach(id => {
    document.getElementById(id).value = "";
    document.getElementById(id).closest(".form-group").classList.remove("has-error");
  });
  ["cf-issue", "cf-impact", "cf-response", "cf-request"].forEach(id => {
    document.getElementById(id).value = "";
    document.getElementById(id).closest(".form-group").classList.remove("has-error");
  });
}

/** 案件フォームの入力値を取得する */
function getCaseFormData() {
  return {
    relatedScoreItem: document.getElementById("cf-relatedScoreItem").value,
    component:        document.getElementById("cf-component").value,
    issueType:        document.getElementById("cf-issueType").value,
    issue:            document.getElementById("cf-issue").value.trim(),
    impact:           document.getElementById("cf-impact").value.trim(),
    response:         document.getElementById("cf-response").value.trim(),
    request:          document.getElementById("cf-request").value.trim(),
  };
}

/** 案件フォームのバリデーションを行い、成否を返す */
function validateCaseForm(data) {
  let valid = true;
  const required = [
    { id: "cf-relatedScoreItem", value: data.relatedScoreItem },
    { id: "cf-component",        value: data.component },
    { id: "cf-issueType",        value: data.issueType },
    { id: "cf-issue",            value: data.issue },
    { id: "cf-impact",           value: data.impact },
    { id: "cf-response",         value: data.response },
  ];
  required.forEach(f => {
    const group = document.getElementById(f.id).closest(".form-group");
    if (!f.value) {
      group.classList.add("has-error");
      valid = false;
    } else {
      group.classList.remove("has-error");
    }
  });
  return valid;
}

/** 案件を追加または更新する */
function saveCase() {
  const data = getCaseFormData();
  if (!validateCaseForm(data)) {
    showToast("⚠ 必須項目を入力してください");
    return;
  }

  if (state.editingCaseId !== null) {
    const c = state.cases.find(x => x.id === state.editingCaseId);
    if (c) Object.assign(c, data);
    state.editingCaseId = null;
    document.getElementById("case-form-title").textContent = "新規案件登録";
    document.getElementById("btn-case-save").textContent   = "＋ 案件を追加";
    document.getElementById("btn-case-cancel").style.display = "none";
    showToast("案件を更新しました");
  } else {
    const caseNo = state.nextCaseNo++;
    state.cases.push({ id: caseNo, ...data });
    showToast(`CASE-${formatCaseId(caseNo)} を追加しました`);
  }

  clearCaseForm();
  renderCaseList();
  refreshCaseTags();
}

/** 案件を編集モードにする */
function editCase(id) {
  const c = state.cases.find(x => x.id === id);
  if (!c) return;
  state.editingCaseId = id;

  document.getElementById("cf-relatedScoreItem").value = c.relatedScoreItem;
  document.getElementById("cf-component").value        = c.component;
  document.getElementById("cf-issueType").value        = c.issueType;
  document.getElementById("cf-issue").value            = c.issue;
  document.getElementById("cf-impact").value           = c.impact;
  document.getElementById("cf-response").value         = c.response;
  document.getElementById("cf-request").value          = c.request;

  document.getElementById("case-form-title").textContent  = `CASE-${formatCaseId(c.id)} を編集`;
  document.getElementById("btn-case-save").textContent    = "💾 保存";
  document.getElementById("btn-case-cancel").style.display = "";

  document.querySelector(".case-form").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** 編集をキャンセルする */
function cancelEdit() {
  state.editingCaseId = null;
  clearCaseForm();
  document.getElementById("case-form-title").textContent  = "新規案件登録";
  document.getElementById("btn-case-save").textContent    = "＋ 案件を追加";
  document.getElementById("btn-case-cancel").style.display = "none";
}

/** 案件を削除する */
function removeCase(id) {
  if (!confirm("この案件を削除しますか？")) return;
  state.cases = state.cases.filter(c => c.id !== id);
  if (state.editingCaseId === id) cancelEdit();
  renderCaseList();
  refreshCaseTags();
  showToast("案件を削除しました");
}

/** 案件一覧を描画する */
function renderCaseList() {
  const container = document.getElementById("cases-list");

  if (state.cases.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:12px 0;">案件はまだ登録されていません。</p>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "case-list-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Case ID</th>
        <th>Related Score Item</th>
        <th>Component</th>
        <th>Issue Type</th>
        <th>Issue</th>
        <th>Impact</th>
        <th>Response</th>
        <th>Request</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  state.cases.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>CASE-${formatCaseId(c.id)}</strong></td>
      <td>${escHtml(SCORE_ITEM_LABELS[c.relatedScoreItem] || c.relatedScoreItem)}</td>
      <td>${escHtml(c.component)}</td>
      <td>${escHtml(c.issueType)}</td>
      <td class="cell-wrap">${escHtml(c.issue)}</td>
      <td class="cell-wrap">${escHtml(c.impact)}</td>
      <td class="cell-wrap">${escHtml(c.response)}</td>
      <td class="cell-wrap">${escHtml(c.request)}</td>
      <td class="cell-actions">
        <button class="btn btn-outline btn-sm" onclick="editCase(${c.id})">✏ 編集</button>
        <button class="btn btn-danger btn-sm" onclick="removeCase(${c.id})">✕ 削除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  container.innerHTML = "";
  container.appendChild(table);
}

/* ============================================================
   Revision
   ============================================================ */
function incrementRevision() {
  state.revision++;
  document.getElementById("revision").value = state.revision;
  showToast(`リビジョンを R${state.revision} に更新しました`);
}

/* ============================================================
   バリデーション
   ============================================================ */
function validate(showAlert = false) {
  const errors = [];

  // Service Center
  const sc = document.getElementById("serviceCenter").value;
  if (!sc) {
    errors.push("Service Center を選択してください。");
    document.getElementById("serviceCenter").closest(".form-group").classList.add("has-error");
  } else {
    document.getElementById("serviceCenter").closest(".form-group").classList.remove("has-error");
  }

  // Overall Evaluation（7項目すべて必須、5以外は根拠案件1件以上）
  EVAL_ITEMS.forEach(item => {
    const score = getScore(item.key);
    const row   = document.getElementById(`eval-row-${item.key}`);
    if (score === null) {
      errors.push(`${item.no}「${item.label}」のスコアを選択してください。`);
      if (row) row.classList.add("has-error-row");
    } else {
      if (row) row.classList.remove("has-error-row");
      if (score !== 5) {
        const linked = state.cases.filter(c => c.relatedScoreItem === item.key);
        if (linked.length === 0) {
          errors.push(
            `${item.no}「${item.label}」が${score}点のため、根拠案件を1件以上登録してください。`
          );
        }
      }
    }
  });

  // エラー表示
  const alertEl   = document.getElementById("validation-alert");
  const alertList = document.getElementById("validation-errors");
  if (errors.length > 0) {
    alertList.innerHTML = errors.map(e => `<li>${e}</li>`).join("");
    alertEl.classList.add("show");
    if (showAlert) alertEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    alertEl.classList.remove("show");
  }

  return errors.length === 0;
}

/* ============================================================
   JSON 生成
   ============================================================ */
function buildJSON() {
  const sc = document.getElementById("serviceCenter").value;

  const overallEvaluation = {};
  EVAL_ITEMS.forEach(item => {
    overallEvaluation[item.key] = getScore(item.key);
  });

  const cases = state.cases.map(c => {
    const obj = {
      caseId:           formatCaseId(c.id),
      relatedScoreItem: c.relatedScoreItem,
      component:        c.component,
      issueType:        c.issueType,
      issue:            c.issue,
      impact:           c.impact,
      response:         c.response,
    };
    if (c.request) obj.request = c.request;
    return obj;
  });

  return {
    serviceCenter:     sc,
    surveyYear:        FIXED.SURVEY_YEAR,
    fiscalHalf:        FIXED.FISCAL_HALF,
    surveyId:          state.surveyId,
    revision:          state.revision,
    overallEvaluation: overallEvaluation,
    cases:             cases,
  };
}

/** JSON を生成してプレビューエリアに表示する */
function generateJSON() {
  const data    = buildJSON();
  const jsonStr = JSON.stringify(data, null, 2);
  const wrapper = document.getElementById("json-preview-wrapper");
  document.getElementById("json-preview").value = jsonStr;
  wrapper.style.display = "";
  wrapper.scrollIntoView({ behavior: "smooth", block: "nearest" });
  showToast("JSON を生成しました");
}

/** JSON をクリップボードにコピーする */
function copyJSON() {
  const text = document.getElementById("json-preview").value;
  if (!text) { showToast("先に JSON を生成してください"); return; }
  navigator.clipboard.writeText(text).then(() => {
    showToast("クリップボードにコピーしました");
  }).catch(() => {
    showToast("コピーに失敗しました");
  });
}

/** JSON をファイルとしてダウンロードする */
function downloadJSON() {
  const text = document.getElementById("json-preview").value;
  if (!text) { showToast("先に JSON を生成してください"); return; }
  const blob = new Blob([text], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `nc-csat_${state.surveyId.replace(/[^0-9A-Za-z\-]/g, "_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("JSON をダウンロードしました");
}

/* ============================================================
   送信（mailto）
   ============================================================ */
function sendMail() {
  if (!validate(true)) return;

  const data     = buildJSON();
  const subject  = `[NC-CSAT] ${state.surveyId} ${data.serviceCenter}`;
  const bodyText = JSON.stringify(data, null, 2);

  const mailto =
    `mailto:${FIXED.MAIL_TO}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(bodyText)}`;

  if (mailto.length > FIXED.MAILTO_MAX_LEN) {
    showToast("⚠️ データが大きいため、JSON をダウンロードしてメール添付をご検討ください", 6000);
    generateJSON();
    return;
  }

  window.location.href = mailto;
  showToast("📧 メーラーを起動しています…");
}

/* ============================================================
   エントリーポイント
   ============================================================ */
document.addEventListener("DOMContentLoaded", init);
