"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../Modal";
import { useUi } from "../Ui";
import { cachedJson } from "../dataCache";

// 1ファイルの上限（サーバー側 lib/storage.js の MAX_FILE_BYTES と合わせること）
const MAX_MB = 50;

const fmtSize = (n) => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toUpperCase() : "—";
};

// 画面の中で開いて見られるもの（それ以外はダウンロードのみ）
const VIEWABLE = /\.(png|jpe?g|gif|webp|svg|pdf|txt|csv|md|json)$/i;

function FolderIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h8A1.5 1.5 0 0 1 20 10v8a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 18Z" />
    </svg>
  );
}
function FileIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export default function FilesPage() {
  const [path, setPath] = useState("");
  const [data, setData] = useState(null); // { folders, files } | { error }
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const [mkOpen, setMkOpen] = useState(false);
  const [mkName, setMkName] = useState("");
  const [renameTarget, setRenameTarget] = useState(null); // { name, kind, newName }
  const [delTarget, setDelTarget] = useState(null); // { name, kind }
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInput = useRef(null);
  const { setBusy, flashDone, showToast, busy } = useUi();

  useEffect(() => {
    cachedJson("/api/auth/me", 60 * 1000)
      .then((d) => setCanEdit(!!d?.perms?.pages?.files?.edit))
      .catch(() => {});
  }, []);

  const load = useCallback(async (p) => {
    setLoading(true);
    try {
      const j = await fetch(`/api/files?path=${encodeURIComponent(p)}`, { cache: "no-store" }).then((r) => r.json());
      setData(j);
    } catch (e) {
      setData({ error: String(e?.message || e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(path);
  }, [load, path]);

  // パンくず。先頭は保管庫そのもの。
  const crumbs = path ? path.split("/") : [];

  const openFolder = (name) => setPath(path ? `${path}/${name}` : name);
  const goTo = (i) => setPath(crumbs.slice(0, i + 1).join("/"));

  const createFolder = async () => {
    const name = mkName.trim();
    if (!name) return;
    setSaving(true);
    setBusy("フォルダを作成中…");
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name }),
      }).then((r) => r.json());
      if (res.error) {
        setBusy(null);
        showToast(res.error, "err");
      } else {
        setMkOpen(false);
        setMkName("");
        await load(path);
        flashDone("作成しました");
      }
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };

  const uploadFiles = async (list) => {
    const arr = Array.from(list || []);
    if (arr.length === 0) return;
    setSaving(true);
    let ok = 0;
    try {
      for (let i = 0; i < arr.length; i++) {
        setBusy(arr.length > 1 ? `アップロード中… (${i + 1}/${arr.length})` : "アップロード中…");
        const fd = new FormData();
        fd.append("path", path);
        fd.append("file", arr[i]);
        const res = await fetch("/api/files/upload", { method: "POST", body: fd }).then((r) => r.json());
        if (res.error) {
          setBusy(null);
          showToast(`${arr[i].name}：${res.error}`, "err");
        } else ok++;
      }
      await load(path);
      if (ok > 0) flashDone(`${ok}件をアップロードしました`);
      else setBusy(null);
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };

  const doRename = async () => {
    const t = renameTarget;
    const newName = (t?.newName || "").trim();
    if (!t || !newName || newName === t.name) return setRenameTarget(null);
    setSaving(true);
    setBusy("名前を変更中…");
    try {
      const res = await fetch("/api/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name: t.name, newName, kind: t.kind }),
      }).then((r) => r.json());
      if (res.error) {
        setBusy(null);
        showToast(res.error, "err");
      } else {
        setRenameTarget(null);
        await load(path);
        flashDone("変更しました");
      }
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    const t = delTarget;
    if (!t) return;
    setSaving(true);
    setBusy("削除中…");
    try {
      const q = new URLSearchParams({ path, name: t.name, kind: t.kind });
      const res = await fetch(`/api/files?${q.toString()}`, { method: "DELETE" }).then((r) => r.json());
      if (res.error) {
        setBusy(null);
        showToast(res.error, "err");
      } else {
        setDelTarget(null);
        await load(path);
        flashDone("削除しました");
      }
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };

  // 一時URLを取り、別タブで開く（表示）／保存する（ダウンロード）
  const openFile = async (name, dl) => {
    try {
      const q = new URLSearchParams({ path, name, ...(dl ? { dl: "1" } : {}) });
      const res = await fetch(`/api/files/link?${q.toString()}`, { cache: "no-store" }).then((r) => r.json());
      if (res.error) return showToast(res.error, "err");
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      showToast(String(e?.message || e), "err");
    }
  };

  const folders = data?.folders || [];
  const files = data?.files || [];
  const empty = !loading && !data?.error && folders.length === 0 && files.length === 0;

  return (
    <div className="wrap page-compact forms-page files-page">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="資料保管" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h8A1.5 1.5 0 0 1 20 10v8a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 18Z" />
            </svg>
          </span>
          <span className="page-h page-h-gap">資料保管</span>
          <span className="head-sep" aria-hidden="true" />
          {/* いまどこを開いているか。クリックでその階層に戻る */}
          <nav className="fx-crumbs" aria-label="いまの場所">
            <button type="button" className={"fx-crumb" + (path === "" ? " here" : "")} onClick={() => setPath("")}>
              すべての資料
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="fx-crumb-wrap">
                <span className="fx-crumb-sep" aria-hidden="true">
                  /
                </span>
                <button
                  type="button"
                  className={"fx-crumb" + (i === crumbs.length - 1 ? " here" : "")}
                  onClick={() => goTo(i)}
                >
                  {c}
                </button>
              </span>
            ))}
          </nav>
        </div>
        <div className="head-right">
          {canEdit && (
            <>
              <button className="icon-btn" onClick={() => setMkOpen(true)} title="フォルダを作成" aria-label="フォルダを作成" disabled={saving}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h8A1.5 1.5 0 0 1 20 10v8a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 18Z" />
                  <path d="M11.5 11.5v5M9 14h5" />
                </svg>
              </button>
              <button className="icon-btn" onClick={() => fileInput.current?.click()} title="ファイルをアップロード" aria-label="ファイルをアップロード" disabled={saving}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4" />
                  <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
                  <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
                </svg>
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
      </div>

      {data?.error && <div className="banner err-banner">エラー：{data.error}</div>}

      {loading && !busy ? (
        <div className="page-loading">
          <span className="loader-ring" role="status" aria-label="読み込み中" />
        </div>
      ) : (
        <div
          className={"card no-pad" + (dragOver ? " fx-drop" : "")}
          onDragOver={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            setDragOver(false);
            uploadFiles(e.dataTransfer?.files);
          }}
        >
          <div className="tw forms-tw">
            <table className="fx-table">
              <thead>
                <tr>
                  <th className="fx-name">名前</th>
                  <th className="fx-kind">種類</th>
                  <th className="fx-size">サイズ</th>
                  <th className="fx-when">更新</th>
                  <th className="fx-ops" />
                </tr>
              </thead>
              <tbody>
                {folders.map((f) => (
                  <tr key={`d:${f.name}`} className="fx-row">
                    <td className="fx-name">
                      <button type="button" className="fx-open fx-folder" onClick={() => openFolder(f.name)}>
                        <FolderIcon />
                        <span>{f.name}</span>
                      </button>
                    </td>
                    <td className="fx-kind">フォルダ</td>
                    <td className="fx-size">—</td>
                    <td className="fx-when">—</td>
                    <td className="fx-ops">
                      {canEdit && (
                        <>
                          <button className="forms-op" onClick={() => setRenameTarget({ ...f, newName: f.name })} title="名前を変更" aria-label="名前を変更">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                          <button className="forms-op danger" onClick={() => setDelTarget(f)} title="削除" aria-label="削除">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 7h16" />
                              <path d="M9 7V5h6v2" />
                              <path d="M6.5 7 7 20h10l.5-13" />
                            </svg>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {files.map((f) => (
                  <tr key={`f:${f.name}`} className="fx-row">
                    <td className="fx-name">
                      {VIEWABLE.test(f.name) ? (
                        <button type="button" className="fx-open" onClick={() => openFile(f.name, false)} title="開く">
                          <FileIcon />
                          <span>{f.name}</span>
                        </button>
                      ) : (
                        <span className="fx-open plain">
                          <FileIcon />
                          <span>{f.name}</span>
                        </span>
                      )}
                    </td>
                    <td className="fx-kind">{extOf(f.name)}</td>
                    <td className="fx-size">{fmtSize(f.size)}</td>
                    <td className="fx-when">{fmtWhen(f.updatedAt)}</td>
                    <td className="fx-ops">
                      <button className="forms-op" onClick={() => openFile(f.name, true)} title="ダウンロード" aria-label="ダウンロード">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 4v12" />
                          <path d="m7.5 11.5 4.5 4.5 4.5-4.5" />
                          <path d="M4 18v1.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V18" />
                        </svg>
                      </button>
                      {canEdit && (
                        <>
                          <button className="forms-op" onClick={() => setRenameTarget({ ...f, newName: f.name })} title="名前を変更" aria-label="名前を変更">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                          <button className="forms-op danger" onClick={() => setDelTarget(f)} title="削除" aria-label="削除">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 7h16" />
                              <path d="M9 7V5h6v2" />
                              <path d="M6.5 7 7 20h10l.5-13" />
                            </svg>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {empty && (
                  <tr>
                    <td colSpan={5} className="fx-empty">
                      {canEdit
                        ? "ここにはまだ何もありません。右上のボタンか、この枠へのドラッグ＆ドロップで追加できます。"
                        : "ここにはまだ何もありません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* フォルダ作成 */}
      <Modal
        open={mkOpen}
        title="フォルダを作成"
        onClose={() => setMkOpen(false)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setMkOpen(false)} disabled={saving}>
              キャンセル
            </button>
            <button className="save-btn" onClick={createFolder} disabled={saving || !mkName.trim()}>
              {saving ? "作成中…" : "作成"}
            </button>
          </>
        }
      >
        <div className="modal-fields">
          <label className="fld">
            フォルダ名
            <input
              type="text"
              value={mkName}
              onChange={(e) => setMkName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
              placeholder="例：CM情報"
            />
          </label>
          <p className="modal-note">
            作成先：{path ? `すべての資料 / ${path.split("/").join(" / ")}` : "すべての資料"}
          </p>
        </div>
      </Modal>

      {/* 名前の変更 */}
      <Modal
        open={!!renameTarget}
        title={renameTarget?.kind === "folder" ? "フォルダ名を変更" : "ファイル名を変更"}
        onClose={() => setRenameTarget(null)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setRenameTarget(null)} disabled={saving}>
              キャンセル
            </button>
            <button className="save-btn" onClick={doRename} disabled={saving || !renameTarget?.newName?.trim()}>
              {saving ? "変更中…" : "変更"}
            </button>
          </>
        }
      >
        {renameTarget && (
          <div className="modal-fields">
            <label className="fld">
              新しい名前
              <input
                type="text"
                value={renameTarget.newName}
                onChange={(e) => setRenameTarget({ ...renameTarget, newName: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && doRename()}
              />
            </label>
          </div>
        )}
      </Modal>

      {/* 削除の確認 */}
      <Modal
        open={!!delTarget}
        title="削除の確認"
        onClose={() => setDelTarget(null)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setDelTarget(null)} disabled={saving}>
              キャンセル
            </button>
            <button className="save-btn danger-btn" onClick={doDelete} disabled={saving}>
              {saving ? "削除中…" : "削除"}
            </button>
          </>
        }
      >
        {delTarget && (
          <div className="modal-fields">
            <p className="modal-note">
              「{delTarget.name}」を削除します。
              {delTarget.kind === "folder" && "中に入っているファイルもすべて消えます。"}
              元には戻せません。
            </p>
          </div>
        )}
      </Modal>

      <p className="fx-foot">
        1ファイル {MAX_MB}MB まで。保管しているデータは、このサイトにログインできる人だけが開けます。
      </p>
    </div>
  );
}
