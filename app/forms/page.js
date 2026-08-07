"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../Modal";
import { useUi } from "../Ui";

// 最終回答日時のラベル整形（今日 HH:MM / 昨日 HH:MM / M/D HH:MM）
function fmtUpdated(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const now = new Date();
  const hhmm = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `今日 ${hhmm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `昨日 ${hhmm}`;
  return `${d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })} ${hhmm}`;
}

export default function FormsPage() {
  const [items, setItems] = useState(null);
  const [counts, setCounts] = useState({}); // { id: {total, month, latest} | {error} }
  const [selected, setSelected] = useState(null);
  const [grid, setGrid] = useState(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canEdit, setCanEdit] = useState(false);

  const [editTarget, setEditTarget] = useState(null); // { id?, title, url, description }
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState(null);
  const [cfg, setCfg] = useState(null);
  const { setBusy, flashDone, showToast, busy } = useUi();
  const dragIndex = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  const reorder = (from, to) => {
    if (from == null || to == null || from === to) return;
    const arr = [...items];
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
    const withSort = arr.map((f, idx) => ({ ...f, sort: idx + 1 }));
    const prev = new Map(items.map((f) => [f.id, f.sort]));
    setItems(withSort);
    for (const f of withSort) {
      if (prev.get(f.id) !== f.sort) {
        fetch("/api/form-sheets", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: f.id, sort: f.sort }),
        }).catch(() => {});
      }
    }
  };

  useEffect(() => {
    fetch("/api/form-config", { cache: "no-store" }).then((r) => r.json()).then(setCfg).catch(() => {});
  }, []);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCanEdit(!!d?.perms?.editTasks))
      .catch(() => {});
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const j = await fetch("/api/form-sheet-counts", { cache: "no-store" }).then((r) => r.json());
      setCounts(j.counts || {});
    } catch {
      /* noop */
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await fetch("/api/form-sheets", { cache: "no-store" }).then((r) => r.json());
      if (j.error) setError(j.error);
      setItems(j.items || []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
    loadCounts();
  }, [loadList, loadCounts]);

  const loadGrid = useCallback(async (id) => {
    if (!id) {
      setGrid(null);
      return;
    }
    setGridLoading(true);
    try {
      const j = await fetch(`/api/form-sheet-data?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json());
      setGrid(j);
    } catch (e) {
      setGrid({ error: String(e?.message || e) });
    } finally {
      setGridLoading(false);
    }
  }, []);

  const openDetail = (id) => {
    setSelected(id);
    setGrid(null);
    loadGrid(id);
  };
  const backToList = () => {
    setSelected(null);
    setGrid(null);
  };

  const save = async () => {
    if (!editTarget) return;
    const title = editTarget.title.trim();
    const url = editTarget.url.trim();
    const description = (editTarget.description || "").trim();
    if (!title || !url) return;
    setSaving(true);
    setBusy("保存中…");
    try {
      const method = editTarget.id ? "PATCH" : "POST";
      const body = editTarget.id ? { id: editTarget.id, title, url, description } : { title, url, description };
      const res = await fetch("/api/form-sheets", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.error) {
        setBusy(null);
        showToast(res.error, "err");
      } else {
        const editedId = editTarget.id;
        setEditTarget(null);
        await loadList();
        loadCounts();
        if (editedId && editedId === selected) await loadGrid(editedId);
        flashDone("保存完了");
      }
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!delTarget) return;
    setSaving(true);
    setBusy("削除中…");
    try {
      await fetch(`/api/form-sheets?id=${encodeURIComponent(delTarget.id)}`, { method: "DELETE" }).catch(() => {});
      if (delTarget.id === selected) backToList();
      setDelTarget(null);
      await loadList();
      loadCounts();
      flashDone("削除完了");
    } finally {
      setSaving(false);
    }
  };

  const current = items?.find((x) => x.id === selected) || null;

  // 集計バー用のサマリー
  const cvals = Object.values(counts);
  const totalForms = items?.length || 0;
  const totalResponses = cvals.reduce((s, c) => s + (c && !c.error ? c.total || 0 : 0), 0);
  const monthResponses = cvals.reduce((s, c) => s + (c && !c.error ? c.month || 0 : 0), 0);
  const latestMs = cvals.reduce((m, c) => (c && !c.error && c.latest ? Math.max(m, c.latest) : m), 0);

  return (
    <div className="wrap page-compact forms-page">
      {/* 上部ヘッダー（他ページと共通スタイル）。一覧と詳細で内容を出し分ける */}
      <div className="head">
        {selected ? (
          <>
            <div className="head-left">
              <button className="icon-btn forms-back" onClick={backToList} title="一覧へ戻る" aria-label="一覧へ戻る">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="page-h page-h-gap">{current?.title || "フォーム回答"}</span>
              {grid && !grid.error && (
                <span className="forms-count-pill">
                  {grid.total?.toLocaleString("ja-JP")} 件{grid.truncated && "（先頭のみ）"}
                </span>
              )}
            </div>
            <div className="head-right">
              {canEdit && current && (
                <button className="icon-btn" onClick={() => setEditTarget({ id: current.id, title: current.title, url: current.url, description: current.description })} title="このフォームを編集" aria-label="編集">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
              <button className="icon-btn" onClick={() => loadGrid(selected)} disabled={gridLoading} title="再読み込み" aria-label="再読み込み">
                <svg className={gridLoading ? "spin" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="head-left">
              <span className="conn ok" title="フォーム回答" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                  <rect x="9" y="2" width="6" height="4" rx="1" />
                  <line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="14" y2="15" />
                </svg>
              </span>
              <span className="page-h page-h-gap">フォーム回答</span>
            </div>
            <div className="head-right">
              {canEdit && (
                <button className="icon-btn" onClick={() => setEditTarget({ title: "", url: "", description: "" })} title="フォームを追加" aria-label="フォームを追加">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              )}
              <button className="icon-btn" onClick={() => { loadList(); loadCounts(); }} disabled={loading} title="再読み込み" aria-label="再読み込み">
                <svg className={loading ? "spin" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      {error && <div className="banner err-banner">エラー：{error}</div>}

      {selected ? (
        /* ===== 詳細（回答テーブル） ===== */
        gridLoading && !busy ? (
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
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
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((r, ri) => (
                    <tr key={ri}>
                      <td className="forms-rownum">{ri + 1}</td>
                      {grid.headers.map((_, ci) => {
                        const v = r[ci] ?? "";
                        return (
                          <td key={ci} title={v || undefined}>
                            {v}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : items === null && !busy ? (
        <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
      ) : (
        /* ===== 一覧（集計＋レコード） ===== */
        <div className="forms-listwrap">
          {/* 集計バー */}
          <div className="forms-stats">
            <div className="fstat">
              <span className="fstat-ico fstat-blue" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                  <rect x="9" y="2" width="6" height="4" rx="1" />
                  <line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="14" y2="15" />
                </svg>
              </span>
              <span className="fstat-body">
                <span className="fstat-label">合計フォーム数</span>
                <span className="fstat-value">{totalForms.toLocaleString("ja-JP")}<span className="fstat-unit">件</span></span>
              </span>
            </div>
            <div className="fstat">
              <span className="fstat-ico fstat-green" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              </span>
              <span className="fstat-body">
                <span className="fstat-label">総回答数</span>
                <span className="fstat-value">{totalResponses.toLocaleString("ja-JP")}<span className="fstat-unit">件</span></span>
              </span>
            </div>
            <div className="fstat">
              <span className="fstat-ico fstat-purple" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="20" x2="4" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="20" y1="20" x2="20" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
                </svg>
              </span>
              <span className="fstat-body">
                <span className="fstat-label">今月の回答数</span>
                <span className="fstat-value">{monthResponses.toLocaleString("ja-JP")}<span className="fstat-unit">件</span></span>
              </span>
            </div>
            <div className="fstat">
              <span className="fstat-ico fstat-orange" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" />
                </svg>
              </span>
              <span className="fstat-body">
                <span className="fstat-label">最終更新</span>
                <span className="fstat-value fstat-value-sm">{fmtUpdated(latestMs)}</span>
              </span>
            </div>
          </div>

          {!items || items.length === 0 ? (
            <div className="card">
              <div className="notice">
                フォームがまだ登録されていません。
                {canEdit ? "右上の＋から、GoogleスプレッドシートのURLを登録してください。" : "編集権限のあるユーザーが登録すると、ここに表示されます。"}
              </div>
            </div>
          ) : (
            <div className="forms-grid">
              {items.map((f, i) => {
                const c = counts[f.id];
                return (
                  <div
                    key={f.id}
                    className={"form-card" + (dragOver === i ? " dragover" : "")}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetail(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDetail(f.id);
                      }
                    }}
                    onDragOver={canEdit ? (e) => { e.preventDefault(); if (dragOver !== i) setDragOver(i); } : undefined}
                    onDrop={canEdit ? () => { reorder(dragIndex.current, i); dragIndex.current = null; setDragOver(null); } : undefined}
                  >
                    {canEdit && (
                      <span
                        className="form-card-grip"
                        draggable
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => { e.stopPropagation(); dragIndex.current = i; }}
                        onDragEnd={() => { dragIndex.current = null; setDragOver(null); }}
                        title="ドラッグで並べ替え"
                        aria-hidden="true"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="9" cy="5" r="1.7" /><circle cx="15" cy="5" r="1.7" />
                          <circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" />
                          <circle cx="9" cy="19" r="1.7" /><circle cx="15" cy="19" r="1.7" />
                        </svg>
                      </span>
                    )}

                    <span className="form-card-head">
                      <span className="form-card-ico" aria-hidden="true">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                          <rect x="9" y="2" width="6" height="4" rx="1" />
                          <line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="14" y2="15" />
                        </svg>
                      </span>
                      <span className="form-card-body">
                        <span className="form-card-title" title={f.title}>{f.title}</span>
                        {f.description && <span className="form-card-desc">{f.description}</span>}
                      </span>
                    </span>

                    <span className="form-card-metric">
                      <span className="form-card-caption">回答数</span>
                      {c?.error ? (
                        <span className="form-card-err" title={c.error}>取得エラー</span>
                      ) : c ? (
                        <>
                          <span className="form-card-num">{Number(c.total || 0).toLocaleString("ja-JP")}</span>
                          <span className="form-card-unit">件</span>
                        </>
                      ) : (
                        <span className="form-card-dim">—</span>
                      )}
                    </span>

                    {canEdit && (
                      <span className="form-card-ops">
                        <button className="forms-op" onClick={(e) => { e.stopPropagation(); setEditTarget({ id: f.id, title: f.title, url: f.url, description: f.description }); }} title="編集" aria-label="編集">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                        <button className="forms-op danger" onClick={(e) => { e.stopPropagation(); setDelTarget(f); }} title="削除" aria-label="削除">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      </span>
                    )}

                    <span className="form-card-chev" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 追加・編集モーダル */}
      <Modal
        open={!!editTarget}
        title={editTarget?.id ? "フォームを編集" : "フォームを追加"}
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
              <input type="text" value={editTarget.title} onChange={(e) => setEditTarget({ ...editTarget, title: e.target.value })} placeholder="例：施設アンケート" />
            </label>
            <label className="fld">
              説明（任意）
              <input type="text" value={editTarget.description || ""} onChange={(e) => setEditTarget({ ...editTarget, description: e.target.value })} placeholder="例：CM掲載に関する情報を収集するフォームです" />
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
              URL末尾の <code>gid</code> で読み取るタブを判別します（フォーム回答タブを開いた状態でコピー）。
            </p>
          </div>
        )}
      </Modal>

      {/* 削除確認 */}
      <Modal
        open={!!delTarget}
        title="フォームの削除"
        onClose={() => setDelTarget(null)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setDelTarget(null)} disabled={saving}>キャンセル</button>
            <button className="save-btn danger-btn" onClick={doDelete} disabled={saving}>削除する</button>
          </>
        }
      >
        <span className="modal-strong">「{delTarget?.title}」</span> の登録を削除します。
        <p className="modal-note">シート自体は削除されません（サイトからの登録を外すだけです）。</p>
      </Modal>
    </div>
  );
}
