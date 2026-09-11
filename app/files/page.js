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

// 画面の中で開いて見られるもの（それ以外はダウンロードのみ）
const VIEWABLE = /\.(png|jpe?g|gif|webp|svg|pdf|txt|csv|md|json)$/i;
// 絵として出せるもの / 紙面として出せるもの / 文字として出せるもの
const PV_IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const PV_PDF = /\.pdf$/i;
const PV_TEXT = /\.(txt|csv|tsv|md|json|xml|log)$/i;
const pvKind = (name) =>
  PV_IMAGE.test(name) ? "image" : PV_PDF.test(name) ? "pdf" : PV_TEXT.test(name) ? "text" : null;

// 拡張子から中身の種類を決める。
// 一覧の「種類」はこの種類の絵で出し、文字（CSV・PDF など）は
// マウスを乗せたときと読み上げに回す。
const TYPES = [
  { key: "image", label: "画像", re: /^(png|jpe?g|gif|webp|svg|bmp|heic|avif)$/i },
  { key: "pdf", label: "PDF", re: /^pdf$/i },
  { key: "sheet", label: "表", re: /^(csv|tsv|xls|xlsx|xlsm|numbers)$/i },
  { key: "doc", label: "文書", re: /^(doc|docx|txt|md|rtf|pages|json|xml|html?)$/i },
  { key: "slide", label: "スライド", re: /^(ppt|pptx|key)$/i },
  { key: "zip", label: "圧縮ファイル", re: /^(zip|rar|7z|gz|tar)$/i },
  { key: "video", label: "動画", re: /^(mp4|mov|avi|webm|mkv|m4v)$/i },
  { key: "audio", label: "音声", re: /^(mp3|wav|m4a|aac|flac|ogg)$/i },
];

// 一覧に出す名前。拡張子は「種類」の列に出るので、ここでは省く。
// 保存されている本当の名前（拡張子つき）は、そのまま持ち回る。
function baseName(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function typeOf(name, kind) {
  if (kind === "folder") return { key: "folder", label: "フォルダ", ext: "フォルダ" };
  const i = name.lastIndexOf(".");
  const ext = i > 0 ? name.slice(i + 1) : "";
  const hit = ext ? TYPES.find((t) => t.re.test(ext)) : null;
  return {
    key: hit ? hit.key : "file",
    label: hit ? hit.label : "ファイル",
    ext: ext ? ext.toUpperCase() : "ファイル",
  };
}

// 種類の絵。線の太さ・大きさは一覧のほかのアイコンにそろえる。
function TypeIcon({ kind }) {
  const p = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (kind === "folder")
    return (
      <svg {...p}>
        <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h8A1.5 1.5 0 0 1 20 10v8a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 18Z" />
      </svg>
    );
  if (kind === "image")
    return (
      <svg {...p}>
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path d="m4 17 4.8-4.8a1.5 1.5 0 0 1 2.1 0L16 17.3" />
        <path d="m14 15 1.8-1.8a1.5 1.5 0 0 1 2.1 0L20 15.2" />
      </svg>
    );
  if (kind === "pdf")
    // 小さく出すと文字は読めないので、PDF は「帯の付いた書類」の形と色で見分ける
    return (
      <svg {...p}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
        <path d="M14 3v5h5" />
        <rect x="7.5" y="13.5" width="9" height="4.5" rx="1.2" fill="currentColor" stroke="none" />
      </svg>
    );
  if (kind === "sheet")
    return (
      <svg {...p}>
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <path d="M3 9.5h18" />
        <path d="M9 9.5v10" />
        <path d="M3 14.5h18" />
      </svg>
    );
  if (kind === "doc")
    return (
      <svg {...p}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
        <path d="M14 3v5h5" />
        <path d="M8.5 13h7M8.5 16.5h5" />
      </svg>
    );
  if (kind === "slide")
    return (
      <svg {...p}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M12 16v4" />
        <path d="M8.5 20h7" />
      </svg>
    );
  if (kind === "zip")
    return (
      <svg {...p}>
        <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11A2.5 2.5 0 0 1 16.5 20h-9A2.5 2.5 0 0 1 5 17.5Z" />
        <path d="M12 4v3M12 8.5v2M12 12v2" />
        <rect x="10.5" y="15" width="3" height="3.5" rx="1" />
      </svg>
    );
  if (kind === "video")
    return (
      <svg {...p}>
        <rect x="3" y="5.5" width="13" height="13" rx="2" />
        <path d="m16 11 5-2.8v7.6L16 13Z" />
      </svg>
    );
  if (kind === "audio")
    return (
      <svg {...p}>
        <path d="M10 18V6.5l9-1.8V16" />
        <circle cx="7.5" cy="18" r="2.5" />
        <circle cx="16.5" cy="16" r="2.5" />
      </svg>
    );
  return (
    <svg {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

// JSON を送って JSON を受け取る。
// サーバーが JSON でない応答（413 の "Request Entity Too Large" など）を
// 返すことがあるので、そのときは中身をそのままエラー文言にする
// （JSON.parse の失敗が画面に出ると何が起きたか分からないため）。
async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.trim().slice(0, 120) || `通信に失敗しました（${r.status}）` };
  }
}

function FolderIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h8A1.5 1.5 0 0 1 20 10v8a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 18Z" />
    </svg>
  );
}
// 移動：フォルダへ入っていく矢印
function MoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 6h4.5A1.5 1.5 0 0 1 19 7.5V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18v-4" />
      <path d="M3 9h8" />
      <path d="m7.5 5.5 3.5 3.5-3.5 3.5" />
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

