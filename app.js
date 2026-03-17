/**
 * 顧客満足度入力Webアプリ — app.js
 * =====================================================
 * 機能:
 *  - SurveyID の自動生成（YYYYMMDD-HHMMSS）
 *  - 総合評価スコアの入力と連動バリデーション
 *  - 案件（ケース）の追加・削除
 *  - 入力整合性チェック
 *  - JSON 生成とメール作成（mailto）
 */

"use strict";

/* ============================================================
   定数
   ============================================================ */
const FIXED = {
  SURVEY_YEAR:   2025,
  FISCAL_HALF:   "2H",
  MAIL_TO:       "nc-csat@xxxxx.co.jp",
};

const EVAL_ITEMS = [
  "製品品質",
  "顧客応対",
  "技術サポート",
  "納期対応",
  "提案力",
  "価格対応",
  "総合満足度",
];

/* ============================================================
   状態
   ============================================================ */
let state = {
  surveyID: "",
  revision: 1,
  cases: [],           // [{ id, impact, response, request, comment }]
  nextCaseNo: 1,
};

/* ============================================================
   ユーティリティ
   ============================================================ */

/** タイムスタンプ形式のSurveyIDを生成する */
function generateSurveyID() {
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

/** スコア要素(name="scoreN")からスコア値(int|null)を取得する */
function getScore(index) {
  const checked = document.querySelector(
    `input[name="score${index}"]:checked`
  );
  return checked ? parseInt(checked.value, 10) : null;
}

/** 評価項目行に紐づくケースIDリストを返す */
function getLinkedCaseIDs(evalIndex) {
  return state.cases
    .filter(c => {
      const cb = document.getElementById(
        `link_case${c.id}_eval${evalIndex}`
      );
      return cb && cb.checked;
    })
    .map(c => `CASE-${String(c.id).padStart(3, "0")}`);
}

/* ============================================================
   初期化
   ============================================================ */
function init() {
  state.surveyID = generateSurveyID();

  // 固定値をDOMへ反映
  document.getElementById("surveyID").value    = state.surveyID;
  document.getElementById("surveyYear").value  = FIXED.SURVEY_YEAR;
  document.getElementById("fiscalHalf").value  = FIXED.FISCAL_HALF;
  document.getElementById("revision").value    = state.revision;

  // 総合評価テーブルを描画
  renderEvalTable();

  // イベント登録
  document.getElementById("btn-add-case").addEventListener("click", addCase);
  document.getElementById("btn-validate").addEventListener("click", () => validate(true));
  document.getElementById("btn-send").addEventListener("click", sendMail);
  document.getElementById("btn-revision-up").addEventListener("click", incrementRevision);
}

/* ============================================================
   総合評価テーブル
   ============================================================ */
function renderEvalTable() {
  const tbody = document.getElementById("eval-tbody");
  tbody.innerHTML = "";

  EVAL_ITEMS.forEach((item, i) => {
    const tr = document.createElement("tr");
    tr.dataset.evalIndex = i;

    // スコアラジオボタン
    const scoreHTML = [1, 2, 3, 4, 5]
      .map(
        v => `
        <input type="radio" id="score${i}_${v}" name="score${i}" value="${v}">
        <label for="score${i}_${v}" data-score="${v}">${v}</label>`
      )
      .join("");

    tr.innerHTML = `
      <td style="font-weight:600">${item}</td>
      <td>
        <div class="score-group" id="scoreGroup${i}">${scoreHTML}</div>
        <div class="required-cases-note" id="scoreNote${i}" style="display:none">
          ※ 5以外の評価には根拠案件が必要です
        </div>
      </td>
      <td>
        <div class="case-tags" id="caseTags${i}"></div>
      </td>
    `;
    tbody.appendChild(tr);

    // スコア変更でノートを更新
    tr.querySelectorAll(`input[name="score${i}"]`).forEach(radio => {
      radio.addEventListener("change", () => updateScoreNote(i));
    });
  });
}

/** スコアの注記と行の強調を更新 */
function updateScoreNote(index) {
  const score = getScore(index);
  const note  = document.getElementById(`scoreNote${index}`);
  if (score !== null && score !== 5) {
    note.style.display = "block";
  } else {
    note.style.display = "none";
  }
}

/* ============================================================
   ケース管理
   ============================================================ */
function addCase() {
  const id = state.nextCaseNo++;
  state.cases.push({ id, impact: "", response: "", request: "", comment: "" });
  renderCases();
  // 新規追加したカードまでスクロール
  const card = document.getElementById(`case-card-${id}`);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  showToast(`案件 CASE-${String(id).padStart(3, "0")} を追加しました`);
}

function removeCase(id) {
  state.cases = state.cases.filter(c => c.id !== id);
  renderCases();
  refreshCaseTags();
  showToast("案件を削除しました");
}

function renderCases() {
  const container = document.getElementById("cases-list");
  container.innerHTML = "";

  if (state.cases.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);font-size:13px;">案件はまだ登録されていません。</p>`;
    refreshEvalTableCaseColumns();
    return;
  }

  state.cases.forEach(c => {
    const caseLabel = `CASE-${String(c.id).padStart(3, "0")}`;
    const div = document.createElement("div");
    div.className = "case-card";
    div.id = `case-card-${c.id}`;

    // 評価項目チェックボックス
    const linkCheckboxes = EVAL_ITEMS.map(
      (item, i) => `
        <label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:12px;cursor:pointer;">
          <input type="checkbox" id="link_case${c.id}_eval${i}"
            onchange="refreshCaseTags()">
          ${item}
        </label>`
    ).join("");

    div.innerHTML = `
      <div class="case-card-header">
        <span>${caseLabel}</span>
        <button class="btn btn-danger" onclick="removeCase(${c.id})">✕ 削除</button>
      </div>
      <div class="case-card-body">
        <div class="form-group full-width">
          <label>紐づける評価項目</label>
          <div style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 0;">
            ${linkCheckboxes}
          </div>
        </div>
        <div class="form-group">
          <label>影響（Impact）</label>
          <textarea id="case_impact_${c.id}" rows="3"
            placeholder="発生した問題や顧客への影響を記入"
            oninput="updateCaseField(${c.id},'impact',this.value)">${c.impact}</textarea>
        </div>
        <div class="form-group">
          <label>対応（Response）</label>
          <textarea id="case_response_${c.id}" rows="3"
            placeholder="実施した対応内容を記入"
            oninput="updateCaseField(${c.id},'response',this.value)">${c.response}</textarea>
        </div>
        <div class="form-group">
          <label>要望（Request）</label>
          <textarea id="case_request_${c.id}" rows="3"
            placeholder="顧客からの要望・改善依頼を記入"
            oninput="updateCaseField(${c.id},'request',this.value)">${c.request}</textarea>
        </div>
        <div class="form-group">
          <label>コメント（Comment）</label>
          <textarea id="case_comment_${c.id}" rows="3"
            placeholder="その他コメント"
            oninput="updateCaseField(${c.id},'comment',this.value)">${c.comment}</textarea>
        </div>
      </div>
    `;
    container.appendChild(div);
  });

  refreshEvalTableCaseColumns();
}

