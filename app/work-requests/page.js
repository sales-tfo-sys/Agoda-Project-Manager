"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdhocActiveTable, { useAdhocActive } from "../AdhocActiveTable";
import FormAnswersTable, { filterFormRows } from "../FormAnswersTable";
import Modal from "../Modal";
import { useUi } from "../Ui";
import { cachedJson } from "../dataCache";

// 手動入力の3項目
const EMPTY_CELL = { created: false, recordNo: "", doneDate: "" };
// ISO(YYYY-MM-DD) → 表示用 YYYY/MM/DD
const fmtDate = (v) => (v ? String(v).replace(/-/g, "/") : "");
// 最終読込の表示（YYYY/MM/DD HH:MM）
const fmtStamp = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
// 日付文字列（2025/10/10 等）→ ISO(YYYY-MM-DD)
const toISO = (v) => {
  const m = String(v || "").trim().match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : "";
};
// レコード作成の印（〇 等）を真偽に解釈
const isMaru = (v) => {
  const s = String(v || "").trim();
  return s !== "" && !/^(×|✗|false|no|0|-)$/i.test(s);
};

// ページはタブで分かれる。
//   new       … 登録したスプレッドシートの一覧（シートは kind で振り分ける）
//   adhoc     … 進行中の Ad Hoc タスク（On Track / Behind）
//   temairazu … 管理 → フォーム回答 の「新規参画(Temairazu)」と同じ回答一覧
const KINDS = [
  { key: "new", label: "新規作業依頼" },
  { key: "adhoc", label: "Ad Hoc Task" },
  { key: "temairazu", label: "Temairazu" },
];
const KIND_KEYS = KINDS.map((k) => k.key);
// フォーム回答に登録してあるシートのうち、どれを Temairazu タブに出すか（名前で探す）
const TEMAIRAZU_FORM = /temairazu/i;
const KIND_LS = "agoda-workreq-kind";

