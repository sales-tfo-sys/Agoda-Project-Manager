"use client";

import Link from "next/link";
import Modal from "../../Modal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUi } from "../../Ui";

const PAGE_SIZE = 10;

// 氏名の下に出すローマ字。メールのローカル部から作る（hori@… → Hori）
function romaji(email) {
  if (!email) return "";
  const local = String(email).split("@")[0] || "";
  const head = local.split(/[._-]/)[0];
  if (!head) return "";
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
}

const DEMO = [
  { id: "demo-p0", name: "田中", email: "", role: "member", can_login: false, sort_order: 1, active: true },
  { id: "demo-p1", name: "長内", email: "", role: "member", can_login: false, sort_order: 2, active: true },
  { id: "demo-p2", name: "原", email: "", role: "member", can_login: false, sort_order: 3, active: true },
];

// 最終ログインの表示（yyyy/mm/dd hh:mm）
function fmtLogin(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

export default function KosuPersonsPage() {
  const [configured, setConfigured] = useState(null);
  const [persons, setPersons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const { showToast, flashDone } = useUi();
  const [addOpen, setAddOpen] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");

  const [canLogin, setCanLogin] = useState(false);
  // 追加モーダルで設定する個別付与（オーナーのみ操作）
  const [addEditAccounts, setAddEditAccounts] = useState(false);
  const [addEditTasks, setAddEditTasks] = useState(false);
  // 削除確認 { id, name }
  const [delTarget, setDelTarget] = useState(null);

  // ログイン中の実効権限（閲覧・編集の可否を決める）
  const [perms, setPerms] = useState(null);
  const [permsLoaded, setPermsLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPerms(d?.perms || null))
      .catch(() => setPerms(null))
      .finally(() => setPermsLoaded(true));
  }, []);
  const canView = !perms ? false : perms.viewAccounts;
  const canEdit = !!perms?.editAccounts; // 追加・改名・退職・削除ができる
  const canGrant = !!perms?.grantPerms; // 役割・権限フラグを変更できる（オーナー）

  // 検索・絞り込み・ページ送り
  const [q, setQ] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const filterRef = useRef(null);

  // 絞り込みポップオーバーは外side クリックで閉じる
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setFilterOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  const removePerson = async () => {
    if (!delTarget) return;
    if (!configured) {
      showToast("デモモードのため保存されません", "warn");
      setDelTarget(null);
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/kosu-persons?id=${encodeURIComponent(delTarget.id)}`,
        { method: "DELETE" }
      ).then((r) => r.json());
      if (res.error) setError(res.error);
      else {
        await load();
        flashDone("削除完了");
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
      setDelTarget(null);
    }
  };
  // インライン編集：{ id, field: "name" | "email", value }
  const [edit, setEdit] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const st = await fetch("/api/kosu-status", { cache: "no-store" }).then((r) => r.json());
      setConfigured(st.configured);
      if (st.configured) {
        const j = await fetch("/api/kosu-persons?all=1", { cache: "no-store" }).then((r) => r.json());
        if (j.error) setError(j.error);
        setPersons(j.persons || []);
      } else {
        setPersons(DEMO);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 完了メッセージは数秒で自動的に消す（エラーは操作するまで残す）
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const add = async () => {
    if (!name.trim()) return;
    if (canLogin && !email.trim()) {
      setError("ログインを許可するにはメールアドレスが必要です");
      return;
    }
    if (!configured) {
      showToast("デモモードのため保存されません", "warn");
      setPersons((p) => [
        ...p,
        {
          id: "demo-new-" + p.length,
          name: name.trim(),
          email: email.trim(),
          role,
          can_login: canLogin,
          sort_order: p.length + 1,
          active: true,
        },
      ]);
      setName("");
      setEmail("");
      setCanLogin(false);
      setAddOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const maxSort = persons.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
      const res = await fetch("/api/kosu-persons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          can_login: canLogin,
          // 役割・権限フラグはオーナーのみ有効（サーバー側でも再チェック）
          role: canGrant ? role : "member",
          can_edit_accounts: canGrant && role === "admin" ? addEditAccounts : false,
          can_edit_tasks: canGrant && role === "admin" ? addEditTasks : false,
          sort_order: maxSort + 1,
        }),
      }).then((r) => r.json());
      if (res.error) setError(res.error);
      else {
        setName("");
        setEmail("");
        setCanLogin(false);
        setRole("member");
        setAddEditAccounts(false);
        setAddEditTasks(false);
        setAddOpen(false);
        await load();
        flashDone("追加完了");
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id, body) => {
    if (!configured) {
      showToast("デモモードのため保存されません", "warn");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kosu-persons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      }).then((r) => r.json());
      if (res.error) setError(res.error);
      else await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // ドラッグでの並べ替え
  const dragIndex = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const reorder = async (from, to) => {
    if (from == null || to == null || from === to) return;
    const list = persons.filter((p) => p.active);
    if (!list[from] || !list[to]) return;
    const moved = list.splice(from, 1)[0];
    list.splice(to, 0, moved);
    // 1..n を振り直し、変わった行だけ保存する
    const updates = list
      .map((p, i) => ({ id: p.id, sort_order: i + 1, before: p.sort_order }))
      .filter((u) => u.before !== u.sort_order);
    if (!updates.length) return;
    // 先に画面へ反映（待たせない）
    const next = new Map(updates.map((u) => [u.id, u.sort_order]));
    setPersons((prev) =>
      [...prev]
        .map((p) => (next.has(p.id) ? { ...p, sort_order: next.get(p.id) } : p))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.sort_order - b.sort_order)
    );
    if (!configured) {
      showToast("デモモードのため保存されません", "warn");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const u of updates) {
        const res = await fetch("/api/kosu-persons", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: u.id, sort_order: u.sort_order }),
        }).then((r) => r.json());
        if (res.error) {
          setError(res.error);
          break;
        }
      }
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (p) => {
    if (!edit) return;
    const v = edit.value.trim();
    const cur = edit.field === "name" ? p.name : p.email || "";
    if (v === cur || (edit.field === "name" && !v)) {
      setEdit(null);
      return;
    }
    setEdit(null);
    await patch(p.id, { [edit.field]: edit.field === "email" ? v || null : v });
  };

  const activeList = persons.filter((p) => p.active);

  // 検索＋在籍/退職の絞り込み → ページ分割
  const filtered = useMemo(() => {
    const base = showRetired ? persons : activeList;
    const key = q.trim().toLowerCase();
    if (!key) return base;
    return base.filter((p) =>
      [p.name, p.email, romaji(p.email)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(key))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persons, q, showRetired]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const rangeFrom = filtered.length === 0 ? 0 : (curPage - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(curPage * PAGE_SIZE, filtered.length);
  // 並べ替えは絞り込みが無いときだけ（表示順と実データの順が一致しているため）
  const canDrag = !q.trim() && !showRetired && curPage === 1;

  useEffect(() => {
    setPage(1);
  }, [q, showRetired]);

  // 権限の確認が終わるまでは何も出さない（一瞬でも中身を見せない）
  if (!permsLoaded) {
    return (
      <div className="wrap page-compact persons-page">
        <div className="card">
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
        </div>
      </div>
    );
  }

  // 閲覧権限が無い＝アクセス拒否画面
  if (!canView) {
    return (
      <div className="wrap page-compact persons-page">
        <div className="access-deny">
          <span className="deny-badge" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 3 6v6c0 5 3.8 8.3 9 10 5.2-1.7 9-5 9-10V6l-9-4Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="16.5" x2="12" y2="16.6" />
            </svg>
          </span>
          <div className="deny-title">アクセス権限がありません</div>
          <p className="deny-text">
            このページを閲覧する権限がありません。管理者にお問い合わせください。
          </p>
          <Link href="/dashboard" className="primary-btn deny-back">
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap page-compact persons-page">
      <div className="head persons-head">
        <div className="head-left">
          <span className="conn ok" title="アカウント管理" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <span className="page-h page-h-gap">アカウント管理</span>
        </div>
        <div className="head-right">
          {canEdit && (
            <button
              className="primary-btn icon-only add-person-btn"
              onClick={() => {
                setError(null);
                setMsg(null);
                setAddOpen(true);
              }}
              title="担当者を追加"
              aria-label="担当者を追加"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 20v-1.6a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.4V20" />
                <circle cx="9" cy="7.6" r="3.6" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className="banner info-banner">
          閲覧のみの権限です。編集するにはオーナーに権限を付与してもらってください。
        </div>
      )}

      {configured === false && (
        <div className="banner warn-banner">
          Supabase 未接続のため<b>変更は保存されません</b>（デモ表示）。接続すると担当者の追加・改名・退職処理が有効になります。
        </div>
      )}

      <Modal
        open={!!delTarget}
        title="担当者の削除"
        onClose={() => setDelTarget(null)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setDelTarget(null)} disabled={busy}>
              キャンセル
            </button>
            <button className="save-btn danger-btn" onClick={removePerson} disabled={busy}>
              削除する
            </button>
          </>
        }
      >
        <div className="modal-fields">
          <div className="fld">
            対象
            <span className="modal-strong">{delTarget?.name}</span>
          </div>
        </div>
        <p className="modal-note">
          担当者とログインアカウントを完全に削除します。この操作は取り消せません。
          <br />
          工数の実績が登録されている場合は削除できません。その場合は「退職」をご利用ください（実績は残ります）。
        </p>
      </Modal>
      {error && <div className="banner err-banner">エラー：{error}</div>}

      <Modal
        open={addOpen}
        title="担当者追加"
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setAddOpen(false)} disabled={busy}>
              キャンセル
            </button>
            <button className="save-btn" onClick={add} disabled={busy || !name.trim()}>
              追加する
            </button>
          </>
        }
      >
        <div className="modal-fields">
          <label className="fld">
            氏名
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="例：山田"
            />
          </label>
          <label className="fld">
            メール（ログイン用）
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="yamada@example.com"
            />
          </label>
          {/* 役割・権限を設定できるのはオーナーのみ */}
          {canGrant && (
            <label className="fld">
              権限
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="owner">オーナー</option>
                <option value="admin">管理者</option>
                <option value="member">メンバー</option>
              </select>
            </label>
          )}
          {canGrant && role === "admin" && (
            <div className="fld">
              個別に許可する編集
              <div className="grant-check-row">
                <label className="chk-row">
                  <input
                    type="checkbox"
                    checked={addEditAccounts}
                    onChange={(e) => setAddEditAccounts(e.target.checked)}
                  />
                  アカウント管理の編集
                </label>
                <label className="chk-row">
                  <input
                    type="checkbox"
                    checked={addEditTasks}
                    onChange={(e) => setAddEditTasks(e.target.checked)}
                  />
                  タスクの編集
                </label>
              </div>
            </div>
          )}
          <label className="chk-row">
            <input
              type="checkbox"
              checked={canLogin}
              onChange={(e) => setCanLogin(e.target.checked)}
            />
            ログインを許可する
          </label>
        </div>
        {error && <div className="modal-err">{error}</div>}
        <p className="modal-note">
          ログインを許可するにはメールアドレスが必要です。ログインは Google アカウントで行います。
        </p>
      </Modal>

      <div className="persons-toolbar">
        <label className="search-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="担当者を検索..."
            aria-label="担当者を検索"
          />
        </label>
        <span className="filter-wrap" ref={filterRef}>
          <button
            className={"icon-btn filter-btn" + (showRetired ? " on" : "")}
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
            title="絞り込み"
            aria-label="絞り込み"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="21 4 3 4 10 12.5 10 19 14 21 14 12.5 21 4" />
            </svg>
          </button>
          {filterOpen && (
            <div className="filter-pop" role="dialog" aria-label="絞り込み">
              <label className="chk-row">
                <input
                  type="checkbox"
                  checked={showRetired}
                  onChange={(e) => setShowRetired(e.target.checked)}
                />
                退職者も表示する
              </label>
            </div>
          )}
        </span>
      </div>

      {loading ? (
        <div className="card">
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
        </div>
      ) : (
        <div className="card no-pad persons-card">
          <div className="dtw">
            <table className="dtable persons-table">
              <thead>
                <tr>
                  <th className="grip-th" aria-label="並べ替え" />
                  <th className="l">担当者</th>
                  <th className="l">メール（ログインID）</th>
                  <th>ログイン</th>
                  <th>権限</th>
                  <th>編集権限</th>
                  <th>最終ログイン</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td className="l no-hit" colSpan={8}>
                      該当する担当者がいません。
                    </td>
                  </tr>
                )}
                {pageRows.map((p) => {
                  const i = activeList.indexOf(p);
                  return (
                    <tr
                      key={p.id}
                      draggable={canDrag && !busy && i >= 0}
                      onDragStart={() => {
                        dragIndex.current = i;
                      }}
                      onDragOver={(e) => {
                        if (!canDrag) return;
                        e.preventDefault();
                        if (dragOver !== i) setDragOver(i);
                      }}
                      onDragLeave={() => {
                        if (dragOver === i) setDragOver(null);
                      }}
                      onDrop={() => {
                        reorder(dragIndex.current, i);
                        dragIndex.current = null;
                        setDragOver(null);
                      }}
                      onDragEnd={() => {
                        dragIndex.current = null;
                        setDragOver(null);
                      }}
                      className={
                        (dragOver === i ? "row-dragover " : "") +
                        (dragIndex.current === i ? "row-dragging " : "") +
                        (p.active ? "" : "row-retired")
                      }
                    >
                      <td
                        className="grip-td"
                        title={canDrag ? "ドラッグで並べ替え" : "検索・絞り込み中は並べ替えできません"}
                      >
                        <span className="grip" aria-hidden="true">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="5" r="1.7" />
                            <circle cx="15" cy="5" r="1.7" />
                            <circle cx="9" cy="12" r="1.7" />
                            <circle cx="15" cy="12" r="1.7" />
                            <circle cx="9" cy="19" r="1.7" />
                            <circle cx="15" cy="19" r="1.7" />
                          </svg>
                        </span>
                      </td>
                      <td className="l name-cell">
                        {/* td 自体を flex にすると table の列幅計算から外れ、縦線がずれる。
                            中身は内側の div で flex にする */}
                        <span className="name-inner">
                          {p.avatar_url ? (
                            <img
                              className="person-photo"
                              src={p.avatar_url}
                              alt=""
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="person-photo-none" aria-hidden="true">
                              {p.name?.slice(0, 1) || "?"}
                            </span>
                          )}
                          <span className="name-stack">
                            {edit?.id === p.id && edit.field === "name" ? (
                              <input
                                className="cell-input name-input"
                                value={edit.value}
                                autoFocus
                                onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                                onKeyDown={(e) => e.key === "Enter" && saveEdit(p)}
                                onBlur={() => saveEdit(p)}
                              />
                            ) : canEdit ? (
                              <button
                                className="link-cell name-main"
                                onClick={() => setEdit({ id: p.id, field: "name", value: p.name })}
                                title="クリックで改名"
                              >
                                {p.name}
                              </button>
                            ) : (
                              <span className="name-main">
                                {p.name}
                              </span>
                            )}
                            {/* ログイン時に取得した Google アカウント名。
                                未ログインならメールから作った仮名を出す */}
                            <span className="name-sub">
                              {p.login_name || romaji(p.email)}
                              {!p.active && <span className="retired-tag">退職</span>}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="l">
                        {edit?.id === p.id && edit.field === "email" ? (
                          <input
                            className="cell-input email-input"
                            type="email"
                            value={edit.value}
                            autoFocus
                            onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && saveEdit(p)}
                            onBlur={() => saveEdit(p)}
                          />
                        ) : canEdit ? (
                          <button
                            className="link-cell"
                            onClick={() => setEdit({ id: p.id, field: "email", value: p.email || "" })}
                            title="クリックでメール編集"
                          >
                            {p.email || "未設定"}
                          </button>
                        ) : (
                          <span className="plain-cell">{p.email || "未設定"}</span>
                        )}
                      </td>
                      <td>
                        <span className="login-cell-inner">
                          <button
                            className={"switch login-switch " + (p.can_login ? "on" : "off")}
                            role="switch"
                            aria-checked={p.can_login}
                            aria-label="ログイン許可"
                            onClick={() => {
                              if (!p.can_login && !p.email) {
                                setError("ログインを許可するには先にメールアドレスを登録してください");
                                return;
                              }
                              patch(p.id, { can_login: !p.can_login });
                            }}
                            disabled={busy || !canEdit}
                            title={
                              !canEdit
                                ? undefined
                                : p.can_login
                                ? "クリックでログインを禁止"
                                : "クリックでログインを許可"
                            }
                          >
                            <span className="switch-knob" aria-hidden="true" />
                          </button>
                          <span className={"login-state " + (p.can_login ? "on" : "off")}>
                            {p.can_login ? "許可" : "拒否"}
                          </span>
                        </span>
                      </td>
                      <td className="perm-cell">
                        <select
                          className={"mini-select role-select role-" + (p.role || "member")}
                          value={p.role || "member"}
                          onChange={(e) => patch(p.id, { role: e.target.value })}
                          disabled={busy || !canGrant}
                          title={canGrant ? undefined : "役割を変更できるのはオーナーだけです"}
                        >
                          <option value="owner">オーナー</option>
                          <option value="admin">管理者</option>
                          <option value="member">メンバー</option>
                        </select>
                      </td>
                      {/* 編集権限：管理者への個別付与だけを扱う列。
                          オーナー・メンバーは対象外なので「—」 */}
                      <td className="grant-cell">
                        {(p.role || "member") === "admin" ? (
                          <span className="grant-switches">
                            <span className="switch-chip">
                              <span className="switch-label">アカウント</span>
                              <button
                                className={"switch " + (p.can_edit_accounts ? "on" : "off")}
                                role="switch"
                                aria-checked={p.can_edit_accounts}
                                aria-label="アカウント管理の編集を許可"
                                onClick={() => patch(p.id, { can_edit_accounts: !p.can_edit_accounts })}
                                disabled={busy || !canGrant}
                                title="アカウント管理を編集できる"
                              >
                                <span className="switch-knob" aria-hidden="true" />
                              </button>
                            </span>
                            <span className="switch-chip">
                              <span className="switch-label">タスク</span>
                              <button
                                className={"switch " + (p.can_edit_tasks ? "on" : "off")}
                                role="switch"
                                aria-checked={p.can_edit_tasks}
                                aria-label="タスクの編集を許可"
                                onClick={() => patch(p.id, { can_edit_tasks: !p.can_edit_tasks })}
                                disabled={busy || !canGrant}
                                title="ダッシュボードのタスクを編集できる"
                              >
                                <span className="switch-knob" aria-hidden="true" />
                              </button>
                            </span>
                          </span>
                        ) : (
                          <span className="perm-note">—</span>
                        )}
                      </td>
                      <td>
                        <span className={"last-login" + (p.last_login_at ? "" : " none")}>
                          {fmtLogin(p.last_login_at)}
                        </span>
                      </td>
                      <td className="ops-td">
                        {canEdit ? (
                          <>
                            {p.active ? (
                              <button
                                className="mini-btn"
                                onClick={() =>
                                  patch(p.id, {
                                    active: false,
                                    left_on: new Date().toISOString().slice(0, 10),
                                  })
                                }
                                disabled={busy}
                                title="退職・異動（過去の実績は残ります）"
                              >
                                退職
                              </button>
                            ) : (
                              <button
                                className="mini-btn"
                                onClick={() => patch(p.id, { active: true, left_on: null })}
                                disabled={busy}
                                title="在籍に戻す"
                              >
                                復帰
                              </button>
                            )}{" "}
                            <button
                              className="mini-btn danger"
                              onClick={() => {
                                setError(null);
                                setMsg(null);
                                setDelTarget({ id: p.id, name: p.name });
                              }}
                              disabled={busy}
                              title="担当者とログインアカウントを完全に削除（実績があるときは不可）"
                            >
                              削除
                            </button>
                          </>
                        ) : (
                          <span className="perm-note">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="table-foot">
            <span className="foot-count">
              全 {filtered.length} 件中 {rangeFrom} 〜 {rangeTo} 件を表示
            </span>
            <div className="pager">
              <button
                className="pager-btn"
                onClick={() => setPage(curPage - 1)}
                disabled={curPage <= 1}
                aria-label="前のページ"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              {Array.from({ length: pageCount }, (_, n) => n + 1).map((n) => (
                <button
                  key={n}
                  className={"pager-btn num" + (n === curPage ? " active" : "")}
                  onClick={() => setPage(n)}
                  aria-current={n === curPage ? "page" : undefined}
                >
                  {n}
                </button>
              ))}
              <button
                className="pager-btn"
                onClick={() => setPage(curPage + 1)}
                disabled={curPage >= pageCount}
                aria-label="次のページ"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