/** ケースデータを更新 */
function updateCaseField(id, field, value) {
  const c = state.cases.find(x => x.id === id);
  if (c) c[field] = value;
}

/** 評価テーブルのケースタグ列を更新 */
function refreshEvalTableCaseColumns() {
  EVAL_ITEMS.forEach((_, i) => {
    const tagsDiv = document.getElementById(`caseTags${i}`);
    if (!tagsDiv) return;
    tagsDiv.innerHTML = "";
    state.cases.forEach(c => {
      const cb = document.getElementById(`link_case${c.id}_eval${i}`);
      if (cb && cb.checked) {
        const tag = document.createElement("span");
        tag.className = "case-tag";
        tag.textContent = `CASE-${String(c.id).padStart(3, "0")}`;
        tagsDiv.appendChild(tag);
      }
    });
  });
}

/** チェックボックス変更時にタグを更新 */
function refreshCaseTags() {
  refreshEvalTableCaseColumns();
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

  // サービスセンター
  const sc = document.getElementById("serviceCenter").value.trim();
  if (!sc) {
    errors.push("サービスセンターを入力してください。");
    setError("serviceCenter", true);
  } else {
    setError("serviceCenter", false);
  }

  // 各評価項目
  EVAL_ITEMS.forEach((item, i) => {
    const score = getScore(i);
    if (score === null) {
      errors.push(`「${item}」のスコアを選択してください。`);
      document
        .getElementById(`scoreGroup${i}`)
        .closest("tr")
        .classList.add("has-error-row");
    } else {
      document
        .getElementById(`scoreGroup${i}`)
        .closest("tr")
        .classList.remove("has-error-row");

      // 5以外 → 根拠案件必須
      if (score !== 5) {
        const linked = getLinkedCaseIDs(i);
        if (linked.length === 0) {
          errors.push(
            `「${item}」はスコアが${score}点のため、根拠案件を1件以上紐づけてください。`
          );
        }
      }
    }
  });

  // ケースフィールド必須チェック
  state.cases.forEach(c => {
    const caseLabel = `CASE-${String(c.id).padStart(3, "0")}`;
    if (!c.impact.trim())   errors.push(`${caseLabel}: 影響（Impact）を入力してください。`);
    if (!c.response.trim()) errors.push(`${caseLabel}: 対応（Response）を入力してください。`);
    if (!c.request.trim())  errors.push(`${caseLabel}: 要望（Request）を入力してください。`);
  });

  // エラー表示
  const alertEl = document.getElementById("validation-alert");
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

/** フォームグループのエラー状態を設定 */
function setError(inputId, hasError) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const group = el.closest(".form-group");
  if (!group) return;
  if (hasError) group.classList.add("has-error");
  else          group.classList.remove("has-error");
}

