"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function DetailRow({ label, value }) {
  const isUrl = /^https?:\/\//.test(value);
  return (
    <div className="kv">
      <div className="kv-l">{label}</div>
      <div className="kv-v">
        {value ? (
          isUrl ? (
            <a href={value} target="_blank" rel="noreferrer">
              {value}
            </a>
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
          <section className="panel">
            <div className="panel-title">基本情報</div>
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

          <section className="panel">
            <div className="panel-title">滞留理由</div>
            <div className="panel-text">
              {fieldValue(record, FIELD_CODE["滞留理由"]) || "—"}
            </div>
          </section>

          <div className="box-row">
            {["いつまでに", "誰が", "なにをする"].map((k) => (
              <div className="box" key={k}>
                <div className="box-title">{k}</div>
                <div className="box-text">
                  {fieldValue(record, FIELD_CODE[k]) || "—"}
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
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCanSync(!!d?.perms?.editTasks))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/records", { cache: "no-store" });
      const json = await res.json();
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
    try {
      const res = await fetch("/api/kintone-sync", { method: "POST" }).then((r) => r.json());
      if (res.error) setError(res.error);
      else await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSyncing(false);
    }
  }, [load]);

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
          {updatedAt && (
            <span className="updated">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
              最終更新：{formatDateTime(updatedAt)}
            </span>
          )}
          {canSync && (
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
          <button
            className="icon-btn"
            onClick={load}
            disabled={loading}
            title="表示を再読み込み"
            aria-label="表示を再読み込み"
          >
            <RefreshIcon spinning={loading} />
          </button>
        </div>
      </div>

      {/* 絞り込みは表の直前に置く（ヘッダーはアイコンと更新だけにする） */}
      {data && !error && (
        <div className="detail-tools list-tools">
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
          {records.length > 0 && (
            <label className="head-year">
              案件名
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">
                  すべて（{records.length.toLocaleString("ja-JP")}）
                </option>
                {typeList.map((t) => (
                  <option key={t} value={t}>
                    {t}（{typeCounts[t].toLocaleString("ja-JP")}）
                  </option>
                ))}
              </select>
            </label>
          )}
          {records.length > 0 && (
            <label className="head-year">
              ステータス
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="active">完了以外</option>
                <option value="all">すべて</option>
              </select>
            </label>
          )}
          {years.length > 0 && (
            <label className="head-year">
              年
              <select value={periodYear} onChange={(e) => setPeriodYear(e.target.value)}>
                <option value="all">すべて</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
            </label>
          )}
          {records.length > 0 && (
            <label className="head-year">
              四半期
              <select
                value={periodQ}
                onChange={(e) => setPeriodQ(e.target.value)}
                disabled={periodYear === "all"}
                title={periodYear === "all" ? "先に年を選んでください" : undefined}
              >
                <option value="all">通年</option>
                <option value="1">Q1（1〜3月）</option>
                <option value="2">Q2（4〜6月）</option>
                <option value="3">Q3（7〜9月）</option>
                <option value="4">Q4（10〜12月）</option>
              </select>
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
