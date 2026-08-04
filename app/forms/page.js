"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "../Modal";

export default function FormsPage() {
  const [items, setItems] = useState(null); // 登録フォーム一覧
  const [selected, setSelected] = useState(null); // 選択中のフォームid
  const [grid, setGrid] = useState(null); // 選択フォームの中身 {headers, rows, total, truncated} or {error}
  const [gridLoading, setGridLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canEdit, setCanEdit] = useState(false);

  // 追加・編集モーダル
  const [editTarget, setEditTarget] = useState(null); // { id?, title, url } or null
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCanEdit(!!d?.perms?.editTasks))
      .catch(() => {});
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await fetch("/api/form-sheets", { cache: "no-store" }).then((r) => r.json());
      if (j.error) setError(j.error);
      const list = j.items || [];
      setItems(list);
      setSelected((cur) => (cur && list.some((x) => x.id === cur) ? cur : list[0]?.id || null));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

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
    } catch (e) {
      setGrid({ error: String(e?.message || e) });
    } finally {
      setGridLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGrid(selected);
  }, [selected, loadGrid]);

  const save = async () => {
    if (!editTarget) return;
    const title = editTarget.title.trim();
    const url = editTarget.url.trim();
    if (!title || !url) return;
    setSaving(true);
    try {
      const method = editTarget.id ? "PATCH" : "POST";
      const body = editTarget.id ? { id: editTarget.id, title, url } : { title, url };
      const res = await fetch("/api/form-sheets", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.error) {
        setError(res.error);
      } else {
        setEditTarget(null);
        await loadList();
        if (res.id) setSelected(res.id);
        else if (editTarget.id === selected) loadGrid(selected);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!delTarget) return;
    setSaving(true);
    try {
      await fetch(`/api/form-sheets?id=${encodeURIComponent(delTarget.id)}`, {
        method: "DELETE",
      }).catch(() => {});
      setDelTarget(null);
      await loadList();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wrap page-compact forms-page">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="フォーム回答" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
              <rect x="9" y="2" width="6" height="4" rx="1" />
              <line x1="8" y1="11" x2="16" y2="11" />
              <line x1="8" y1="15" x2="14" y2="15" />
            </svg>
          </span>
          <span className="page-h page-h-gap">フォーム回答</span>
        </div>
        <div className="head-right">
          {canEdit && (
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
          <button
            className="icon-btn"
            onClick={() => {
              loadList();
              loadGrid(selected);
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

      {loading ? (
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
      ) : (
        <div className="forms-layout">
          {/* 左：登録フォーム一覧 */}
          <aside className="forms-list">
            {items.map((f) => (
              <div
                key={f.id}
                className={"forms-item" + (selected === f.id ? " active" : "")}
              >
                <button className="forms-item-name" onClick={() => setSelected(f.id)} title={f.title}>
                  {f.title}
                </button>
                {canEdit && (
                  <span className="forms-item-ops">
                    <button
                      className="mini-btn"
                      onClick={() => setEditTarget({ id: f.id, title: f.title, url: f.url })}
                      title="編集"
                    >
                      編集
                    </button>
                    <button
                      className="mini-btn danger"
                      onClick={() => setDelTarget(f)}
                      title="削除"
                    >
                      削除
                    </button>
                  </span>
                )}
              </div>
            ))}
          </aside>

          {/* 右：選択フォームの中身 */}
          <section className="forms-content">
            {(() => {
              const cur = items.find((x) => x.id === selected);
              if (!cur) return <div className="notice">左からフォームを選んでください。</div>;
              return (
                <>
                  <div className="forms-content-head">
                    <span className="forms-content-title">{cur.title}</span>
                    {cur.url && (
                      <a className="forms-open" href={cur.url} target="_blank" rel="noreferrer">
                        シートを開く ↗
                      </a>
                    )}
                    {grid && !grid.error && (
                      <span className="forms-count">
                        {grid.total?.toLocaleString("ja-JP")} 件
                        {grid.truncated && "（先頭のみ表示）"}
                      </span>
                    )}
                  </div>

                  {gridLoading ? (
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
                                    <td key={ci} title={v}>
                                      {v === "" ? <span className="empty">—</span> : v}
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
              );
            })()}
          </section>
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
              対象シートは「リンクを知っている全員が閲覧可」にしてください。
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
