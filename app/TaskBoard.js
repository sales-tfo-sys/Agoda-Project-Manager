"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Modal from "./Modal";
import Calendar from "./Calendar";

const TYPE_CODE = "ドロップダウン_13"; // 案件名（空欄は Hotel依頼）
const STAGE_CODE = "ドロップダウン"; // Stage（ステータス）
// IHM の Ad Hoc タスクは、シートではなく Kintone から集計する。
//   案件名(ドロップダウン_13)="IHM" ＋ 作業区分(ドロップダウン_8)=Room/Plan/CM
const WORK_TYPE_CODE = "ドロップダウン_8"; // ★作業区分（IHM用）
const IHM_SUBTASKS = { IHM_Room: "Room", IHM_Plan: "Plan", IHM_CM: "CM" };
const TYPE_ORDER = ["Hotel", "ACQ", "Liberty", "Temairazu", "IHM"];
const EMPTY_IDS = []; // 参照を固定（未アサイン時の再レンダリング抑止）
const EMPTY_OV = {};

// Ad Hoc Task 表の列幅（px）。内容で自動調整させるとタブ切替のたびに幅がぶれるため固定する。
// 順: 優先/タスク/開始/期日/受注数/完了数/残件数/進捗率/進捗/目標対応件数/実作業工数/
//     課題・遅延理由/次回アクション/対応人数/対応者　※メモ列は幅を指定せず余りを全て使う
const ADHOC_COLS = [46, 324, 106, 106, 70, 70, 70, 62, 96, 92, 88, 160, 148, 66, 110];
const ADHOC_MEMO_MIN = 170;
const ADHOC_W = ADHOC_COLS.reduce((a, b) => a + b, 0) + ADHOC_MEMO_MIN;

// 進捗フラグ（Regular Task / Ad Hoc Task 共通）
const STATUS_OPTIONS = ["On Track", "Behind", "Onhold", "Complete"];
function statusClass(st) {
  if (st === "Complete") return "st-done";
  if (st === "Onhold") return "st-hold";
  if (st === "Behind") return "st-behind";
  if (!st) return "st-none";
  return "st-ontrack";
}

