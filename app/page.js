"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UpdatedPop from "./UpdatedPop";
import Pulldown from "./Pulldown";
import { cachedJson, peekJson, invalidate } from "./dataCache";
import { useUi } from "./Ui";

const TYPE_ORDER = ["Hotel", "ACQ", "Liberty", "Temairazu", "IHM"];

// 一覧の列見出しの表示名を上書き（Kintoneの実ラベルを別名で表示）
const HEADER_LABEL = { "ドロップダウン": "ステータス", "ドロップダウン_4": "CM代行設定" };

// この列から右のセル（本文）は中央揃えにする
const CENTER_FROM_CODE = "ドロップダウン_4"; // CM代行設定

// 完了扱いのステータス（「完了以外を表示」フィルタで除外）
const DONE_STAGES = new Set(["7.販売開始確認（完了）", "完了"]);

// 案件名（空欄は Hotel依頼）
function caseTypeOf(r) {
  const v = r?.["ドロップダウン_13"]?.value;
  return v && String(v).trim() ? String(v).trim() : "Hotel";
}

function stageOf(r) {
  return r?.["ドロップダウン"]?.value || "";
}

// 作成日時 → { year, q }（年・四半期の絞り込み用）。判別不能は null
function periodOf(r) {
  const v = r?.["作成日時"]?.value;
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})/);
  if (m) return { year: Number(m[1]), q: Math.floor((Number(m[2]) - 1) / 3) + 1 };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), q: Math.floor(d.getMonth() / 3) + 1 };
}

// Kintone のフィールド値（{ type, value }）を人が読める文字列にする
function formatValue(field) {
  if (!field) return "";
  const v = field.value;
  if (v == null || v === "") return "";

  // 日付・日時はすべて「日付表示（YYYY/MM/DD）」に統一
  if (field.type === "DATE") return String(v).replaceAll("-", "/");
  if (
    field.type === "DATETIME" ||
    field.type === "UPDATED_TIME" ||
    field.type === "CREATED_TIME"
  ) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    return String(v);
  }

  if (Array.isArray(v)) {
    // ユーザー選択・組織選択・グループ選択：{ code, name } の配列
    if (v.length && typeof v[0] === "object" && v[0] !== null) {
      if ("name" in v[0]) return v.map((x) => x.name).join(", ");
      // サブテーブルなど：件数だけ示す
      return `（${v.length}件）`;
    }
    // 複数選択・チェックボックス：文字列の配列
    return v.join(", ");
  }

  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// 表示ラベル（略称）→ Kintone フィールドコード（null は該当フィールド未確定）
const FIELD_CODE = {
  依頼: "ドロップダウン_13",
  HID: "文字列__1行_",
  Hotel: "文字列__1行__0",
  ステータス: "ドロップダウン",
  CM種別: "ドロップダウン_2",
  CM設定: "ドロップダウン_4",
  URL: "文字列__1行__6",
  ID: "文字列__1行__7",
  PW: "文字列__1行__8",
  契約コード: "文字列__1行__9",
  完了希望日: null,
  "Google Form 受領日": null,
  "CM情報 受領日": null,
  "作業依頼 受領日": null,
  Stage変更日: "日付",
  YCS完了メール: "日付_8",
  掲載開始: "日付_6",
  DSA: "ドロップダウン_11",
  滞留理由: "文字列__複数行__1",
  いつまでに: "日付_3",
  誰が: "ドロップダウン_7",
  なにをする: "文字列__複数行__4",
};
const DETAIL_LEFT = [
  "依頼",
  "HID",
  "Hotel",
  "ステータス",
  "CM種別",
  "CM設定",
  "URL",
  "ID",
  "PW",
  "契約コード",
];
const DETAIL_RIGHT = [
  "完了希望日",
  "Google Form 受領日",
  "CM情報 受領日",
  "作業依頼 受領日",
  "Stage変更日",
  "YCS完了メール",
  "掲載開始",
  "DSA",
];

function fieldValue(record, code) {
  if (!code || !record) return "";
  return formatValue(record[code]);
}

