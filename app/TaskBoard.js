"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import ProgressChart, { CopyChartsBtn } from "./ProgressChart";
import AdhocChart, { ONGOING } from "./AdhocChart";
import Modal from "./Modal";
import Calendar from "./Calendar";
import { holidayName, dowLabel } from "../lib/holidays";
import UpdatedPop from "./UpdatedPop";

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
//     課題・遅延理由/次回アクション/対応人数/対応者/メモ
// null は「余った幅を分け合う列」。メモは幅を決めておき、余りは長文が入る
// 課題・遅延理由／次回アクションに回す（メモだけが極端に広くならないように）。
const ADHOC_COLS = [50, 330, 106, 106, 70, 70, 70, 66, 96, 116, 92, null, null, 78, 118, 240];
const ADHOC_FLEX_MIN = 110; // 幅を分け合う列の最低幅（これを下回ると横スクロール）
const ADHOC_W = ADHOC_COLS.reduce((a, b) => a + (b == null ? ADHOC_FLEX_MIN : b), 0);

// スケジュールの日付ユーティリティ（ISO "YYYY-MM-DD" で扱う）
const pad2 = (n) => String(n).padStart(2, "0");
const isoOfDate = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
const parseIso = (s) => {
  const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};
const dateOfIso = (s) => {
  const p = parseIso(s);
  return p ? new Date(p.y, p.m - 1, p.d) : null;
};
// その日が属する週の月曜日
const mondayOfIso = (s) => {
  const dt = dateOfIso(s);
  if (!dt) return null;
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return isoOfDate(dt);
};
const addDaysIso = (s, n) => {
  const dt = dateOfIso(s);
  if (!dt) return null;
  dt.setDate(dt.getDate() + n);
  return isoOfDate(dt);
};

// Agoda から届いた作業シートの置き場所（Google ドライブ）。
// 依頼を受けたら「アップ先」に置いてスプレッドシートに変換し、
// 完了・保留になったら該当のフォルダへ移す運用に合わせたショートカット。
const DRIVE_FOLDERS = [
  {
    key: "new",
    label: "アップ先",
    url: "https://drive.google.com/drive/u/0/folders/1KFnrcBpPbilgC20wOFlRm-yOpq-tfIha",
  },
  {
    key: "done",
    label: "完了",
    url: "https://drive.google.com/drive/u/0/folders/1ZN1KOn5Ob2jT3dZm5wf_S5-WrvsbS2mm",
  },
  {
    key: "hold",
    label: "保留",
    url: "https://drive.google.com/drive/u/0/folders/1Qi8GMVPSywyle1rr1UftHLicSxZry2g7",
  },
];

// 作業シート保管先（Google ドライブ）へのショートカット。
// only を渡すとそのフォルダだけ出す（追加時は「アップ先」しか使わないため）
function DriveLinks({ note, only }) {
  const folders = only ? DRIVE_FOLDERS.filter((f) => only.includes(f.key)) : DRIVE_FOLDERS;
  return (
    <div className="fld">
      作業シート保管先
      <span className="drive-links">
        {folders.map((f) => (
          <a
            key={f.key}
            className={"drive-link drive-" + f.key}
            href={f.url}
            target="_blank"
            rel="noreferrer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
            {f.label}
          </a>
        ))}
      </span>
      {note && <span className="drive-note">{note}</span>}
    </div>
  );
}

// 優先順の入力欄。
// 1文字打つたびに保存すると、その場で並べ替わって行が動き、入力欄からフォーカスが
// 外れてしまう（「2桁目が打てない＝変更できない」状態になる）。
// 入力中は手元の値だけ更新し、フォーカスが外れたときと Enter で保存する。
function PrioInput({ value, onCommit, label }) {
  const [draft, setDraft] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const v = String(draft).trim();
    if (v === String(value ?? "")) return; // 変わっていなければ何もしない
    onCommit(v);
  };
  return (
    <input
      className="prio-input"
      type="number"
      min="1"
      value={draft}
      aria-label={label}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value ?? "");
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// 日本とベトナムの現在時刻（アナログ＋デジタル）。1秒ごとに書き換える。
// サーバー側では時刻を出さない（描画がズレるため）。画面に出てから動き出す。
const CLOCKS = [
  { key: "jp", label: "日本", tz: "Asia/Tokyo", accent: "#2f6be0" },
  { key: "vn", label: "ベトナム", tz: "Asia/Ho_Chi_Minh", accent: "#d33a2c" },
];

// 指定タイムゾーンの時・分・秒を取り出す
function timeInZone(date, tz) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t) => Number(p.find((x) => x.type === t)?.value || 0);
  return { h: get("hour") % 24, m: get("minute"), s: get("second") };
}

// 文字盤。分の目盛りを60本入れ、針は先を細くした多角形にして輪郭をはっきりさせる。
function ClockFace({ h, m, s, accent }) {
  const R = 50;
  const pt = (deg, r) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [R + r * Math.cos(a), R + r * Math.sin(a)];
  };
  const hourDeg = ((h % 12) + m / 60) * 30;
  const minDeg = (m + s / 60) * 6;
  const secDeg = s * 6;
  const nums = [
    [12, 0],
    [3, 90],
    [6, 180],
    [9, 270],
  ];
  return (
    <svg
      viewBox="0 0 100 100"
      className="clock-face"
      shapeRendering="geometricPrecision"
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="47" fill="#ffffff" stroke="#c9d1e0" strokeWidth="1" />
      {/* 分の目盛り（細い） */}
      {Array.from({ length: 60 }, (_, i) => i * 6).map((deg) =>
        deg % 30 === 0 ? null : (
          <line
            key={"m" + deg}
            x1={pt(deg, 43.5)[0]}
            y1={pt(deg, 43.5)[1]}
            x2={pt(deg, 46)[0]}
            y2={pt(deg, 46)[1]}
            stroke="#c2cad9"
            strokeWidth="0.6"
          />
        )
      )}
      {/* 時の目盛り（太い）。数字を置く 12/3/6/9 は短くする */}
      {Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => {
        const big = deg % 90 !== 0;
        return (
          <line
            key={"h" + deg}
            x1={pt(deg, big ? 39.5 : 43)[0]}
            y1={pt(deg, big ? 39.5 : 43)[1]}
            x2={pt(deg, 46)[0]}
            y2={pt(deg, 46)[1]}
            stroke="#2b3550"
            strokeWidth={big ? 1.7 : 1.2}
          />
        );
      })}
      {nums.map(([n, deg]) => {
        const [x, y] = pt(deg, 33);
        return (
          <text
            key={n}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="11"
            fontWeight="700"
            fill="#2b3550"
          >
            {n}
          </text>
        );
      })}
      {/* 針は先細りの多角形。角を丸めないことで輪郭をはっきりさせる */}
      <g transform={`rotate(${hourDeg} 50 50)`}>
        <polygon points="48.3,56 51.7,56 50.8,26 49.2,26" fill="#10192e" />
      </g>
      <g transform={`rotate(${minDeg} 50 50)`}>
        <polygon points="48.9,58 51.1,58 50.5,15 49.5,15" fill="#10192e" />
      </g>
      <g transform={`rotate(${secDeg} 50 50)`}>
        <line x1="50" y1="62" x2="50" y2="13" stroke={accent} strokeWidth="0.8" />
        <circle cx="50" cy="62" r="2" fill={accent} />
      </g>
      <circle cx="50" cy="50" r="2.6" fill="#10192e" />
      <circle cx="50" cy="50" r="1" fill="#ffffff" />
    </svg>
  );
}

