"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../Modal";
import { useUi } from "../Ui";

export default function FormsPage() {
  const [items, setItems] = useState(null); // 登録フォーム一覧
  const [counts, setCounts] = useState({}); // { id: {total} | {error} }
  const [selected, setSelected] = useState(null); // 詳細表示中のフォームid（null=カード一覧）
  const [grid, setGrid] = useState(null); // 選択フォームの中身 {headers, rows, total, truncated} or {error}
  const [gridLoading, setGridLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canEdit, setCanEdit] = useState(false);

  // 追加・編集モーダル
  const [editTarget, setEditTarget] = useState(null); // { id?, title, url } or null
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState(null);
  const [cfg, setCfg] = useState(null); // { mode, serviceEmail }
  const { setBusy, flashDone, showToast, busy } = useUi();
  // ドラッグ並べ替え
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
    fetch("/api/form-config", { cache: "no-store" })
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCanEdit(!!d?.perms?.editTasks))
      .catch(() => {});
  }, []);

  // カード一覧用の件数をまとめて取得
  const loadCounts = useCallback(async () => {
    try {
      const j = await fetch("/api/form-sheet-counts", { cache: "no-store" }).then((r) => r.json());
      setCounts(j.counts || {});
    } catch {
      /* 件数は無くても一覧は表示する */
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await fetch("/api/form-sheets", { cache: "no-store" }).then((r) => r.json());
      if (j.error) setError(j.error);
      const list = j.items || [];
      setItems(list);
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

  // 選択フォームの中身を取得
  const loadGrid = useCallback(async (id) => {
    if (!id) {
      setGrid(null);
      return;
    }
    setGridLoading(true);
    try {
      const j = await fetch(`/api/form-sheet-data?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      }).then((r) => r.json());
      setGrid(j);
      // 件数を最新化
      setCounts((c) => ({ ...c, [id]: j?.error ? { error: j.error } : { total: j?.total ?? 0 } }));
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
    if (!title || !url) return;
    setSaving(true);
    setBusy("保存中…");
    try {
      const method = editTarget.id ? "PATCH" : "POST";
      const body = editTarget.id ? { id: editTarget.id, title, url } : { title, url };
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
      await fetch(`/api/form-sheets?id=${encodeURIComponent(delTarget.id)}`, {
        method: "DELETE",
      }).catch(() => {});
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

  return (
    <div className="wrap page-compact forms-page">
      <div className="head">
        <div className="head-left">
          {selected ? (
            <button className="icon-btn forms-back" onClick={backToList} title="一覧へ戻る" aria-label="一覧へ戻る">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          ) : (
            <span className="conn ok" title="フォーム回答" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                <rect x="9" y="2" width="6" height="4" rx="1" />
                <line x1="8" y1="11" x2="16" y2="11" />
                <line x1="8" y1="15" x2="14" y2="15" />
              </svg>
            </span>
          )}
          <span className="page-h page-h-gap">{selected ? current?.title || "フォーム回答" : "フォーム回答"}</span>
          {selected && grid && !grid.error && (
            <span className="forms-count-pill">
              {grid.total?.toLocaleString("ja-JP")} 件{grid.truncated && "（先頭のみ）"}
            </span>
          )}
        </div>
        <div className="head-right">
          {canEdit && !selected && (
            <button
              className="icon-btn"
              onClick={() => setEditTarget({ title: "", url: "" })}
              title="フォームを追加"
              aria-label="フォームを追加"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
          {canEdit && selected && current && (
            <button
              className="icon-btn"
              onClick={() => setEditTarget({ id: current.id, title: current.title, url: current.url })}
              title="このフォームを編集"
              aria-label="編集"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => {
              if (selected) loadGrid(selected);
              else {
                loadList();
                loadCounts();
              }
            }}
            disabled={loading || gridLoading}
            title="再読み込み"
            aria-label="再読み込み"
          >
            <svg className={loading || gridLoading ? "spin" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {error && <div className="banner err-banner">エラー：{error}</div>}

      {items === null && !busy ? (
        <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
      ) : !items || items.length === 0 ? (
        <div className="card">
          <div className="notice">
            フォームがまだ登録されていません。
            {canEdit
              ? "右上の＋から、GoogleスプレッドシートのURLを登録してください。"
              : "編集権限のあるユーザーが登録すると、ここに表示されます。"}
          </div>
        </div>
      ) : selected ? (
        /* ===== 詳細（回答テーブル） ===== */
        <>
          {gridLoading && !busy ? (
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
          )}
        </>
      ) : (
        /* ===== カード一覧 ===== */
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
                onDragOver={
                  canEdit
                    ? (e) => {
                        e.preventDefault();
                        if (dragOver !== i) setDragOver(i);
                      }
                    : undefined
                }
                onDrop={
                  canEdit
                    ? () => {
                        reorder(dragIndex.current, i);
                        dragIndex.current = null;
                        setDragOver(null);
                      }
                    : undefined
                }
              >
                {canEdit && (
                  <span
                    className="form-card-grip"
                    draggable
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      dragIndex.current = i;
                    }}
                    onDragEnd={() => {
                      dragIndex.current = null;
                      setDragOver(null);
                    }}
                    title="ドラッグで並べ替え"
                    aria-hidden="true"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="9" cy="5" r="1.7" />
                      <circle cx="15" cy="5" r="1.7" />
                      <circle cx="9" cy="12" r="1.7" />
                      <circle cx="15" cy="12" r="1.7" />
                      <circle cx="9" cy="19" r="1.7" />
                      <circle cx="15" cy="19" r="1.7" />
                    </svg>
                  </span>
                )}

                <span className="form-card-ico" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                    <rect x="9" y="2" width="6" height="4" rx="1" />
                    <line x1="8" y1="11" x2="16" y2="11" />
                    <line x1="8" y1="15" x2="14" y2="15" />
                  </svg>
                </span>

                <span className="form-card-title" title={f.title}>
                  {f.title}
                </span>

                <span className="form-card-count">
                  {c?.error ? (
                    <span className="form-card-err" title={c.error}>取得エラー</span>
                  ) : c ? (
                    <>
                      <b>{Number(c.total || 0).toLocaleString("ja-JP")}</b> 件
                    </>
                  ) : (
                    <span className="form-card-dim">件数取得中…</span>
                  )}
                </span>

                {canEdit && (
                  <span className="form-card-ops">
                    <button
                      className="forms-op"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditTarget({ id: f.id, title: f.title, url: f.url });
                      }}
                      title="編集"
                      aria-label="編集"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      className="forms-op danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDelTarget(f);
                      }}
                      title="削除"
                      aria-label="削除"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 追加・編集モーダル */}
      <Modal
        open={!!editTarget}
        title={editTarget?.id ? "フォームを編集" : "フォームを追加"}
        onClose={() => setEditTarget(null)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setEditTarget(null)} disabled={saving}>
              キャンセル
            </button>
            <button
              className="save-btn"
              onClick={save}
              disabled={saving || !editTarget?.title.trim() || !editTarget?.url.trim()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        {editTarget && (
          <div className="modal-fields">
            <label className="fld">
              名前
              <input
                type="text"
                value={editTarget.title}
                onChange={(e) => setEditTarget({ ...editTarget, title: e.target.value })}
                placeholder="例：施設アンケート"
              />
            </label>
            <label className="fld">
              スプレッドシートURL（対象タブを開いた状態でコピー）
              <input
                type="text"
                value={editTarget.url}
                onChange={(e) => setEditTarget({ ...editTarget, url: e.target.value })}
                placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=..."
              />
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
            <button className="mini-btn" onClick={() => setDelTarget(null)} disabled={saving}>
              キャンセル
            </button>
            <button className="save-btn danger-btn" onClick={doDelete} disabled={saving}>
              削除する
            </button>
          </>
        }
      >
        <span className="modal-strong">「{delTarget?.title}」</span> の登録を削除します。
        <p className="modal-note">シート自体は削除されません（サイトからの登録を外すだけです）。</p>
      </Modal>
    </div>
  );
}