// 詳細画面の項目につける小さな絵。どの項目かがひと目で分かるようにする。
// 線の太さ・大きさはこの画面の中でそろえる。
const DETAIL_SHAPES = {
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </>
  ),
  hash: (
    <>
      <path d="M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16" />
    </>
  ),
  hotel: (
    <>
      <path d="M4 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15" />
      <path d="M15 21V11h4a1 1 0 0 1 1 1v9" />
      <path d="M3 21h18M7.5 9h1M11 9h1M7.5 13h1M11 13h1M7.5 17h1M11 17h1" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />,
  tag: (
    <>
      <path d="M20.5 13.5 13 21a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 2.6 12l.4-7a1 1 0 0 1 1-1l7-.4a2 2 0 0 1 1.5.6l7 7a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 2.6 14H2.4a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 2.6V2.4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.3.8Z" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19M6 14.5h4" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4" />
      <path d="m10.5 12.5 8-8M16 7l2.5 2.5M13.5 9.5 16 12" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="17" rx="2" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="m3 6.5 9 6.5 9-6.5" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5 4.5 5.5V11c0 5 3.2 9 7.5 10.5 4.3-1.5 7.5-5.5 7.5-10.5V5.5Z" />
    </>
  ),
  chat: (
    <>
      <path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4-1 0-2-.15-2.9-.42L4 20.8l1.5-3.6C4.1 15.9 3.5 14 3.5 12 3.5 7.9 7.3 4.6 12 4.6s8.5 3.3 8.5 7.4Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 1.9" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6M17.5 13.6a6.2 6.2 0 0 1 3.7 5.9" />
    </>
  ),
  check: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8 12.2 2.8 2.8L16.4 9.4" />
    </>
  ),
};

function DetailIcon({ name, size = 15 }) {
  const shape = DETAIL_SHAPES[name] || DETAIL_SHAPES.doc;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}

// 項目名 → 絵。載っていない項目は書類の絵にする。
const DETAIL_ICON = {
  依頼: "doc",
  HID: "hash",
  Hotel: "hotel",
  ステータス: "dot",
  CM種別: "tag",
  CM設定: "gear",
  URL: "link",
  ID: "card",
  PW: "key",
  契約コード: "doc",
  完了希望日: "calendar",
  "Google Form 受領日": "doc",
  "CM情報 受領日": "mail",
  "作業依頼 受領日": "person",
  Stage変更日: "calendar",
  YCS完了メール: "mail",
  掲載開始: "calendar",
  DSA: "shield",
};

function DetailRow({ label, value }) {
  const isUrl = /^https?:\/\//.test(value);
  // ステータスは他と見分けがつくよう、囲みにして出す
  const isStatus = label === "ステータス";
  return (
    <div className="kv">
      <div className="kv-l">
        <span className={"kv-ic" + (label === "ステータス" ? " on" : "")} aria-hidden="true">
          <DetailIcon name={DETAIL_ICON[label]} />
        </span>
        <span className="kv-lt">{label}</span>
      </div>
      <div className="kv-v">
        {value ? (
          isUrl ? (
            <a href={value} target="_blank" rel="noreferrer" className="kv-link">
              <span className="kv-link-t">{value}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 4h6v6" />
                <path d="M20 4 11 13" />
                <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
              </svg>
            </a>
          ) : isStatus ? (
            <span className="kv-pill">{value}</span>
          ) : (
            value
          )
        ) : (
          <span className="dash">—</span>
        )}
      </div>
    </div>
  );
}

// 下段の3つ（いつまでに／誰が／なにをする）。色と絵で見分ける。
const ACTION_BOXES = [
  { key: "いつまでに", tone: "blue", icon: "clock" },
  { key: "誰が", tone: "violet", icon: "people" },
  { key: "なにをする", tone: "green", icon: "check" },
];