// 移動先を選ぶ小さなフォルダ一覧。フォルダだけを出し、潜って選ぶ。
// いま開いている場所と、移動するフォルダ自身（とその中）は選べない。
function FolderPicker({ from, target, onPick, saving }) {
  const [at, setAt] = useState("");
  const [folders, setFolders] = useState(null);
  useEffect(() => {
    let alive = true;
    setFolders(null);
    fetch(`/api/files?path=${encodeURIComponent(at)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setFolders(j.folders || []))
      .catch(() => alive && setFolders([]));
    return () => {
      alive = false;
    };
  }, [at]);

  const crumbs = at ? at.split("/") : [];
  // 移動するフォルダそのもの（の中）は移動先にできない
  const self = target?.kind === "folder" ? (from ? `${from}/${target.name}` : target.name) : null;
  const blocked = (p) => self != null && (p === self || p.startsWith(self + "/"));
  const here = at === from;

  return (
    <div className="fx-pick">
      <nav className="fx-pick-crumbs" aria-label="移動先">
        <button type="button" className="fx-crumb" onClick={() => setAt("")} disabled={at === ""}>
          すべての資料
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="fx-crumb-wrap">
            <span className="fx-crumb-sep" aria-hidden="true">
              /
            </span>
            <button
              type="button"
              className="fx-crumb"
              onClick={() => setAt(crumbs.slice(0, i + 1).join("/"))}
              disabled={i === crumbs.length - 1}
            >
              {c}
            </button>
          </span>
        ))}
      </nav>
      <div className="fx-pick-list">
        {folders == null ? (
          <p className="fx-pick-empty">読み込み中…</p>
        ) : folders.length === 0 ? (
          <p className="fx-pick-empty">この中にフォルダはありません。</p>
        ) : (
          folders.map((f) => {
            const p = at ? `${at}/${f.name}` : f.name;
            const no = blocked(p);
            return (
              <button
                key={f.name}
                type="button"
                className="fx-pick-row"
                onClick={() => setAt(p)}
                disabled={no}
                title={no ? "自分自身の中へは移動できません" : undefined}
              >
                <FolderIcon />
                <span>{f.name}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="fx-pick-foot">
        <span className="fx-pick-dest">
          移動先：{at ? `すべての資料 / ${at.split("/").join(" / ")}` : "すべての資料"}
        </span>
        <button
          className="save-btn"
          onClick={() => onPick(at)}
          disabled={saving || here || blocked(at)}
          title={here ? "いまと同じ場所です" : undefined}
        >
          {saving ? "移動中…" : "ここへ移動"}
        </button>
      </div>
    </div>
  );
}

export default function FilesPage() {
  const [path, setPath] = useState("");
  const [data, setData] = useState(null); // { folders, files } | { error }
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const [mkOpen, setMkOpen] = useState(false);
  const [mkName, setMkName] = useState("");
  const [renameTarget, setRenameTarget] = useState(null); // { name, kind, newName }
  const [moveTarget, setMoveTarget] = useState(null); // { name, kind }
  const [delTarget, setDelTarget] = useState(null); // 削除の確認 { items:[{name,kind}] }
  const [picked, setPicked] = useState([]); // まとめて消すために選んだもの [{name,kind}]
  const [preview, setPreview] = useState(null); // 画面の中で見る { name, kind, url, text, error }
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false); // パソコンからのファイル追加
  const [dragItem, setDragItem] = useState(null); // 一覧の中でつまんでいるもの
  const [dropOn, setDropOn] = useState(null); // 落とそうとしている先の目印

  const fileInput = useRef(null);
  const dragDepth = useRef(0); // ドラッグ中の出入りの数（leave の判定に使う）
  const { setBusy, flashDone, showToast, busy } = useUi();

  useEffect(() => {
    cachedJson("/api/auth/me", 60 * 1000)
      .then((d) => {
        setCanEdit(!!d?.perms?.pages?.files?.edit);
        // 削除は編集とは別の許可（人ごとに外せる）
        setCanDelete(!!d?.perms?.pages?.files?.del);
      })
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
    setPicked([]); // 場所が変わったら選び直し
  }, [load, path]);

  // プレビューは Esc でも閉じられるようにする
  useEffect(() => {
    if (!preview) return;
    const onKey = (e) => e.key === "Escape" && setPreview(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

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

  // ファイルの中身は自前のAPIを通さず、発行してもらった一時URLで
  // ストレージへ直接送る（APIを経由すると置いているサーバー側の
  // 本文サイズ上限に当たって、大きいファイルが送れないため）。
  const uploadFiles = async (list) => {
    const arr = Array.from(list || []);
    if (arr.length === 0) return;
    setSaving(true);
    let ok = 0;
    try {
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        setBusy(arr.length > 1 ? `アップロード中… (${i + 1}/${arr.length})` : "アップロード中…");
        const res = await postJson("/api/files/upload-url", {
          path,
          name: f.name,
          size: f.size,
        });
        if (res.error) {
          setBusy(null);
          showToast(`${f.name}：${res.error}`, "err");
          continue;
        }
        const put = await fetch(res.url, {
          method: "PUT",
          headers: { "Content-Type": f.type || "application/octet-stream" },
          body: f,
        });
        if (!put.ok) {
          setBusy(null);
          showToast(`${f.name}：アップロードできませんでした（${put.status}）`, "err");
          continue;
        }
        ok++;
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

  const moveItem = async (t, toPath) => {
    if (!t || toPath === path) {
      setMoveTarget(null);
      return;
    }
    setSaving(true);
    setBusy("移動中…");
    try {
      const res = await fetch("/api/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name: t.name, toPath, kind: t.kind }),
      }).then((r) => r.json());
      if (res.error) {
        setBusy(null);
        showToast(res.error, "err");
      } else {
        setMoveTarget(null);
        await load(path);
        flashDone("移動しました");
      }
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };
  const doMove = (toPath) => moveItem(moveTarget, toPath);

  // ── ドラッグで移動 ──
  // 行をつまんで、フォルダの行か、上のパンくず（＝その階層）に落とす。
  // パソコンから持ってきたファイルの追加（枠へのドロップ）と混ざらないよう、
  // 「持っているものがファイルかどうか」で見分ける。
  const hasOsFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const startDrag = (e, item) => {
    setDragItem(item);
    e.dataTransfer.effectAllowed = "move";
    // 何も入れないと Firefox ではドラッグが始まらない
    e.dataTransfer.setData("text/plain", item.name);
  };
  const endDrag = () => {
    setDragItem(null);
    setDropOn(null);
  };
  const allowDrop = (e, key) => {
    if (!dragItem) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dropOn !== key) setDropOn(key);
  };
  const dropInto = (e, toPath, key) => {
    if (!dragItem) return;
    e.preventDefault();
    e.stopPropagation();
    const item = dragItem;
    endDrag();
    if (key !== null && toPath === path) return; // いまと同じ場所
    moveItem(item, toPath);
  };

  const doDelete = async () => {
    const items = delTarget?.items || [];
    if (items.length === 0) return;
    setSaving(true);
    let ok = 0;
    try {
      for (let i = 0; i < items.length; i++) {
        setBusy(items.length > 1 ? `削除中… (${i + 1}/${items.length})` : "削除中…");
        const t = items[i];
        const q = new URLSearchParams({ path, name: t.name, kind: t.kind });
        const res = await fetch(`/api/files?${q.toString()}`, { method: "DELETE" }).then((r) => r.json());
        if (res.error) {
          setBusy(null);
          showToast(`${t.name}：${res.error}`, "err");
        } else ok++;
      }
      setDelTarget(null);
      setPicked([]);
      await load(path);
      if (ok > 0) flashDone(`${ok}件を削除しました`);
      else setBusy(null);
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };

  // ── まとめて選ぶ ──
  const pickKey = (it) => `${it.kind}:${it.name}`;
  const isPicked = (it) => picked.some((x) => pickKey(x) === pickKey(it));
  const togglePick = (it) =>
    setPicked((prev) =>
      prev.some((x) => pickKey(x) === pickKey(it))
        ? prev.filter((x) => pickKey(x) !== pickKey(it))
        : [...prev, it]
    );

  // 一時URLを取る。dl=true なら添付として落とすためのURL。
  const linkOf = async (name, dl) => {
    const q = new URLSearchParams({ path, name, ...(dl ? { dl: "1" } : {}) });
    const res = await fetch(`/api/files/link?${q.toString()}`, { cache: "no-store" }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    return res.url;
  };

  // 別タブで開く（表示）／保存する（ダウンロード）
  const openFile = async (name, dl) => {
    try {
      window.open(await linkOf(name, dl), "_blank", "noopener,noreferrer");
    } catch (e) {
      showToast(String(e?.message || e), "err");
    }
  };

  // 画面の中で中身を見る。
  // 画像・PDF は一時URLをそのまま貼り、文字のファイルは読み込んで出す。
  const openPreview = async (name) => {
    const kind = pvKind(name);
    if (!kind) return openFile(name, true); // 見られないものはダウンロード
    setPreview({ name, kind, url: null, text: null, error: null });
    try {
      const url = await linkOf(name, false);
      if (kind === "text") {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`読み込めませんでした（${r.status}）`);
        const t = await r.text();
        setPreview({ name, kind, url, text: t.slice(0, 200000), error: null });
      } else {
        setPreview({ name, kind, url, text: null, error: null });
      }
    } catch (e) {
      setPreview({ name, kind, url: null, text: null, error: String(e?.message || e) });
    }
  };

  const folders = data?.folders || [];
  const files = data?.files || [];
  const empty = !loading && !data?.error && folders.length === 0 && files.length === 0;
  const allItems = [...folders, ...files].map((f) => ({ name: f.name, kind: f.kind }));
  const allPicked = allItems.length > 0 && picked.length === allItems.length;
  const toggleAll = () => setPicked(allPicked ? [] : allItems);

  return (
    // パソコンから持ってきたファイルは、一覧のどこに落としても受け取る。
    // 受け口を表だけにしていると、行の上に落としたときに取りこぼすことがあった。
    <div
      className="wrap page-compact forms-page files-page"
      onDragEnter={(e) => {
        if (!canEdit || !hasOsFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (!canEdit || !hasOsFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!canEdit || !hasOsFiles(e)) return;
        // 子要素をまたぐたびに leave が飛ぶので、出入りの数を数えて判断する
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!canEdit || !hasOsFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        uploadFiles(e.dataTransfer?.files);
      }}
    >
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="資料" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h8A1.5 1.5 0 0 1 20 10v8a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 18Z" />
            </svg>
          </span>
          <span className="page-h page-h-gap">資料</span>
          <span className="head-sep" aria-hidden="true" />
          {/* フォルダの中にいるときだけ、1つ上へ戻るボタンを出す */}
          {path && (
            <button
              type="button"
              className="icon-btn fx-up"
              onClick={() => setPath(crumbs.slice(0, -1).join("/"))}
              title="1つ上のフォルダへ戻る"
              aria-label="1つ上のフォルダへ戻る"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 12H5" />
                <path d="m11.5 5.5-6.5 6.5 6.5 6.5" />
              </svg>
            </button>
          )}
          {/* いまどこを開いているか。クリックでその階層に戻る。
              ドラッグ中はここに落として上の階層へ移すこともできる。 */}
          <nav className="fx-crumbs" aria-label="いまの場所">
            <button
              type="button"
              className={"fx-crumb" + (path === "" ? " here" : "") + (dropOn === "crumb:" ? " dropon" : "")}
              onClick={() => setPath("")}
              onDragOver={(e) => allowDrop(e, "crumb:")}
              onDragLeave={() => setDropOn(null)}
              onDrop={(e) => dropInto(e, "", "crumb:")}
            >
              すべての資料
            </button>
            {crumbs.map((c, i) => {
              const to = crumbs.slice(0, i + 1).join("/");
              return (
                <span key={i} className="fx-crumb-wrap">
                  <span className="fx-crumb-sep" aria-hidden="true">
                    /
                  </span>
                  <button
                    type="button"
                    className={
                      "fx-crumb" +
                      (i === crumbs.length - 1 ? " here" : "") +
                      (dropOn === "crumb:" + to ? " dropon" : "")
                    }
                    onClick={() => goTo(i)}
                    onDragOver={(e) => allowDrop(e, "crumb:" + to)}
                    onDragLeave={() => setDropOn(null)}
                    onDrop={(e) => dropInto(e, to, "crumb:" + to)}
                  >
                    {c}
                  </button>
                </span>
              );
            })}
          </nav>
        </div>
        <div className="head-right">
          {/* まとめて削除。選んでいるときだけ出す */}
          {canDelete && picked.length > 0 && (
            <button
              className="icon-btn fx-bulk-del"
              onClick={() => setDelTarget({ items: picked })}
              title={`選んだ ${picked.length} 件を削除`}
              disabled={saving}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h16" />
                <path d="M9 7V5h6v2" />
                <path d="M6.5 7 7 20h10l.5-13" />
              </svg>
              {picked.length}
            </button>
          )}
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
        <div className={"card no-pad" + (dragOver ? " fx-drop" : "")}>
          <div className="tw forms-tw">
            <table className="fx-table">
              <thead>
                <tr>
                  {canDelete && (
                    <th className="fx-pick">
                      <input
                        type="checkbox"
                        checked={allPicked}
                        onChange={toggleAll}
                        aria-label="すべて選ぶ"
                        disabled={allItems.length === 0}
                      />
                    </th>
                  )}
                  <th className="fx-name">名前</th>
                  <th className="fx-kind">種類</th>
                  <th className="fx-size">サイズ</th>
                  <th className="fx-when">作成</th>
                  <th className="fx-when">更新</th>
                  <th className="fx-ops" />
                </tr>
              </thead>
              <tbody>
                {folders.map((f) => {
                  const into = path ? `${path}/${f.name}` : f.name;
                  const self = dragItem?.name === f.name;
                  return (
                  <tr
                    key={`d:${f.name}`}
                    className={
                      "fx-row" +
                      (canEdit ? " fx-draggable" : "") +
                      (self ? " fx-dragging" : "") +
                      (dropOn === "dir:" + f.name ? " fx-dropon" : "")
                    }
                    draggable={canEdit && !saving}
                    onDragStart={(e) => startDrag(e, f)}
                    onDragEnd={endDrag}
                    onDragOver={(e) => !self && allowDrop(e, "dir:" + f.name)}
                    onDragLeave={() => setDropOn(null)}
                    onDrop={(e) => !self && dropInto(e, into, "dir:" + f.name)}
                  >
                    {canDelete && (
                      <td className="fx-pick">
                        <input
                          type="checkbox"
                          checked={isPicked(f)}
                          onChange={() => togglePick({ name: f.name, kind: f.kind })}
                          aria-label={`${f.name} を選ぶ`}
                        />
                      </td>
                    )}
                    <td className="fx-name">
                      <button type="button" className="fx-open fx-folder" onClick={() => openFolder(f.name)}>
                        <FolderIcon />
                        <span>{f.name}</span>
                      </button>
                    </td>
                    <td className="fx-kind">
                      <span className="fx-type folder">
                        <TypeIcon kind="folder" />
                        <span>フォルダ</span>
                      </span>
                    </td>
                    {/* フォルダには実体が無いので、中身を数えた値を出す */}
                    <td className="fx-size" title={f.files != null ? `${f.files.toLocaleString("ja-JP")} 個のファイル` : undefined}>
                      {f.size != null ? fmtSize(f.size) : "—"}
                    </td>
                    <td className="fx-when">{fmtWhen(f.createdAt)}</td>
                    <td className="fx-when">{fmtWhen(f.updatedAt)}</td>
                    <td className="fx-ops">
                      {canEdit && (
                        <>
                          <button className="forms-op" onClick={() => setMoveTarget(f)} title="別のフォルダへ移動" aria-label="別のフォルダへ移動">
                            <MoveIcon />
                          </button>
                          <button className="forms-op" onClick={() => setRenameTarget({ ...f, newName: f.name })} title="名前を変更" aria-label="名前を変更">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                          {canDelete && (
                          <button className="forms-op danger" onClick={() => setDelTarget({ items: [{ name: f.name, kind: f.kind }] })} title="削除" aria-label="削除">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 7h16" />
                              <path d="M9 7V5h6v2" />
                              <path d="M6.5 7 7 20h10l.5-13" />
                            </svg>
                          </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {files.map((f) => (
                  <tr
                    key={`f:${f.name}`}
                    className={
                      "fx-row" +
                      (canEdit ? " fx-draggable" : "") +
                      (dragItem?.name === f.name ? " fx-dragging" : "")
                    }
                    draggable={canEdit && !saving}
                    onDragStart={(e) => startDrag(e, f)}
                    onDragEnd={endDrag}
                  >
                    {canDelete && (
                      <td className="fx-pick">
                        <input
                          type="checkbox"
                          checked={isPicked(f)}
                          onChange={() => togglePick({ name: f.name, kind: f.kind })}
                          aria-label={`${f.name} を選ぶ`}
                        />
                      </td>
                    )}
                    <td className="fx-name">
                      {VIEWABLE.test(f.name) ? (
                        <button type="button" className="fx-open" onClick={() => openPreview(f.name)} title={f.name}>
                          <FileIcon />
                          <span>{baseName(f.name)}</span>
                        </button>
                      ) : (
                        <span className="fx-open plain" title={f.name}>
                          <FileIcon />
                          <span>{baseName(f.name)}</span>
                        </span>
                      )}
                    </td>
                    <td className="fx-kind">
                      {(() => {
                        const t = typeOf(f.name, "file");
                        // 拡張子の無いものは元のとおり「—」。絵で種類、文字で拡張子を出す。
                        const text = t.ext === "ファイル" ? "—" : t.ext;
                        return (
                          <span className={"fx-type " + t.key} title={`${text}（${t.label}）`}>
                            <TypeIcon kind={t.key} />
                            <span>{text}</span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="fx-size">{fmtSize(f.size)}</td>
                    <td className="fx-when">{fmtWhen(f.createdAt)}</td>
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
                          <button className="forms-op" onClick={() => setMoveTarget(f)} title="別のフォルダへ移動" aria-label="別のフォルダへ移動">
                            <MoveIcon />
                          </button>
                          <button className="forms-op" onClick={() => setRenameTarget({ ...f, newName: f.name })} title="名前を変更" aria-label="名前を変更">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                          {canDelete && (
                          <button className="forms-op danger" onClick={() => setDelTarget({ items: [{ name: f.name, kind: f.kind }] })} title="削除" aria-label="削除">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 7h16" />
                              <path d="M9 7V5h6v2" />
                              <path d="M6.5 7 7 20h10l.5-13" />
                            </svg>
                          </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {empty && (
                  <tr>
                    <td colSpan={canDelete ? 7 : 6} className="fx-empty">
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

      {/* 別のフォルダへ移動 */}
      <Modal
        open={!!moveTarget}
        title={moveTarget?.kind === "folder" ? "フォルダを移動" : "ファイルを移動"}
        onClose={() => setMoveTarget(null)}
        width={520}
        footer={
          <button className="mini-btn" onClick={() => setMoveTarget(null)} disabled={saving}>
            キャンセル
          </button>
        }
      >
        {moveTarget && (
          <div className="modal-fields">
            <p className="modal-note fx-move-what">
              <span className="fx-move-name">
                {moveTarget.kind === "folder" ? <FolderIcon /> : <FileIcon />}
                <span>{moveTarget.name}</span>
              </span>
              を移動します。移動先のフォルダを選んでください。
            </p>
            <FolderPicker from={path} target={moveTarget} onPick={doMove} saving={saving} />
          </div>
        )}
      </Modal>

      {/* 中身を見る */}
      {preview && (
        <div
          className="fx-pv-back"
          onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label={preview.name}
        >
          <div className="fx-pv">
            <div className="fx-pv-head">
              <span className="fx-pv-name" title={preview.name}>
                {preview.kind === "image" ? <TypeIcon kind="image" /> : preview.kind === "pdf" ? <TypeIcon kind="pdf" /> : <TypeIcon kind="doc" />}
                <span>{preview.name}</span>
              </span>
              <span className="fx-pv-acts">
                <button className="mini-btn" onClick={() => openFile(preview.name, false)}>
                  別のタブで開く
                </button>
                <button className="mini-btn" onClick={() => openFile(preview.name, true)}>
                  ダウンロード
                </button>
                <button className="fx-pv-x" onClick={() => setPreview(null)} aria-label="閉じる">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <line x1="5" y1="5" x2="19" y2="19" />
                    <line x1="19" y1="5" x2="5" y2="19" />
                  </svg>
                </button>
              </span>
            </div>
            <div className="fx-pv-body">
              {preview.error ? (
                <div className="banner err-banner">エラー：{preview.error}</div>
              ) : preview.kind === "image" ? (
                preview.url ? (
                  <img className="fx-pv-img" src={preview.url} alt={preview.name} />
                ) : (
                  <span className="loader-ring" role="status" aria-label="読み込み中" />
                )
              ) : preview.kind === "pdf" ? (
                preview.url ? (
                  <iframe className="fx-pv-frame" src={preview.url} title={preview.name} />
                ) : (
                  <span className="loader-ring" role="status" aria-label="読み込み中" />
                )
              ) : preview.text != null ? (
                <pre className="fx-pv-text">{preview.text}</pre>
              ) : (
                <span className="loader-ring" role="status" aria-label="読み込み中" />
              )}
            </div>
          </div>
        </div>
      )}

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
              {delTarget.items.length === 1
                ? `「${delTarget.items[0].name}」を削除します。`
                : `選んだ ${delTarget.items.length} 件を削除します。`}
              {delTarget.items.some((x) => x.kind === "folder") &&
                "フォルダの中に入っているファイルもすべて消えます。"}
              元には戻せません。
            </p>
            {delTarget.items.length > 1 && (
              <ul className="fx-del-list">
                {delTarget.items.map((x) => (
                  <li key={x.kind + x.name}>
                    {x.kind === "folder" ? <FolderIcon /> : <FileIcon />}
                    <span>{x.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      <p className="fx-foot">1ファイル {MAX_MB}MB まで</p>
    </div>
  );
}
