"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "../Modal";
import { useUi } from "../Ui";

// 手動入力の3列
const EMPTY_CELL = { created: false, recordNo: "", doneDate: "" };
// 「完了」の定義：作業完了日が入っている行
const isDone = (cell) => !!(cell && String(cell.doneDate || "").trim());
// ISO(YYYY-MM-DD) → 表示用 YYYY/MM/DD
const fmtDate = (v) => (v ? String(v).replace(/-/g, "/") : "");

export default function WorkRequestsPage() {
  const [item, setItem] = useState(null); // 単一の登録シート（固定ページ）
  const [grid, setGrid] = useState(null); // {headers, rows, rowKeys, overlay, total} or {error}
  const [cells, setCells] = useState({}); // rowKey -> {created, recordNo, doneDate}
  const [gridLoading, setGridLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [filter, setFilter] = useState("all"); // "all" | "pending"（完了以外）
  const [editingKey, setEditingKey] = useState(null); // 編集中の行キー

  const [editTarget, setEditTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState(null);
  const { setBusy, flashDone, showToast, busy } = useUi();

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

  // 登録シート（先頭1件）を固定ページとして読み込む
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
        </div>
        <div className="head-right">
          {item && grid && !grid.error && (
            <div className="wr-filter" role="group" aria-label="表示フィルター">
              <button className={"wr-filter-btn" + (filter === "all" ? " active" : "")} onClick={() => setFilter("all")}>すべて</button>
              <button className={"wr-filter-btn" + (filter === "pending" ? " active" : "")} onClick={() => setFilter("pending")}>完了以外</button>
            </div>
          )}
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
            <table>
              <thead>
                <tr>
                  <th className="forms-rownum">#</th>
                  {grid.headers.map((h, ci) => (
                    <th key={ci}>{h || ""}</th>
                  ))}
                  <th className="wr-mancol">レコード作成</th>
                  <th className="wr-mancol">レコードNo</th>
                  <th className="wr-mancol">作業完了日</th>
                  {canEdit && <th className="wr-opcol" />}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r, ri) => {
                  const rk = grid.rowKeys?.[ri] ?? `#${ri}`;
                  const cell = cells[rk] || EMPTY_CELL;
                  if (filter === "pending" && isDone(cell)) return null;
                  const editing = canEdit && editingKey === rk;
                  return (
                    <tr key={ri} className={editing ? "wr-row-editing" : undefined}>
                      <td className="forms-rownum">{ri + 1}</td>
                      {grid.headers.map((_, ci) => {
                        const v = r[ci] ?? "";
                        return (
                          <td key={ci} title={v || undefined}>
                            {v}
                          </td>
                        );
                      })}
                      {/* レコード作成 */}
                      <td className="wr-mancol wr-center">
                        {editing ? (
                          <input
                            type="checkbox"
                            className="wr-chk"
                            checked={!!cell.created}
                            onChange={(e) => saveCell(rk, { created: e.target.checked })}
                            aria-label="レコード作成"
                          />
                        ) : cell.created ? (
                          <span className="hid-check-on" aria-label="作成済">✓</span>
                        ) : (
                          ""
                        )}
                      </td>
                      {/* レコードNo */}
                      <td className="wr-mancol">
                        {editing ? (
                          <input
                            type="text"
                            className="wr-input"
                            defaultValue={cell.recordNo}
                            onBlur={(e) => {
                              if ((e.target.value || "") !== (cell.recordNo || "")) saveCell(rk, { recordNo: e.target.value });
                            }}
                            placeholder="—"
                          />
                        ) : (
                          cell.recordNo || ""
                        )}
                      </td>
                      {/* 作業完了日 */}
                      <td className="wr-mancol wr-center">
                        {editing ? (
                          <input
                            type="date"
                            className="wr-input wr-date"
                            value={cell.doneDate || ""}
                            onChange={(e) => saveCell(rk, { doneDate: e.target.value })}
                          />
                        ) : (
                          fmtDate(cell.doneDate)
                        )}
                      </td>
                      {canEdit && (
                        <td className="wr-opcol">
                          {editing ? (
                            <button className="forms-op hid-op-done" onClick={() => setEditingKey(null)} title="編集を終了" aria-label="編集を終了">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </button>
                          ) : (
                            <button className="forms-op" onClick={() => setEditingKey(rk)} title="編集" aria-label="編集">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </button>
                          )}
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
              「レコード作成 / レコードNo / 作業完了日」はこのサイト上で手動入力します（各行の先頭列＝タイムスタンプに紐づけて保存）。
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