function DetailModal({ record, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="詳細"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>【 詳細 】</h2>
          <button className="close-btn" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="modal-body">
          <section className="panel panel-hero">
            {/* 見出し。左に絵、右下に薄い飾り */}
            <div className="panel-title">
              <span className="panel-ico" aria-hidden="true">
                <DetailIcon name="hotel" size={22} />
              </span>
              <span className="panel-h">
                <b>基本情報</b>
                <small>ホテル・施設の基本情報と設定内容</small>
              </span>
              <span className="panel-deco" aria-hidden="true">
                <svg width="150" height="64" viewBox="0 0 150 64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M92 62V24a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v38" />
                  <path d="M116 62V34h16a2 2 0 0 1 2 2v26" />
                  <path d="M84 62h62" />
                  <path d="M98 30h4M106 30h4M98 38h4M106 38h4M98 46h4M106 46h4M122 42h4M122 50h4" />
                </svg>
              </span>
            </div>
            <div className="kv-cols">
              <div className="kv-col">
                {DETAIL_LEFT.map((k) => (
                  <DetailRow
                    key={k}
                    label={k}
                    value={fieldValue(record, FIELD_CODE[k])}
                  />
                ))}
              </div>
              <div className="kv-col">
                {DETAIL_RIGHT.map((k) => (
                  <DetailRow
                    key={k}
                    label={k}
                    value={fieldValue(record, FIELD_CODE[k])}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="panel panel-note">
            <div className="panel-title">
              <span className="panel-ico" aria-hidden="true">
                <DetailIcon name="chat" size={18} />
              </span>
              <span className="panel-h">
                <b>滞留理由</b>
              </span>
            </div>
            <div className="panel-text">
              {fieldValue(record, FIELD_CODE["滞留理由"]) || "—"}
            </div>
          </section>

          <div className="box-row">
            {ACTION_BOXES.map(({ key, tone, icon }) => (
              <div className={"box tone-" + tone} key={key}>
                <div className="box-title">
                  <span className="box-ico" aria-hidden="true">
                    <DetailIcon name={icon} size={16} />
                  </span>
                  {key}
                </div>
                <div className="box-text">
                  {fieldValue(record, FIELD_CODE[key]) || "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      className={spinning ? "spin" : ""}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function ConnectedIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export default function Page() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [selected, setSelected] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active"); // active=完了以外（既定） / all=すべて
  const [periodYear, setPeriodYear] = useState("all"); // "all" or 年
  const [periodQ, setPeriodQ] = useState("all"); // "all" or 1〜4
  const [q, setQ] = useState(""); // HID / Hotel Name 検索（入力用・即時反映）
  const [qDeb, setQDeb] = useState(""); // 実際の絞り込みに使う値（デバウンス）
  const [canSync, setCanSync] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // 取込中／完了のメッセージは画面中央の共通オーバーレイに出す
  const { setBusy, flashDone } = useUi();
  // ヘッダークリックでの並べ替え（col=フィールドコード, dir=asc/desc）
  const [sort, setSort] = useState({ col: null, dir: "asc" });

  // ページネーション用
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const twRef = useRef(null); // 表スクロール領域（1ページ件数の自動計算に使う）

  // 絞り込みや並べ替えが変わったら1ページ目に戻す（表示件数の自動調整では戻さない）
  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, statusFilter, qDeb, periodYear, periodQ, sort]);

  // 入力のたびに全件フィルタ＋ソートが走るとカクつくので、少し待ってから反映する
  useEffect(() => {
    const t = setTimeout(() => setQDeb(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const clickSort = (c) =>
    setSort((s) =>
      s.col === c ? { col: c, dir: s.dir === "asc" ? "desc" : "asc" } : { col: c, dir: "asc" }
    );

  useEffect(() => {
    cachedJson("/api/auth/me", 60 * 1000)
      .then((d) => setCanSync(!!d?.perms?.editTasks))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    // 前に取ったものがあれば、待たせずにそのまま出す
    const cached = peekJson("/api/records");
    setLoading(!cached);
    setError(null);
    try {
      const json = await cachedJson("/api/records");
      if (json.error) setError(json.error);
      setData(json);
      // 表示は Kintone を取り込んだ時刻（保存済みなら fetchedAt）
      if (!json.error) setUpdatedAt(json.fetchedAt ? new Date(json.fetchedAt) : new Date());
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  const syncKintone = useCallback(async () => {
    setSyncing(true);
    setError(null);
    // 数秒〜十数秒かかるので、画面中央に「取込中」を出して待ってもらう
    setBusy("Kintone から取り込み中…");
    try {
      const res = await fetch("/api/kintone-sync", { method: "POST" }).then((r) => r.json());
      if (res.error) {
        setBusy(null);
        setError(res.error);
      } else {
        // 取り込んだら、ためていた案件データは捨てて取り直す
        invalidate("/api/records");
        await load();
        flashDone("取り込みました");
      }
    } catch (e) {
      setBusy(null);
      setError(String(e?.message || e));
    } finally {
      setSyncing(false);
    }
  }, [load, setBusy, flashDone]);

  const formatDateTime = (d) =>
    d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  useEffect(() => {
    load();
  }, [load]);

  // Esc で詳細を閉じる
  useEffect(() => {
    if (!selected) return;
    const onKey = (e) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const records = data?.records || [];

  // 案件名フィルタ用の選択肢（件数つき）
  const typeCounts = useMemo(() => {
    const m = {};
    for (const r of records) {
      const t = caseTypeOf(r);
      m[t] = (m[t] || 0) + 1;
    }
    return m;
  }, [records]);
  const typeList = [
    ...TYPE_ORDER.filter((t) => typeCounts[t]),
    ...Object.keys(typeCounts).filter((t) => !TYPE_ORDER.includes(t)),
  ];
  // 絞り込みに使える年（作成日時ベース・降順）
  const years = useMemo(() => {
    const set = new Set();
    for (const r of records) {
      const p = periodOf(r);
      if (p) set.add(p.year);
    }
    return [...set].sort((a, b) => b - a);
  }, [records]);

  const kw = qDeb.trim().toLowerCase();
  const shown = useMemo(
    () =>
      records.filter((r) => {
        if (!(typeFilter === "all" || caseTypeOf(r) === typeFilter)) return false;
        if (!(statusFilter === "all" || !DONE_STAGES.has(stageOf(r)))) return false;
        if (kw) {
          // HID（文字列__1行_）と Hotel Name（文字列__1行__0）で検索
          const hid = formatValue(r["文字列__1行_"]).toLowerCase();
          const hotel = formatValue(r["文字列__1行__0"]).toLowerCase();
          if (!hid.includes(kw) && !hotel.includes(kw)) return false;
        }
        if (periodYear !== "all") {
          const p = periodOf(r);
          if (!p || p.year !== Number(periodYear)) return false;
          if (periodQ !== "all" && p.q !== Number(periodQ)) return false;
        }
        return true;
      }),
    [records, typeFilter, statusFilter, kw, periodYear, periodQ]
  );

  // フィールドコード → 表示ラベル
  const labelOf = (key) => {
    if (key === "$id") return "レコード番号";
    const f = data?.fields?.[key];
    return f?.label || key;
  };

  // 表示する列の順番（ユーザー指定）。Kintone のフィールドコードで指定。
  // ※「完了希望日 / Google Form受領日 / 作業依頼受領日」は該当フィールドが特定できず未設定。
  const COLUMN_ORDER = [
    "ドロップダウン_13", // 依頼（= 案件名）
    "文字列__1行_", //     HID
    "文字列__1行__0", //   Hotel Name
    "ドロップダウン", //   Stage
    // 完了希望日        → 未特定
    // Google Form受領日 → 未特定
    "日付_2", //           CM情報受領日（= ★CMS情報回収メール送付日（最新））
    // 作業依頼受領日    → 未特定
    "日付", //             Stage変更日（= ★Stage変更日）
    "更新日時", //         更新日時
    "ドロップダウン_4", // CM設定（= CMS代行設定）
    "ドロップダウン_2", // CM種別（= CMS種別）
    "文字列__1行__6", //   URL
    "文字列__1行__7", //   ID
    "文字列__1行__8", //   PW（= Pass）
    "文字列__1行__9", //   契約コード
    "文字列__複数行__1", //滞留理由（= 作業滞留理由）
    "日付_3", //           いつまでに（= ＊いつまでに）
    "ドロップダウン_7", // 誰が（= ＊誰が）
    "文字列__複数行__4", //なにをする（= ＊なにをする）
    "ドロップダウン_11", //DSA
    "日付_8", //           YCS完了メール（= ★YCSログイン情報メール送付日）
    "日付_6", //           掲載開始（= ★販売開始日）
  ];

  // 実在する列だけを、指定順で表示
  const columns = useMemo(() => {
    const first = records[0] || {};
    return COLUMN_ORDER.filter((code) => code in first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);
  // CM代行設定の列位置。ここから右のセルは中央揃えにする
  const centerFrom = columns.indexOf(CENTER_FROM_CODE);

  // ヘッダークリックで並べ替え。数値は数値順、それ以外（日付・文字）は文字順。
  // 空欄は常に末尾に回す。
  const sortedShown = useMemo(() => {
    if (!sort.col) return shown;
    const c = sort.col;
    const arr = [...shown];
    arr.sort((a, b) => {
      const sa = formatValue(a[c]);
      const sb = formatValue(b[c]);
      if (sa === "" && sb === "") return 0;
      if (sa === "") return 1;
      if (sb === "") return -1;
      const na = Number(String(sa).replace(/,/g, ""));
      const nb = Number(String(sb).replace(/,/g, ""));
      const cmp =
        Number.isFinite(na) && Number.isFinite(nb)
          ? na - nb
          : String(sa).localeCompare(String(sb), "ja");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [shown, sort]);

  // ページネーション用の表示データ抽出
  const totalPages = Math.ceil(sortedShown.length / itemsPerPage) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedShown.slice(start, start + itemsPerPage);
  }, [sortedShown, currentPage, itemsPerPage]);

  // 表示件数は手動選択をやめ、表の表示領域の高さに収まる行数を自動計算する
  useEffect(() => {
    const el = twRef.current;
    if (!el) return;
    const calc = () => {
      const thead = el.querySelector("thead");
      const row = el.querySelector("tbody tr");
      const rowH = (row && row.offsetHeight) || 30;
      const headH = (thead && thead.offsetHeight) || 34;
      const n = Math.max(5, Math.floor((el.clientHeight - headH) / rowH));
      setItemsPerPage((cur) => (cur === n ? cur : n));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, records.length]);

  // 件数が減って現在ページが範囲外になったら最終ページへ寄せる
  useEffect(() => {
    setCurrentPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  return (
    <div className="wrap page-fill">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="施設一覧" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3.5" y1="6" x2="3.51" y2="6" />
              <line x1="3.5" y1="12" x2="3.51" y2="12" />
              <line x1="3.5" y1="18" x2="3.51" y2="18" />
            </svg>
          </span>
          <span className="page-h page-h-gap">施設一覧</span>
        </div>
        <div className="head-right">
          {canSync && (
            <button
              className="icon-btn"
              onClick={syncKintone}
              disabled={syncing || loading}
              title="Kintone取込（最新データを取り込みます・数秒〜十数秒）"
              aria-label="Kintone取込"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="8 17 12 21 16 17" />
                <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
              </svg>
            </button>
          )}
          <UpdatedPop />
        </div>
      </div>

      {/* 絞り込みは表の直前に置く */}
      {data && !error && (
        <div className="detail-tools list-tools">
          {/* 並びは 年 → 四半期 → 案件名 → ステータス → 検索。
              どれで絞るかは選択肢とアイコンで分かるので、項目名は出さない。 */}
          {years.length > 0 && (
            <Pulldown
              value={periodYear}
              onChange={setPeriodYear}
              ariaLabel="年で絞り込み"
              icon="calendar"
              options={[
                { value: "all", label: "すべての年" },
                ...years.map((y) => ({ value: String(y), label: `${y} 年` })),
              ]}
            />
          )}
          {records.length > 0 && (
            <Pulldown
              value={periodQ}
              onChange={setPeriodQ}
              disabled={periodYear === "all"}
              ariaLabel="四半期で絞り込み"
              icon="calendar"
              options={[
                { value: "all", label: "通年" },
                { value: "1", label: "Q1（1〜3月）" },
                { value: "2", label: "Q2（4〜6月）" },
                { value: "3", label: "Q3（7〜9月）" },
                { value: "4", label: "Q4（10〜12月）" },
              ]}
            />
          )}
          {records.length > 0 && (
            <Pulldown
              value={typeFilter}
              onChange={setTypeFilter}
              ariaLabel="案件名で絞り込み"
              icon="filter"
              options={[
                { value: "all", label: `すべての案件名（${records.length.toLocaleString("ja-JP")}）` },
                ...typeList.map((t) => ({
                  value: t,
                  label: `${t}（${typeCounts[t].toLocaleString("ja-JP")}）`,
                })),
              ]}
            />
          )}
          {records.length > 0 && (
            <Pulldown
              value={statusFilter}
              onChange={setStatusFilter}
              ariaLabel="ステータスで絞り込み"
              icon="filter"
              options={[
                { value: "active", label: "完了以外" },
                { value: "all", label: "すべてのステータス" },
              ]}
            />
          )}
          {records.length > 0 && (
            <label className="search-box" aria-label="HID・Hotel Name で検索">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <line x1="16.5" y1="16.5" x2="21" y2="21" />
              </svg>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="HID・Hotel Name で検索..."
              />
            </label>
          )}
          <span className="count">
            絞り込み： <b>{shown.length.toLocaleString("ja-JP")}</b> 件
            {shown.length !== records.length && (
              <span className="count-sub">
                {" "}
                / 全 {records.length.toLocaleString("ja-JP")} 件
              </span>
            )}
          </span>
        </div>
      )}

      <div className="card">
        {error ? (
          <div className="err">
            {"接続エラーが発生しました。\n\n"}
            {error}
            {"\n\n.env.local のサブドメイン / アプリID / APIトークンをご確認ください。"}
          </div>
        ) : loading && !data ? (
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
        ) : records.length === 0 ? (
          <div className="notice">レコードがありません。</div>
        ) : (
          <>
            {data?.source === "mock" && (
              <div className="notice">
                <h2>まだ Kintone に接続していません（デモ表示）</h2>
                下記の手順で接続すると、この表が実データに切り替わります。
                <ol>
                  <li>
                    <code>.env.local.example</code> を <code>.env.local</code> にコピー
                  </li>
                  <li>サブドメイン・アプリID・APIトークンを記入</li>
                  <li>開発サーバーを再起動</li>
                </ol>
              </div>
            )}
            <div className="tw list-tw" ref={twRef}>
              <table>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c}
                        className={"sortable" + (sort.col === c ? " sorted" : "")}
                        onClick={() => clickSort(c)}
                        title="クリックで並べ替え"
                      >
                        {HEADER_LABEL[c] || labelOf(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.map((r, i) => (
                    <tr
                      key={r.$id?.value ?? i}
                      className="clickable"
                      onClick={() => setSelected(r)}
                    >
                      {columns.map((c, ci) => {
                        const text = formatValue(r[c]);
                        const center = centerFrom >= 0 && ci >= centerFrom;
                        return (
                          <td
                            key={c}
                            className={
                              (c === "$id" ? "idcol" : "") + (center ? " tc" : "")
                            }
                            title={text}
                          >
                            {text === "" ? <span className="empty">—</span> : text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* ページネーション・コントロール */}
            {totalPages > 1 && (
              <div className="pagination-modern">
                <button
                  className="page-btn-modern"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  title="前のページへ"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                  <span>前へ</span>
                </button>
                
                <span className="page-info-modern">
                  <b>{currentPage}</b> / {totalPages}
                </span>

                <button
                  className="page-btn-modern"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  title="次のページへ"
                >
                  <span>次へ</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <DetailModal record={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