function Clocks() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const fmt = (tz, opts) =>
    now ? new Intl.DateTimeFormat("ja-JP", { timeZone: tz, ...opts }).format(now) : "--";
  return (
    <aside className="clocks" aria-label="現在時刻">
      {CLOCKS.map((c) => {
        const t = now ? timeInZone(now, c.tz) : { h: 0, m: 0, s: 0 };
        return (
          <div key={c.key} className={"clock clock-" + c.key}>
            <span className="clock-label">{c.label}</span>
            <ClockFace h={t.h} m={t.m} s={t.s} accent={c.accent} />
            <span className="clock-time">
              {fmt(c.tz, { hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
          </div>
        );
      })}
    </aside>
  );
}

// ドラッグの取っ手（優先順のセルに出す）
function Grip({ onDragStart, onDragEnd, title }) {
  return (
    <span
      className="adhoc-grip"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={title}
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
  );
}

// スプレッドシートURL → Excel(.xlsx) で書き出すURL。
// Google の標準機能なので API もサービスアカウントも要らない
// （開いている本人のGoogleアカウントの権限でダウンロードされる）。
function xlsxUrlOf(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx` : null;
}

// タスクの削除は一旦無効（誤操作防止のため削除ボタンを出さない）。
// 再開するときはここを true に戻せば、削除ボタンと確認モーダルが復活する。
const ALLOW_TASK_DELETE = false;

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
function AssignCell({ scope, akey, ids, persons, retired = [], allowRetired = false, setAssign }) {
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
  // 選択肢は「在籍中の担当者」＋「退職者のうち、完了タスク or すでに割当済みの人」。
  // 完了したタスクは当時の担当者を残す／設定できる必要があるため、退職しても隠さない。
  const options = [
    ...persons.map((p) => ({ ...p, gone: false })),
    ...retired
      .filter((p) => allowRetired || ids.includes(p.id))
      .map((p) => ({ ...p, gone: true })),
  ];
  const optOf = (id) => options.find((p) => p.id === id);
  const nameOf = (id) => optOf(id)?.name || "?";
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
      {options.length === 0 ? (
        <div className="asg-none">担当者が未登録です</div>
      ) : (
        options.map((p) => (
          <label key={p.id} className="asg-item">
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={() => toggle(p.id)}
            />
            <span>{p.name}</span>
            {p.gone && <span className="asg-ret">退職</span>}
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
            <span
              key={id}
              className={
                "asg-chip" + (i === 0 ? " main" : "") + (optOf(id)?.gone ? " gone" : "")
              }
              title={optOf(id)?.gone ? `${nameOf(id)}（退職）` : undefined}
            >
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
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

// モーダル用の日付欄。ブラウザ標準の日付入力は OS の書式に引きずられて
// 「年/月/日 ()」のように空のかっこが出るため、表示は自前で描き、
// カレンダーだけ隠した input から showPicker() で開く。
function ModalDateField({ label, value, onChange }) {
  const open = (e) => {
    const inp = e.currentTarget.parentNode.querySelector(".dt-native");
    if (inp?.showPicker) inp.showPicker();
    else inp?.click();
  };
  return (
    <div className="fld">
      {label}
      <span className="dt-field modal-dt">
        <input
          className="dt-native"
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          tabIndex={-1}
          aria-hidden="true"
        />
        <button type="button" className="dt-btn" onClick={open} aria-label={`${label}を選択`}>
          <span className={value ? "" : "dt-ph"}>
            {value ? String(value).replace(/-/g, "/") : "未設定"}
          </span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4.5" width="18" height="17" rx="2" />
            <line x1="3" y1="9.5" x2="21" y2="9.5" />
            <line x1="8" y1="2.5" x2="8" y2="6.5" />
            <line x1="16" y1="2.5" x2="16" y2="6.5" />
          </svg>
        </button>
      </span>
    </div>
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

// 表と注記を canvas に描いて画像にする。
// 外部ライブラリ（html-to-image）はこのページのCSS量だと固まってしまうため、
// 表という決まった形を活かして自前で描く。速くて結果も安定する。
const IMG_PAD = 14;
const IMG_SCALE = 2; // 貼り付け先で粗く見えないよう2倍で描く

function cssColor(v, fallback) {
  if (!v || v === "transparent" || v === "rgba(0, 0, 0, 0)") return fallback;
  return v;
}

// セルの中の進捗ピル（On Track など）を丸角で描く
function drawPill(ctx, pill, x, y, w, h) {
  const cs = getComputedStyle(pill);
  const r = pill.getBoundingClientRect();
  const pw = r.width;
  const ph = r.height;
  const px = x + (w - pw) / 2;
  const py = y + (h - ph) / 2;
  const rad = Math.min(ph / 2, 999);
  ctx.beginPath();
  ctx.moveTo(px + rad, py);
  ctx.arcTo(px + pw, py, px + pw, py + ph, rad);
  ctx.arcTo(px + pw, py + ph, px, py + ph, rad);
  ctx.arcTo(px, py + ph, px, py, rad);
  ctx.arcTo(px, py, px + pw, py, rad);
  ctx.closePath();
  ctx.fillStyle = cssColor(cs.backgroundColor, "#ffffff");
  ctx.fill();
  const bc = cssColor(cs.borderColor, null);
  if (bc) {
    ctx.strokeStyle = bc;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = cs.color;
  ctx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pill.textContent.trim(), px + pw / 2, py + ph / 2 + 0.5);
}

// 表を1つ描く。左上の位置と、描いた高さを返す
// セルの中身を行に分ける。
// 見出しの「目標対応件数(Daily)」のように <small> を block で下に出しているものは、
// 画面と同じく2行に分けて描く（1行にまとめると列からはみ出して読めなくなる）。
function cellLines(cell, cs, isHead) {
  const out = [];
  const style = (c) => ({
    font: c.fontWeight + " " + c.fontSize + " " + c.fontFamily,
    size: parseFloat(c.fontSize) || 13,
  });
  const base = style(cs);
  const baseColor = isHead ? "#ffffff" : cs.color;
  let cur = null;
  const add = (text, st, color) => {
    const t = String(text).replace(/\s+/g, " ");
    if (!t.trim()) return;
    if (cur) cur.text += t;
    else {
      cur = { text: t, ...st, color };
      out.push(cur);
    }
  };
  for (const node of cell.childNodes) {
    if (node.nodeType === 3) {
      add(node.nodeValue, base, baseColor);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const ecs = getComputedStyle(node);
    if (ecs.display === "block") {
      cur = null; // ここで行を変える
      add(node.textContent, style(ecs), isHead ? "rgba(255,255,255,0.88)" : ecs.color);
      cur = null;
    } else add(node.textContent, base, baseColor);
  }
  for (const l of out) l.text = l.text.trim();
  return out.filter((l) => l.text);
}

function drawTable(ctx, table, ox, oy, maxCols) {
  const t = table.getBoundingClientRect();
  for (const tr of table.querySelectorAll("tr")) {
    let ci = -1;
    for (const cell of tr.children) {
      ci += 1;
      if (maxCols && ci >= maxCols) break; // ここから右は画像に入れない
      const r = cell.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const x = ox + (r.left - t.left);
      const y = oy + (r.top - t.top);
      const cs = getComputedStyle(cell);
      const isHead = cell.tagName === "TH";
      // 背景（見出しはグラデーションなので代表色で塗る）
      ctx.fillStyle = isHead ? "#2f6be0" : cssColor(cs.backgroundColor, "#ffffff");
      ctx.fillRect(x, y, r.width, r.height);
      // 罫線
      ctx.strokeStyle = isHead ? "rgba(255,255,255,0.35)" : "#d7deea";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, r.width - 1, r.height - 1);
      // 中身
      const pill = cell.querySelector(".st-pill");
      if (pill) {
        drawPill(ctx, pill, x, y, r.width, r.height);
        continue;
      }
      const lines = cellLines(cell, cs, isHead);
      if (!lines.length) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, r.width, r.height);
      ctx.clip();
      ctx.textBaseline = "middle";
      const padL = parseFloat(cs.paddingLeft) || 8;
      const padR = parseFloat(cs.paddingRight) || 8;
      const align = cs.textAlign;
      const hs = lines.map((l) => l.size * 1.28);
      let ly = y + (r.height - hs.reduce((a, b) => a + b, 0)) / 2;
      for (let li = 0; li < lines.length; li++) {
        const l = lines[li];
        ctx.fillStyle = l.color;
        ctx.font = l.font;
        const cy = ly + hs[li] / 2 + 0.5;
        if (align === "left" || align === "start") {
          ctx.textAlign = "left";
          ctx.fillText(l.text, x + padL, cy);
        } else if (align === "right" || align === "end") {
          ctx.textAlign = "right";
          ctx.fillText(l.text, x + r.width - padR, cy);
        } else {
          ctx.textAlign = "center";
          ctx.fillText(l.text, x + r.width / 2, cy);
        }
        ly += hs[li];
      }
      ctx.restore();
    }
  }
  return t.height;
}

// 表＋注記のかたまりを画像にする
async function areaToBlob(area, maxCols) {
  const table = area.querySelector("table");
  if (!table) throw new Error("表が見つかりません");
  const notes = [...area.querySelectorAll(".table-note, .summary-notes li")];
  const noteStyle = notes[0] ? getComputedStyle(notes[0]) : null;
  const noteH = noteStyle ? Math.ceil(parseFloat(noteStyle.lineHeight) || 20) : 0;
  const tRect = table.getBoundingClientRect();
  let tw = Math.ceil(tRect.width);
  if (maxCols) {
    const head = table.querySelector("tr");
    const lastCell = head && head.children[maxCols - 1];
    if (lastCell) tw = Math.ceil(lastCell.getBoundingClientRect().right - tRect.left);
  }
  // 注記が表より長いこともあるので、幅は広い方に合わせる
  let noteW = 0;
  const probe = document.createElement("canvas").getContext("2d");
  if (noteStyle) {
    probe.font = noteStyle.fontWeight + " " + noteStyle.fontSize + " " + noteStyle.fontFamily;
    for (const n of notes) noteW = Math.max(noteW, probe.measureText(n.textContent.trim()).width);
  }
  const W = Math.ceil(Math.max(tw, noteW)) + IMG_PAD * 2;
  const H = Math.ceil(table.getBoundingClientRect().height) + notes.length * noteH + IMG_PAD * 2 + (notes.length ? 8 : 0);

  const cv = document.createElement("canvas");
  cv.width = W * IMG_SCALE;
  cv.height = H * IMG_SCALE;
  const ctx = cv.getContext("2d");
  ctx.scale(IMG_SCALE, IMG_SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // 画面と同じ並び（注記が上か下か）で描く
  let y = IMG_PAD;
  const noteBefore = notes.length > 0 && notes[0].compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING;
  const drawNotes = () => {
    if (!notes.length) return;
    ctx.font = noteStyle.fontWeight + " " + noteStyle.fontSize + " " + noteStyle.fontFamily;
    // 画面の下地は黒っぽいので注記の赤を明るくしているが、
    // 画像は白地に描くので、こちらは元の濃い赤で描く
    ctx.fillStyle = "#c0392b";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const n of notes) {
      ctx.fillText(n.textContent.trim(), IMG_PAD, y + noteH / 2);
      y += noteH;
    }
    y += 8;
  };
  if (noteBefore) drawNotes();
  y += drawTable(ctx, table, IMG_PAD, y, maxCols);
  if (!noteBefore) {
    y += 8;
    drawNotes();
  }

  return new Promise((resolve, reject) =>
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を作れませんでした"))), "image/png")
  );
}

// 表を画像にしてコピーするボタン。
// メールに貼ったときに画面と同じ見た目（赤い注記も含む）になるよう、
// 表と注記をまとめた範囲を PNG にしてクリップボードへ入れる。
function CopyTableBtn({ targetRef, label = "表を画像でコピー", maxCols }) {
  const [state, setState] = useState(""); // "" / "busy" / "done" / "err"
  useEffect(() => {
    if (state !== "done" && state !== "err") return;
    const t = setTimeout(() => setState(""), 1800);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    const node = targetRef.current;
    if (!node || state === "busy") return;
    setState("busy");
    // 横スクロールしている表は見えている分しか測れないので、
    // 描くあいだだけ全幅に広げる（終わったら元に戻す）。
    const scroller = node.querySelector(".dtw, .tw2");
    const undo = [];
    if (scroller && scroller.scrollWidth > scroller.clientWidth) {
      undo.push([scroller, scroller.getAttribute("style") || ""]);
      scroller.style.overflow = "visible";
      scroller.style.width = scroller.scrollWidth + "px";
    }
    try {
      const blob = await areaToBlob(node, maxCols);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setState("done");
    } catch (e) {
      console.error("[copy]", e);
      setState("err");
    } finally {
      for (const [el, style] of undo) el.setAttribute("style", style);
    }
  };

  const title =
    state === "done"
      ? "コピーしました"
      : state === "err"
      ? "コピーできませんでした"
      : label;
  return (
    <button
      type="button"
      className={"icon-btn copy-btn" + (state ? " " + state : "")}
      onClick={copy}
      title={title}
      aria-label={label}
      disabled={state === "busy"}
    >
      {state === "done" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
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
  retired = [],
  ovOf,
  setOvField,
  edit = false,
  onToggleEdit,
  notes = [],
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
  // 退職者も名前を引けるようにする（当時の担当者を「?」にしない）
  const nameOf = (id) =>
    persons.find((p) => p.id === id)?.name || retired.find((p) => p.id === id)?.name || "?";
  const cardRef = useRef(null);
  return (
    <div className="summary-block">
      <div className="sec-row">
        <div className="sec-head">{title}</div>
        {onToggleEdit && <EditToggle on={edit} onToggle={onToggleEdit} />}
        <CopyTableBtn targetRef={cardRef} />
      </div>
      <div className="copy-area" ref={cardRef}>
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
                        <PrioInput
                          value={prioOf(scope, t, "") ?? ""}
                          onCommit={(v) => setPriority(scope, t, v)}
                          label={`${t} の作業優先順`}
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
                        retired={retired}
                        allowRetired={o.status === "Complete"}
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
      {notes.length > 0 && (
        <ul className="summary-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
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
        .then((j) => {
          setSheetCounts(j.items || {});
          setSheetErrors(j.errors || {});
          // 完了済みタスクでサーバーが焼き付けた件数を、こちらの上書きデータにも入れておく。
          // 入れておかないと、次に何か編集して保存したときに消えてしまう。
          const fz = j.frozen || {};
          if (Object.keys(fz).length) {
            const m = { ...ovRef.current };
            for (const [key, v] of Object.entries(fz)) {
              const k = `adhoc|${key}`;
              m[k] = { ...(m[k] || {}), total: v.total, done: v.done };
            }
            ovRef.current = m;
            setOv(m);
          }
        })
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
  // 一度も設定していない（行が無い）ときだけ fallback（シートの#など）を使う。
  // 空にして保存したもの（null）は「優先なし」のまま扱う。
  // そうしないと、シートに#が入っている行は優先を消しても#が戻ってきて消せない。
  const prioOf = (scope, key, fallback) => {
    const v = prio[`${scope}|${key}`];
    return v === undefined ? fallback : v;
  };

  // 作業ごとの担当アサイン（Supabaseに保存）
  const [assign, setAssignMap] = useState({}); // { "scope|key": [person_id,...] }
  const [persons, setPersons] = useState([]); // 在籍中の作業者（対応者の既定の選択肢）
  const [retiredPersons, setRetiredPersons] = useState([]); // 退職した作業者
  useEffect(() => {
    (async () => {
      try {
        const j = await fetch("/api/assign", { cache: "no-store" }).then((r) => r.json());
        // オーナー・管理者は作業者ではないので対応者の選択肢に出さない
        const workers = (j.persons || []).filter(
          (p) => !["owner", "admin"].includes(p.role || "member")
        );
        // 退職者の割当も残す。完了したタスクは「当時の担当者」が分からなくなると
        // 設定し直せないため、退職を理由に割当を捨てない（名前を引けない分だけ除外）。
        const known = new Set(workers.map((p) => p.id));
        const m = {};
        for (const it of j.items || []) {
          if (!known.has(it.person_id)) continue;
          const k = `${it.scope}|${it.key}`;
          if (!m[k]) m[k] = [];
          // 主担当を先頭に保つ
          if (it.role === "main") m[k].unshift(it.person_id);
          else m[k].push(it.person_id);
        }
        setAssignMap(m);
        setPersons(workers.filter((p) => p.active !== false));
        setRetiredPersons(workers.filter((p) => p.active === false));
      } catch {}
    })();
  }, []);
  // 在籍・退職の両方から担当者を引く（表示用）
  const personById = useMemo(() => {
    const m = new Map();
    for (const p of persons) m.set(p.id, p);
    for (const p of retiredPersons) m.set(p.id, p);
    return m;
  }, [persons, retiredPersons]);
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

  // ── スケジュールの予定（タスクとは別に自由に入れるもの）──
  // 置き場所は task_override の scope="event"。key は作ったときの通し番号。
  // 専用テーブルを増やさずに済み、保存も既存の /api/override をそのまま使える。
  const eventList = useMemo(
    () =>
      Object.entries(ov)
        .filter(([k, v]) => k.startsWith("event|") && v && v.title)
        .map(([k, v]) => ({ id: k.slice(6), ...v }))
        .sort((a, b) => String(a.start || "").localeCompare(String(b.start || ""))),
    [ov]
  );
  // 予定の保存（新規・更新とも）。data を丸ごと送る
  const saveEvent = (id, data) => {
    const k = `event|${id}`;
    ovRef.current = { ...ovRef.current, [k]: data };
    setOv(ovRef.current);
    fetch("/api/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "event", key: id, data }),
    }).catch(() => {});
  };
  // 予定の削除（全項目を空にすると行ごと消える仕様に合わせる）
  const removeEvent = (id) => {
    const k = `event|${id}`;
    const m = { ...ovRef.current };
    delete m[k];
    ovRef.current = m;
    setOv(m);
    fetch("/api/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "event", key: id, data: {} }),
    }).catch(() => {});
  };
  const setOvField = (scope, key, field, value) => {
    const k = `${scope}|${key}`;
    const next = { ...(ovRef.current[k] || {}), [field]: value };
    // 完了にした瞬間の件数・完了数を保存しておく。
    // 完了後もシートを読み続けると、タスクが増えるほど表示が遅くなるため
    // （シートのURL・セルの設定はそのまま残す）。
    if (scope === "adhoc" && field === "status" && value === "Complete") {
      const sc = sheetCountsRef.current[key];
      if (sc && (sc.total != null || sc.done != null)) {
        if (sc.total != null) next.total = sc.total;
        if (sc.done != null) next.done = sc.done;
      }
    }
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
  // タスク名 → シート由来の元データ（詳細編集で「上書きが無いときの値」を出すのに使う）
  const adhocByTask = useMemo(() => {
    const m = new Map();
    for (const a of adhoc || []) m.set(a.task, a);
    return m;
  }, [adhoc]);
  const [adhocTab, setAdhocTab] = useState("active"); // active（対応中）/ done（完了）
  // 各Ad Hocタスクの受注数・完了数（登録シートのセルから取得）: { [task]: {total, done} }
  const [sheetCounts, setSheetCounts] = useState({});
  // setOvField（毎回作り直される）から最新の値を読むための控え
  const sheetCountsRef = useRef({});
  sheetCountsRef.current = sheetCounts;
  // シートを読めなかったタスクの理由（連携ボタンとモーダルに出す）
  const [sheetErrors, setSheetErrors] = useState({});
  // シート連携の設定モーダル対象タスク
  const [cfgTask, setCfgTask] = useState(null);
  // 詳細編集モーダル（管理表に列が無い項目）の対象タスク
  const [detailTask, setDetailTask] = useState(null);
  // Google ドライブ連携（未設定なら関連UIを出さない）
  const [driveCfg, setDriveCfg] = useState(null);
  useEffect(() => {
    fetch("/api/drive-upload", { cache: "no-store" })
      .then((r) => r.json())
      .then(setDriveCfg)
      .catch(() => setDriveCfg({ configured: false }));
  }, []);
  // タスク追加モーダルでの Excel アップロード
  const [upBusy, setUpBusy] = useState(false);
  const [upErr, setUpErr] = useState(null);
  const [upDone, setUpDone] = useState(null);
  const uploadExcel = async (file) => {
    if (!file) return;
    setUpErr(null);
    setUpDone(null);
    setUpBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // 入力済みならタスク名でシートを作る（未入力なら元のファイル名）
      if (newTask.trim()) fd.append("name", newTask.trim());
      const j = await fetch("/api/drive-upload", { method: "POST", body: fd }).then((r) => r.json());
      if (j.error) setUpErr(j.error);
      else {
        setAF("sheetUrl", j.url);
        setUpDone(j.name);
        if (!newTask.trim() && j.name) setNewTask(j.name);
      }
    } catch (e) {
      setUpErr(String(e?.message || e));
    } finally {
      setUpBusy(false);
    }
  };
  // 作業シートをフォルダ間で移動する
  const [moveMsg, setMoveMsg] = useState(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const moveSheet = async (url, to) => {
    setMoveMsg(null);
    setMoveBusy(true);
    try {
      const j = await fetch("/api/drive-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, to }),
      }).then((r) => r.json());
      setMoveMsg(j.error ? `エラー：${j.error}` : `「${j.label}」フォルダへ移動しました`);
    } catch (e) {
      setMoveMsg(`エラー：${String(e?.message || e)}`);
    } finally {
      setMoveBusy(false);
    }
  };
  // Ad Hoc の手動並べ替え（同一優先度内の順番）
  const adhocDragIndex = useRef(null);
  const [adhocDragOver, setAdhocDragOver] = useState(null);

  // サイトで追加した Ad Hoc タスク（シート由来の分と結合して表示）
  const [customAdhoc, setCustomAdhoc] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newBoard, setNewBoard] = useState("adhoc"); // 追加するタスクの区分（adhoc / regular）
  const [addError, setAddError] = useState(null);
  const [addBusy, setAddBusy] = useState(false);
  // 追加モーダルで一緒に設定する項目（追加後に個別設定して回らなくて済むように）
  const ADD_FORM_INIT = {
    status: "On Track",
    start: "",
    end: "",
    prio: "",
    assign: [],
    sheetUrl: "",
    orderCell: "",
    doneCell: "",
    daily: "",
    effort: "",
    issue: "",
    next: "",
    memo: "",
  };
  const [addForm, setAddForm] = useState(ADD_FORM_INIT);
  const setAF = (k, v) => setAddForm((f) => ({ ...f, [k]: v }));
  const toggleAddAssign = (id) =>
    setAddForm((f) => ({
      ...f,
      assign: f.assign.includes(id) ? f.assign.filter((x) => x !== id) : [...f.assign, id],
    }));
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
  // 追加フォームはモーダルで開く。開くたびに前回の入力・エラーを消す。
  const openAdd = () => {
    setNewTask("");
    setNewBoard("adhoc");
    setAddForm(ADD_FORM_INIT);
    setAddError(null);
    setUpErr(null);
    setUpDone(null);
    setAdding(true);
  };
  const closeAdd = () => {
    if (addBusy) return;
    setAdding(false);
    setNewTask("");
    setNewBoard("adhoc");
    setAddForm(ADD_FORM_INIT);
    setAddError(null);
  };
  const addAdhoc = async () => {
    const name = newTask.trim();
    if (!name || addBusy) return;
    setAddError(null);
    setAddBusy(true);
    const j = await fetch("/api/adhoc-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 区分も渡して、工数側の作業種別（Regular / Ad hoc）に引き継ぐ
      body: JSON.stringify({ task: name, board: newBoard }),
    })
      .then((r) => r.json())
      .catch((e) => ({ error: String(e?.message || e) }));
    setAddBusy(false);
    if (j.error) {
      setAddError(j.error);
      return;
    }
    // モーダルで入力した項目をまとめて反映する。
    // setOvField は同じキーぶんをまとめて1回で保存するので、順に呼んで問題ない。
    // 進捗の既定は「On Track」。未設定だと工数入力に出る条件が判断できないため。
    setOvField("adhoc", name, "status", addForm.status || "On Track");
    // Regular 区分として追加する場合は、カスタムタスクに区分マーカーを付ける
    // （設定は scope="adhoc" に保存し、表示上 Regular セクションに並べる）
    if (newBoard === "regular") {
      setOvField("adhoc", name, "board", "regular");
    }
    if (addForm.start) setOvField("adhoc", name, "start", fromDateInput(addForm.start));
    if (addForm.end) setOvField("adhoc", name, "end", fromDateInput(addForm.end));
    if (addForm.sheetUrl) setOvField("adhoc", name, "sheetUrl", addForm.sheetUrl.trim());
    if (addForm.orderCell) setOvField("adhoc", name, "orderCell", addForm.orderCell.trim());
    if (addForm.doneCell) setOvField("adhoc", name, "doneCell", addForm.doneCell.trim());
    for (const k of ["daily", "effort", "issue", "next", "memo"]) {
      if (String(addForm[k] || "").trim()) setOvField("adhoc", name, k, addForm[k].trim());
    }
    if (addForm.assign.length) setAssign("adhoc", name, addForm.assign);
    if (String(addForm.prio).trim()) setPriority("adhoc", name, addForm.prio);

    setNewTask("");
    setNewBoard("adhoc");
    setAddForm(ADD_FORM_INIT);
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

  // Regular Task の表の下に出す注記（受注数の数え方の断り書き）
  const REGULAR_NOTES = [
    "※[受注数]は、[対応不要]及び[失注]の件数を除外しています。",
    "※[受注数]は、[事前登録施設（依頼前）]の件数を除外しています。",
  ];

  // 進捗表の中の切り替え（Regular Task / Ad Hoc Task）
  const [tableTab, setTableTab] = useState("regular");
  useEffect(() => {
    try {
      const v = localStorage.getItem("agoda-table-tab");
      if (v === "regular" || v === "adhoc") setTableTab(v);
    } catch {}
  }, []);
  const switchTableTab = (v) => {
    setTableTab(v);
    try {
      localStorage.setItem("agoda-table-tab", v);
    } catch {}
  };

  // 進捗グラフの中の切り替え（Regular Task / Ad Hoc Task）
  const [graphTab, setGraphTab] = useState("regular");
  useEffect(() => {
    try {
      const v = localStorage.getItem("agoda-graph-tab");
      if (v === "regular" || v === "adhoc") setGraphTab(v);
    } catch {}
  }, []);
  const switchGraphTab = (v) => {
    setGraphTab(v);
    try {
      localStorage.setItem("agoda-graph-tab", v);
    } catch {}
  };

  // Ad Hoc 表のコピー用（表の DOM をそのまま読むため）
  const adhocCardRef = useRef(null);
  // 進捗グラフのコピー用（グラフの入れ物を指す）
  const graphGridRef = useRef(null);
  const adhocGridRef = useRef(null);

  // 進捗グラフの並び（ドラッグで並べ替え）。
  // 置き場所は task_override の scope="graph"、key は regular / pending / adhoc。
  // 全員に同じ並びで見せたいのでサーバーに保存する（編集権限のある人だけ動かせる）。
  const graphOrderOf = (key) => ov[`graph|${key}`]?.order;
  const saveGraphOrder = (key, order) => {
    const k = `graph|${key}`;
    ovRef.current = { ...ovRef.current, [k]: { order } };
    setOv(ovRef.current);
    fetch("/api/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "graph", key, data: { order } }),
    }).catch(() => {});
  };

  // 予定の追加・編集モーダル（null = 閉じている）
  const [evForm, setEvForm] = useState(null); // { id, title, start, end, memo, isNew }
  const openNewEvent = (iso) =>
    setEvForm({
      id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: "",
      start: iso || "",
      end: "",
      memo: "",
      isNew: true,
    });
  const openEditEvent = (id) => {
    const ev = eventList.find((x) => x.id === id);
    if (!ev) return;
    setEvForm({
      id,
      title: ev.title || "",
      start: toDateInput(ev.start) || "",
      end: toDateInput(ev.end) || "",
      memo: ev.memo || "",
      isNew: false,
    });
  };
  const submitEvent = () => {
    if (!evForm) return;
    const title = String(evForm.title || "").trim();
    if (!title || !evForm.start) return;
    const data = { title, start: evForm.start };
    if (evForm.end) data.end = evForm.end;
    if (String(evForm.memo || "").trim()) data.memo = String(evForm.memo).trim();
    saveEvent(evForm.id, data);
    setEvForm(null);
  };

  // 表示タブ（スケジュール / 進捗）。
  // 「全体」と「案件詳細」は1ページにまとめて「進捗」にした。
  const [tab, setTab] = useState("progress");
  useEffect(() => {
    try {
      const v = localStorage.getItem("agoda-dash-tab");
      if (v === "schedule") setTab("schedule");
      else if (v === "graph") setTab("graph");
      // 旧「全体 / 案件詳細」の保存値は進捗表に読み替える
      else if (v === "overview" || v === "cases" || v === "progress") setTab("progress");
    } catch {}
  }, []);
  const switchTab = (v) => {
    setTab(v);
    try {
      localStorage.setItem("agoda-dash-tab", v);
    } catch {}
  };
  // タブが3つになり幅も不揃いなので、選択中ボタンの実寸からスライダーを合わせる。
  // タブバーは読み込み完了後に描画されるため、ref はコールバックで受け取り
  // 「実際にDOMに出た時点」で計測する（useRef だと初回に間に合わず選択が見えなくなる）。
  const [segEl, setSegEl] = useState(null);
  const [segThumb, setSegThumb] = useState(null);
  useEffect(() => {
    if (!segEl) return;
    const fit = () => {
      const el = segEl.querySelector(`.segbar-btn[data-tab="${tab}"]`);
      if (el) setSegThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [segEl, tab]);

  // 管理表のフィルター（区分／進捗）も、選択中の枠が滑らかに移動するようにする
  const [fltEl, setFltEl] = useState(null);
  const [fltThumb, setFltThumb] = useState(null);
  const [subEl, setSubEl] = useState(null);
  const [subThumb, setSubThumb] = useState(null);
  // 枠の位置は「親のパディング箱」からの距離で測る（offsetLeft だと枠線ぶんずれる）
  const measureThumb = (box) => {
    const el = box?.querySelector(".mng-filter-btn.active");
    if (!el) return null;
    const br = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!r.width) return null; // 非表示中は測らない
    const origin = br.left + (parseFloat(getComputedStyle(box).borderLeftWidth) || 0);
    return { left: Math.round(r.left - origin), width: Math.round(r.width) };
  };
  useEffect(() => {
    if (!fltEl) return;
    const fit = () => {
      const m = measureThumb(fltEl);
      if (m) setFltThumb(m);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fltEl, mngFilter]);
  useEffect(() => {
    if (!subEl) return;
    const fit = () => {
      const m = measureThumb(subEl);
      if (m) setSubThumb(m);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [subEl, mngStatus, mngFilter]);

  // スケジュールタブ：選択中の日付（既定は今日）と、左側カレンダーの基準月。
  // カレンダーは2つ並べるが、月送りは共通なので常に「当月＋翌月」の関係が崩れない。
  const [schedDate, setSchedDate] = useState(() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const [schedYm, setSchedYm] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });
  // 予定の表示範囲：日 / 週 / 月
  const [schedRange, setSchedRange] = useState("day");
  const shiftYm = ({ y, m }, delta) => {
    const n = m + delta;
    if (n < 1) return { y: y - 1, m: 12 };
    if (n > 12) return { y: y + 1, m: 1 };
    return { y, m: n };
  };
  const navSched = (delta) => setSchedYm((v) => shiftYm(v, delta));
  const todaySched = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    setSchedYm({ y: d.getFullYear(), m: d.getMonth() + 1 });
    setSchedDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  };
  // Ad Hoc タスクの開始日・期日を日付ごとにまとめてカレンダーの予定にする
  const schedEvents = useMemo(() => {
    const seen = new Set((adhoc || []).map((a) => a.task));
    const list = [
      ...(adhoc || []),
      ...(customAdhoc || []).filter((c) => !seen.has(c.task)).map((c) => ({ task: c.task })),
    ];
    const map = {};
    const push = (iso, item) => {
      if (!iso) return;
      (map[iso] = map[iso] || []).push(item);
    };
    for (const t of list) {
      const o = ov[`adhoc|${t.task}`] || EMPTY_OV;
      const name = o.name ?? t.task;
      const status = o.status ?? t.status ?? "";
      push(toDateInput(o.start ?? t.start), { task: name, status, kind: "start" });
      push(toDateInput(o.end ?? t.end), { task: name, status, kind: "end" });
    }
    // 自由に入れた予定。期間があれば開始日から終了日まで毎日出す
    for (const ev of eventList) {
      const from = toDateInput(ev.start);
      if (!from) continue;
      const to = toDateInput(ev.end) || from;
      let d = from;
      // 期間が長すぎるデータでも止まらないように上限を付ける
      for (let i = 0; i < 400 && d <= to; i++) {
        push(d, { task: ev.title, kind: "event", id: ev.id, memo: ev.memo || "" });
        d = addDaysIso(d, 1);
      }
    }
    // 同じ日は「予定 → 期日 → 開始」の順に出す（自分で入れたものを上に）
    const rank = { event: 0, end: 1, start: 2 };
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));
    }
    return map;
  }, [adhoc, customAdhoc, ov, eventList]);

  // 表示制御：0件ステータスを隠す／カードの折りたたみ
  const [hideZero, setHideZero] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const toggleCard = (t) => setCollapsed((p) => ({ ...p, [t]: !p[t] }));

  // プロジェクト進捗のカードは並べ替えない（案件タイプの既定の順で出す）。
  // 並びは2列固定で、Stage の体系ごとに縦に並べる。
  //   左：Hotel・Temairazu（1〜7の番号付きStage＝A群）
  //   右：ACQ・Liberty・IHM（YCS作成中〜完了のStage＝B群）
  // 体系の分からない案件タイプは右に置く。
  const displayTypes = renderTypes;
  const typeColumns = useMemo(() => {
    const left = [];
    const right = [];
    for (const t of displayTypes) (TYPE_GROUP[t] === "A" ? left : right).push(t);
    return [left, right];
  }, [displayTypes]);

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

  // 進捗グラフに出す Ad Hoc タスク（対応中のもの＝On Track / Behind / Onhold）。
  // 並びは表と同じ「優先」順。
  const adhocOngoing = useMemo(() => {
    const seen = new Set((adhoc || []).map((a) => a.task));
    const all = [
      ...(adhoc || []),
      ...(customAdhoc || []).filter((c) => !seen.has(c.task)).map((c) => ({ task: c.task })),
    ];
    return all
      .map((t, i) => {
        const o = ov[`adhoc|${t.task}`] || EMPTY_OV;
        return { key: t.task, label: t.task, status: o.status ?? t.status, no: t.no, i };
      })
      .filter((r) => ONGOING.includes(r.status))
      .map((r) => ({ ...r, p: prioOf("adhoc", r.key, r.no) }))
      .sort((a, b) => {
        const na = a.p == null ? Infinity : a.p;
        const nb = b.p == null ? Infinity : b.p;
        return na - nb || a.i - b.i;
      });
  }, [adhoc, customAdhoc, ov, prio]);

  // Ad Hoc 表にある全タスク名（完了ぶんも含む）。
  // グラフ側で「表には無いがプロジェクト単位で記録が残っているもの」を見分けるのに使う。
  const adhocKnown = useMemo(() => {
    const s = new Set((adhoc || []).map((a) => a.task));
    for (const c of customAdhoc || []) s.add(c.task);
    return s;
  }, [adhoc, customAdhoc]);

  // その日の受注数・完了数を1日1回だけ記録する。
  // Ad Hoc の件数はシートの「今の値」しか読めず、後から遡って数え直せないため。
  // シートの読み込みは表示より遅れて届くので、一度きりではなく
  // 「送る中身が変わったら送り直す」（同じ日への保存は上書きなので何度でも安全）。
  const savedSigRef = useRef(null);
  useEffect(() => {
    if (!adhocOngoing.length) return;
    const p = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const items = {};
    for (const t of adhocOngoing) {
      const o = ov[`adhoc|${t.key}`] || EMPTY_OV;
      const sc = sheetCounts[t.key] || kintoneCounts[t.key];
      const total = sc?.total != null ? sc.total : o.total;
      const done = sc?.done != null ? sc.done : o.done;
      if (total == null && done == null) continue;
      items[t.key] = { total, done };
    }
    if (!Object.keys(items).length) return;
    const sig = today + "|" + JSON.stringify(items);
    if (savedSigRef.current === sig) return;
    savedSigRef.current = sig;
    fetch("/api/adhoc-daily", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: today, items }),
    }).catch(() => {});
  }, [adhocOngoing, sheetCounts, kintoneCounts, ov]);

  // Regular Task サマリーの対象（IHM は Ad Hoc 扱いのため除外）
  const REGULAR_EXCLUDE = new Set(["IHM"]);
  const regularTypes = renderTypes.filter((t) => !REGULAR_EXCLUDE.has(t));

  const fmt = (n) => n.toLocaleString("ja-JP");
  const dateLabel =
    dateOptions.find((o) => o.code === dateCode)?.label || dateCode;
  // 編集モード（プロジェクト管理）は Regular ＋ Ad Hoc の編集に集中するため
  // 編集画面（プロジェクト管理）はタブを使わない。
  const activeTab = isEdit ? "edit" : tab;

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
          <UpdatedPop />
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
            <div className="segbar" role="tablist" aria-label="表示切替" ref={setSegEl}>
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
              data-tab="progress"
              aria-selected={tab === "progress"}
              className={"segbar-btn" + (tab === "progress" ? " active" : "")}
              onClick={() => switchTab("progress")}
            >
              進捗表
            </button>
            <button
              type="button"
              role="tab"
              data-tab="graph"
              aria-selected={tab === "graph"}
              className={"segbar-btn" + (tab === "graph" ? " active" : "")}
              onClick={() => switchTab("graph")}
            >
              進捗グラフ
            </button>
            </div>
            {/* 対象年は「進捗」の集計に使うもの。
                スケジュールは Ad Hoc の開始日・期日で表示するので出さない。 */}
            {years.length > 0 && activeTab !== "schedule" && (
              <label className="head-year head-year-bare">
                <select
                  value={year ?? ""}
                  onChange={(e) => setYear(Number(e.target.value))}
                  aria-label="対象年"
                >
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
            // 開始日を比較用の数値（YYYYMMDD）に。未設定は最後に回す
            const startNum = (r) => {
              const m = r.start && String(r.start).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
              return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : -Infinity;
            };
            const byPrio = (arr, scope) =>
              [...arr]
                .map((r, i) => ({ r, i, p: effPrio(scope, r.key, r.no) }))
                .sort((a, b) => {
                  // 優先が入っているものが先（小さい番号ほど上）
                  if (a.p != null && b.p != null) return a.p - b.p || a.i - b.i;
                  if (a.p != null) return -1;
                  if (b.p != null) return 1;
                  // ここから「優先が未設定」同士。
                  // Complete は開始日の新しい順で、優先なしグループの先頭に並べる。
                  const ca = (a.r.status || "") === "Complete";
                  const cb = (b.r.status || "") === "Complete";
                  if (ca !== cb) return ca ? -1 : 1;
                  if (ca && cb) return startNum(b.r) - startNum(a.r) || a.i - b.i;
                  return a.i - b.i;
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
            // 完了した作業は順位を持たない（表示も「—」）ので並べ替えの対象から外す
            const isRanked = (r) => (r.status || "") !== "Complete";
            // 並べ替えたあと、上から 1,2,3… を振り直す。
            // 工数グルーピングが同じ作業は「1つの塊」として同じ番号にする
            // （IHM_CM / IHM_Plan / IHM_Room がまとめて 3 になる、という従来の付け方に合わせる）。
            const renumber = (scope, keys) => {
              const numOf = new Map(); // グループ → 番号
              let n = 0;
              for (const k of keys) {
                const g = ovOf(scope, k).kosuLink || k;
                if (!numOf.has(g)) numOf.set(g, ++n);
                setPriority(scope, k, numOf.get(g));
              }
            };
            const dragEnd = () => {
              mngDragKey.current = null;
              setMngOverKey(null);
            };
            const canDropOn = (row) => {
              const from = mngDragKey.current;
              return !!from && from.scope === row.scope && from.kind === row.kind && from.key !== row.key;
            };
            const onDrop = (row) => {
              if (!canDropOn(row) || !isRanked(row)) return dragEnd();
              const from = mngDragKey.current;
              const keys = rows
                .filter((r) => r.scope === row.scope && r.kind === row.kind && isRanked(r))
                .map((r) => r.key);
              const fi = keys.indexOf(from.key);
              const ti = keys.indexOf(row.key);
              if (fi < 0 || ti < 0) return dragEnd();
              const moved = keys.splice(fi, 1)[0];
              keys.splice(ti, 0, moved);
              renumber(row.scope, keys);
              dragEnd();
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
                  <div
                    className="mng-filter"
                    role="group"
                    aria-label="区分で絞り込み"
                    ref={setFltEl}
                    style={fltThumb ? { "--thumb-x": fltThumb.left + "px", "--thumb-w": fltThumb.width + "px" } : undefined}
                  >
                    <span className={"mng-filter-thumb" + (fltThumb ? " on" : "")} aria-hidden="true" />
                    <button type="button" className={"mng-filter-btn" + (mngFilter === "all" ? " active" : "")} onClick={() => setMngFilter("all")}>すべて<span className="mng-fcount">{cnt.all}</span></button>
                    <button type="button" className={"mng-filter-btn" + (mngFilter === "regular" ? " active" : "")} onClick={() => setMngFilter("regular")}>Regular<span className="mng-fcount">{cnt.regular}</span></button>
                    <button type="button" className={"mng-filter-btn" + (mngFilter === "pending" ? " active" : "")} onClick={() => setMngFilter("pending")}>Pending<span className="mng-fcount">{cnt.pending}</span></button>
                    <button type="button" className={"mng-filter-btn" + (mngFilter === "adhoc" ? " active" : "")} onClick={() => setMngFilter("adhoc")}>Ad Hoc<span className="mng-fcount">{cnt.adhoc}</span></button>
                  </div>
                  {mngFilter === "adhoc" && (
                    <div
                      className="mng-filter mng-filter-sub"
                      role="group"
                      aria-label="進捗で絞り込み"
                      ref={setSubEl}
                      style={subThumb ? { "--thumb-x": subThumb.left + "px", "--thumb-w": subThumb.width + "px" } : undefined}
                    >
                      <span className={"mng-filter-thumb" + (subThumb ? " on" : "")} aria-hidden="true" />
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
                      {/* 追加はモーダルで行う（表の見出し行にフォームを差し込まない） */}
                      <button type="button" className="icon-btn" onClick={openAdd} title="タスク追加" aria-label="タスク追加">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
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
                        const ranked = isRanked(row);
                        const dragOn = editable && ranked;
                        return (
                          <tr
                            key={rk}
                            className={mngOverKey === rk ? "row-dragover" : undefined}
                            onDragOver={
                              dragOn
                                ? (e) => {
                                    if (!canDropOn(row)) return;
                                    e.preventDefault();
                                    if (mngOverKey !== rk) setMngOverKey(rk);
                                  }
                                : undefined
                            }
                            onDrop={dragOn ? () => onDrop(row) : undefined}
                          >
                            <td className="prio-td">
                              {editable ? (
                                <span className="prio-edit">
                                  {ranked && (
                                    <Grip
                                      onDragStart={() => {
                                        mngDragKey.current = { scope: row.scope, key: row.key, kind: row.kind };
                                      }}
                                      onDragEnd={dragEnd}
                                      title="ドラッグで並べ替え（離すと上から順に番号を付け直します）"
                                    />
                                  )}
                                  <PrioInput
                                    value={effPrio(row.scope, row.key, row.no) ?? ""}
                                    onCommit={(v) => setPriority(row.scope, row.key, v)}
                                    label={`${row.key} の作業優先順`}
                                  />
                                </span>
                              ) : (
                                effPrio(row.scope, row.key, row.no) ?? "—"
                              )}
                            </td>
                            <td><span className={"mng-badge " + kindBadge[row.kind]}>{row.kind}</span></td>
                            <td className="l">
                              <span className="mng-task-cell">
                                {editable ? (
                                  <input className="ed-input" type="text" value={o.name ?? row.key} onChange={(e) => setOvField(row.scope, row.key, "name", e.target.value)} />
                                ) : (
                                  <span className="mng-task-name">{o.name ?? row.key}</span>
                                )}
                                {/* グルーピングとシート連携の印は、タスク列の右端に寄せる */}
                                {row.kind === "Ad Hoc" && editable && (
                                  <span className="mng-task-marks">
                                    {/* 工数グルーピング：複数の名前の作業を工数側で1つにまとめる */}
                                    <KosuLinkCell
                                      value={o.kosuLink || ""}
                                      contents={kosuContents}
                                      onChange={(v) => setOvField(row.scope, row.key, "kosuLink", v)}
                                    />
                                    <button
                                      type="button"
                                      className={
                                        "klink-btn klink-sheet" +
                                        (o.sheetUrl ? " on" : "") +
                                        (sheetErrors[row.key] ? " ng" : "")
                                      }
                                      onClick={() => setCfgTask(row.key)}
                                      title={
                                        sheetErrors[row.key]
                                          ? "シートを読めませんでした：" + sheetErrors[row.key]
                                          : "スプレッドシート連携（受注数・完了数を自動取得）"
                                      }
                                      aria-label="シート連携を設定"
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                        <line x1="3" y1="9" x2="21" y2="9" />
                                        <line x1="9" y1="9" x2="9" y2="21" />
                                      </svg>
                                    </button>
                                  </span>
                                )}
                                {/* 紐づけ先が自分と同じ名前でも「設定済み」なので印を出す
                                    （編集中のボタンは点灯するのに、編集を終えると消えてしまうため） */}
                                {!editable &&
                                  row.kind === "Ad Hoc" &&
                                  (o.kosuLink || o.sheetUrl) && (
                                    <span className="mng-task-marks">
                                      {o.kosuLink && (
                                        <span
                                          className="mng-link-mark"
                                          title={
                                            o.kosuLink === row.key
                                              ? `工数明細の作業：\n${o.kosuLink}`
                                              : `工数はこの作業にまとめています：\n${o.kosuLink}`
                                          }
                                          aria-label="工数グルーピングあり"
                                        >
                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                                        </span>
                                      )}
                                      {o.sheetUrl && (
                                        <span className={"mng-link-mark sheet" + (sheetErrors[row.key] ? " ng" : "")} title={sheetErrors[row.key] ? `シートを読めませんでした：
${sheetErrors[row.key]}` : `スプレッドシート連携中（受注数・完了数を自動取得）
${o.sheetUrl}`} aria-label={sheetErrors[row.key] ? "シートを読めませんでした" : "シート連携あり"}>
                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="9" x2="9" y2="21" /></svg>
                                        </span>
                                      )}
                                    </span>
                                  )}
                              </span>
                            </td>
                            <td className="mng-date">{row.kind === "Ad Hoc" ? (editable ? dateField(row, "start") : (row.start || "—")) : <span className="mng-dim">—</span>}</td>
                            <td className="mng-date">{row.kind === "Ad Hoc" ? (editable ? dateField(row, "end") : (row.end || "—")) : <span className="mng-dim">—</span>}</td>
                            <td className="l">{editable ? (<AssignCell scope={row.scope} akey={row.key} ids={ids} persons={persons} retired={retiredPersons} allowRetired={row.status === "Complete"} setAssign={setAssign} />) : (ids.length ? ids.map((id) => { const p = personById.get(id); return p ? (<span key={id} className={"mng-asg-name" + (p.active === false ? " gone" : "")} title={p.active === false ? `${p.name}（退職）` : undefined}>{p.name}</span>) : null; }).filter(Boolean) : "—")}</td>
                            <td>{editable ? (<select className="ed-input ed-sel" value={row.status || ""} onChange={(e) => setOvField(row.scope, row.key, "status", e.target.value)}><option value="">—</option>{STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}</select>) : (<span className={"st-pill " + statusClass(row.status)}>{row.status || "—"}</span>)}</td>
                            <td className="v-strong">{row.count == null ? "—" : row.count}</td>
                            <td>{row.done == null ? "—" : row.done}</td>
                            <td>{row.rate == null ? "—" : row.rate + "%"}</td>
                            {/* 操作：シートを開く／詳細編集／削除。
                                scope=adhoc（Ad Hoc・区分Regularで追加した分）だけが対象。 */}
                            <td className="mng-ops">{row.scope === "adhoc" && (o.sheetUrl || editable || (ALLOW_TASK_DELETE && row.customId)) ? (
                              <span className="mng-ops-wrap">
                                {/* 表に列が無い項目（目標対応件数・実作業工数・課題・次回アクション・メモ） */}
                                {editable && (
                                  <button type="button" className="forms-op" title="詳細を編集（目標対応件数・実作業工数・課題・遅延理由・次回アクション・メモ）" aria-label="詳細を編集" onClick={() => { setMoveMsg(null); setDetailTask(row.key); }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="7" x2="21" y2="7" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="17" x2="16" y2="17" /><line x1="3.5" y1="7" x2="3.51" y2="7" /><line x1="3.5" y1="12" x2="3.51" y2="12" /><line x1="3.5" y1="17" x2="3.51" y2="17" /></svg>
                                  </button>
                                )}
                                {/* 作業シートを Excel(.xlsx) で落とす。提出用にそのまま使える */}
                                {o.sheetUrl && xlsxUrlOf(o.sheetUrl) && (
                                  <a className="forms-op dl" href={xlsxUrlOf(o.sheetUrl)} target="_blank" rel="noreferrer" title={"作業シートを Excel(.xlsx) でダウンロード\n" + (o.name ?? row.key)} aria-label="Excelでダウンロード">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                  </a>
                                )}
                                {/* 連携済みならスプレッドシートを直接開けるようにする（閲覧時も表示） */}
                                {o.sheetUrl && (
                                  <a className="forms-op on" href={o.sheetUrl} target="_blank" rel="noreferrer" title={"スプレッドシートを開く\n" + o.sheetUrl} aria-label="スプレッドシートを開く">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                                  </a>
                                )}
                                {/* シート連携の設定ボタンはタスク名の横（グルーピングの隣）へ移設 */}
                                {ALLOW_TASK_DELETE && row.customId && (
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

          {activeTab === "progress" && !isEdit && (
            <div className="sec-row sub-tabs">
              <div className="segbar segbar-sm" role="tablist" aria-label="進捗表の表示切替">
                <span
                  className="segbar-thumb"
                  style={{ transform: `translateX(${tableTab === "adhoc" ? "100%" : "0%"})` }}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableTab === "regular"}
                  className={"segbar-btn" + (tableTab === "regular" ? " active" : "")}
                  onClick={() => switchTableTab("regular")}
                >
                  Regular Task
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tableTab === "adhoc"}
                  className={"segbar-btn" + (tableTab === "adhoc" ? " active" : "")}
                  onClick={() => switchTableTab("adhoc")}
                >
                  Ad Hoc Task
                </button>
              </div>
            </div>
          )}

          {activeTab === "progress" && !isEdit && tableTab === "regular" && (
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
                retired={retiredPersons}
                ovOf={ovOf}
                setOvField={setOvField}
                edit={editable}
                onToggleEdit={undefined}
                notes={REGULAR_NOTES}
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
                    retired={retiredPersons}
                    ovOf={ovOf}
                    setOvField={setOvField}
                    edit={editable}
                    onToggleEdit={undefined}
                    notes={REGULAR_NOTES}
                  />
                ) : null;
              })()}
            </div>
          </div>
          )}

          {/* スケジュール：カレンダー2つ（当月＋翌月・月送りは共通）＋下に予定 */}
          {activeTab === "schedule" && !isEdit && (() => {
            const p = parseIso(schedDate);
            // 表示範囲（日 / 週 / 月）
            let start = schedDate;
            let end = schedDate;
            let rangeLabel = "—";
            if (p) {
              const dw = dowLabel(p.y, p.m, p.d);
              if (schedRange === "week") {
                start = mondayOfIso(schedDate);
                end = addDaysIso(start, 6);
                const s = parseIso(start);
                const e = parseIso(end);
                rangeLabel = `${s.y}/${pad2(s.m)}/${pad2(s.d)} 〜 ${e.y === s.y ? "" : e.y + "/"}${pad2(e.m)}/${pad2(e.d)}`;
              } else if (schedRange === "month") {
                start = `${p.y}-${pad2(p.m)}-01`;
                end = `${p.y}-${pad2(p.m)}-${pad2(new Date(p.y, p.m, 0).getDate())}`;
                rangeLabel = `${p.y}年${p.m}月`;
              } else {
                rangeLabel = `${p.y}年${p.m}月${p.d}日（${dw}）`;
              }
            }
            const hol = p && schedRange === "day" ? holidayName(p.y, p.m, p.d) : null;
            const dw = p ? dowLabel(p.y, p.m, p.d) : "";
            // 範囲内で予定がある日を日付順に集める
            const days = Object.keys(schedEvents)
              .filter((iso) => iso >= start && iso <= end)
              .sort();
            const total = days.reduce((a, iso) => a + schedEvents[iso].length, 0);
            const dayLabel = (iso) => {
              const q = parseIso(iso);
              if (!q) return iso;
              return `${q.m}/${q.d}（${dowLabel(q.y, q.m, q.d)}）`;
            };
            const rangeProp = schedRange === "day" ? null : { start, end };
            return (
              <div className="tab-panel sched-wrap">
                {/* 当月＋翌月を1つの枠に。月送りは1組だけ置く。右に現在時刻 */}
                <div className="sched-top">
                  <Calendar
                    months={2}
                    ym={schedYm}
                    onNav={navSched}
                    onToday={todaySched}
                    events={schedEvents}
                    selected={schedDate}
                    onSelect={setSchedDate}
                    range={rangeProp}
                  />
                  <Clocks />
                </div>

                <section className="sched-panel">
                  <div className="sched-panel-head">
                    <span
                      className={
                        "sched-date" +
                        (schedRange === "day" && (dw === "日" || hol)
                          ? " sun"
                          : schedRange === "day" && dw === "土"
                          ? " sat"
                          : "")
                      }
                    >
                      {rangeLabel}
                    </span>
                    {hol && <span className="sched-hol">{hol}</span>}
                    <span className="range-seg" role="group" aria-label="予定の表示範囲">
                      {[
                        ["day", "日"],
                        ["week", "週"],
                        ["month", "月"],
                      ].map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          className={"range-seg-btn" + (schedRange === k ? " active" : "")}
                          onClick={() => setSchedRange(k)}
                          aria-pressed={schedRange === k}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                    <span className="sched-count">{total} 件</span>
                    {canEditTasks && (
                      <button
                        type="button"
                        className="icon-btn sched-add"
                        onClick={() => openNewEvent(schedDate)}
                        title="予定を追加"
                        aria-label="予定を追加"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {total === 0 ? (
                    <div className="sched-empty">
                      {schedRange === "day"
                        ? "この日の予定はありません"
                        : schedRange === "week"
                        ? "この週の予定はありません"
                        : "この月の予定はありません"}
                    </div>
                  ) : (
                    <div className="sched-groups">
                      {days.map((iso) => (
                        <div key={iso} className="sched-group">
                          {schedRange !== "day" && (
                            <button
                              type="button"
                              className={"sched-gday" + (iso === schedDate ? " on" : "")}
                              onClick={() => setSchedDate(iso)}
                              title="この日を選ぶ"
                            >
                              {dayLabel(iso)}
                              <span className="sched-gcount">{schedEvents[iso].length}</span>
                            </button>
                          )}
                          <ul className="sched-items">
                            {schedEvents[iso].map((e, i) => (
                              <li key={e.task + e.kind + i} className={"sched-item" + (e.kind === "event" ? " is-event" : "")}>
                                <span className={"sched-kind " + e.kind}>
                                  {e.kind === "start" ? "開始" : e.kind === "end" ? "期日" : "予定"}
                                </span>
                                <span className="sched-task" title={e.memo ? `${e.task}
${e.memo}` : e.task}>
                                  {e.task}
                                </span>
                                {e.kind === "event" ? (
                                  canEditTasks ? (
                                    <button
                                      type="button"
                                      className="mini-btn sched-edit"
                                      onClick={() => openEditEvent(e.id)}
                                    >
                                      編集
                                    </button>
                                  ) : (
                                    <span className="sched-memo">{e.memo}</span>
                                  )
                                ) : (
                                  <span className={"st-pill " + statusClass(e.status)}>
                                    {e.status || "—"}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            );
          })()}

          {activeTab === "progress" && !isEdit && tableTab === "adhoc" && adhoc && (adhoc.length > 0 || customAdhoc.length > 0) && (() => {
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
                  {editable && (
                    <button
                      type="button"
                      className="edit-btn"
                      onClick={openAdd}
                      title="Ad Hoc タスクを追加"
                    >
                      ＋ タスク追加
                    </button>
                  )}
                  </span>
                </div>
                <div className="copy-area" ref={adhocCardRef}>
                {/* コピーボタンは表のすぐ上（注記の行の右端）に置く。
                    画像は表と注記の文字だけを描くので、ボタンは写らない。
                    コピーする画像は「優先〜実作業工数」まで（11列） */}
                <div className="note-row">
                  <p className="table-note">
                    ※作業工数が５営業日以上かかるプロジェクトについては、グラフ化を行っております。
                  </p>
                  <CopyTableBtn targetRef={adhocCardRef} maxCols={11} />
                </div>
                <div className="qcard adhoc-card">
                  <div className="dtw adhoc-tw">
                    {/* 幅は100%。指定のない最終列（メモ）が余白を全部吸収する */}
                    <table
                      className="dtable adhoc-table"
                      style={{ width: "100%", minWidth: ADHOC_W }}
                    >
                      <colgroup>
                        {ADHOC_COLS.map((w, ci) => (
                          <col key={ci} style={w == null ? undefined : { width: w }} />
                        ))}
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
                            ? ids.map((id) => personById.get(id)?.name || "?")
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
                                  <PrioInput
                                    value={prioOf("adhoc", t.task, t.no) ?? ""}
                                    onCommit={(v) => setPriority("adhoc", t.task, v)}
                                    label={`${t.task} の作業優先順`}
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
                                  {ALLOW_TASK_DELETE && t.customId && (
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
                                // グルーピング／シート連携の印はタスク列の右端に寄せる
                                <span className="tname-view">
                                  <span className="tname-text">{val("name", t.task)}</span>
                                  {(o.kosuLink || o.sheetUrl) && (
                                    <span className="tname-marks">
                                      {o.kosuLink && (
                                        <span
                                          className="klink-mark"
                                          title={
                                            o.kosuLink === t.task
                                              ? `工数明細の作業：\n${o.kosuLink}`
                                              : `工数はこの作業にまとめています：\n${o.kosuLink}`
                                          }
                                          aria-label="工数グルーピングあり"
                                        >
                                          <svg width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
                                            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                                          </svg>
                                        </span>
                                      )}
                                      {o.sheetUrl && (
                                        <span className="sheet-mark" title={"シート連携中（受注数・完了数を自動取得）\n" + o.sheetUrl} aria-label="シート連携あり">
                                          <svg width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="3" width="18" height="18" rx="2" />
                                            <line x1="3" y1="9" x2="21" y2="9" />
                                            <line x1="9" y1="9" x2="9" y2="21" />
                                          </svg>
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </span>
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
                                  retired={retiredPersons}
                                  allowRetired={status === "Complete"}
                                  setAssign={setAssign}
                                />
                              ) : ids.length ? (
                                ids.map((id) => {
                                  const pp = personById.get(id);
                                  return pp ? (
                                    <span
                                      key={id}
                                      className={"mng-asg-name" + (pp.active === false ? " gone" : "")}
                                      title={pp.active === false ? `${pp.name}（退職）` : undefined}
                                    >
                                      {pp.name}
                                    </span>
                                  ) : null;
                                })
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
              </div>
            );
          })()}

          {activeTab === "graph" && !isEdit && (
            <div className="tab-panel">
              <div className="sec-row sub-tabs">
                <div className="segbar segbar-sm" role="tablist" aria-label="進捗グラフの表示切替">
                  <span
                    className="segbar-thumb"
                    style={{ transform: `translateX(${graphTab === "adhoc" ? "100%" : "0%"})` }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    role="tab"
                    aria-selected={graphTab === "regular"}
                    className={"segbar-btn" + (graphTab === "regular" ? " active" : "")}
                    onClick={() => switchGraphTab("regular")}
                  >
                    Regular Task
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={graphTab === "adhoc"}
                    className={"segbar-btn" + (graphTab === "adhoc" ? " active" : "")}
                    onClick={() => switchGraphTab("adhoc")}
                  >
                    Ad Hoc Task
                  </button>
                </div>
                <CopyChartsBtn targetRef={graphTab === "regular" ? graphGridRef : adhocGridRef} />
              </div>
              {graphTab === "regular" ? (
                <ProgressChart
                  year={year}
                  dateCode={dateCode}
                  types={regularTypes}
                  gridRef={graphGridRef}
                  order={graphOrderOf("regular")}
                  onReorder={canEditTasks ? (o) => saveGraphOrder("regular", o) : undefined}
                  penOrder={graphOrderOf("pending")}
                  onReorderPen={canEditTasks ? (o) => saveGraphOrder("pending", o) : undefined}
                />
              ) : (
                <AdhocChart
                  year={year}
                  dateCode={dateCode}
                  tasks={adhocOngoing}
                  known={adhocKnown}
                  gridRef={adhocGridRef}
                  order={graphOrderOf("adhoc")}
                  onReorder={canEditTasks ? (o) => saveGraphOrder("adhoc", o) : undefined}
                />
              )}
            </div>
          )}

          {/* プロジェクト進捗：案件タイプ別のステータス×四半期（全ステータスを0件でも表示） */}
          {activeTab === "progress" && tableTab === "regular" && (renderTypes.length === 0 ? (
            <div className="card">
              <div className="notice">案件がありません。</div>
            </div>
          ) : (
            <>
            {/* 見出し（プロジェクト進捗）は各カードに案件タイプ名が出ているので置かない */}
            <div className="qgrid qgrid-top">
            {typeColumns.map((col, ci) => (
            <div className="qcol" key={"col" + ci}>
            {col.map((t, idx) => {
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
              const accent = TYPE_ACCENT[t] || ACCENT_FALLBACK;
              const isOpen = !collapsed[t];
              return (
                <div
                  className={"qcard type-card" + (isOpen ? "" : " is-collapsed")}
                  style={{ "--type-accent": accent }}
                  key={t}
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
                    <span className="case-name">{t}</span>
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
            ))}
            </div>
            </>
          ))}

          {activeTab === "progress" && tableTab === "regular" && yearAgg && yearAgg.noDate > 0 && (
            <p className="note-line">
              ※「{dateLabel}」が空欄で四半期に振り分けられない案件が {fmt(yearAgg.noDate)} 件あります（別の基準日に切り替えると変わります）。
            </p>
          )}
        </>
      )}

      {/* タスク追加 */}
      <Modal
        open={adding}
        title="タスク追加"
        onClose={closeAdd}
        width={560}
        footer={
          <>
            <button className="mini-btn" onClick={closeAdd} disabled={addBusy}>
              キャンセル
            </button>
            <button
              className="save-btn"
              onClick={addAdhoc}
              disabled={addBusy || !newTask.trim()}
            >
              {addBusy ? "追加中…" : "追加する"}
            </button>
          </>
        }
      >
        <div className="modal-fields add-task-fields">
          <label className="fld">
            タスク名
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAdhoc()}
              placeholder="例：Room mapping 13"
            />
          </label>

          <div className="cfg-grid">
            <label className="fld">
              区分
              <select value={newBoard} onChange={(e) => setNewBoard(e.target.value)}>
                <option value="adhoc">Ad Hoc</option>
                <option value="regular">Regular</option>
              </select>
            </label>
            <label className="fld">
              進捗
              <select value={addForm.status} onChange={(e) => setAF("status", e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="cfg-grid">
            <ModalDateField
              label="開始"
              value={addForm.start}
              onChange={(v) => setAF("start", v)}
            />
            <ModalDateField label="期日" value={addForm.end} onChange={(v) => setAF("end", v)} />
          </div>

          <label className="fld">
            優先（未入力なら優先なし）
            <input
              type="number"
              min="1"
              value={addForm.prio}
              onChange={(e) => setAF("prio", e.target.value)}
              placeholder="例：1"
            />
          </label>

          <div className="fld">
            対応者
            <div className="add-asg">
              {persons.length === 0 ? (
                <span className="add-asg-none">担当者が未登録です</span>
              ) : (
                persons.map((p) => (
                  <label key={p.id} className="chk-row">
                    <input
                      type="checkbox"
                      checked={addForm.assign.includes(p.id)}
                      onChange={() => toggleAddAssign(p.id)}
                    />
                    {p.name}
                  </label>
                ))
              )}
            </div>
          </div>

          {driveCfg?.configured ? (
            <div className="fld">
              Agoda から届いた Excel をアップロード
              <span className="up-row">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  disabled={upBusy}
                  onChange={(e) => uploadExcel(e.target.files?.[0])}
                />
                {upBusy && <span className="up-busy">アップロード中…</span>}
              </span>
              <span className="drive-note">
                「アップ先」フォルダに置いて、そのままスプレッドシートに変換します。
                変換後のURLは下の欄に自動で入ります。
              </span>
              {upDone && <span className="up-ok">「{upDone}」を作成しました</span>}
              {upErr && <span className="up-err">{upErr}</span>}
            </div>
          ) : null}
          <DriveLinks only={["new"]} />
          <label className="fld">
            スプレッドシートURL（※取得したい受注数・完了数の記載されたページのURL）
            <input
              type="text"
              value={addForm.sheetUrl}
              onChange={(e) => setAF("sheetUrl", e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=..."
            />
          </label>
          <div className="cfg-grid">
            <label className="fld">
              受注数のセル
              <input
                type="text"
                value={addForm.orderCell}
                onChange={(e) => setAF("orderCell", e.target.value)}
                placeholder="例：C2"
              />
            </label>
            <label className="fld">
              完了数のセル
              <input
                type="text"
                value={addForm.doneCell}
                onChange={(e) => setAF("doneCell", e.target.value)}
                placeholder="例：C3"
              />
            </label>
          </div>

          <div className="cfg-grid">
            <label className="fld">
              目標対応件数（Daily）
              <input
                type="text"
                value={addForm.daily}
                onChange={(e) => setAF("daily", e.target.value)}
                placeholder="例：32"
              />
            </label>
            <label className="fld">
              実作業工数
              <input
                type="text"
                value={addForm.effort}
                onChange={(e) => setAF("effort", e.target.value)}
                placeholder="例：1h 4件"
              />
            </label>
          </div>
          <label className="fld">
            課題・遅延理由
            <textarea
              rows={2}
              value={addForm.issue}
              onChange={(e) => setAF("issue", e.target.value)}
              placeholder="例：上位優先作業集中の為"
            />
          </label>
          <label className="fld">
            次回アクション
            <textarea
              rows={2}
              value={addForm.next}
              onChange={(e) => setAF("next", e.target.value)}
              placeholder="例：指示待ち"
            />
          </label>
          <label className="fld">
            メモ
            <textarea
              rows={2}
              value={addForm.memo}
              onChange={(e) => setAF("memo", e.target.value)}
              placeholder="補足があれば"
            />
          </label>
        </div>
        {addError && <div className="modal-err">{addError}</div>}
      </Modal>

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

      {/* 詳細編集：管理表・Ad Hoc 表に入力欄が無い項目をここでまとめて編集する */}
      <Modal
        open={!!detailTask}
        title="詳細"
        onClose={() => setDetailTask(null)}
        width={540}
        footer={
          <button className="save-btn" onClick={() => setDetailTask(null)}>
            閉じる
          </button>
        }
      >
        {detailTask &&
          (() => {
            const o = ovOf("adhoc", detailTask);
            const src = adhocByTask.get(detailTask) || {};
            // 上書きがあればそれを、無ければ進捗シート由来の値を出す
            const cur = (k) => (o[k] !== undefined ? o[k] : src[k] ?? "");
            const set = (k, v) => setOvField("adhoc", detailTask, k, v);
            return (
              <div className="modal-fields">
                <div className="modal-strong">「{o.name ?? detailTask}」</div>
                <div className="cfg-grid">
                  <label className="fld">
                    目標対応件数（Daily）
                    <input
                      type="text"
                      value={cur("daily")}
                      onChange={(e) => set("daily", e.target.value)}
                      placeholder="例：32"
                    />
                  </label>
                  <label className="fld">
                    実作業工数
                    <input
                      type="text"
                      value={cur("effort")}
                      onChange={(e) => set("effort", e.target.value)}
                      placeholder="例：1h 4件"
                    />
                  </label>
                </div>
                <label className="fld">
                  課題・遅延理由
                  <textarea
                    rows={2}
                    value={cur("issue")}
                    onChange={(e) => set("issue", e.target.value)}
                    placeholder="例：上位優先作業集中の為"
                  />
                </label>
                <label className="fld">
                  次回アクション
                  <textarea
                    rows={2}
                    value={cur("next")}
                    onChange={(e) => set("next", e.target.value)}
                    placeholder="例：指示待ち"
                  />
                </label>
                <label className="fld">
                  メモ
                  <textarea
                    rows={2}
                    value={cur("memo")}
                    onChange={(e) => set("memo", e.target.value)}
                    placeholder="補足があれば"
                  />
                </label>
                {driveCfg?.configured && o.sheetUrl && (
                  <div className="fld">
                    作業シートの保管先
                    <span className="drive-links">
                      {[
                        ["done", "完了フォルダへ移動"],
                        ["hold", "保留フォルダへ移動"],
                        ["new", "アップ先へ戻す"],
                      ].map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          className={"drive-link drive-" + k}
                          disabled={moveBusy}
                          onClick={() => moveSheet(o.sheetUrl, k)}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                    {moveMsg && <span className="drive-note">{moveMsg}</span>}
                  </div>
                )}
                <p className="modal-note">
                  入力すると自動で保存され、ダッシュボードの Ad Hoc Task 表に反映されます。
                  空にすると上書きが消え、進捗シート取込時の値に戻ります。
                </p>
              </div>
            );
          })()}
      </Modal>

      {/* スケジュールの予定（タスクとは別に自由に入れるもの） */}
      <Modal
        open={!!evForm}
        title={evForm?.isNew ? "予定を追加" : "予定を編集"}
        icon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4.5" width="18" height="17" rx="2" />
            <line x1="3" y1="9.5" x2="21" y2="9.5" />
            <line x1="8" y1="2.5" x2="8" y2="6.5" />
            <line x1="16" y1="2.5" x2="16" y2="6.5" />
          </svg>
        }
        onClose={() => setEvForm(null)}
        footer={
          <>
            {!evForm?.isNew && (
              <button
                className="mini-btn danger"
                onClick={() => {
                  removeEvent(evForm.id);
                  setEvForm(null);
                }}
              >
                削除
              </button>
            )}
            <button className="mini-btn" onClick={() => setEvForm(null)}>
              キャンセル
            </button>
            <button
              className="save-btn"
              onClick={submitEvent}
              disabled={!String(evForm?.title || "").trim() || !evForm?.start}
            >
              保存
            </button>
          </>
        }
      >
        {evForm && (
          <div className="modal-fields">
            <label className="fld">
              予定名
              <input
                value={evForm.title}
                onChange={(e) => setEvForm({ ...evForm, title: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && submitEvent()}
                placeholder="例：定例会"
              />
            </label>
            <div className="cfg-grid">
              <ModalDateField
                label="日付"
                value={evForm.start}
                onChange={(v) => setEvForm({ ...evForm, start: v })}
              />
              <ModalDateField
                label="終了日"
                value={evForm.end}
                onChange={(v) => setEvForm({ ...evForm, end: v })}
              />
            </div>
            <label className="fld">
              メモ
              <textarea
                rows={3}
                value={evForm.memo}
                onChange={(e) => setEvForm({ ...evForm, memo: e.target.value })}
                placeholder="任意"
              />
            </label>
          </div>
        )}
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
                <DriveLinks note="完了・保留になったら、シートを該当のフォルダへ移動してください。" />
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
                {sheetErrors[cfgTask] && (
                  <div className="banner err-banner cfg-err">
                    シートを読めませんでした：{sheetErrors[cfgTask]}
                  </div>
                )}
                <p className="modal-note">
                  進捗を <b>Complete</b> にすると、その時点の受注数・完了数を保存して以降はシートを読みません
                  （完了したタスクが増えても表示が遅くならないように。URL・セルの設定はそのまま残ります）。
                  取り直したいときは、進捗を一度 Complete 以外に戻してください。
                  <br />
                  <b>読み取るタブを開いた状態のURL</b>を貼ってください（URL末尾の <code>gid</code> でタブを判別します）。
                  受注数・完了数は<b>同じタブ</b>にある前提です。入力は自動保存され、次回の読み込みで最新値を取得します。
                  シートはサービスアカウントに「閲覧者」で共有するか、「リンクを知っている全員が閲覧可」にしてください。
                  別タブに分かれている場合はお知らせください。
                </p>
              </div>
            );
          })()}
      </Modal>
    </div>
  );
}