/* ============================================================
   JSON 生成
   ============================================================ */
function buildJSON() {
  const sc = document.getElementById("serviceCenter").value.trim();

  const overallEvaluation = EVAL_ITEMS.map((item, i) => ({
    Item:    item,
    Score:   getScore(i),
    CaseIDs: getLinkedCaseIDs(i),
  }));

  const cases = state.cases.map(c => ({
    CaseID:   `CASE-${String(c.id).padStart(3, "0")}`,
    Impact:   c.impact.trim(),
    Response: c.response.trim(),
    Request:  c.request.trim(),
    Comment:  c.comment.trim(),
  }));

  return {
    SurveyID:          state.surveyID,
    SurveyYear:        FIXED.SURVEY_YEAR,
    FiscalHalf:        FIXED.FISCAL_HALF,
    ServiceCenter:     sc,
    Revision:          state.revision,
    OverallEvaluation: overallEvaluation,
    Cases:             cases,
  };
}

/* ============================================================
   送信（mailto）
   ============================================================ */
function sendMail() {
  if (!validate(true)) return;

  const data = buildJSON();
  const sc   = data.ServiceCenter;

  const subject  = `[NC-CSAT] ${state.surveyID} ${sc}`;
  const bodyText = JSON.stringify(data, null, 2);

  const mailto =
    `mailto:${FIXED.MAIL_TO}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(bodyText)}`;

  // mailto には URI 長制限があるため警告
  if (mailto.length > 8000) {
    showToast("⚠️ データが大きいため、メーラーによっては送信できない場合があります", 5000);
  }

  window.location.href = mailto;
  showToast("📧 メーラーを起動しています…");
}

/* ============================================================
   エントリーポイント
   ============================================================ */
document.addEventListener("DOMContentLoaded", init);
