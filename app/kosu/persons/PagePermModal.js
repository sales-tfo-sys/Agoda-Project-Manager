"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PAGE_GROUPS } from "../../../lib/pages";
import PageIcon from "../../PageIcons";

// 各ユーザーの「閲覧できるページ／編集できるページ」を設定するモーダル。
// チェックを付け外した時点で自動保存する（保存ボタンなし）。
export default function PagePermModal({ person, onClose }) {
  const [pages, setPages] = useState(null);
  const [initial, setInitial] = useState(null); // 開いた時の状態（リセット用）
  const [status, setStatus] = useState(null); // "saving" | "saved"
  const [err, setErr] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!person) return;
    setPages(null);
    setInitial(null);
    setErr(null);
    setStatus(null);
    fetch(`/api/page-perms?personId=${encodeURIComponent(person.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setErr(d.error);
        else {
          setPages(d.pages || {});
          setInitial(d.pages || {});
        }
      })
      .catch((e) => setErr(String(e?.message || e)));
  }, [person]);

  // 変更のたびに自動保存（連打をまとめるため少し待つ）
  const persist = useCallback(
    (next) => {
      if (!person) return;
      if (timer.current) clearTimeout(timer.current);
      setStatus("saving");
      timer.current = setTimeout(async () => {
        try {
          const r = await fetch("/api/page-perms", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ personId: person.id, pages: next }),
          }).then((res) => res.json());
          if (r.error) {
            setErr(r.error);
            setStatus(null);
          } else {
            setErr(null);
            setStatus("saved");
            setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 1600);
          }
        } catch (e) {
          setErr(String(e?.message || e));
          setStatus(null);
        }
      }, 350);
    },
    [person]
  );

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  // Escで閉じる
  useEffect(() => {
    if (!person) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [person, onClose]);

  if (!person) return null;

  const toggle = (key, field) =>
    setPages((prev) => {
      const cur = prev[key] || { view: false, edit: false };
      const nextCell = { ...cur, [field]: !cur[field] };
      // 編集ONなら閲覧も自動ON。閲覧OFFなら編集もOFF。
      if (field === "edit" && nextCell.edit) nextCell.view = true;
      if (field === "view" && !nextCell.view) nextCell.edit = false;
      const next = { ...prev, [key]: nextCell };
      persist(next); // その場で保存
      return next;
    });

  // 開いた時の状態に戻す（自動保存されているため保存もやり直す）
  const reset = () => {
    if (!initial) return;
    setPages(initial);
    persist(initial);
  };

  const avatarInitial = (person.login_name || person.name || "?").slice(0, 1);

  return (
    <div
      className="pp-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div className="pp-modal" role="dialog" aria-modal="true" aria-label="ページ権限">
        <div className="pp-head">
          <span className="pp-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            ページ権限
          </span>
          <button type="button" className="pp-close" onClick={() => onClose(false)} aria-label="閉じる">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="pp-target">
          <span className="pp-target-label">対象者</span>
          {person.avatar_url ? (
            <img className="pp-avatar" src={person.avatar_url} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="pp-avatar pp-avatar-fallback" aria-hidden="true">{avatarInitial}</span>
          )}
          <b className="pp-target-name">{person.login_name || person.name}</b>
          {person.email && <span className="pp-target-mail">（{person.email}）</span>}
        </div>

        {err && <div className="banner err-banner pp-err">エラー：{err}</div>}

        {pages === null ? (
          <div className="pp-body"><div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div></div>
        ) : (
          <div className="pp-body">
            {PAGE_GROUPS.map((g) => (
              <div key={g.group} className="pp-group">
                <div className="pp-group-head">
                  <span className="pp-group-name">{g.group}</span>
                  <span className="pp-col">閲覧</span>
                  <span className="pp-col">編集</span>
                </div>
                {g.pages.map((pg) => {
                  const v = pages[pg.key] || { view: false, edit: false };
                  return (
                    <div key={pg.key} className="pp-row">
                      <span className="pp-page">
                        <span className="pp-page-ico" aria-hidden="true"><PageIcon pageKey={pg.key} /></span>
                        <span className="pp-page-label">{pg.label}</span>
                      </span>
                      <label className="pp-chk">
                        <input type="checkbox" checked={!!v.view} onChange={() => toggle(pg.key, "view")} aria-label={`${pg.label} 閲覧`} />
                      </label>
                      {pg.editable ? (
                        <label className="pp-chk">
                          <input type="checkbox" checked={!!v.edit} onChange={() => toggle(pg.key, "edit")} aria-label={`${pg.label} 編集`} />
                        </label>
                      ) : (
                        <span className="pp-na">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <div className="pp-foot">
          <span className={"pp-status" + (status ? " on" : "")}>
            {status === "saving" ? "保存中…" : status === "saved" ? "✓ 保存しました" : "変更すると自動で保存されます"}
          </span>
          <button
            type="button"
            className="mini-btn"
            onClick={reset}
            disabled={pages === null || initial === null}
            title="開いた時の状態に戻す"
          >
            リセット
          </button>
        </div>
      </div>
    </div>
  );
}