// 日付は表示・保存とも "YYYY/MM/DD"、<input type="date"> は "YYYY-MM-DD" を要求するため相互変換する
function toDateInput(v) {
  if (!v) return "";
  const m = String(v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m
    ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`
    : "";
}
function fromDateInput(v) {
  const m = String(v || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : "";
}

// 数値は3桁区切り（1,000）で表示。数値に見えないものはそのまま返す（"98%" "1h 100件" 等）
function num(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("ja-JP") : "—";
  const n = Number(String(v).replace(/,/g, "").trim());
  return String(v).trim() !== "" && Number.isFinite(n) ? n.toLocaleString("ja-JP") : v;
}

function caseType(r) {
  const v = r?.[TYPE_CODE]?.value;
  return v && String(v).trim() ? String(v).trim() : "Hotel";
}

function statusCategory(stage) {
  if (!stage) return "進行中";
  if (stage.includes("完了") || stage.includes("販売開始")) return "完了";
  if (stage.includes("失注")) return "失注";
  if (stage.includes("対応不要")) return "対応不要";
  return "進行中";
}

const CAT_COLOR = {
  進行中: "var(--accent)",
  完了: "var(--ok)",
  失注: "var(--ink-3)",
  対応不要: "var(--border2)",
};
// 案件タイプごとの識別色（カードを一目で見分けるため）
const TYPE_ACCENT = {
  Hotel: "#2563c4",
  ACQ: "#1e8e4e",
  Liberty: "#b5790f",
  Temairazu: "#7c5cd6",
  IHM: "#c04a6a",
};
const ACCENT_FALLBACK = "#5a6b85";
const CAT_RANK = { 進行中: 0, 完了: 1, 失注: 2, 対応不要: 3 };
const DATE_TYPES = ["DATE", "DATETIME", "CREATED_TIME", "UPDATED_TIME"];

// 案件タイプ → Stage選択肢のどのグループを正式ステータス一覧として使うか
const TYPE_GROUP = {
  "Hotel": "A",
  Temairazu: "A",
  ACQ: "B",
  Liberty: "B",
  IHM: "B",
};

// 日付フィールドの値 → { year, q }（振り分け不能は null）
function parseQuarter(field) {
  if (!field || !field.value) return null;
  const v = String(field.value);
  let y;
  let m;
  if (v.includes("T")) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    y = d.getFullYear();
    m = d.getMonth() + 1;
  } else {
    const mm = v.match(/^(\d{4})-(\d{2})/);
    if (!mm) return null;
    y = Number(mm[1]);
    m = Number(mm[2]);
  }
  return { year: y, q: Math.floor((m - 1) / 3) + 1 };
}

// サマリーのステータス内訳列（シートの関数から確認したマッピング）
const STATUS_COLS = [
  "YCS作成",
  "CM情報待ち",
  "CM接続申請",
  "CM設定CN",
  "CM設定施設",
  "agoda確認",
  "販売待ち",
];
// 各グループで有効な列（それ以外は「—」表示）
const STATUS_APPLICABLE = {
  A: new Set(["YCS作成", "CM情報待ち", "CM設定施設", "agoda確認", "販売待ち"]),
  B: new Set(["YCS作成", "CM情報待ち", "CM接続申請", "CM設定CN"]),
};
// ステージ → 内訳列（グループ依存）
function statusColumn(stage, group) {
  if (!stage) return null;
  if (group === "B") {
    if (stage === "YCS作成中") return "YCS作成";
    if (stage === "CM情報待ち") return "CM情報待ち";
    if (stage === "CM接続申請") return "CM接続申請";
    if (stage === "CM設定中") return "CM設定CN";
    return null;
  }
  // グループA（Hotel / Temairazu）
  if (stage.startsWith("2-1") || stage.startsWith("2-2")) return "YCS作成";
  if (stage.startsWith("3-1")) return "CM情報待ち";
  if (stage.startsWith("3-2")) return "CM設定施設"; // 3-2.接続待ち（式AO10で確認）
  if (stage.includes("agoda")) return "agoda確認";
  if (stage.startsWith("6")) return "販売待ち"; // 6-1/6-3 の販売前段階
  return null;
}

// 指定年のタスク別サマリーを集計（受注数=総件数−事前登録−失注−対応不要）
function buildSummary(records, dateCode, y) {
  const by = {};
  for (const r of records) {
    const pq = parseQuarter(r?.[dateCode]);
    if (!pq || pq.year !== y) continue;
    const t = caseType(r);
    const group = TYPE_GROUP[t];
    const stage = r?.[STAGE_CODE]?.value || "";
    if (!by[t])
      by[t] = {
        total: 0,
        pre: 0,
        lost: 0,
        na: 0,
        done: 0,
        handlers: new Set(),
        cols: {},
        group,
      };
    const e = by[t];
    e.total += 1;
    if (stage.includes("事前登録")) e.pre += 1;
    else if (stage.includes("失注")) e.lost += 1;
    else if (stage.includes("対応不要")) e.na += 1;
    const doneStage = group === "A" ? "7.販売開始確認（完了）" : "完了";
    if (stage === doneStage) e.done += 1;
    const col = statusColumn(stage, group);
    if (col) e.cols[col] = (e.cols[col] || 0) + 1;
    const h = r?.["ドロップダウン_3"]?.value; // 対応者
    if (h && String(h).trim()) e.handlers.add(String(h).trim());
  }

  // DSA は Hotel依頼の全受注に対するサブ作業。受注数=Hotel受注数、完了=DSAフィールド(ドロップダウン_11)が「完了」
  const dsa = {
    total: 0,
    pre: 0,
    lost: 0,
    na: 0,
    done: 0,
    handlers: new Set(),
    cols: {},
    group: null,
  };
  for (const r of records) {
    const pq = parseQuarter(r?.[dateCode]);
    if (!pq || pq.year !== y) continue;
    if (caseType(r) !== "Hotel") continue;
    const stage = r?.[STAGE_CODE]?.value || "";
    dsa.total += 1;
    if (stage.includes("事前登録")) dsa.pre += 1;
    else if (stage.includes("失注")) dsa.lost += 1;
    else if (stage.includes("対応不要")) dsa.na += 1;
    if (r?.["ドロップダウン_11"]?.value === "完了") dsa.done += 1;
    const h = r?.["ドロップダウン_3"]?.value;
    if (h && String(h).trim()) dsa.handlers.add(String(h).trim());
  }
  by["DSA"] = dsa;

  return by;
}

function fieldYear(field) {
  const pq = parseQuarter(field);
  return pq ? pq.year : null;
}

// 前年からの繰り越し（Pending）を集計：作成がy年で、完了到達がy+1年 or まだ対応中
function buildPending(records, y) {
  const by = {};
  for (const r of records) {
    const t = caseType(r);
    const group = TYPE_GROUP[t];
    if (fieldYear(r?.["作成日時"]) !== y) continue;
    const stage = r?.[STAGE_CODE]?.value || "";
    const doneStage = group === "A" ? "7.販売開始確認（完了）" : "完了";
    const isDone = stage === doneStage;
    const changeY = fieldYear(r?.["日付"]); // ★Stage変更日
    let done = false;
    let open = false;
    if (isDone) {
      if (changeY && changeY >= y + 1) done = true; // 翌年に完了＝繰り越し
    } else if (
      !stage.includes("事前登録") &&
      !stage.includes("失注") &&
      !stage.includes("対応不要")
    ) {
      open = true; // まだ対応中
    }
    if (!done && !open) continue;
    if (!by[t])
      by[t] = { total: 0, pre: 0, lost: 0, na: 0, done: 0, handlers: new Set(), cols: {}, group };
    const e = by[t];
    e.total += 1;
    if (done) e.done += 1;
    if (open) {
      const col = statusColumn(stage, group);
      if (col) e.cols[col] = (e.cols[col] || 0) + 1;
    }
    const h = r?.["ドロップダウン_3"]?.value;
    if (h && String(h).trim()) e.handlers.add(String(h).trim());
  }

  // ※ DSA の繰り越しは「DSA完了日」が必要だが Kintone に無いため Pending では集計不可（除外）
  return by;
}

// 作業ごとの担当アサイン（複数人・先頭が主担当）。セルをクリックで選択パネルを開く。
function AssignCell({ scope, akey, ids, persons, setAssign }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // 表は横スクロールするため position:fixed で出す
  const ref = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null); // パネルは body 直下に出すので別で持つ
  const openPanel = () => {
    if (open) return setOpen(false);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const H = 220; // パネル概算高さ（下に入らなければ上に出す）
      setPos({
        left: Math.min(r.left, window.innerWidth - 176),
        top: r.bottom + H > window.innerHeight ? r.top - H - 4 : r.bottom + 4,
      });
    }
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);
  const nameOf = (id) => persons.find((p) => p.id === id)?.name || "?";
  const toggle = (id) =>
    setAssign(scope, akey, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  // 表のセル内に置くと他の行に隠れる／はみ出しが切られるため、body 直下に描画する
  const panel = (
    <div
      className="asg-pop"
      ref={popRef}
      style={pos ? { top: pos.top, left: pos.left } : undefined}
    >
      <div className="asg-pop-h">担当者</div>
      {persons.length === 0 ? (
        <div className="asg-none">担当者が未登録です</div>
      ) : (
        persons.map((p) => (
          <label key={p.id} className="asg-item">
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={() => toggle(p.id)}
            />
            <span>{p.name}</span>
          </label>
        ))
      )}
      {ids.length > 0 && (
        <button
          type="button"
          className="asg-clear"
          onClick={() => setAssign(scope, akey, [])}
        >
          すべて解除
        </button>
      )}
    </div>
  );

  return (
    <div className="asg" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className={"asg-btn" + (ids.length ? "" : " empty")}
        onClick={openPanel}
        title={ids.length ? `担当：${ids.map(nameOf).join("、")}` : "担当者を設定"}
      >
        {ids.length ? (
          ids.map((id, i) => (
            <span key={id} className={"asg-chip" + (i === 0 ? " main" : "")}>
              {nameOf(id)}
            </span>
          ))
        ) : (
          <span className="asg-plus">＋</span>
        )}
      </button>
      {open && typeof document !== "undefined" && createPortal(panel, document.body)}
    </div>
  );
}

// 工数明細のどの作業内容に対応するかを選ぶ。
// Ad Hoc では 1タスクが Tier 等に分割されている一方、工数明細では1行にまとめている場合があるため、
// 複数のタスクに同じ作業内容を指定すると、それらが工数明細の1行に集約される。
function KosuLinkCell({ value, contents, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const toggle = () => {
    if (open) return setOpen(false);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const H = 300;
      setPos({
        left: Math.min(r.left, window.innerWidth - 320),
        top: r.bottom + H > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4,
      });
    }
    setQ("");
    setOpen(true);
  };
  const hit = q.trim()
    ? contents.filter((c) => c.detail.toLowerCase().includes(q.trim().toLowerCase()))
    : contents;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={"klink-btn" + (value ? " on" : "")}
        onClick={toggle}
        title={value ? `工数明細：${value}` : "工数明細の作業内容に紐づける"}
        aria-label="工数明細との紐づけ"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </svg>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="klink-pop"
            ref={popRef}
            style={pos ? { top: pos.top, left: pos.left } : undefined}
          >
            <div className="klink-h">工数明細の作業内容</div>
            <input
              className="klink-q"
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="絞り込み"
              autoFocus
            />
            <button
              type="button"
              className={"klink-item" + (!value ? " sel" : "")}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              紐づけない
            </button>
            {hit.length === 0 && <div className="klink-none">該当なし</div>}
            {hit.map((c) => (
              <button
                key={c.type + "|" + c.detail}
                type="button"
                className={"klink-item" + (c.detail === value ? " sel" : "")}
                onClick={() => {
                  onChange(c.detail);
                  setOpen(false);
                }}
                title={`${c.type} / ${c.detail}`}
              >
                {c.detail}
                <small>{c.type}</small>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// 表ごとの編集トグル
function EditToggle({ on, onToggle }) {
  return (
    <button
      type="button"
      className={"edit-btn" + (on ? " on" : "")}
      onClick={onToggle}
      title={on ? "編集を終了" : "この表を編集"}
      aria-pressed={on}
    >
      {on ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          完了
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          編集
        </>
      )}
    </button>
  );
}

function SummaryTable({
  title,
  data,
  types,
  countLabel = "受注数",
  rateLabel = "完了率",
  prioOf,
  setPriority,
  scope = "regular",
  assignOf,
  setAssign,
  persons = [],
  ovOf,
  setOvField,
  edit = false,
  onToggleEdit,
}) {
  const ordered = prioOf
    ? [...types].sort((a, b) => {
        const pa = prioOf(scope, a, null);
        const pb = prioOf(scope, b, null);
        if (pa == null && pb == null) return types.indexOf(a) - types.indexOf(b);
        if (pa == null) return 1;
        if (pb == null) return -1;
        return pa - pb || types.indexOf(a) - types.indexOf(b);
      })
    : types;
  const nameOf = (id) => persons.find((p) => p.id === id)?.name || "?";
  return (
    <div className="summary-block">
      <div className="sec-row">
        <div className="sec-head">{title}</div>
        {onToggleEdit && <EditToggle on={edit} onToggle={onToggleEdit} />}
      </div>
      <div className="qcard summary-card">
        <div className="tw2">
        <table className="qtable summary-table">
          <thead>
            <tr>
              {setPriority && <th className="prio-th">優先</th>}
              <th className="l">タスク</th>
              <th>{countLabel}</th>
              <th>完了数</th>
              <th>対応中</th>
              <th className="st-th">進捗</th>
              <th>{rateLabel}</th>
              <th>対応人数</th>
              <th className="l asg-th">対応者</th>
              {STATUS_COLS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((t) => {
              const s = data[t] || {
                total: 0,
                pre: 0,
                lost: 0,
                na: 0,
                done: 0,
                handlers: new Set(),
                cols: {},
                group: null,
              };
              const juchu = s.total - s.pre - s.lost - s.na;
              const taio = juchu - s.done;
              const rate = juchu > 0 ? Math.round((s.done / juchu) * 100) : 0;
              const applic = s.group ? STATUS_APPLICABLE[s.group] : null;
              const o = ovOf ? ovOf(scope, t) : {};
              // 対応者：担当者マスタから選択済みならそれを優先、未設定なら Kintone の実績
              const ids = assignOf ? assignOf(scope, t) : [];
              const handlers = ids.length ? ids.map(nameOf) : Array.from(s.handlers);
              return (
                <tr key={t}>
                  {setPriority && (
                    <td className="prio-td">
                      {edit ? (
                        <input
                          className="prio-input"
                          type="number"
                          min="1"
                          value={prioOf(scope, t, "") ?? ""}
                          onChange={(e) => setPriority(scope, t, e.target.value)}
                          aria-label={`${t} の作業優先順`}
                        />
                      ) : (
                        <span className="prio-view">{prioOf(scope, t, "") ?? "—"}</span>
                      )}
                    </td>
                  )}
                  <td className="l">
                    {edit ? (
                      <input
                        className="ed-input"
                        type="text"
                        value={o.name ?? t}
                        onChange={(e) => setOvField(scope, t, "name", e.target.value)}
                        aria-label={`${t} のタスク名`}
                      />
                    ) : (
                      o.name || t
                    )}
                  </td>
                  <td className="v-strong">{num(juchu)}</td>
                  <td>{num(s.done)}</td>
                  <td>{num(taio)}</td>
                  {/* 進捗フラグ（画面で設定する値。集計値ではない） */}
                  <td className="st-td">
                    {edit && setOvField ? (
                      <select
                        className="ed-input ed-sel"
                        value={o.status || ""}
                        onChange={(e) => setOvField(scope, t, "status", e.target.value)}
                        aria-label={`${t} の進捗`}
                      >
                        <option value="">—</option>
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={"st-pill " + statusClass(o.status)}>{o.status || "—"}</span>
                    )}
                  </td>
                  <td className="c-rate">
                    <span className="prog-val">{rate}%</span>
                  </td>
                  {/* 対応人数：対応者の選択人数を自動反映 */}
                  <td className={ids.length ? "v-auto" : ""} title={ids.length ? "対応者の選択人数" : undefined}>
                    {handlers.length}
                  </td>
                  <td className="l asg-td">
                    {edit && setAssign ? (
                      <AssignCell
                        scope={scope}
                        akey={t}
                        ids={ids}
                        persons={persons}
                        setAssign={setAssign}
                      />
                    ) : handlers.length ? (
                      handlers.join("、")
                    ) : (
                      "—"
                    )}
                  </td>
                  {STATUS_COLS.map((c) => (
                    <td key={c} className={applic && applic.has(c) ? "" : "z"}>
                      {applic && applic.has(c) ? num(s.cols?.[c] || 0) : "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function TaskBoard({ mode = "view" }) {
  // mode: "view" = 閲覧専用（ダッシュボード）／ "edit" = 常時編集（プロジェクト管理）
  const isEdit = mode === "edit";
  const [records, setRecords] = useState(null);
  const [fields, setFields] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [dateCode, setDateCode] = useState("作成日時");
  const [year, setYear] = useState(null);

  // Kintone → Supabase の手動同期。完了後に画面を再読み込みする。
  const [syncing, setSyncing] = useState(false);
  const syncKintone = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/kintone-sync", { method: "POST" }).then((r) => r.json());
      if (res.error) setError(res.error);
      else await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSyncing(false);
    }
    // load は下で定義（同一レンダー内の関数参照なので依存に入れない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, ares] = await Promise.all([
        fetch("/api/records", { cache: "no-store" }),
        fetch("/api/adhoc", { cache: "no-store" }).catch(() => null),
      ]);
      try {
        const aj = ares ? await ares.json() : null;
        setAdhoc(aj && !aj.error ? aj.tasks || [] : []);
      } catch {
        setAdhoc([]);
      }
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setRecords(json.records || []);
        setFields(json.fields || {});
        // 表示は「Kintone を取り込んだ時刻」（保存済みなら fetchedAt）
        setUpdatedAt(json.fetchedAt ? new Date(json.fetchedAt) : new Date());
      }
      // Ad Hoc のシート連携（受注数・完了数）も取得。更新のたびに最新化する。
      fetch("/api/adhoc-counts", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setSheetCounts(j.items || {}))
        .catch(() => {});
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 全体KPI（全期間）
  const kpi = useMemo(() => {
    if (!records) return null;
    let done = 0;
    let progress = 0;
    let lost = 0;
    let na = 0;
    for (const r of records) {
      const c = statusCategory(r?.[STAGE_CODE]?.value);
      if (c === "完了") done += 1;
      else if (c === "進行中") progress += 1;
      else if (c === "失注") lost += 1;
      else na += 1;
    }
    const total = records.length;
    const active = total - lost - na;
    return {
      total,
      done,
      progress,
      lost,
      na,
      rate: active > 0 ? Math.round((done / active) * 100) : 0,
    };
  }, [records]);

  // 基準日に使える日付フィールド一覧
  const dateOptions = useMemo(() => {
    if (!fields) return [];
    return Object.entries(fields)
      .filter(([, f]) => DATE_TYPES.includes(f?.type))
      .map(([code, f]) => ({ code, label: f.label || code }));
  }, [fields]);

  // 選択中の基準日に存在する年（降順）
  const years = useMemo(() => {
    if (!records) return [];
    const set = new Set();
    for (const r of records) {
      const pq = parseQuarter(r?.[dateCode]);
      if (pq) set.add(pq.year);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [records, dateCode]);

  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [years, year]);

  // 年×案件タイプ×ステータス×四半期 の集計
  const yearAgg = useMemo(() => {
    if (!records || year == null) return null;
    const byType = {};
    let noDate = 0;
    for (const r of records) {
      const pq = parseQuarter(r?.[dateCode]);
      if (!pq) {
        noDate += 1;
        continue;
      }
      if (pq.year !== year) continue;
      const t = caseType(r);
      const stage = r?.[STAGE_CODE]?.value || "(未設定)";
      if (!byType[t]) byType[t] = { stages: {}, cols: [0, 0, 0, 0], total: 0 };
      const e = byType[t];
      if (!e.stages[stage]) e.stages[stage] = { q: [0, 0, 0, 0], total: 0 };
      e.stages[stage].q[pq.q - 1] += 1;
      e.stages[stage].total += 1;
      e.cols[pq.q - 1] += 1;
      e.total += 1;
    }
    return { byType, noDate };
  }, [records, dateCode, year]);

  // 各案件タイプが使う全ステータス（全期間の実績。マスター一覧の補完用）
  const usedAll = useMemo(() => {
    const m = {};
    if (records)
      for (const r of records) {
        const t = caseType(r);
        const s = r?.[STAGE_CODE]?.value || "(未設定)";
        (m[t] = m[t] || new Set()).add(s);
      }
    return m;
  }, [records]);

  // Stage選択肢を区切りでグループ分け（A: Hotel・Temairazu / B: ACQ・Liberty・IHM）
  const stageGroups = useMemo(() => {
    const f = fields?.[STAGE_CODE];
    const A = [];
    const B = [];
    if (f?.options) {
      const opts = Object.values(f.options)
        .sort((a, b) => Number(a.index) - Number(b.index))
        .map((o) => o.label);
      let cur = null;
      for (const label of opts) {
        if (label.trimStart().startsWith("--")) {
          cur = label.includes("Hotel") ? "A" : label.includes("ACQ") ? "B" : null;
          continue;
        }
        if (cur === "A") A.push(label);
        else if (cur === "B") B.push(label);
      }
    }
    return { A, B };
  }, [fields]);

  // 案件タイプの正式ステータス一覧（グループの全項目＋実績で出た想定外ステータス）
  const masterStatuses = (t) => {
    const grp = TYPE_GROUP[t];
    const base = grp === "A" ? stageGroups.A : grp === "B" ? stageGroups.B : [];
    const used = usedAll[t] ? Array.from(usedAll[t]) : [];
    const extra = used.filter((s) => !base.includes(s));
    return [...base, ...extra];
  };

  // 表示する案件タイプ（全期間に存在するものは、対象年に0件でも表を出す）
  const renderTypes = TYPE_ORDER.filter((t) => usedAll[t]).concat(
    Object.keys(usedAll).filter((t) => !TYPE_ORDER.includes(t))
  );

  // 作業優先順（Supabaseに保存。未設定はシートの#順）
  const [prio, setPrio] = useState({}); // { "scope|key": number }
  const loadPrio = useCallback(async () => {
    try {
      const j = await fetch("/api/priority", { cache: "no-store" }).then((r) => r.json());
      const m = {};
      for (const it of j.items || []) m[`${it.scope}|${it.key}`] = it.priority;
      setPrio(m);
    } catch {}
  }, []);
  useEffect(() => {
    loadPrio();
  }, [loadPrio]);
  const setPriority = (scope, key, raw) => {
    const v = raw === "" ? null : Number(raw);
    setPrio((p) => ({ ...p, [`${scope}|${key}`]: v }));
    fetch("/api/priority", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, key, priority: v }),
    }).catch(() => {});
  };
  const prioOf = (scope, key, fallback) => {
    const v = prio[`${scope}|${key}`];
    return v === undefined || v === null ? fallback : v;
  };

  // 作業ごとの担当アサイン（Supabaseに保存）
  const [assign, setAssignMap] = useState({}); // { "scope|key": [person_id,...] }
  const [persons, setPersons] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const j = await fetch("/api/assign", { cache: "no-store" }).then((r) => r.json());
        // オーナー・管理者は作業者ではないので対応者の選択肢に出さない
        const workers = (j.persons || []).filter(
          (p) => !["owner", "admin"].includes(p.role || "member")
        );
        // 退職者（active=false で一覧から外れた担当者）は persons に居ないため、
        // 割当に残っていると名前が「?」になる。解決できる現役だけを採用して表示・
        // カウントから除外する。
        const validSet = new Set(workers.map((p) => p.id));
        const m = {};
        for (const it of j.items || []) {
          if (!validSet.has(it.person_id)) continue;
          const k = `${it.scope}|${it.key}`;
          if (!m[k]) m[k] = [];
          // 主担当を先頭に保つ
          if (it.role === "main") m[k].unshift(it.person_id);
          else m[k].push(it.person_id);
        }
        setAssignMap(m);
        setPersons(workers);
      } catch {}
    })();
  }, []);
  // 画面から編集した内容（上書き）
  const [ov, setOv] = useState({}); // { "scope|key": {field: value} }
  const ovRef = useRef({});
  const saveTimers = useRef({});
  useEffect(() => {
    (async () => {
      try {
        const j = await fetch("/api/override", { cache: "no-store" }).then((r) => r.json());
        const m = {};
        for (const it of j.items || []) m[`${it.scope}|${it.key}`] = it.data || {};
        ovRef.current = m;
        setOv(m);
      } catch {}
    })();
  }, []);
  const ovOf = (scope, key) => ov[`${scope}|${key}`] || EMPTY_OV;
  const setOvField = (scope, key, field, value) => {
    const k = `${scope}|${key}`;
    const next = { ...(ovRef.current[k] || {}), [field]: value };
    ovRef.current = { ...ovRef.current, [k]: next };
    setOv(ovRef.current);
    // 入力のたびに送らないよう少しまとめてから保存
    clearTimeout(saveTimers.current[k]);
    saveTimers.current[k] = setTimeout(() => {
      fetch("/api/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, key, data: next }),
      }).catch(() => {});
    }, 600);
  };

  // 表ごとの編集モード
  const [edits, setEdits] = useState({});
  const toggleEdit = (scope) => setEdits((e) => ({ ...e, [scope]: !e[scope] }));

  const assignOf = (scope, key) => assign[`${scope}|${key}`] || EMPTY_IDS;
  const setAssign = (scope, key, ids) => {
    setAssignMap((m) => ({ ...m, [`${scope}|${key}`]: ids }));
    fetch("/api/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, key, personIds: ids }),
    }).catch(() => {});
  };

  // Ad Hoc Task（進捗シート由来）
  const [adhoc, setAdhoc] = useState(null);
  const [adhocTab, setAdhocTab] = useState("active"); // active（対応中）/ done（完了）
  // 各Ad Hocタスクの受注数・完了数（登録シートのセルから取得）: { [task]: {total, done} }
  const [sheetCounts, setSheetCounts] = useState({});
  // シート連携の設定モーダル対象タスク
  const [cfgTask, setCfgTask] = useState(null);
  // Ad Hoc の手動並べ替え（同一優先度内の順番）
  const adhocDragIndex = useRef(null);
  const [adhocDragOver, setAdhocDragOver] = useState(null);

  // サイトで追加した Ad Hoc タスク（シート由来の分と結合して表示）
  const [customAdhoc, setCustomAdhoc] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newBoard, setNewBoard] = useState("adhoc"); // 追加するタスクの区分（adhoc / regular）
  const [addError, setAddError] = useState(null);
  // ログイン中の権限（タスク編集の可否・アカウント管理の閲覧可否）
  const [perms, setPerms] = useState(null);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPerms(d?.perms || null))
      .catch(() => {});
  }, []);
  const canEditTasks = !!perms?.editTasks; // 取得前は false（編集ボタンを出さない）
  // 管理表の編集モード（既定は表示のみ。編集ボタンでON、完了でOFF）
  const [mngEdit, setMngEdit] = useState(false);
  // このボード上で実際に編集できるか。編集は「プロジェクト管理(mode=edit)」で
  // 「編集モードON」かつタスク編集権限がある場合のみ。ダッシュボード(mode=view)は常に閲覧専用。
  const editable = isEdit && canEditTasks && mngEdit;

  // 工数明細の作業内容一覧（紐づけ先の選択肢）
  const [kosuContents, setKosuContents] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const j = await fetch("/api/kosu?list=1", { cache: "no-store" }).then((r) => r.json());
        // 紐づけ先は Ad Hoc 系のみ。Regular task は対象外
        setKosuContents((j.contents || []).filter((c) => !/regular/i.test(c.type || "")));
      } catch {}
    })();
  }, []);

  const loadCustomAdhoc = useCallback(async () => {
    try {
      const j = await fetch("/api/adhoc-tasks", { cache: "no-store" }).then((r) => r.json());
      setCustomAdhoc(j.tasks || []);
    } catch {}
  }, []);
  useEffect(() => {
    loadCustomAdhoc();
  }, [loadCustomAdhoc]);
  const addAdhoc = async () => {
    const name = newTask.trim();
    if (!name) return;
    setAddError(null);
    const j = await fetch("/api/adhoc-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: name }),
    })
      .then((r) => r.json())
      .catch((e) => ({ error: String(e?.message || e) }));
    if (j.error) {
      setAddError(j.error);
      return;
    }
    // Regular 区分として追加する場合は、カスタムタスクに区分マーカーを付ける
    // （設定は scope="adhoc" に保存し、表示上 Regular セクションに並べる）
    if (newBoard === "regular") {
      setOvField("adhoc", name, "board", "regular");
    }
    setNewTask("");
    setNewBoard("adhoc");
    setAdding(false);
    loadCustomAdhoc();
  };
  // 削除の確認はモーダルで行う（ブラウザ標準のダイアログは使わない）
  const [delTarget, setDelTarget] = useState(null);
  // プロジェクト管理（管理表）の行ドラッグ並べ替え用
  const mngDragKey = useRef(null);
  const [mngOverKey, setMngOverKey] = useState(null);
  // 区分フィルター: "all" | "regular" | "pending" | "adhoc"
  const [mngFilter, setMngFilter] = useState("all");
  // Ad Hoc 選択時の進捗フィルター: "all" | "On Track" | "Behind" | "Onhold" | "Complete"
  const [mngStatus, setMngStatus] = useState("all");
  const [deleting, setDeleting] = useState(false);
  const removeAdhoc = (row) => setDelTarget(row);
  const doRemoveAdhoc = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await fetch(
        `/api/adhoc-tasks?id=${encodeURIComponent(delTarget.id)}&task=${encodeURIComponent(
          delTarget.task
        )}`,
        { method: "DELETE" }
      ).catch(() => {});
      setDelTarget(null);
      loadCustomAdhoc();
    } finally {
      setDeleting(false);
    }
  };

  // マスタ管理メニュー（担当者管理・作業内容管理）
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (!e.target.closest?.(".menu-wrap")) setMenuOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  // 表示タブ（スケジュール / 全体 / 案件詳細）
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    try {
      const v = localStorage.getItem("agoda-dash-tab");
      if (v === "schedule" || v === "overview" || v === "cases") setTab(v);
    } catch {}
  }, []);
  const switchTab = (v) => {
    setTab(v);
    try {
      localStorage.setItem("agoda-dash-tab", v);
    } catch {}
  };
  // タブが3つになり幅も不揃いなので、選択中ボタンの実寸からスライダーを合わせる
  const segRef = useRef(null);
  const [segThumb, setSegThumb] = useState(null);
  useEffect(() => {
    const fit = () => {
      const el = segRef.current?.querySelector(`.segbar-btn[data-tab="${tab}"]`);
      if (el) setSegThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [tab]);

  // 表示制御：0件ステータスを隠す／カードの折りたたみ
  const [hideZero, setHideZero] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const toggleCard = (t) => setCollapsed((p) => ({ ...p, [t]: !p[t] }));

  // 表の並び順（ドラッグで変更・localStorageに保存）
  const [order, setOrder] = useState(null);
  const dragIndex = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const renderTypesKey = renderTypes.join("|");

  useEffect(() => {
    if (!renderTypes.length) return;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem("agoda-dash-order") || "null");
    } catch {}
    const base = Array.isArray(saved) ? saved : [];
    const kept = base.filter((t) => renderTypes.includes(t));
    const extra = renderTypes.filter((t) => !kept.includes(t));
    setOrder([...kept, ...extra]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTypesKey]);

  const displayTypes = order && order.length ? order : renderTypes;

  const handleDrop = (toIdx) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragOver(null);
    if (from == null || from === toIdx) return;
    setOrder((prev) => {
      const arr = [...(prev || renderTypes)];
      const [moved] = arr.splice(from, 1);
      arr.splice(toIdx, 0, moved);
      try {
        localStorage.setItem("agoda-dash-order", JSON.stringify(arr));
      } catch {}
      return arr;
    });
  };

  const resetOrder = () => {
    try {
      localStorage.removeItem("agoda-dash-order");
    } catch {}
    setOrder(renderTypes);
  };

  // タスク別サマリー（当年 Regular ／ 前年 Pending）
  const summary = useMemo(
    () => (records && year != null ? buildSummary(records, dateCode, year) : null),
    [records, dateCode, year]
  );
  const pending = useMemo(
    () => (records && year != null ? buildPending(records, year - 1) : null),
    [records, year]
  );

  // IHM の Ad Hoc（IHM_Room/Plan/CM）の受注数・完了数を Kintone から集計する。
  //   受注数 = 該当件数 −（事前登録・失注・対応不要）／完了数 = Stage が「完了」
  const kintoneCounts = useMemo(() => {
    if (!records) return {};
    const map = {};
    for (const [taskKey, sub] of Object.entries(IHM_SUBTASKS)) {
      const list = records.filter(
        (r) =>
          caseType(r) === "IHM" &&
          String(r?.[WORK_TYPE_CODE]?.value || "").trim() === sub
      );
      let pre = 0;
      let lost = 0;
      let na = 0;
      let done = 0;
      for (const r of list) {
        const stage = r?.[STAGE_CODE]?.value || "";
        if (stage.includes("事前登録")) pre += 1;
        else if (stage.includes("失注")) lost += 1;
        else if (stage.includes("対応不要")) na += 1;
        if (stage === "完了") done += 1;
      }
      map[taskKey] = { total: list.length - pre - lost - na, done };
    }
    return map;
  }, [records]);

  // Regular Task サマリーの対象（IHM は Ad Hoc 扱いのため除外）
  const REGULAR_EXCLUDE = new Set(["IHM"]);
  const regularTypes = renderTypes.filter((t) => !REGULAR_EXCLUDE.has(t));

  const fmt = (n) => n.toLocaleString("ja-JP");
  const dateLabel =
    dateOptions.find((o) => o.code === dateCode)?.label || dateCode;
  // 編集モード（プロジェクト管理）は Regular ＋ Ad Hoc の編集に集中するため
  // 「案件詳細」タブは出さず常に overview を表示する。
  const activeTab = isEdit ? "overview" : tab;

  return (
    <div className="wrap">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="ダッシュボード" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </span>
          <span className="page-h page-h-gap">{isEdit ? "プロジェクト管理" : "ダッシュボード"}</span>
        </div>
        <div className="head-right">
          {updatedAt && (
            <span className="updated">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
              最終更新：
              {updatedAt.toLocaleString("ja-JP", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
          {editable && (
            <button
              className="icon-btn"
              onClick={syncKintone}
              disabled={syncing || loading}
              title="Kintone取込（最新データを取り込みます・数秒〜十数秒）"
              aria-label="Kintone取込"
            >
              <svg className={syncing ? "spin" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="8 17 12 21 16 17" />
                <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="card">
          <div className="err">{"集計エラー\n\n" + error}</div>
        </div>
      ) : records === null ? (
        <div className="card">
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="集計中" /></div>
        </div>
      ) : (
        <>
          {!isEdit && (
          <div className="tabbar-row">
            <div className="segbar" role="tablist" aria-label="表示切替" ref={segRef}>
            <span
              className="segbar-thumb"
              style={segThumb ? { left: segThumb.left, width: segThumb.width, transform: "none" } : { opacity: 0 }}
              aria-hidden="true"
            />
            <button
              type="button"
              role="tab"
              data-tab="schedule"
              aria-selected={tab === "schedule"}
              className={"segbar-btn" + (tab === "schedule" ? " active" : "")}
              onClick={() => switchTab("schedule")}
            >
              スケジュール
            </button>
            <button
              type="button"
              role="tab"
              data-tab="overview"
              aria-selected={tab === "overview"}
              className={"segbar-btn" + (tab === "overview" ? " active" : "")}
              onClick={() => switchTab("overview")}
            >
              全体
            </button>
            <button
              type="button"
              role="tab"
              data-tab="cases"
              aria-selected={tab === "cases"}
              className={"segbar-btn" + (tab === "cases" ? " active" : "")}
              onClick={() => switchTab("cases")}
            >
              案件詳細
            </button>
            </div>
            {years.length > 0 && (
              <label className="head-year">
                対象年
                <select value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))}>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y} 年
                    </option>
                  ))}
                </select>
              </label>
            )}
            {/* アカウント管理はサイドバーのメニューに移設 */}
          </div>
          )}

          {isEdit && (() => {
            // 管理表の行データ（区分ごと）。数値は自動集計、設定（優先/対応者/進捗/名前/並び）を編集する。
            const regRows = (regularTypes || [])
              .map((t) => {
                const s = summary?.[t];
                if (!s) return null;
                const juchu = s.total - s.pre - s.lost - s.na;
                const rate = juchu ? Math.round((s.done / juchu) * 100) : 0;
                const o = ovOf("regular", t);
                return { scope: "regular", key: t, kind: "Regular", name: o.name ?? t, count: juchu, done: s.done, rate, status: o.status };
              })
              .filter(Boolean);
            const ptypes = pending ? [...(regularTypes || []), "DSA"].filter((t) => pending[t] && pending[t].total > 0) : [];
            const penRows = ptypes.map((t) => {
              const s = pending[t];
              const zan = s.total - s.pre - s.lost - s.na;
              const rate = s.total ? Math.round((s.done / s.total) * 100) : 0;
              const o = ovOf("pending", t);
              return { scope: "pending", key: t, kind: "Pending", name: o.name ?? t, count: zan, done: s.done, rate, status: o.status };
            });
            const seenA = new Set((adhoc || []).map((a) => a.task));
            const adhocList = [
              ...(adhoc || []),
              ...(customAdhoc || []).filter((c) => !seenA.has(c.task)).map((c) => ({ task: c.task, customId: c.id })),
            ];
            const adhocRows = adhocList.map((a) => {
              const t = a.task;
              const o = ovOf("adhoc", t);
              // ダッシュボードと同じ優先順位で数値を出す：
              //   シート連携(sheetCounts) / IHMのKintone集計(kintoneCounts) → 上書き(o) → シート由来(a)
              const sc = sheetCounts?.[t] || kintoneCounts?.[t] || {};
              const total = sc.total != null ? sc.total : o.total ?? a.total ?? null;
              const done = sc.done != null ? sc.done : o.done ?? a.done ?? null;
              const rate =
                total != null && Number(total) > 0 && done != null
                  ? Math.round((Number(done) / Number(total)) * 100)
                  : o.pct != null
                  ? Number(String(o.pct).replace(/[^0-9.]/g, ""))
                  : null;
              const isReg = o.board === "regular";
              // 進捗はダッシュボードと同じく「上書き → シート値」の順で効かせる
              const st = o.status ?? a.status ?? "";
              const start = o.start ?? a.start ?? "";
              const end = o.end ?? a.end ?? "";
              return { scope: "adhoc", key: t, kind: isReg ? "Regular" : "Ad Hoc", name: o.name ?? t, count: total, done, rate, status: st, start, end, no: a.no ?? null, customId: a.customId };
            });
            const customRegRows = adhocRows.filter((r) => r.kind === "Regular");
            const adhocOnlyRows = adhocRows.filter((r) => r.kind !== "Regular");
            // 実効優先度：明示設定 → シート#(no) の順。0・空は「優先なし」(null) とする。
            const effPrio = (scope, key, no) => {
              const v = prioOf(scope, key, no ?? null);
              const n = Number(v);
              return Number.isFinite(n) && n > 0 ? n : null;
            };
            const byPrio = (arr, scope) =>
              [...arr]
                .map((r, i) => ({ r, i, p: effPrio(scope, r.key, r.no) }))
                .sort((a, b) => {
                  if (a.p == null && b.p == null) return a.i - b.i;
                  if (a.p == null) return 1;
                  if (b.p == null) return -1;
                  return a.p - b.p || a.i - b.i;
                })
                .map((x) => x.r);
            const rows = [
              ...byPrio(regRows, "regular"),
              ...byPrio(customRegRows, "adhoc"),
              ...byPrio(penRows, "pending"),
              ...byPrio(adhocOnlyRows, "adhoc"),
            ];
            const kindOfFilter = { regular: "Regular", pending: "Pending", adhoc: "Ad Hoc" };
            let shown = mngFilter === "all" ? rows : rows.filter((r) => r.kind === kindOfFilter[mngFilter]);
            // Ad Hoc のときは進捗ステータスでも絞り込む
            if (mngFilter === "adhoc" && mngStatus !== "all") {
              shown =
                mngStatus === "not-complete"
                  ? shown.filter((r) => (r.status || "") !== "Complete")
                  : shown.filter((r) => (r.status || "") === mngStatus);
            }
            const cnt = {
              all: rows.length,
              regular: rows.filter((r) => r.kind === "Regular").length,
              pending: rows.filter((r) => r.kind === "Pending").length,
              adhoc: rows.filter((r) => r.kind === "Ad Hoc").length,
            };
            const STATUS_FILTERS = ["Onhold", "Behind", "On Track", "Complete"];
            const adhocForStatus = rows.filter((r) => r.kind === "Ad Hoc");
            const statusCnt = { all: adhocForStatus.length };
            for (const s of STATUS_FILTERS) statusCnt[s] = adhocForStatus.filter((r) => (r.status || "") === s).length;
            statusCnt["not-complete"] = adhocForStatus.filter((r) => (r.status || "") !== "Complete").length;
            const onDrop = (row) => {
              const from = mngDragKey.current;
              if (!from || from.scope !== row.scope || from.kind !== row.kind || from.key === row.key) {
                mngDragKey.current = null;
                setMngOverKey(null);
                return;
              }
              const keys = rows.filter((r) => r.scope === row.scope && r.kind === row.kind).map((r) => r.key);
              const fi = keys.indexOf(from.key);
              const ti = keys.indexOf(row.key);
              if (fi < 0 || ti < 0) {
                mngDragKey.current = null;
                setMngOverKey(null);
                return;
              }
              const moved = keys.splice(fi, 1)[0];
              keys.splice(ti, 0, moved);
              keys.forEach((k, idx) => setPriority(row.scope, k, idx + 1));
              mngDragKey.current = null;
              setMngOverKey(null);
            };
            const kindBadge = { Regular: "mng-b-reg", Pending: "mng-b-pen", "Ad Hoc": "mng-b-adhoc" };
            // 日付は自前表示（曜日の括弧を出さない）＋カレンダーだけ標準ピッカーを開く
            const dateField = (row, k) => {
              const iso = toDateInput(row[k]);
              return (
                <span className="dt-field">
                  <input className="dt-native" type="date" value={iso} onChange={(e) => setOvField(row.scope, row.key, k, fromDateInput(e.target.value))} tabIndex={-1} aria-hidden="true" />
                  <button type="button" className="dt-btn" onClick={(e) => { const inp = e.currentTarget.parentNode.querySelector(".dt-native"); if (inp?.showPicker) inp.showPicker(); else inp?.click(); }} aria-label={`${k === "start" ? "開始日" : "期日"}を選択`}>
                    <span className={iso ? "" : "dt-ph"}>{iso ? fromDateInput(iso) : "未設定"}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="17" rx="2" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="8" y1="2.5" x2="8" y2="6.5" /><line x1="16" y1="2.5" x2="16" y2="6.5" /></svg>
                  </button>
                </span>
              );
            };
            return (
              <div className="card no-pad manage-card">
                <div className="manage-head">
                  {years.length > 0 && (
                    <select className="mng-year-select" value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))} aria-label="対象年">
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y} 年
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="mng-filter" role="group" aria-label="区分で絞り込み">
                    <button type="button" className={"mng-filter-btn" + (mngFilter === "all" ? " active" : "")} onClick={() => setMngFilter("all")}>すべて<span className="mng-fcount">{cnt.all}</span></button>
                    <button type="button" className={"mng-filter-btn" + (mngFilter === "regular" ? " active" : "")} onClick={() => setMngFilter("regular")}>Regular<span className="mng-fcount">{cnt.regular}</span></button>
                    <button type="button" className={"mng-filter-btn" + (mngFilter === "pending" ? " active" : "")} onClick={() => setMngFilter("pending")}>Pending<span className="mng-fcount">{cnt.pending}</span></button>
                    <button type="button" className={"mng-filter-btn" + (mngFilter === "adhoc" ? " active" : "")} onClick={() => setMngFilter("adhoc")}>Ad Hoc<span className="mng-fcount">{cnt.adhoc}</span></button>
                  </div>
                  {mngFilter === "adhoc" && (
                    <div className="mng-filter mng-filter-sub" role="group" aria-label="進捗で絞り込み">
                      <button type="button" className={"mng-filter-btn" + (mngStatus === "all" ? " active" : "")} onClick={() => setMngStatus("all")}>すべて<span className="mng-fcount">{statusCnt.all}</span></button>
                      {STATUS_FILTERS.map((s) => (
                        <button key={s} type="button" className={"mng-filter-btn" + (mngStatus === s ? " active" : "")} onClick={() => setMngStatus(s)}>{s}<span className="mng-fcount">{statusCnt[s]}</span></button>
                      ))}
                      <button type="button" className={"mng-filter-btn" + (mngStatus === "not-complete" ? " active" : "")} onClick={() => setMngStatus("not-complete")}>Complete以外<span className="mng-fcount">{statusCnt["not-complete"]}</span></button>
                    </div>
                  )}
                  {canEditTasks && (
                    <span className="manage-actions">
                      <button type="button" className={"icon-btn manage-edit-btn" + (mngEdit ? " on" : "")} onClick={() => setMngEdit((v) => !v)} title={mngEdit ? "編集を終了" : "編集"} aria-label={mngEdit ? "編集を終了" : "編集"}>
                        {mngEdit ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" /></svg>
                        )}
                      </button>
                      {adding ? (
                        <span className="addbar">
                          <select className="ed-input ed-sel" value={newBoard} onChange={(e) => setNewBoard(e.target.value)} aria-label="区分">
                            <option value="adhoc">Ad Hoc</option>
                            <option value="regular">Regular</option>
                          </select>
                          <input className="ed-input" type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addAdhoc(); if (e.key === "Escape") { setAdding(false); setAddError(null); } }} placeholder="タスク名" autoFocus />
                          <button type="button" className="edit-btn on" onClick={addAdhoc}>追加</button>
                          <button type="button" className="edit-btn" onClick={() => { setAdding(false); setNewTask(""); setNewBoard("adhoc"); setAddError(null); }}>取消</button>
                          {addError && <span className="add-err">{addError}</span>}
                        </span>
                      ) : (
                        <button type="button" className="icon-btn" onClick={() => setAdding(true)} title="タスク追加" aria-label="タスク追加">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <div className="tw manage-tw">
                  <table className="manage-table">
                    <thead>
                      <tr>
                        <th>優先</th>
                        <th>区分</th>
                        <th className="l">タスク</th>
                        <th>開始</th>
                        <th>期日</th>
                        <th className="l">対応者</th>
                        <th>進捗</th>
                        <th>件数</th>
                        <th>完了</th>
                        <th>進捗率</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row) => {
                        const o = ovOf(row.scope, row.key);
                        const ids = assignOf(row.scope, row.key);
                        const rk = row.scope + "|" + row.key;
                        return (
                          <tr
                            key={rk}
                          >
                            <td>{editable ? (<input className="prio-input" type="number" value={effPrio(row.scope, row.key, row.no) ?? ""} onChange={(e) => setPriority(row.scope, row.key, e.target.value)} />) : (effPrio(row.scope, row.key, row.no) ?? "—")}</td>
                            <td><span className={"mng-badge " + kindBadge[row.kind]}>{row.kind}</span></td>
                            <td className="l">{editable ? (<input className="ed-input" type="text" value={o.name ?? row.key} onChange={(e) => setOvField(row.scope, row.key, "name", e.target.value)} />) : (o.name ?? row.key)}</td>
                            <td className="mng-date">{row.kind === "Ad Hoc" ? (editable ? dateField(row, "start") : (row.start || "—")) : <span className="mng-dim">—</span>}</td>
                            <td className="mng-date">{row.kind === "Ad Hoc" ? (editable ? dateField(row, "end") : (row.end || "—")) : <span className="mng-dim">—</span>}</td>
                            <td className="l">{editable ? (<AssignCell scope={row.scope} akey={row.key} ids={ids} persons={persons} setAssign={setAssign} />) : (ids.map((id) => persons.find((p) => p.id === id)?.name).filter(Boolean).join("、") || "—")}</td>
                            <td>{editable ? (<select className="ed-input ed-sel" value={row.status || ""} onChange={(e) => setOvField(row.scope, row.key, "status", e.target.value)}><option value="">—</option>{STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}</select>) : (<span className={"st-pill " + statusClass(row.status)}>{row.status || "—"}</span>)}</td>
                            <td className="v-strong">{row.count == null ? "—" : row.count}</td>
                            <td>{row.done == null ? "—" : row.done}</td>
                            <td>{row.rate == null ? "—" : row.rate + "%"}</td>
                            <td className="mng-ops">{row.kind === "Ad Hoc" ? (
                              <span className="mng-ops-wrap">
                                {/* 連携済みならスプレッドシートを直接開けるようにする（閲覧時も表示） */}
                                {o.sheetUrl && (
                                  <a className="forms-op on" href={o.sheetUrl} target="_blank" rel="noreferrer" title={"スプレッドシートを開く\n" + o.sheetUrl} aria-label="スプレッドシートを開く">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                                  </a>
                                )}
                                {editable && (
                                  <button type="button" className={"forms-op" + (o.sheetUrl ? " on" : "")} title="スプレッドシート連携（受注数・完了数を自動取得）" aria-label="シート連携" onClick={() => setCfgTask(row.key)}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="9" x2="9" y2="21" /></svg>
                                  </button>
                                )}
                                {row.customId && (
                                  <button type="button" className="forms-op danger" title="削除" aria-label="削除" onClick={() => removeAdhoc({ id: row.customId, task: row.key })}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                  </button>
                                )}
                              </span>
                            ) : (<span className="mng-dim">—</span>)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {activeTab === "overview" && !isEdit && (
          <div className="tab-panel overview-row">
            <div className="summary-row overview-tables">
            {summary && renderTypes.length > 0 && (
              <SummaryTable
                title={`Regular Task ｜ ${year}年`}
                data={summary}
                types={regularTypes}
                prioOf={prioOf}
                setPriority={setPriority}
                assignOf={assignOf}
                setAssign={setAssign}
                persons={persons}
                ovOf={ovOf}
                setOvField={setOvField}
                edit={editable}
                onToggleEdit={undefined}
              />
            )}
            {pending &&
              (() => {
                const ptypes = [...regularTypes, "DSA"].filter(
                  (t) => pending[t] && pending[t].total > 0
                );
                return ptypes.length > 0 ? (
                  <SummaryTable
                    title={`Regular Task ｜ Pending_${year - 1}年`}
                    data={pending}
                    types={ptypes}
                    countLabel="残件数"
                    rateLabel="進捗率"
                    prioOf={prioOf}
                    setPriority={setPriority}
                    scope="pending"
                    assignOf={assignOf}
                    setAssign={setAssign}
                    persons={persons}
                    ovOf={ovOf}
                    setOvField={setOvField}
                    edit={editable}
                    onToggleEdit={undefined}
                  />
                ) : null;
              })()}
            </div>
          </div>
          )}

          {/* スケジュール：当月と翌月のカレンダーを並べて表示 */}
          {activeTab === "schedule" && !isEdit && (
            <div className="tab-panel sched-row">
              <Calendar />
              <Calendar offset={1} />
            </div>
          )}

          {activeTab === "overview" && !isEdit && adhoc && (adhoc.length > 0 || customAdhoc.length > 0) && (() => {
            // シート由来のタスク＋サイトで追加したタスクを結合
            const merged = [
              ...adhoc,
              ...customAdhoc
                .filter((c) => !adhoc.some((a) => a.task === c.task))
                .map((c) => ({
                  task: c.task,
                  customId: c.id, // サイト追加分の目印（削除できる）
                  no: null,
                  start: null,
                  end: null,
                  total: null,
                  done: null,
                  rest: null,
                  pct: null,
                  status: null,
                  daily: null,
                  effort: null,
                  issue: null,
                  next: null,
                  people: null,
                  pic: null,
                  memo: null,
                })),
            ];
            // 進捗を編集した場合はその値で「完了」を判定する
            const statusOf = (t) => ovOf("adhoc", t.task).status ?? t.status;
            const active = merged.filter((t) => statusOf(t) !== "Complete");
            const done = merged.filter((t) => statusOf(t) === "Complete");
            const doneCount = done.length;
            // 開始日を比較用の数値（YYYYMMDD）に。未設定は最後に回す
            const startKey = (t) => {
              const s = ovOf("adhoc", t.task).start ?? t.start;
              const m = s && String(s).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
              return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : -Infinity;
            };
            // 同一優先度内の手動並び順（seq）。未設定は末尾扱い（元の順を保つ）
            const seqOf = (t) => {
              const s = ovOf("adhoc", t.task).seq;
              const n = Number(s);
              return s != null && Number.isFinite(n) ? n : null;
            };
            const byPriority = (a, b) => {
              const pa = prioOf("adhoc", a.task, a.no);
              const pb = prioOf("adhoc", b.task, b.no);
              const na = pa == null ? Infinity : pa;
              const nb = pb == null ? Infinity : pb;
              if (na !== nb) return na - nb;
              // 優先度が同じときは手動並び(seq)で決める
              const sa = seqOf(a);
              const sb = seqOf(b);
              if (sa == null && sb == null) return 0;
              if (sa == null) return 1;
              if (sb == null) return -1;
              return sa - sb;
            };
            // 対応中は優先順、完了は開始日の新しい順
            const list =
              adhocTab === "done"
                ? [...done].sort((a, b) => startKey(b) - startKey(a))
                : [...active].sort(byPriority);
            const cell = (v) => (v === null || v === undefined || v === "" ? "—" : v);
            // ドラッグで並べ替え：新しい並びを seq として保存する。
            // 優先度が先に効くので、seq は同一優先度内の順番決めに使われる。
            const moveAdhoc = (from, to) => {
              if (from == null || to == null || from === to) return;
              const arr = [...list];
              const [m] = arr.splice(from, 1);
              arr.splice(to, 0, m);
              arr.forEach((t, idx) => setOvField("adhoc", t.task, "seq", idx));
            };
            return (
              <div className="tab-panel">
                <div className="sec-row">
                  <div className="sec-head">Ad Hoc Task</div>
                  <div className="segbar segbar-sm" role="tablist" aria-label="Ad Hoc Task の表示切替">
                    <span
                      className="segbar-thumb"
                      style={{ transform: `translateX(${adhocTab === "done" ? "100%" : "0%"})` }}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      role="tab"
                      aria-selected={adhocTab === "active"}
                      className={"segbar-btn" + (adhocTab === "active" ? " active" : "")}
                      onClick={() => setAdhocTab("active")}
                    >
                      対応中
                      <span className="seg-count">{active.length}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={adhocTab === "done"}
                      className={"segbar-btn" + (adhocTab === "done" ? " active" : "")}
                      onClick={() => setAdhocTab("done")}
                    >
                      完了
                      <span className="seg-count">{doneCount}</span>
                    </button>
                  </div>
                  <span className="sec-actions">
                  {editable &&
                    (adding ? (
                      <span className="addbar">
                        <input
                          className="ed-input"
                          type="text"
                          value={newTask}
                          onChange={(e) => setNewTask(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addAdhoc();
                            if (e.key === "Escape") {
                              setAdding(false);
                              setAddError(null);
                            }
                          }}
                          placeholder="タスク名を入力"
                          autoFocus
                        />
                        <button type="button" className="edit-btn on" onClick={addAdhoc}>
                          追加
                        </button>
                        <button
                          type="button"
                          className="edit-btn"
                          onClick={() => {
                            setAdding(false);
                            setNewTask("");
                            setAddError(null);
                          }}
                        >
                          取消
                        </button>
                        {addError && <span className="add-err">{addError}</span>}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="edit-btn"
                        onClick={() => setAdding(true)}
                        title="Ad Hoc タスクを追加"
                      >
                        ＋ タスク追加
                      </button>
                    ))}
                  </span>
                </div>
                <div className="card no-pad">
                  <div className="dtw adhoc-tw">
                    {/* 幅は100%。指定のない最終列（メモ）が余白を全部吸収する */}
                    <table
                      className="dtable adhoc-table"
                      style={{ width: "100%", minWidth: ADHOC_W }}
                    >
                      <colgroup>
                        {ADHOC_COLS.map((w, ci) => (
                          <col key={ci} style={{ width: w }} />
                        ))}
                        <col />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="prio-th">優先</th>
                          <th className="l">タスク</th>
                          <th>開始</th>
                          <th>期日</th>
                          <th>受注数</th>
                          <th>完了数</th>
                          <th>残件数</th>
                          <th>進捗率</th>
                          <th>進捗</th>
                          <th>目標対応件数<small>(Daily)</small></th>
                          <th>実作業工数</th>
                          <th className="l">課題・遅延理由</th>
                          <th className="l">次回アクション</th>
                          <th>対応人数</th>
                          <th className="l">対応者</th>
                          <th className="l">メモ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((t, i) => {
                          const ed = editable;
                          const o = ovOf("adhoc", t.task);
                          const ids = assignOf("adhoc", t.task);
                          const names = ids.length
                            ? ids.map((id) => persons.find((p) => p.id === id)?.name || "?")
                            : null;
                          // 上書きがあればそれを、なければ元データを表示
                          const val = (k, src) => (o[k] !== undefined ? o[k] : src);
                          const status = val("status", t.status);
                          // サイト追加分は入力した受注数・完了数から残件数と進捗率を出す
                          const nTotal = Number(val("total", t.total));
                          const nDone = Number(val("done", t.done));
                          const hasCount = Number.isFinite(nTotal) && Number.isFinite(nDone);
                          const calcRest = hasCount ? nTotal - nDone : null;
                          const calcPct =
                            hasCount && nTotal > 0 ? `${Math.round((nDone / nTotal) * 100)}%` : "—";
                          // 自動集計（シート連携 or IHMのKintone集計）を優先表示し、
                          // 残件数・進捗率も自動計算する。
                          const sc = sheetCounts[t.task] || kintoneCounts[t.task];
                          const scLabel = sheetCounts[t.task]
                            ? "登録シートから取得"
                            : kintoneCounts[t.task]
                            ? "Kintoneから集計"
                            : undefined;
                          const scTotal = sc && sc.total != null ? sc.total : null;
                          const scDone = sc && sc.done != null ? sc.done : null;
                          const hasSheet = scTotal != null || scDone != null;
                          const dispTotal = scTotal != null ? scTotal : val("total", t.total);
                          const dispDone = scDone != null ? scDone : val("done", t.done);
                          const dispRest =
                            scTotal != null && scDone != null ? scTotal - scDone : null;
                          const dispPct =
                            scTotal != null && scDone != null && scTotal > 0
                              ? `${Math.round((scDone / scTotal) * 100)}%`
                              : null;
                          // 日付はカレンダーから選ぶ（保存は "YYYY/MM/DD" のまま）。
                          // ブラウザ標準の日付入力は表示書式が環境依存（曜日の括弧が付くなど）のため、
                          // 表示は自前で描き、カレンダーだけ標準のものを showPicker() で開く。
                          const dateIn = (k, src) => {
                            const iso = toDateInput(o[k] ?? src);
                            return (
                              <span className="dt-field">
                                <input
                                  className="dt-native"
                                  type="date"
                                  value={iso}
                                  onChange={(e) =>
                                    setOvField("adhoc", t.task, k, fromDateInput(e.target.value))
                                  }
                                  tabIndex={-1}
                                  aria-hidden="true"
                                />
                                <button
                                  type="button"
                                  className="dt-btn"
                                  onClick={(e) => {
                                    const inp =
                                      e.currentTarget.parentNode.querySelector(".dt-native");
                                    if (inp?.showPicker) inp.showPicker();
                                    else inp?.click();
                                  }}
                                  aria-label={`${k === "start" ? "開始日" : "期日"}を選択`}
                                >
                                  <span className={iso ? "" : "dt-ph"}>
                                    {iso ? fromDateInput(iso) : "未設定"}
                                  </span>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <rect x="3" y="4.5" width="18" height="17" rx="2" />
                                    <line x1="3" y1="9.5" x2="21" y2="9.5" />
                                    <line x1="8" y1="2.5" x2="8" y2="6.5" />
                                    <line x1="16" y1="2.5" x2="16" y2="6.5" />
                                  </svg>
                                </button>
                              </span>
                            );
                          };
                          // 上書き用のテキスト入力（幅の指定だけ変える）
                          const txt = (k, src, cls = "ed-input") => (
                            <input
                              className={cls}
                              type="text"
                              value={o[k] ?? src ?? ""}
                              onChange={(e) => setOvField("adhoc", t.task, k, e.target.value)}
                              aria-label={k}
                            />
                          );
                          // 完了したタスクは優先順を持たせない（入力欄も出さない）
                          const isDone = status === "Complete";
                          const canDragRow = ed && adhocTab === "active";
                          return (
                          <tr
                            key={t.task + i}
                            className={
                              (isDone ? "row-done " : "") +
                              (adhocDragOver === i ? "row-dragover" : "")
                            }
                            onDragOver={
                              canDragRow
                                ? (e) => {
                                    e.preventDefault();
                                    if (adhocDragOver !== i) setAdhocDragOver(i);
                                  }
                                : undefined
                            }
                            onDrop={
                              canDragRow
                                ? () => {
                                    moveAdhoc(adhocDragIndex.current, i);
                                    adhocDragIndex.current = null;
                                    setAdhocDragOver(null);
                                  }
                                : undefined
                            }
                          >
                            <td className="prio-td">
                              {isDone ? (
                                <span className="prio-none">—</span>
                              ) : ed ? (
                                <span className="prio-edit">
                                  <span
                                    className="adhoc-grip"
                                    draggable
                                    onDragStart={() => {
                                      adhocDragIndex.current = i;
                                    }}
                                    onDragEnd={() => {
                                      adhocDragIndex.current = null;
                                      setAdhocDragOver(null);
                                    }}
                                    title="ドラッグで並べ替え（同じ優先度内の順番）"
                                    aria-hidden="true"
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                      <circle cx="9" cy="5" r="1.7" />
                                      <circle cx="15" cy="5" r="1.7" />
                                      <circle cx="9" cy="12" r="1.7" />
                                      <circle cx="15" cy="12" r="1.7" />
                                      <circle cx="9" cy="19" r="1.7" />
                                      <circle cx="15" cy="19" r="1.7" />
                                    </svg>
                                  </span>
                                  <input
                                    className="prio-input"
                                    type="number"
                                    min="1"
                                    value={prioOf("adhoc", t.task, t.no) ?? ""}
                                    onChange={(e) => setPriority("adhoc", t.task, e.target.value)}
                                    aria-label={`${t.task} の作業優先順`}
                                  />
                                </span>
                              ) : (
                                <span className="prio-view">{prioOf("adhoc", t.task, t.no) ?? "—"}</span>
                              )}
                            </td>
                            <td
                              className="l tname"
                              title={
                                o.kosuLink
                                  ? `${val("name", t.task)}\n工数明細：${o.kosuLink}`
                                  : val("name", t.task)
                              }
                            >
                              {ed ? (
                                <span className="tname-edit">
                                  {txt("name", t.task, "ed-input ed-name")}
                                  <KosuLinkCell
                                    value={o.kosuLink || ""}
                                    contents={kosuContents}
                                    onChange={(v) => setOvField("adhoc", t.task, "kosuLink", v)}
                                  />
                                  <button
                                    type="button"
                                    className={"cfg-btn" + (o.sheetUrl ? " on" : "")}
                                    onClick={() => setCfgTask(t.task)}
                                    title="シート連携（受注数・完了数）"
                                    aria-label="シート連携を設定"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <rect x="3" y="3" width="18" height="18" rx="2" />
                                      <line x1="3" y1="9" x2="21" y2="9" />
                                      <line x1="9" y1="9" x2="9" y2="21" />
                                    </svg>
                                  </button>
                                  {t.customId && (
                                    <button
                                      type="button"
                                      className="row-del"
                                      onClick={() => removeAdhoc({ id: t.customId, task: t.task })}
                                      title="このタスクを削除"
                                      aria-label={`${t.task} を削除`}
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              ) : (
                                <>
                                  {val("name", t.task)}
                                  {o.kosuLink && (
                                    <span className="klink-mark" aria-hidden="true">
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
                                        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                                      </svg>
                                    </span>
                                  )}
                                  {o.sheetUrl && (
                                    <span className="sheet-mark" title="シート連携中（受注数・完了数を自動取得）" aria-hidden="true">
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                        <line x1="3" y1="9" x2="21" y2="9" />
                                        <line x1="9" y1="9" x2="9" y2="21" />
                                      </svg>
                                    </span>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="period">{ed ? dateIn("start", t.start) : cell(val("start", t.start))}</td>
                            <td className="period">{ed ? dateIn("end", t.end) : cell(val("end", t.end))}</td>
                            {/* シート連携＞サイト入力＞シート由来の集計値、の優先順で表示。
                                連携時は残件数・進捗率も自動計算する。 */}
                            <td className={hasSheet ? "v-auto" : ""} title={scLabel}>
                              {hasSheet
                                ? num(dispTotal)
                                : t.customId && ed
                                ? txt("total", t.total, "ed-input ed-num")
                                : num(val("total", t.total))}
                            </td>
                            <td className={hasSheet ? "v-auto" : ""} title={scLabel}>
                              {hasSheet
                                ? num(dispDone)
                                : t.customId && ed
                                ? txt("done", t.done, "ed-input ed-num")
                                : num(val("done", t.done))}
                            </td>
                            <td>{dispRest != null ? num(dispRest) : num(t.customId ? calcRest : t.rest)}</td>
                            <td className="c-rate">
                              {(() => {
                                const raw = dispPct != null ? dispPct : t.customId ? calcPct : cell(t.pct);
                                return <span className="prog-val">{raw}</span>;
                              })()}
                            </td>
                            <td>
                              {ed ? (
                                <select
                                  className="ed-input ed-sel"
                                  value={status || ""}
                                  onChange={(e) => setOvField("adhoc", t.task, "status", e.target.value)}
                                  aria-label="進捗"
                                >
                                  <option value="">—</option>
                                  {STATUS_OPTIONS.map((s) => (
                                    <option key={s} value={s}>
                                      {s}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className={"st-pill " + statusClass(status)}>
                                  {status || "—"}
                                </span>
                              )}
                            </td>
                            <td>{ed ? txt("daily", t.daily, "ed-input ed-num") : num(val("daily", t.daily))}</td>
                            <td className="nowrap">{ed ? txt("effort", t.effort, "ed-input ed-num") : cell(val("effort", t.effort))}</td>
                            <td className="l wrapcell" title={val("issue", t.issue)}>
                              {ed ? txt("issue", t.issue, "ed-input ed-wide") : cell(val("issue", t.issue))}
                            </td>
                            <td className="l wrapcell" title={val("next", t.next)}>
                              {ed ? txt("next", t.next, "ed-input ed-wide") : cell(val("next", t.next))}
                            </td>
                            {/* 対応人数：対応者の選択人数を自動反映 */}
                            <td className={names ? "v-auto" : ""} title={names ? "対応者の選択人数" : undefined}>
                              {names ? names.length : num(t.people)}
                            </td>
                            <td className="l nowrap asg-td">
                              {ed ? (
                                <AssignCell
                                  scope="adhoc"
                                  akey={t.task}
                                  ids={ids}
                                  persons={persons}
                                  setAssign={setAssign}
                                />
                              ) : names ? (
                                names.join("、")
                              ) : (
                                cell(t.pic)
                              )}
                            </td>
                            <td className="l wrapcell" title={val("memo", t.memo)}>
                              {ed ? txt("memo", t.memo, "ed-input ed-wide") : cell(val("memo", t.memo))}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 案件タイプ別 ステータス×四半期（全ステータスを0件でも表示） */}
          {activeTab === "cases" && (renderTypes.length === 0 ? (
            <div className="card">
              <div className="notice">案件がありません。</div>
            </div>
          ) : (
            <>
            <div className="dash-toolbar">
              <span className="sec-head inline">案件タイプ別　ステータス×四半期</span>
            </div>
            <div className="qgrid">
            {displayTypes.map((t, idx) => {
              const e = yearAgg?.byType[t] || {
                stages: {},
                cols: [0, 0, 0, 0],
                total: 0,
              };
              const allRows = masterStatuses(t).map((stage) => {
                const d = e.stages[stage];
                return {
                  stage,
                  cat: statusCategory(stage),
                  q: d ? d.q : [0, 0, 0, 0],
                  total: d ? d.total : 0,
                };
              });
              const rows = hideZero ? allRows.filter((r) => r.total > 0) : allRows;
              const hiddenCount = allRows.length - rows.length;
              // カード見出しのKPI（サマリー表と同一ロジック）
              const s = summary?.[t] || { total: 0, pre: 0, lost: 0, na: 0, done: 0 };
              const juchu = s.total - s.pre - s.lost - s.na;
              const kDone = s.done;
              const kOpen = juchu - kDone;
              const kRate = juchu > 0 ? Math.round((kDone / juchu) * 100) : 0;
              const accent = TYPE_ACCENT[t] || ACCENT_FALLBACK;
              const isOpen = !collapsed[t];
              return (
                <div
                  className={
                    "qcard type-card" +
                    (dragOver === idx ? " dragover" : "") +
                    (isOpen ? "" : " is-collapsed")
                  }
                  style={{ "--type-accent": accent }}
                  key={t}
                  draggable
                  onDragStart={() => {
                    dragIndex.current = idx;
                  }}
                  onDragOver={(ev) => {
                    ev.preventDefault();
                    if (dragOver !== idx) setDragOver(idx);
                  }}
                  onDragLeave={() => {
                    if (dragOver === idx) setDragOver(null);
                  }}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={() => {
                    dragIndex.current = null;
                    setDragOver(null);
                  }}
                >
                  <div
                    className="qcard-head"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggleCard(t)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        toggleCard(t);
                      }
                    }}
                    title={isOpen ? "クリックで折りたたむ" : "クリックで展開"}
                  >
                    <span className="drag-handle" aria-hidden="true">
                      ⠿
                    </span>
                    <span className="case-name">{t}</span>
                    <span className="kpi-strip">
                      <span className="kpi-mini">
                        <i>受注</i>
                        <b>{juchu}</b>
                      </span>
                      <span className="kpi-mini">
                        <i>完了</i>
                        <b className="ok">{kDone}</b>
                      </span>
                      <span className="kpi-mini">
                        <i>対応中</i>
                        <b className="warn">{kOpen}</b>
                      </span>
                      <span
                        className={
                          "rate-pill " +
                          (kRate >= 90 ? "r-high" : kRate >= 60 ? "r-mid" : "r-low")
                        }
                      >
                        {kRate}%
                      </span>
                    </span>
                    <span className={"chev" + (isOpen ? " open" : "")} aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                  </div>
                  <div className="qcard-line" aria-hidden="true" />
                  <div className="tw2" hidden={!isOpen}>
                    <table className="qtable">
                      <thead>
                        <tr>
                          <th className="l">ステータス</th>
                          <th>Q1</th>
                          <th>Q2</th>
                          <th>Q3</th>
                          <th>Q4</th>
                          <th className="sum">合計</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="qtotal">
                          <td className="l">総件数</td>
                          {e.cols.map((c, i) => (
                            <td key={i} className={c === 0 ? "z" : ""}>
                              {num(c)}
                            </td>
                          ))}
                          <td className="sum">{num(e.total)}</td>
                        </tr>
                        {rows.map((row) => (
                          <tr key={row.stage} className={"cat-" + row.cat}>
                            <td className="l">
                              <span
                                className="stripe"
                                style={{ background: CAT_COLOR[row.cat] }}
                              />
                              {row.stage}
                            </td>
                            {row.q.map((v, i) => (
                              <td key={i} className={v === 0 ? "z" : ""}>
                                {num(v)}
                              </td>
                            ))}
                            <td className={"sum" + (row.total === 0 ? " z" : "")}>
                              {num(row.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {isOpen && hiddenCount > 0 && (
                    <div className="qcard-foot">0件のステータス {hiddenCount} 件を非表示中</div>
                  )}
                </div>
              );
            })}
            </div>
            </>
          ))}

          {activeTab === "cases" && yearAgg && yearAgg.noDate > 0 && (
            <p className="note-line">
              ※「{dateLabel}」が空欄で四半期に振り分けられない案件が {fmt(yearAgg.noDate)} 件あります（別の基準日に切り替えると変わります）。
            </p>
          )}
        </>
      )}

      <Modal
        open={!!delTarget}
        title="タスクの削除"
        onClose={() => setDelTarget(null)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setDelTarget(null)} disabled={deleting}>
              キャンセル
            </button>
            <button className="mini-btn danger" onClick={doRemoveAdhoc} disabled={deleting}>
              {deleting ? "削除中…" : "削除する"}
            </button>
          </>
        }
      >
        <span className="modal-strong">「{delTarget?.task}」</span> を削除します。
        <p className="modal-note">
          このタスクの優先順・対応者・編集した内容もあわせて削除されます。工数の入力が既にある場合、実績は残ります。
        </p>
      </Modal>

      {/* シート連携（受注数・完了数）の設定 */}
      <Modal
        open={!!cfgTask}
        title="シート連携（受注数・完了数）"
        onClose={() => setCfgTask(null)}
        footer={
          <button className="save-btn" onClick={() => setCfgTask(null)}>
            閉じる
          </button>
        }
      >
        {cfgTask &&
          (() => {
            const o = ovOf("adhoc", cfgTask);
            const set = (k, v) => setOvField("adhoc", cfgTask, k, v);
            return (
              <div className="modal-fields">
                <div className="modal-strong">「{cfgTask}」</div>
                <label className="fld">
                  スプレッドシートURL（対象のタブを開いた状態でコピー）
                  <input
                    type="text"
                    value={o.sheetUrl || ""}
                    onChange={(e) => set("sheetUrl", e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=..."
                  />
                </label>
                <div className="cfg-grid">
                  <label className="fld">
                    受注数のセル
                    <input
                      type="text"
                      value={o.orderCell || ""}
                      onChange={(e) => set("orderCell", e.target.value)}
                      placeholder="例：C2"
                    />
                  </label>
                  <label className="fld">
                    完了数のセル
                    <input
                      type="text"
                      value={o.doneCell || ""}
                      onChange={(e) => set("doneCell", e.target.value)}
                      placeholder="例：C3"
                    />
                  </label>
                </div>
                <p className="modal-note">
                  対象シートは「リンクを知っている全員が閲覧可」にしてください。
                  <b>読み取るタブを開いた状態のURL</b>を貼ってください（URL末尾の <code>gid</code> でタブを判別します）。
                  受注数・完了数は<b>同じタブ</b>にある前提です。入力は自動保存され、ダッシュボードの「更新」で最新値を取得します。
                  別タブに分かれている場合はお知らせください。
                </p>
              </div>
            );
          })()}
      </Modal>
    </div>
  );
}
