"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../Modal";
import { useUi } from "../Ui";
import ManageIcon from "../manage/ManageIcon";
import FormAnswersTable, { filterFormRows } from "../FormAnswersTable";
import { cachedJson, invalidate as invalidateCache } from "../dataCache";

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

// 見出しの先頭についている番号（「1.」「2）」「3 」など）を取り出す。無ければ null
function headNo(h) {
  const m = String(h || "").trim().match(/^([0-9０-９]{1,3})\s*[.．,、)）:：_-]?\s*/);
  if (!m) return null;
  const n = Number(m[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  return Number.isFinite(n) ? n : null;
}

// 見出しがこれに当てはまる列は出さない（案内文など、表で見る必要のないもの）
const HIDE_HEADERS = [/Agoda新規参画サポートサービス/];

// 表に出す列を整える。
//   ・回答フォームのURL（forms.gle など）だけが入っている列は出さない
//   ・HIDE_HEADERS に当てはまる見出しの列も出さない
//   ・見出しに番号が振られていれば、その番号順に並べ替える
//     （シートの並びが番号順になっていないことがあるため）
function viewOf(grid) {
  if (!grid || grid.error || !(grid.headers || []).length) return grid;
  const headers = grid.headers;
  const rows = grid.rows || [];
  const isFormUrl = (v) => /^https?:\/\/(forms\.gle|docs\.google\.com\/forms)/i.test(String(v || "").trim());

  const keep = [];
  for (let c = 0; c < headers.length; c++) {
    const vals = rows.map((r) => String(r?.[c] ?? "").trim()).filter(Boolean);
    const urlCol =
      isFormUrl(headers[c]) || (vals.length > 0 && vals.every(isFormUrl));
    const hideCol = HIDE_HEADERS.some((re) => re.test(String(headers[c] || "")));
    if (!urlCol && !hideCol) keep.push(c);
  }

  // 番号つきの見出しが半分以上あるときだけ並べ替える（誤作動を避ける）
  const nums = keep.map((c) => headNo(headers[c]));
  const numbered = nums.filter((n) => n != null).length;
  let order = keep;
  if (numbered >= Math.max(2, Math.ceil(keep.length / 2))) {
    order = keep
      .map((c, i) => ({ c, n: nums[i], i }))
      .sort((a, b) => {
        // 番号の無い列（タイムスタンプ等）は元の位置のまま前に出す
        if (a.n == null && b.n == null) return a.i - b.i;
        if (a.n == null) return -1;
        if (b.n == null) return 1;
        return a.n - b.n || a.i - b.i;
      })
      .map((x) => x.c);
  }

  // map… 表示の列番号 → シートの列番号（直すときに元の位置へ戻すために持たせる）
  if (order.length === headers.length && order.every((c, i) => c === i)) {
    return { ...grid, map: order };
  }
  return {
    ...grid,
    map: order,
    headers: order.map((c) => headers[c]),
    rows: rows.map((r) => order.map((c) => r[c] ?? "")),
  };
}

// 紐づけの列。まだ読み込めていないときも列は出し、中身だけ後から入れる。
function LinkCell({ p, loading, onPick }) {
  if (loading) return <span className="lk-cell lk-wait">…</span>;
  if (p?.recordId) {
    return (
      <button type="button" className="lk-cell lk-on" onClick={onPick} title={`レコード${p.recordId}／${p.hotel || ""}
クリックで選び直し`}>
        {p.recordId}
      </button>
    );
  }
  return (
    <button type="button" className="lk-cell lk-off" onClick={onPick} title="施設を選んで紐づける">
      紐づけ
    </button>
  );
}

// 先頭列（タイムスタンプ）を時刻に直す。読めなければ null
function tsOf(row) {
  const v = String(row?.[0] ?? "").trim();
  if (!v) return null;
  const d = new Date(v.replace(/-/g, "/"));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// 施設一覧への反映の状態 → 行の左端に出す印
function markOf(p) {
  if (!p) return null;
  const nl = "\n";
  const who = p.recordId ? `レコード${p.recordId}／${p.hotel || "—"}（${p.matchedBy}で紐づけ）` : "";
  if (p.status === "applied") {
    const wrote = Object.values(p.done?.labels || {}).join("・");
    const how = p.done?.wrote
      ? "施設一覧へ反映済み" + (wrote ? "：" + wrote : "")
      : "シートで「Kintoneへ反映済み」に印が付いています";
    return { tone: "done", title: (who ? who + nl : "") + how };
  }
  if (p.status === "pending") {
    const list = (p.changes || []).map((c) => c.label).join("・");
    return { tone: "link", title: who + nl + "これから入れる：" + list };
  }
  if (p.status === "nochange") {
    const why = (p.skipped || []).map((x) => `・${x.label}（${x.why}）`).join(nl);
    return { tone: "link", title: who + nl + "入れるものはありません" + (why ? nl + why : "") };
  }
  return { tone: "warn", title: "まだ施設と紐づいていません（右の「紐づけ」から施設を選んでください）" };
}

// embedded / tabs は「管理」ページに埋め込まれたときだけ渡される
// （見出しを「管理」に差し替え、その下にタブ行を挟む）。
export default function FormsPage({ embedded, tabs } = {}) {
  const [q, setQ] = useState(""); // 回答の絞り込み（全部の列を対象に部分一致）
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
  // CM情報だけ、施設一覧との紐づけ状況を行の左端に出す
  const [link, setLink] = useState(null); // { [行番号]: 予定 }
  const [linkCount, setLinkCount] = useState(null); // 反映できる件数など
  const [linkFilter, setLinkFilter] = useState("all"); // all | pending | nomatch | applied
  const [linkHelp, setLinkHelp] = useState(false); // 「反映のしくみ」の説明
  const [picker, setPicker] = useState(null); // 施設を選ぶ画面 { rowIdx, key, q }
  const [pickList, setPickList] = useState(null); // 候補
  const [picking, setPicking] = useState(false);
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
    cachedJson("/api/auth/me", 60 * 1000)
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

  // CM情報の回答を開いたら、施設一覧との紐づけ状況を読む（書き込みはしない）
  const loadLink = useCallback(async (id, title) => {
    setLink(null);
    if (!/CM情報/.test(String(title || ""))) return;
    try {
      const j = await fetch("/api/cm-import", { cache: "no-store" }).then((r) => r.json());
      if (j.error || !Array.isArray(j.rows)) return;
      const m = {};
      for (const p of j.rows) m[p.index] = p;
      setLink(m);
      setLinkCount(j.count || null);
    } catch {
      /* 印が出ないだけなので、失敗しても画面はそのまま */
    }
  }, []);

  // 施設を選ぶ画面を開く（初めの検索語は、その回答の Hotel ID か施設名）
  const openPicker = (rowIdx) => {
    const p = link?.[rowIdx];
    const q0 = (p?.hid || p?.name || p?.nameJa || "").trim();
    setPicker({ rowIdx, key: p?.key, q: q0 });
  };

  // 候補をさがす
  useEffect(() => {
    if (!picker) {
      setPickList(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/facility-search?q=${encodeURIComponent(picker.q || "")}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => alive && setPickList(j.items || []))
        .catch(() => alive && setPickList([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [picker?.q, picker?.rowIdx]);

  // 選んだ施設に紐づけて、そのまま施設一覧へ反映する
  const pickFacility = async (recordId) => {
    if (!picker?.key || picking) return;
    setPicking(true);
    setBusy("紐づけ中…");
    try {
      const j = await fetch("/api/cm-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relink: { key: picker.key, id: recordId } }),
      }).then((r) => r.json());
      if (j.error) {
        setBusy(null);
        showToast(j.error, "err");
      } else {
        setPicker(null);
        flashDone(j.applied ? "紐づけて反映しました" : "紐づけました（入れる項目はありませんでした）");
        await loadLink(selected, (items || []).find((f) => f.id === selected)?.title);
        invalidateCache("/api/records");
      }
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setPicking(false);
    }
  };

  // 紐づけを外す（入れた値はそのまま）
  const unlinkRow = async () => {
    if (!picker?.key || picking) return;
    setPicking(true);
    try {
      await fetch("/api/cm-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlink: picker.key }),
      });
      setPicker(null);
      await loadLink(selected, (items || []).find((f) => f.id === selected)?.title);
    } finally {
      setPicking(false);
    }
  };

  const openDetail = (id) => {
    setSelected(id);
    setGrid(null);
    setQ("");
    loadGrid(id);
    loadLink(id, (items || []).find((f) => f.id === id)?.title);
  };
  const backToList = () => {
    setSelected(null);
    setGrid(null);
    setLink(null);
    setQ(""); // 検索は持ち越さない
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
  // 「最終回答」＝登録している全フォームの中で、いちばん新しい回答の日時。
  // シートを直した時刻ではないので、どのフォームのいつかを添えておく。
  const latestMs = cvals.reduce((m, c) => (c && !c.error && c.latest ? Math.max(m, c.latest) : m), 0);
  const latestTitle = [
    "登録しているフォームの中で、いちばん新しい回答の日時です",
    ...(items || []).map((f) => {
      const c = counts[f.id];
      const at = c && !c.error && c.latest ? fmtUpdated(c.latest) : "—";
      return `・${f.title}：${at}`;
    }),
  ].join("\n");

  // 検索に当たった行だけを出す（作業依頼の Temairazu タブと同じ決まり）
  // 表示用に整えた表（不要な列を落とし、見出しの番号順にそろえる）
  const viewGrid = useMemo(() => viewOf(grid), [grid]);
  // 紐づけの件数。サーバーの戻り値をそのまま使わず、手元の予定からも数える
  const isCm = /CM情報/.test(String(current?.title || ""));

  const linkStat = useMemo(() => {
    const list = Object.values(link || {});
    if (!list.length) return linkCount || null;
    const n = (st) => list.filter((p) => p.status === st).length;
    return {
      total: list.length,
      pending: n("pending"),
      applied: n("applied"),
      unlinked: n("unlinked"),
      nochange: n("nochange"),
    };
  }, [link, linkCount]);

  const allRows = filterFormRows(viewGrid, q);
  // 紐づけの状態で絞り込む（CM情報のときだけ使う）
  const filteredRows =
    link && linkFilter !== "all"
      ? allRows.filter(({ no }) => (link[no - 1]?.status || "unlinked") === linkFilter)
      : allRows;
  // 新しい回答ほど上に出す（# の番号はシートの行のままにして、突き合わせられるようにする）
  const shownRows = useMemo(() => {
    const list = [...filteredRows];
    list.sort((a, b) => {
      const ta = tsOf(a.r);
      const tb = tsOf(b.r);
      if (ta == null && tb == null) return a.no - b.no;
      if (ta == null) return 1; // 日時が読めない行は下に置く
      if (tb == null) return -1;
      return tb - ta || b.no - a.no;
    });
    return list;
    // filteredRows は毎回作られるので、中身が変わったときだけ並べ替える
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewGrid, q, link, linkFilter]);

  // Hotel ID は画面から直せるようにする（紐づけの直しに使うため）
  const hidCol = useMemo(() => {
    const hs = (viewGrid?.headers || []).map((h) => String(h || "").replace(/[\s　]/g, ""));
    const i = hs.findIndex((h) => /^HotelID$/i.test(h) || /^HID$/i.test(h) || /ホテルID/.test(h));
    return i;
  }, [viewGrid]);

  const saveCell = async (rowIdx, ci, textValue) => {
    if (!selected || !viewGrid) return;
    const orig = viewGrid.map ? viewGrid.map[ci] : ci;
    try {
      const j = await fetch("/api/form-sheet-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected,
          row: rowIdx,
          rowKey: String(grid?.rows?.[rowIdx]?.[0] ?? ""),
          col: orig,
          header: String(grid?.headers?.[orig] ?? ""),
          text: textValue,
        }),
      }).then((r) => r.json());
      if (j.error) {
        showToast(j.error, "err");
        return;
      }
      // 画面の値も入れ替えて、紐づけの印を取り直す
      setGrid((g) =>
        g && Array.isArray(g.rows)
          ? {
              ...g,
              rows: g.rows.map((r, i) => (i === rowIdx ? r.map((c, j2) => (j2 === orig ? textValue : c)) : r)),
            }
          : g
      );
      flashDone("保存しました");
      loadLink(selected, (items || []).find((f) => f.id === selected)?.title);
    } catch (e) {
      showToast(String(e?.message || e), "err");
    }
  };


  return (
    <div className={"wrap page-compact forms-page" + (selected ? " forms-detail" : "")}>
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
              {/* 回答の絞り込み。どの列に入っている言葉でも引っかかる。
                  ページ名との間は、ダッシュボードと同じく仕切り線で区切る */}
              {grid && !grid.error && (grid.rows || []).length > 0 && (
                <>
                  <span className="head-sep" aria-hidden="true" />
                  <label className="search-box forms-search" aria-label="回答を検索">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" />
                      <line x1="16.5" y1="16.5" x2="21" y2="21" />
                    </svg>
                    <input
                      type="search"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="回答の中を検索..."
                    />
                  </label>
                </>
              )}
            </div>
            <div className="head-right">
              {/* 施設一覧への反映（CM情報のときだけ）。中身はモーダルで出す */}
              {link && (
                <button
                  className={"icon-btn" + (linkStat?.pending > 0 ? " has-new" : "")}
                  onClick={() => setLinkHelp(true)}
                  title="施設一覧への反映"
                  aria-label="施設一覧への反映"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
                    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                  </svg>
                  {linkStat?.pending > 0 && <span className="icon-dot" aria-hidden="true" />}
                </button>
              )}
              {canEdit && current && (
                <button className="icon-btn" onClick={() => setEditTarget({ id: current.id, title: current.title, url: current.url, description: current.description })} title="このフォームを編集" aria-label="編集">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="head-left">
              <span className="conn ok" title={embedded ? "管理" : "フォーム回答"} aria-hidden="true">
                {embedded ? (
                  <ManageIcon />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                    <rect x="9" y="2" width="6" height="4" rx="1" />
                    <line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="14" y2="15" />
                  </svg>
                )}
              </span>
              <span className="page-h page-h-gap">{embedded ? "管理" : "フォーム回答"}</span>
              {/* 管理ページに埋め込まれたときの切り替えタブ（ヘッダーの中に置く） */}
              {tabs}
            </div>
            <div className="head-right">
              {canEdit && (
                <button className="icon-btn" onClick={() => setEditTarget({ title: "", url: "", description: "" })} title="フォームを追加" aria-label="フォームを追加">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              )}
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
          <>
          <FormAnswersTable
            headers={viewGrid.headers}
            rows={shownRows}
            q={q}
            marks={
              isCm
                ? link
                  ? Object.fromEntries(Object.entries(link).map(([i, p]) => [i, markOf(p)]))
                  : {}
                : undefined
            }
            rowNode={isCm && canEdit ? (rowIdx) => <LinkCell p={link?.[rowIdx]} loading={!link} onPick={() => openPicker(rowIdx)} /> : undefined}
            rowNodeLabel="紐づけ"
            editCols={canEdit && hidCol >= 0 ? [hidCol] : undefined}
            onEditCell={canEdit ? saveCell : undefined}
          />
          </>
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
                <span className="fstat-label">最終回答</span>
                <span className="fstat-value fstat-value-sm" title={latestTitle}>
                  {fmtUpdated(latestMs)}
                </span>
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
            <div className="forms-list">
              {/* 列見出し（フォーム名／総回答数／今月の回答数） */}
              <div className="fl-head">
                <span className="fl-grip" aria-hidden="true" />
                <span className="fl-name">フォーム名</span>
                <span className="fl-total">総回答数</span>
                <span className="fl-month">今月の回答数</span>
                <span className="fl-act" />
              </div>

              {items.map((f, i) => {
                const c = counts[f.id];
                return (
                  <div
                    key={f.id}
                    className={"fl-row" + (dragOver === i ? " dragover" : "")}
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
                    <span className="fl-grip">
                      {canEdit && (
                        <span
                          className="fl-grip-btn"
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
                    </span>

                    <span className="fl-name">
                      <span className="fl-ico" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                          <rect x="9" y="2" width="6" height="4" rx="1" />
                          <line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="14" y2="15" />
                        </svg>
                      </span>
                      <span className="fl-name-body">
                        <span className="fl-title" title={f.title}>{f.title}</span>
                        {f.description && <span className="fl-desc">{f.description}</span>}
                      </span>
                    </span>

                    <span className="fl-total">
                      {c?.error ? (
                        <span className="fl-err" title={c.error}>取得エラー</span>
                      ) : c ? (
                        <>
                          <b>{Number(c.total || 0).toLocaleString("ja-JP")}</b>
                          <i>件</i>
                        </>
                      ) : (
                        <span className="fl-dim">—</span>
                      )}
                    </span>

                    <span className="fl-month">
                      {c && !c.error ? (
                        <span className="fl-pill">
                          {Number(c.month || 0).toLocaleString("ja-JP")}
                          <i>件</i>
                        </span>
                      ) : (
                        <span className="fl-dim">—</span>
                      )}
                    </span>

                    <span className="fl-act">
                      {canEdit && (
                        <span className="fl-ops">
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
                      <span className="fl-open">
                        回答を見る
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 追加・編集モーダル */}
      {/* 施設をえらぶ */}
      <Modal
        open={!!picker}
        title="施設を選ぶ"
        onClose={() => setPicker(null)}
        width={560}
        footer={
          <>
            {link?.[picker?.rowIdx]?.recordId && (
              <button className="mini-btn" onClick={unlinkRow} disabled={picking}>
                紐づけを外す
              </button>
            )}
            <button className="mini-btn" onClick={() => setPicker(null)} disabled={picking}>
              閉じる
            </button>
          </>
        }
      >
        <div className="fpick">
          <label className="search-box fpick-search" aria-label="施設をさがす">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              type="search"
              value={picker?.q || ""}
              onChange={(e) => setPicker((v) => ({ ...v, q: e.target.value }))}
              placeholder="HID・施設名・レコード番号でさがす"
            />
          </label>
          <div className="fpick-list">
            {pickList == null ? (
              <div className="fpick-empty">さがしています…</div>
            ) : pickList.length === 0 ? (
              <div className="fpick-empty">見つかりませんでした。</div>
            ) : (
              pickList.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className="fpick-row"
                  onClick={() => pickFacility(x.id)}
                  disabled={picking}
                >
                  <span className="fpick-id">{x.id}</span>
                  <span className="fpick-hid">{x.hid || "—"}</span>
                  <span className="fpick-name">{x.name || "—"}</span>
                  <span className="fpick-stage">{x.stage || ""}</span>
                </button>
              ))
            )}
          </div>
          <div className="fpick-note">
            選ぶとすぐに施設一覧へ反映します（Kintone 側が空の項目にだけ入れます）。
          </div>
        </div>
      </Modal>

      {/* 反映のしくみと内訳 */}
      <Modal
        open={linkHelp}
        title="施設一覧への反映について"
        onClose={() => setLinkHelp(false)}
        width={560}
        footer={<button className="save-btn" onClick={() => setLinkHelp(false)}>閉じる</button>}
      >
        <div className="cmhelp">
          {/* 実行と、状態での絞り込み */}
          <div className="cmhelp-run">
            <div className="cmimp-chips">
              {[
                { k: "all", label: "すべて", n: linkStat?.total },
                { k: "pending", label: "反映できる", n: linkStat?.pending },
                { k: "unlinked", label: "未紐づけ", n: linkStat?.unlinked },
                { k: "applied", label: "反映済み", n: linkStat?.applied },
              ].map((c) => (
                <button
                  key={c.k}
                  type="button"
                  className={"cmimp-chip" + (linkFilter === c.k ? " on" : "") + " t-" + c.k}
                  onClick={() => {
                    setLinkFilter(c.k);
                    setLinkHelp(false);
                  }}
                  title="この状態の回答だけを表に出す"
                >
                  {c.label}
                  <b>{(c.n ?? 0).toLocaleString("ja-JP")}</b>
                </button>
              ))}
            </div>
          </div>
          <div className="cmhelp-sec">
            <b>いまの内訳（全 {(linkStat?.total ?? 0).toLocaleString("ja-JP")} 件）</b>
            <ul>
              <li>
                <span className="t-pending">反映できる {(linkStat?.pending ?? 0).toLocaleString("ja-JP")} 件</span>
                … これから入れられるもの
              </li>
              <li>
                <span className="t-nomatch">未紐づけ {(linkStat?.unlinked ?? 0).toLocaleString("ja-JP")} 件</span>
                … まだ施設を選んでいない回答。表の「紐づけ」から施設を選ぶと、その場で反映します
              </li>
              <li>
                入れるものなし {(linkStat?.nochange ?? 0).toLocaleString("ja-JP")} 件
                … Kintone 側にすでに値がある、または CM種別が選択肢にない回答
              </li>
              <li>
                <span className="t-applied">反映済み {(linkStat?.applied ?? 0).toLocaleString("ja-JP")} 件</span>
                … このサイトで反映したもの、およびシートの「Kintoneへ反映済み」に印がある回答
              </li>
            </ul>
          </div>
          <div className="cmhelp-sec">
            <b>紐づけと反映</b>
            <p>
              表の「紐づけ」から施設を選ぶと、<b>その場で1件だけ</b>反映します。
              入れるのは CM種別・URL・ID・PW・契約コードの5つで、<b>Kintone 側が空の項目にだけ</b>入れます。
              すでに値が入っている項目は触りません（手で直した内容を消さないため）。
              CM種別は Kintone の選択肢に無い回答なら入れません。
            </p>
          </div>
          <div className="cmhelp-sec">
            <b>どの施設に入れるか</b>
            <p>
              Hotel ID（HID）→（空なら）施設名（英語）→（それも空なら）施設名（日本語）の順で探します。
              紐づけを間違えている場合は、回答一覧の Hotel ID をその場で直せます。
            </p>
          </div>
          <div className="cmhelp-sec">
            <b>反映したあと</b>
            <p>
              回答の左の印が緑になり、施設一覧のレコードNoの右にも印が付きます。
              シートの「Kintoneへ反映済み」にも〇を付けます。
              紐づけを選び直したり、外したりもできます。
            </p>
          </div>
        </div>
      </Modal>

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
