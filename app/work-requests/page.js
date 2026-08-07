"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../Modal";
import { useUi } from "../Ui";

// 手動入力の3項目
const EMPTY_CELL = { created: false, recordNo: "", doneDate: "" };
// ISO(YYYY-MM-DD) → 表示用 YYYY/MM/DD
const fmtDate = (v) => (v ? String(v).replace(/-/g, "/") : "");
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

export default function WorkRequestsPage() {
  const [item, setItem] = useState(null); // 単一の登録シート（固定ページ）
  const [grid, setGrid] = useState(null); // {headers, rows, rowKeys, overlay, total} or {error}
  const [cells, setCells] = useState({}); // rowKey -> {created, recordNo, doneDate}
  const [gridLoading, setGridLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [filter, setFilter] = useState("all"); // "all" | "pending"（完了以外）

  const [editTarget, setEditTarget] = useState(null); // シート設定モーダル
  const [editRow, setEditRow] = useState(null); // 3項目の編集モーダル { rk }
  const [mform, setMform] = useState(EMPTY_CELL); // 編集モーダルの入力値
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState(null);
  const { setBusy, flashDone, showToast, busy } = useUi();

  // 列固定用（# 〜 施設名(日本語)）の left をJSで実測
  const tableRef = useRef(null);
  const [lefts, setLefts] = useState([]);

  useEffect(() => {
    fetch("/api/form-config", { cache: "no-store" }).then((r) => r.json()).then(setCfg).catch(() => {});
  }, []);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCanEdit(!!d?.perms?.editTasks))
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

  const loadItem = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await fetch("/api/work-requests", { cache: "no-store" }).then((r) => r.json());
      if (j.error) setError(j.error);
      const first = (j.items || [])[0] || null;
      setItem(first);
      if (first) await loadGrid(first.id);
      else {
        setGrid(null);
        setCells({});
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [loadGrid]);

  useEffect(() => {
    loadItem();
  }, [loadItem]);

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
      const body = editTarget.id ? { id: editTarget.id, title, url } : { title, url };
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
        await loadItem();
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
  const openEdit = (rk, r) => {
    const ov = cells[rk];
    if (ov) {
      setMform({ ...EMPTY_CELL, ...ov });
    } else {
      setMform({
        created: cols.recCreate >= 0 ? isMaru(r[cols.recCreate]) : false,
        recordNo: cols.recNo >= 0 ? String(r[cols.recNo] || "").trim() : "",
        doneDate: cols.done >= 0 ? toISO(r[cols.done]) : "",
      });
    }
    setEditRow({ rk });
  };
  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    setBusy("保存中…");
    try {
      await saveCell(editRow.rk, mform);
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

  const freezeProps = (pos) => {
    if (pos >= freezeCount) return {};
    const last = pos === freezeCount - 1;
    return {
      className: "wr-freeze" + (last ? " wr-freeze-last" : ""),
      style: { left: lefts[pos] ?? 0 },
    };
  };

  return (
    <div className="wrap page-compact forms-page">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="新規作業依頼" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </span>
          <span className="page-h page-h-gap">新規作業依頼</span>
          {grid && !grid.error && (
            <span className="forms-count-pill">
              {grid.total?.toLocaleString("ja-JP")} 件{grid.truncated && "（先頭のみ）"}
            </span>
          )}
          {item && grid && !grid.error && (
            <div className="wr-filter" role="group" aria-label="表示フィルター">
              <button className={"wr-filter-btn" + (filter === "all" ? " active" : "")} onClick={() => setFilter("all")}>すべて</button>
              <button className={"wr-filter-btn" + (filter === "pending" ? " active" : "")} onClick={() => setFilter("pending")}>完了以外</button>
            </div>
          )}
        </div>
        <div className="head-right">
          {canEdit && item && (
            <button className="icon-btn" onClick={() => setEditTarget({ id: item.id, title: item.title, url: item.url })} title="シートを設定" aria-label="シートを設定">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          {canEdit && !item && (
            <button className="icon-btn" onClick={() => setEditTarget({ title: "", url: "" })} title="シートを登録" aria-label="シートを登録">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
          <button className="icon-btn" onClick={loadItem} disabled={loading || gridLoading} title="再読み込み" aria-label="再読み込み">
            <svg className={loading || gridLoading ? "spin" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {error && <div className="banner err-banner">エラー：{error}</div>}

      {(loading || gridLoading) && !busy ? (
        <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
      ) : !item ? (
        <div className="card">
          <div className="notice">
            作業依頼シートがまだ登録されていません。
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
                {grid.rows.map((r, ri) => {
                  const rk = grid.rowKeys?.[ri] ?? `#${ri}`;
                  const cell = cells[rk] || EMPTY_CELL;
                  if (filter === "pending" && isDone(r, cell)) return null;
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

      {/* 3項目の編集モーダル */}
      <Modal
        open={!!editRow}
        title="作業状況を編集"
        onClose={() => setEditRow(null)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setEditRow(null)} disabled={saving}>キャンセル</button>
            <button className="save-btn" onClick={saveEdit} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
          </>
        }
      >
        <div className="modal-fields">
          <div className="chk-fld">
            <label className="chk">
              <input type="checkbox" checked={!!mform.created} onChange={(e) => setMform((m) => ({ ...m, created: e.target.checked }))} />
              レコード作成
            </label>
          </div>
          <label className="fld">
            レコードNo
            <input type="text" value={mform.recordNo} onChange={(e) => setMform((m) => ({ ...m, recordNo: e.target.value }))} placeholder="例：12345" />
          </label>
          <label className="fld">
            作業完了日
            <input type="date" value={mform.doneDate} onChange={(e) => setMform((m) => ({ ...m, doneDate: e.target.value }))} />
          </label>
        </div>
      </Modal>

      {/* シート設定モーダル */}
      <Modal
        open={!!editTarget}
        title={editTarget?.id ? "作業依頼シートを設定" : "作業依頼シートを登録"}
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
