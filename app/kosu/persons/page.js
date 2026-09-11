"use client";

import Link from "next/link";
import Modal from "../../Modal";
import PagePermModal from "./PagePermModal";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUi } from "../../Ui";
import Pulldown from "../../Pulldown";
import { cachedJson } from "../../dataCache";

// 役割ごとのまとまり。「その役割が何をできるか」は人ごとに繰り返さず、
// ここで一度だけ言う（メンバー全員の行に「—」が並ぶのを無くすため）。
const ROLE_GROUPS = [
  {
    key: "owner",
    name: "オーナー",
    desc: "すべてのページを見られる。すべてを変更できる。",
  },
  {
    key: "admin",
    name: "管理者",
    desc: "すべてのページを見られる。変更できる範囲は個別に決める。",
  },
  {
    key: "member",
    name: "メンバー",
    desc: "業務のページを見られる。変更できるのは作業工数入力だけ。",
  },
];

// 権限の選択肢（モーダルと一覧で同じものを使う）
const ROLE_OPTIONS = [
  { value: "owner", label: "オーナー" },
  { value: "admin", label: "管理者" },
  { value: "member", label: "メンバー" },
];


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
  if (!v) return "未ログイン";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "未ログイン";
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

// 除外日の表示（yyyy/mm/dd）。left_on は日付の列なので時刻までは持たない
function fmtDay(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

export default function KosuPersonsPage({ embedded = false } = {}) {
  const [configured, setConfigured] = useState(null);
  const [persons, setPersons] = useState([]);
  // ページ権限モーダルの対象ユーザー
  const [ppTarget, setPpTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const { showToast, flashDone, flashOk } = useUi();
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
    cachedJson("/api/auth/me", 60 * 1000)
      .then((d) => setPerms(d?.perms || null))
      .catch(() => setPerms(null))
      .finally(() => setPermsLoaded(true));
  }, []);
  const canView = !perms ? false : perms.viewAccounts;
  const canEdit = !!perms?.editAccounts; // 追加・改名・除外・削除ができる
  const canGrant = !!perms?.grantPerms; // 役割・権限フラグを変更できる（オーナー）

  // 絞り込み：在籍タブ・キーワード・権限
  // 操作列の「…」メニュー（表がスクロールするので body 直下に固定配置で出す）
  const [menu, setMenu] = useState(null); // { id, top, left }
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  const openMenu = (e, id) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const H = 96;
    setMenu({
      id,
      left: Math.min(r.right - 150, window.innerWidth - 162),
      top: r.bottom + H > window.innerHeight ? r.top - H - 4 : r.bottom + 6,
    });
  };

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
  // メール・担当者名の書き換えは、いきなりクリックできると誤編集につながるので
  // ヘッダーの編集ボタンを押しているあいだだけ触れるようにする
  const [textEdit, setTextEdit] = useState(false);

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

  // 楽観的更新：クリックした瞬間に画面へ反映（トグルがその場でアニメーション）し、
  // 全体リロードはしない。保存できたら画面中央に完了メッセージ（okMsg）を出す。
  const patch = async (id, body, okMsg) => {
    if (!configured) {
      showToast("デモモードのため保存されません", "warn");
      return;
    }
    const prev = persons;
    setPersons((list) => list.map((p) => (p.id === id ? { ...p, ...body } : p)));
    setError(null);
    try {
      const res = await fetch("/api/kosu-persons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      }).then((r) => r.json());
      if (res.error) {
        setPersons(prev); // 失敗したら元に戻す
        setError(res.error);
      } else {
        // サーバーが確定した値で上書き（表示のズレ防止）
        if (res.person) {
          setPersons((list) => list.map((p) => (p.id === id ? { ...p, ...res.person } : p)));
        }
        if (okMsg) flashOk(okMsg);
      }
    } catch (e) {
      setPersons(prev);
      setError(String(e?.message || e));
    }
  };

  // ドラッグでの並べ替え
  const dragIndex = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  // 取っ手を押した行だけ掴めるようにする（行のどこからでも動いてしまうのを防ぐ）
  const [armedId, setArmedId] = useState(null);
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

  // 絞り込みは置かない（人数が少なく、除外したメンバーも末尾に並ぶだけで探せるため）
  const pageRows = persons;
  // 除外したメンバーは末尾に固定。現役行だけドラッグ可（現役の表示順＝現役リストの
  // インデックスなので reorder の前提が保たれる）。
  const canDrag = true;

  // 担当者を追加ボタン（通常ヘッダー／埋め込みツールバーの両方で使う）
  const addPersonBtn = canEdit ? (
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 20v-1.6a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.4V20" />
        <circle cx="9" cy="7.6" r="3.6" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </svg>
    </button>
  ) : null;

  // メール・担当者名の編集モードを切り替えるボタン（追加ボタンの左に置く）
  const textEditBtn = canEdit ? (
    <button
      className={"icon-btn persons-edit-btn" + (textEdit ? " on" : "")}
      onClick={() => {
        setEdit(null);
        setTextEdit((v) => !v);
      }}
      title={textEdit ? "編集を終了" : "メール・担当者名を編集"}
      aria-label={textEdit ? "編集を終了" : "メール・担当者名を編集"}
      aria-pressed={textEdit}
    >
      {textEdit ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" /></svg>
      )}
    </button>
  ) : null;

  // 権限の確認が終わるまでは何も出さない（一瞬でも中身を見せない）
  if (!permsLoaded) {
    return (
      <div className={embedded ? "persons-page persons-embed" : "wrap page-compact persons-page"}>
        <div className="card">
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
        </div>
      </div>
    );
  }

  // 閲覧権限が無い＝アクセス拒否画面
  if (!canView) {
    return (
      <div className={embedded ? "persons-page persons-embed" : "wrap page-compact persons-page"}>
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
    <div className={embedded ? "persons-page persons-embed" : "wrap page-compact persons-page"}>
      {!embedded && (
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
            {textEditBtn}
            {addPersonBtn}
          </div>
        </div>
      )}

      {embedded && canEdit && (
        <div className="persons-embed-tools">
          {textEditBtn}
          {addPersonBtn}
        </div>
      )}

      {!canEdit && (
        <div className="banner info-banner">
          閲覧のみの権限です。編集するにはオーナーに権限を付与してもらってください。
        </div>
      )}

      {configured === false && (
        <div className="banner warn-banner">
          Supabase 未接続のため<b>変更は保存されません</b>（デモ表示）。接続すると担当者の追加・改名・除外処理が有効になります。
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
          工数の実績が登録されている場合は削除できません。その場合は「除外」をご利用ください（実績は残ります）。
        </p>
      </Modal>

      <PagePermModal person={ppTarget} onClose={() => setPpTarget(null)} />

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
              <Pulldown
                value={role}
                onChange={setRole}
                ariaLabel="権限"
                options={ROLE_OPTIONS}
              />
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

      {loading ? (
        <div className="card">
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
        </div>
      ) : (
        <>
        <div className="acct">
          <p className="acct-lede">
            {persons.length}人が登録されています。
            {persons.filter((x) => x.active && x.can_login).length}人がログインできます。
            {canEdit && !textEdit && "　変更するときは右上の編集ボタンを押してください。"}
          </p>

          {pageRows.length === 0 && (
            <p className="acct-empty">
              まだ誰も登録されていません。右上の＋から追加してください。
            </p>
          )}

          {/* 役割ごとのまとまり。行には「その人だけで変わるもの」しか置かない */}
          {ROLE_GROUPS.map((g) => {
            const people = pageRows.filter((p) => p.active && (p.role || "member") === g.key);
            if (people.length === 0) return null;
            return (
              <section className="acct-group" key={g.key}>
                <header className="acct-ghead">
                  <h2 className="acct-gname">{g.name}</h2>
                  <span className="acct-gcount">{people.length}</span>
                  <p className="acct-gdesc">{g.desc}</p>
                </header>
                <ul className="acct-list">
                  {people.map((p) => {
                    const i = activeList.indexOf(p);
                    const isAdmin = (p.role || "member") === "admin";
                    return (
                      <li
                        key={p.id}
                        draggable={canDrag && !busy && armedId === p.id}
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
                          setArmedId(null);
                        }}
                        onDragEnd={() => {
                          dragIndex.current = null;
                          setDragOver(null);
                          setArmedId(null);
                        }}
                        className={
                          "acct-row" +
                          (dragOver === i ? " is-over" : "") +
                          (dragIndex.current === i ? " is-dragging" : "")
                        }
                      >
                        <span
                          className="acct-grip"
                          onMouseDown={() => canDrag && !busy && setArmedId(p.id)}
                          onMouseUp={() => setArmedId(null)}
                          title={canDrag ? "ドラッグで並べ替え" : "検索中は並べ替えできません"}
                          aria-hidden="true"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="5" r="1.7" />
                            <circle cx="15" cy="5" r="1.7" />
                            <circle cx="9" cy="12" r="1.7" />
                            <circle cx="15" cy="12" r="1.7" />
                            <circle cx="9" cy="19" r="1.7" />
                            <circle cx="15" cy="19" r="1.7" />
                          </svg>
                        </span>

                        {p.avatar_url ? (
                          <img className="acct-photo" src={p.avatar_url} alt="" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="acct-photo acct-photo-none" aria-hidden="true">
                            {p.name?.slice(0, 1) || "?"}
                          </span>
                        )}

                        <span className="acct-who">
                          <span className="acct-line1">
                            <span className="acct-name">{p.login_name || romaji(p.email)}</span>
                            {edit?.id === p.id && edit.field === "name" ? (
                              <input
                                className="acct-input acct-input-jp"
                                value={edit.value}
                                autoFocus
                                onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                                onKeyDown={(e) => e.key === "Enter" && saveEdit(p)}
                                onBlur={() => saveEdit(p)}
                              />
                            ) : canEdit && textEdit ? (
                              <button
                                className="acct-jp acct-editable"
                                onClick={() => setEdit({ id: p.id, field: "name", value: p.name })}
                                title="クリックで担当者名を変更"
                              >
                                {p.name}
                              </button>
                            ) : (
                              <span className="acct-jp">{p.name}</span>
                            )}
                          </span>
                          {edit?.id === p.id && edit.field === "email" ? (
                            <input
                              className="acct-input acct-input-mail"
                              type="email"
                              value={edit.value}
                              autoFocus
                              onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                              onKeyDown={(e) => e.key === "Enter" && saveEdit(p)}
                              onBlur={() => saveEdit(p)}
                            />
                          ) : canEdit && textEdit ? (
                            <button
                              className="acct-mail acct-editable"
                              onClick={() => setEdit({ id: p.id, field: "email", value: p.email || "" })}
                              title="クリックでメールを変更"
                            >
                              {p.email || "メール未設定"}
                            </button>
                          ) : (
                            <span className={"acct-mail" + (p.email ? "" : " acct-mail-none")}>
                              {p.email || "メール未設定"}
                            </span>
                          )}
                        </span>

                        {/* 読むとき：許可されているものだけを印字する。
                            許可されていないものは何も書かない（「—」も「拒否」も出さない） */}
                        {!textEdit && (
                          <span className="acct-grants">
                            {!p.can_login && <span className="acct-grant acct-grant-off">ログインできない</span>}
                            {isAdmin && p.can_edit_accounts && <span className="acct-grant">権限編集</span>}
                            {isAdmin && p.can_edit_tasks && <span className="acct-grant">タスク編集</span>}
                          </span>
                        )}

                        {/* 変えるとき：その人で変えられるものだけを並べる */}
                        {textEdit && canEdit && (
                          <span className="acct-controls">
                            <span className="acct-ctl">
                              <button
                                className={"switch " + (p.can_login ? "on" : "off")}
                                role="switch"
                                aria-checked={p.can_login}
                                aria-label="ログインを許可"
                                onClick={() => {
                                  if (!p.can_login && !p.email) {
                                    setError("ログインを許可するには先にメールアドレスを登録してください");
                                    return;
                                  }
                                  patch(p.id, { can_login: !p.can_login }, "ログインの許可設定を変更しました。");
                                }}
                                disabled={busy}
                                title={p.can_login ? "クリックでログインを禁止" : "クリックでログインを許可"}
                              >
                                <span className="switch-knob" aria-hidden="true" />
                              </button>
                              <span className="acct-ctl-label">ログイン</span>
                            </span>

                            {isAdmin && (
                              <>
                                <span className="acct-ctl">
                                  <button
                                    className={"switch " + (p.can_edit_accounts ? "on" : "off")}
                                    role="switch"
                                    aria-checked={p.can_edit_accounts}
                                    aria-label="権限編集を許可"
                                    onClick={() => patch(p.id, { can_edit_accounts: !p.can_edit_accounts }, "アカウント管理の編集権限を変更しました。")}
                                    disabled={busy || !canGrant}
                                    title="アカウント管理を編集できる"
                                  >
                                    <span className="switch-knob" aria-hidden="true" />
                                  </button>
                                  <span className="acct-ctl-label">権限編集</span>
                                </span>
                                <span className="acct-ctl">
                                  <button
                                    className={"switch " + (p.can_edit_tasks ? "on" : "off")}
                                    role="switch"
                                    aria-checked={p.can_edit_tasks}
                                    aria-label="タスク編集を許可"
                                    onClick={() => patch(p.id, { can_edit_tasks: !p.can_edit_tasks }, "タスクの編集権限を変更しました。")}
                                    disabled={busy || !canGrant}
                                    title="ダッシュボードのタスクを編集できる"
                                  >
                                    <span className="switch-knob" aria-hidden="true" />
                                  </button>
                                  <span className="acct-ctl-label">タスク編集</span>
                                </span>
                              </>
                            )}

                            <Pulldown
                              size="sm"
                              value={p.role || "member"}
                              onChange={(v) => patch(p.id, { role: v }, "権限を変更しました。")}
                              disabled={busy || !canGrant}
                              ariaLabel="役割"
                              options={ROLE_OPTIONS}
                            />
                          </span>
                        )}

                        <span className="acct-seen" title="最終ログイン">
                          {fmtLogin(p.last_login_at)}
                        </span>

                        <span className="acct-acts">
                          {(p.role || "member") !== "owner" && canEdit && (
                            <button
                              type="button"
                              className="acct-ghost"
                              onClick={() => setPpTarget(p)}
                              title="見られるページを設定"
                            >
                              ページ権限
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              className={"pf-more" + (menu?.id === p.id ? " on" : "")}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => openMenu(e, p.id)}
                              disabled={busy}
                              title="操作"
                              aria-label="操作"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <circle cx="5" cy="12" r="1.8" />
                                <circle cx="12" cy="12" r="1.8" />
                                <circle cx="19" cy="12" r="1.8" />
                              </svg>
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {/* 除外した人。記録は残すが、権限の話からは外す */}
          {pageRows.some((p) => !p.active) && (
            <section className="acct-group acct-group-out">
              <header className="acct-ghead">
                <h2 className="acct-gname">除外</h2>
                <span className="acct-gcount">{pageRows.filter((p) => !p.active).length}</span>
                <p className="acct-gdesc">ログインできない。工数の記録は残る。</p>
              </header>
              <ul className="acct-list">
                {pageRows
                  .filter((p) => !p.active)
                  .map((p) => (
                    <li key={p.id} className="acct-row acct-row-out">
                      <span className="acct-grip" aria-hidden="true" />
                      {p.avatar_url ? (
                        <img className="acct-photo" src={p.avatar_url} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="acct-photo acct-photo-none" aria-hidden="true">
                          {p.name?.slice(0, 1) || "?"}
                        </span>
                      )}
                      <span className="acct-who">
                        <span className="acct-line1">
                          <span className="acct-name">{p.login_name || romaji(p.email)}</span>
                          <span className="acct-jp">{p.name}</span>
                        </span>
                        <span className="acct-mail">{p.email || "メール未設定"}</span>
                      </span>
                      <span className="acct-grants">
                        <span className="acct-grant acct-grant-off">
                          {p.left_on ? fmtDay(p.left_on) + " に除外" : "除外"}
                        </span>
                      </span>
                      <span className="acct-seen" title="最終ログイン">
                        {fmtLogin(p.last_login_at)}
                      </span>
                      <span className="acct-acts">
                        {canEdit && (
                          <button
                            type="button"
                            className={"pf-more" + (menu?.id === p.id ? " on" : "")}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => openMenu(e, p.id)}
                            disabled={busy}
                            title="操作"
                            aria-label="操作"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <circle cx="5" cy="12" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="19" cy="12" r="1.8" />
                            </svg>
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </div>
        </>
      )}

      {/* 操作の「…」メニュー */}
      {menu &&
        typeof document !== "undefined" &&
        (() => {
          const p = persons.find((x) => x.id === menu.id);
          if (!p) return null;
          return createPortal(
            <div
              className="pf-menu"
              style={{ top: menu.top, left: menu.left }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {p.active ? (
                <button
                  type="button"
                  className="pf-menu-item"
                  disabled={busy}
                  onClick={() => {
                    setMenu(null);
                    patch(p.id, { active: false, left_on: new Date().toISOString().slice(0, 10) });
                  }}
                >
                  除外にする
                </button>
              ) : (
                <button
                  type="button"
                  className="pf-menu-item"
                  disabled={busy}
                  onClick={() => {
                    setMenu(null);
                    patch(p.id, { active: true, left_on: null });
                  }}
                >
                  除外解除
                </button>
              )}
              <button
                type="button"
                className="pf-menu-item danger"
                disabled={busy}
                onClick={() => {
                  setMenu(null);
                  setError(null);
                  setMsg(null);
                  setDelTarget({ id: p.id, name: p.name });
                }}
              >
                削除
              </button>
            </div>,
            document.body
          );
        })()}
    </div>
  );
}