// ヘッダーの切り替えタブ。ラベルの幅が違うので、
// スライダーは選んでいるボタンを実測して重ねる（ダッシュボードのタブと同じ作り）。
function SegTabs({ items, value, onChange, label }) {
  const ref = useRef(null);
  const [thumb, setThumb] = useState(null);
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      const btn = el && el.querySelector(".segbar-btn.active");
      if (!btn) {
        setThumb(null);
        return;
      }
      setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value, items]);
  return (
    <div className="segbar segbar-sm wr-kind-seg" role="tablist" aria-label={label} ref={ref}>
      <span
        className="segbar-thumb"
        style={thumb ? { left: thumb.left, width: thumb.width, transform: "none" } : { opacity: 0 }}
        aria-hidden="true"
      />
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={value === it.key}
          className={"segbar-btn" + (value === it.key ? " active" : "")}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

const FILTERS = [
  { key: "all", label: "すべて" },
  { key: "pending", label: "完了以外" },
];

export default function WorkRequestsPage() {
  const [kind, setKind] = useState("new"); // "new" | "adhoc" | "temairazu"
  const isAdhoc = kind === "adhoc";
  const isForm = kind === "temairazu";
  // Temairazu タブ：フォーム回答シートの中身と検索語
  const [form, setForm] = useState({ loading: false, title: null, grid: null, error: null });
  const [formQ, setFormQ] = useState("");
  const [items, setItems] = useState([]); // 登録済みシートの一覧
  const [grid, setGrid] = useState(null); // {headers, rows, rowKeys, overlay, total} or {error}
  const [cells, setCells] = useState({}); // rowKey -> {created, recordNo, doneDate}
  const [gridLoading, setGridLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  // 開いたときは「完了以外」（まだ手を付けるべき依頼だけを見たいため）
  const [filter, setFilter] = useState("pending"); // "all" | "pending"（完了以外）

  const [editTarget, setEditTarget] = useState(null); // シート設定モーダル
  const [editRow, setEditRow] = useState(null); // 3項目の編集モーダル { rk }
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState(null);
  const { setBusy, flashDone, showToast, busy } = useUi();

  // 列固定用（# 〜 施設名(日本語)）の left をJSで実測
  const tableRef = useRef(null);
  const [lefts, setLefts] = useState([]);

  // Ad Hoc Task タブは、進行中（On Track / Behind）のタスクを出す
  const adhocActive = useAdhocActive();

  // 選んだタブは次に開いたときも覚えておく
  useEffect(() => {
    try {
      const v = localStorage.getItem(KIND_LS);
      if (KIND_KEYS.includes(v)) setKind(v);
    } catch {}
  }, []);
  const switchKind = (k) => {
    setKind(k);
    try {
      localStorage.setItem(KIND_LS, k);
    } catch {}
  };

  useEffect(() => {
    fetch("/api/form-config", { cache: "no-store" }).then((r) => r.json()).then(setCfg).catch(() => {});
  }, []);
  useEffect(() => {
    cachedJson("/api/auth/me", 60 * 1000)
      .then((d) => setCanEdit(!!d?.perms?.pages?.workReq?.edit))
      .catch(() => {});
  }, []);

  const loadGrid = useCallback(async (id) => {
    if (!id) {
      setGrid(null);
      setCells({});
      return;
    }
    setGridLoading(true);
    try {
      const j = await fetch(`/api/work-request-data?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      }).then((r) => r.json());
      setGrid(j);
      setCells(j?.overlay || {});
    } catch (e) {
      setGrid({ error: String(e?.message || e) });
    } finally {
      setGridLoading(false);
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await fetch("/api/work-requests", { cache: "no-store" }).then((r) => r.json());
      if (j.error) setError(j.error);
      setItems(j.items || []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // 新規作業依頼タブのシート。
  // kind を持たない古い登録は「新規作業依頼」のものとして扱う（元の1ページ構成からの引き継ぎ）。
  const item = useMemo(() => {
    if (kind !== "new") return null;
    return items.find((x) => x.kind === "new") || items.find((x) => !x.kind) || null;
  }, [items, kind]);

  // Temairazu タブを開いたら、フォーム回答に登録してある Temairazu のシートを読む
  useEffect(() => {
    if (!isForm) return;
    let alive = true;
    setForm((f) => ({ ...f, loading: true, error: null }));
    (async () => {
      try {
        const list = await fetch("/api/form-sheets", { cache: "no-store" }).then((r) => r.json());
        const sheet = (list.items || []).find((x) => TEMAIRAZU_FORM.test(x.title || ""));
        if (!sheet) {
          if (alive)
            setForm({
              loading: false,
              title: null,
              grid: null,
              error: "管理 → フォーム回答 に、名前に「Temairazu」を含むシートが登録されていません。",
            });
          return;
        }
        const grid = await fetch(`/api/form-sheet-data?id=${encodeURIComponent(sheet.id)}`, {
          cache: "no-store",
        }).then((r) => r.json());
        if (alive) setForm({ loading: false, title: sheet.title, grid, error: null });
      } catch (e) {
        if (alive) setForm({ loading: false, title: null, grid: null, error: String(e?.message || e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [isForm]);
  const formRows = useMemo(() => filterFormRows(form.grid, formQ), [form.grid, formQ]);

  // タブを切り替えたら、そのシートを読み直す
  useEffect(() => {
    loadGrid(item?.id || null);
  }, [item?.id, loadGrid]);

  // 手動セルの保存
  const saveCell = async (rowKey, patch) => {
    if (!item) return;
    const cur = cells[rowKey] || EMPTY_CELL;
    const next = { ...cur, ...patch };
    setCells((c) => ({ ...c, [rowKey]: next }));
    try {
      const res = await fetch("/api/work-request-cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId: item.id, rowKey, ...next }),
      }).then((r) => r.json());
      if (res?.error) showToast(res.error, "err");
    } catch (e) {
      showToast(String(e?.message || e), "err");
    }
  };

  const save = async () => {
    if (!editTarget) return;
    const title = editTarget.title.trim();
    const url = editTarget.url.trim();
    if (!title || !url) return;
    setSaving(true);
    setBusy("保存中…");
    try {
      const method = editTarget.id ? "PATCH" : "POST";
      const k = editTarget.kind || kind;
      const body = editTarget.id ? { id: editTarget.id, title, url, kind: k } : { title, url, kind: k };
      const res = await fetch("/api/work-requests", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.error) {
        setBusy(null);
        showToast(res.error, "err");
      } else {
        setEditTarget(null);
        await loadItems();
        flashDone("保存完了");
      }
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };

  // 3項目の編集モーダル。overlay があればそれを、無ければシートの元値で初期化する。
  // 初期値を editRow に持たせ、フォームの状態は子コンポーネント側に閉じ込める
  // （入力のたびに巨大なテーブルを再描画しないため）。
  const openEdit = (rk, r) => {
    const ov = cells[rk];
    const initial = ov
      ? { ...EMPTY_CELL, ...ov }
      : {
          created: cols.recCreate >= 0 ? isMaru(r[cols.recCreate]) : false,
          recordNo: cols.recNo >= 0 ? String(r[cols.recNo] || "").trim() : "",
          doneDate: cols.done >= 0 ? toISO(r[cols.done]) : "",
        };
    setEditRow({ rk, initial });
  };
  const saveEdit = async (vals) => {
    if (!editRow) return;
    setSaving(true);
    setBusy("保存中…");
    try {
      await saveCell(editRow.rk, vals);
      setEditRow(null);
      flashDone("保存完了");
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };

  // シート列の役割を特定（ステータス / 施設名(日本語) / 既存の3列）
  const cols = useMemo(() => {
    const h = (grid?.headers || []).map((x) => String(x || ""));
    const find = (pred) => h.findIndex(pred);
    let name = find((x) => x.includes("日本語"));
    if (name < 0) name = find((x) => x.includes("施設名") || x.toLowerCase().includes("hotel name"));
    return {
      status: find((x) => x.includes("ステータス")),
      name,
      recCreate: find((x) => x.replace(/\s/g, "").includes("レコード作成")),
      recNo: find((x) => x.replace(/\s/g, "").includes("レコードNo")),
      done: find((x) => x.includes("作業完了日")),
    };
  }, [grid]);

  // 「完了」判定：ステータスが「完了」を含む（例：完了 / 7.販売開始確認（完了））、
  // または「対応不要」。もしくは作業完了日が入っている行。
  const isDone = (r, cell) => {
    const st = cols.status >= 0 ? String(r[cols.status] || "") : "";
    if (st.includes("完了") || st.includes("対応不要")) return true;
    const dd = cell && cell.doneDate ? cell.doneDate : cols.done >= 0 ? r[cols.done] : "";
    if (String(dd || "").trim()) return true;
    return false;
  };

  // 既存の3列（レコード作成/レコードNo/作業完了日）はサイト入力（overlay）を優先表示。
  // overlay 未保存ならシートの元の値を表示する。
  const cellDisplay = (r, ci, rk) => {
    const ov = cells[rk];
    if (ov) {
      if (ci === cols.recCreate) return ov.created ? "〇" : "";
      if (ci === cols.recNo) return ov.recordNo || "";
      if (ci === cols.done) return fmtDate(ov.doneDate);
    }
    return r[ci] ?? "";
  };

  // 固定する列数（シート列 0..name）※#列は無し
  const freezeCount = cols.name >= 0 ? cols.name + 1 : 0;

  // ヘッダーの実幅から固定列の left を算出
  useEffect(() => {
    const measure = () => {
      const tbl = tableRef.current;
      const hr = tbl && tbl.querySelector("thead tr");
      if (!hr) {
        setLefts([]);
        return;
      }
      const kids = hr.children;
      const arr = [];
      let acc = 0;
      for (let i = 0; i < freezeCount && i < kids.length; i++) {
        arr.push(acc);
        acc += kids[i].offsetWidth;
      }
      setLefts(arr);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [grid, freezeCount, filter]);

  const kindLabel = KINDS.find((k) => k.key === kind)?.label || "";

  // 絞り込んだあとに実際に出る行。件数の表示もこれを数える。
  const visibleRows = useMemo(() => {
    if (!grid || grid.error || !Array.isArray(grid.rows)) return [];
    return grid.rows
      .map((r, ri) => ({ r, rk: grid.rowKeys?.[ri] ?? `#${ri}`, ri }))
      .filter(({ r, rk }) => filter !== "pending" || !isDone(r, cells[rk] || EMPTY_CELL));
    // isDone は cols（シートの列の役割）に依存するので、cols も見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, cells, filter, cols]);

  // ヘッダーの件数（いま表に出ている行数）
  const shownCount = isAdhoc ? adhocActive.rows.length : isForm ? formRows.length : visibleRows.length;
  const formReady = isForm && !form.loading && form.grid && !form.grid.error;

  const freezeProps = (pos) => {
    if (pos >= freezeCount) return {};
    const last = pos === freezeCount - 1;
    return {
      className: "wr-freeze" + (last ? " wr-freeze-last" : ""),
      style: { left: lefts[pos] ?? 0 },
    };
  };

  return (
    <div className="wrap page-compact forms-page wr-page">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="作業依頼" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </span>
          <span className="page-h page-h-gap">作業依頼</span>
          {/* 新規作業依頼 / Ad Hoc Task の切り替え。他のページと同じくヘッダーに置く */}
          <span className="head-sep" aria-hidden="true" />
          <SegTabs items={KINDS} value={kind} onChange={switchKind} label="作業依頼の切替" />
          {/* 絞り込みもページタブと同じ形にそろえる。件数はその右に置き、
              いま表として出ている行数を出す（絞り込むと減る） */}
          {kind === "new" && item && grid && !grid.error && (
            <SegTabs items={FILTERS} value={filter} onChange={setFilter} label="表示フィルター" />
          )}
          {/* Temairazu：フォーム回答と同じく、全部の列を対象に検索できる */}
          {formReady && (form.grid.rows || []).length > 0 && (
            <label className="search-box forms-search" aria-label="回答を検索">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <line x1="16.5" y1="16.5" x2="21" y2="21" />
              </svg>
              <input type="search" value={formQ} onChange={(e) => setFormQ(e.target.value)} placeholder="回答の中を検索..." />
            </label>
          )}
          {((isAdhoc && !adhocActive.loading) || formReady || (kind === "new" && grid && !grid.error)) && (
            <span className="forms-count-pill">
              {shownCount.toLocaleString("ja-JP")} 件
              {kind === "new" && grid?.truncated && "（先頭のみ）"}
              {isForm && form.grid?.truncated && "（先頭のみ）"}
            </span>
          )}
        </div>
        <div className="head-right">
          {/* 最終読込。いつ時点の内容なのかを分かるようにする。
              新規作業依頼：スプレッドシートを実際に読んだ時刻（サーバーで最大1分ためている）
              Ad Hoc Task ：このページがデータベースを読んだ時刻（その場で読むので、これがデータの時点） */}
          {(() => {
            const at = isAdhoc
              ? adhocActive.loadedAt
              : isForm
              ? formReady
                ? form.grid.fetchedAt
                : null
              : grid && !grid.error
              ? grid.fetchedAt
              : null;
            const text = fmtStamp(at);
            if (!text) return null;
            return (
              <span
                className="updated"
                title={
                  isAdhoc
                    ? "このページが Ad Hoc タスクを読み込んだ時刻です。ページを開き直すと読み直します。"
                    : "スプレッドシートを読み込んだ時刻です。シートの内容はサーバーで最大1分ためているため、開いた時刻より少し前になることがあります。ページを開き直すと読み直します。"
                }
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                最終読込：{text}
              </span>
            );
          })()}
          {kind === "new" && canEdit && item && (
            <button className="icon-btn" onClick={() => setEditTarget({ id: item.id, kind, title: item.title, url: item.url })} title="シートを設定" aria-label="シートを設定">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          {kind === "new" && canEdit && !item && (
            <button className="icon-btn" onClick={() => setEditTarget({ kind: "new", title: kindLabel, url: "" })} title="シートを登録" aria-label="シートを登録">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner err-banner">エラー：{error}</div>}

      {isAdhoc ? (
        adhocActive.loading ? (
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
        ) : adhocActive.error ? (
          <div className="banner err-banner">エラー：{adhocActive.error}</div>
        ) : adhocActive.rows.length === 0 ? (
          <div className="card">
            <div className="notice">進行中の Ad Hoc Task はありません。</div>
          </div>
        ) : (
          <AdhocActiveTable rows={adhocActive.rows} />
        )
      ) : isForm ? (
        form.loading ? (
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
        ) : form.error ? (
          <div className="card">
            <div className="notice">{form.error}</div>
          </div>
        ) : form.grid?.error ? (
          <div className="banner warn-banner">{form.grid.error}</div>
        ) : !form.grid || (form.grid.headers || []).length === 0 ? (
          <div className="card">
            <div className="notice">データがありません。</div>
          </div>
        ) : (
          <FormAnswersTable headers={form.grid.headers} rows={formRows} q={formQ} />
        )
      ) : (loading || gridLoading) && !busy ? (
        <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
      ) : !item ? (
        <div className="card">
          <div className="notice">
            「{kindLabel}」のシートがまだ登録されていません。
            {canEdit ? "右上の＋から、GoogleスプレッドシートのURLを登録してください。" : "編集権限のあるユーザーが登録すると、ここに表示されます。"}
          </div>
        </div>
      ) : grid?.error ? (
        <div className="banner warn-banner">{grid.error}</div>
      ) : !grid || (grid.headers || []).length === 0 ? (
        <div className="notice">データがありません。</div>
      ) : (
        <div className="card no-pad">
          <div className="tw forms-tw">
            <table ref={tableRef}>
              <thead>
                <tr>
                  {grid.headers.map((h, ci) => {
                    const isMan = ci === cols.recCreate || ci === cols.recNo || ci === cols.done;
                    const fp = freezeProps(ci);
                    const cn = [fp.className, isMan ? "wr-mancell" : ""].filter(Boolean).join(" ");
                    return (
                      <th key={ci} style={fp.style} className={cn || undefined}>{h || ""}</th>
                    );
                  })}
                  {canEdit && <th className="wr-opcol" />}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ r, rk, ri }) => {
                  return (
                    <tr key={ri}>
                      {grid.headers.map((_, ci) => {
                        const v = cellDisplay(r, ci, rk);
                        const isMan = ci === cols.recCreate || ci === cols.recNo || ci === cols.done;
                        const fp = freezeProps(ci);
                        const cn = [fp.className, isMan ? "wr-mancell" : ""].filter(Boolean).join(" ");
                        return (
                          <td key={ci} style={fp.style} className={cn || undefined} title={v || undefined}>
                            {v}
                          </td>
                        );
                      })}
                      {canEdit && (
                        <td className="wr-opcol">
                          <button className="forms-op" onClick={() => openEdit(rk, r)} title="レコード作成・レコードNo・作業完了日を編集" aria-label="編集">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3項目の編集モーダル（フォーム状態は子に閉じ込め、テーブルを再描画させない） */}
      <CellEditModal
        key={editRow?.rk || "closed"}
        open={!!editRow}
        initial={editRow?.initial}
        saving={saving}
        onCancel={() => setEditRow(null)}
        onSave={saveEdit}
      />

      {/* シート設定モーダル */}
      <Modal
        open={!!editTarget}
        title={`「${KINDS.find((k) => k.key === (editTarget?.kind || kind))?.label || ""}」のシートを${editTarget?.id ? "設定" : "登録"}`}
        onClose={() => setEditTarget(null)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setEditTarget(null)} disabled={saving}>キャンセル</button>
            <button className="save-btn" onClick={save} disabled={saving || !editTarget?.title.trim() || !editTarget?.url.trim()}>
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        {editTarget && (
          <div className="modal-fields">
            <label className="fld">
              名前
              <input type="text" value={editTarget.title} onChange={(e) => setEditTarget({ ...editTarget, title: e.target.value })} placeholder="例：新規作業依頼" />
            </label>
            <label className="fld">
              スプレッドシートURL（対象タブを開いた状態でコピー）
              <input type="text" value={editTarget.url} onChange={(e) => setEditTarget({ ...editTarget, url: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=..." />
            </label>
            <p className="modal-note">
              {cfg?.mode === "service" ? (
                <>
                  対象シートを、次の<b>サービスアカウントに「閲覧者」で共有</b>してください（公開不要）：
                  <br />
                  <code className="sa-email">{cfg.serviceEmail}</code>
                </>
              ) : (
                <>対象シートは「リンクを知っている全員が閲覧可」にしてください。</>
              )}
              <br />
              「レコード作成 / レコードNo / 作業完了日」は各行の編集ボタンから入力します（先頭列＝タイムスタンプに紐づけて保存）。
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

// 編集モーダル本体。入力状態をこの中に閉じ込めることで、
// 1文字ごとの再描画が親（巨大なテーブル）に波及しないようにする。
function CellEditModal({ open, initial, saving, onCancel, onSave }) {
  const [m, setM] = useState(initial || EMPTY_CELL);
  return (
    <Modal
      open={open}
      title="作業状況を編集"
      onClose={onCancel}
      footer={
        <>
          <button className="mini-btn" onClick={onCancel} disabled={saving}>キャンセル</button>
          <button className="save-btn" onClick={() => onSave(m)} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
        </>
      }
    >
      <div className="modal-fields">
        <div className="chk-fld">
          <label className="chk">
            <input type="checkbox" checked={!!m.created} onChange={(e) => setM((s) => ({ ...s, created: e.target.checked }))} />
            レコード作成
          </label>
        </div>
        <label className="fld">
          レコードNo
          <input type="text" value={m.recordNo} onChange={(e) => setM((s) => ({ ...s, recordNo: e.target.value }))} placeholder="例：12345" />
        </label>
        <label className="fld">
          作業完了日
          <input type="date" value={m.doneDate} onChange={(e) => setM((s) => ({ ...s, doneDate: e.target.value }))} />
        </label>
      </div>
    </Modal>
  );
}
