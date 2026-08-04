"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "../Modal";
import { useUi } from "../Ui";

// HID新規発行依頼の列定義（すべて手動入力）。実シートの項目に合わせる。
const COLUMNS = [
  { key: "requestDate", label: "依頼日", type: "date", w: 130 },
  { key: "hid", label: "HID", type: "text", w: 110 },
  { key: "hotelName", label: "施設名", type: "text", w: 240 },
  { key: "pref", label: "都道府県", type: "text", w: 90 },
  { key: "applyDate", label: "申請日", type: "date", w: 130 },
  { key: "applyStatus", label: "申請状況", type: "select", options: ["未申請", "申請中", "申請済み"], w: 120 },
  { key: "roomPlanOff", label: "Room削除/Plan無効化", type: "check", w: 130 },
  { key: "promoOff", label: "プロモ無効化", type: "check", w: 110 },
  { key: "hideListing", label: "非掲載", type: "check", w: 90 },
  { key: "agodaReport", label: "Agoda完了報告", type: "select", options: ["未報告", "報告済み"], w: 130 },
  { key: "memo", label: "Memo", type: "text", w: 220 },
];

export default function HidRequestsPage() {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [delTarget, setDelTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const { setBusy, flashDone, showToast, busy } = useUi();

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCanEdit(!!d?.perms?.editTasks))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await fetch("/api/hid-requests", { cache: "no-store" }).then((r) => r.json());
      if (j.error) setError(j.error);
      setItems(j.items || []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addRow = async () => {
    setBusy("追加中…");
    try {
      const res = await fetch("/api/hid-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: {} }),
      }).then((r) => r.json());
      if (res?.error) {
        setBusy(null);
        showToast(res.error, "err");
      } else {
        await load();
        flashDone("追加しました");
      }
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    }
  };

  // 1セルの変更を保存（フィールド単位で PATCH）
  const saveField = async (id, key, value) => {
    setItems((list) =>
      (list || []).map((it) => (it.id === id ? { ...it, fields: { ...it.fields, [key]: value } } : it))
    );
    try {
      const res = await fetch("/api/hid-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, fields: { [key]: value } }),
      }).then((r) => r.json());
      if (res?.error) showToast(res.error, "err");
    } catch (e) {
      showToast(String(e?.message || e), "err");
    }
  };

  const doDelete = async () => {
    if (!delTarget) return;
    setSaving(true);
    setBusy("削除中…");
    try {
      await fetch(`/api/hid-requests?id=${encodeURIComponent(delTarget.id)}`, { method: "DELETE" }).catch(() => {});
      setDelTarget(null);
      await load();
      flashDone("削除しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wrap page-compact forms-page">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="HID新規発行依頼" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M7 15h0M2 9h20" />
            </svg>
          </span>
          <span className="page-h page-h-gap">HID新規発行依頼</span>
          {items && (
            <span className="forms-count-pill">{items.length.toLocaleString("ja-JP")} 件</span>
          )}
        </div>
        <div className="head-right">
          {canEdit && (
            <button className="icon-btn" onClick={addRow} title="行を追加" aria-label="行を追加">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
          <button className="icon-btn" onClick={load} disabled={loading} title="再読み込み" aria-label="再読み込み">
            <svg className={loading ? "spin" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      ) : (items || []).length === 0 ? (
        <div className="card">
          <div className="notice">
            まだ依頼がありません。
            {canEdit ? "右上の＋から行を追加してください。" : "編集権限のあるユーザーが追加すると、ここに表示されます。"}
          </div>
        </div>
      ) : (
        <div className="card no-pad">
          <div className="tw forms-tw">
            <table className="hid-table">
              <thead>
                <tr>
                  <th className="forms-rownum">#</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} style={{ minWidth: c.w }}>{c.label}</th>
                  ))}
                  {canEdit && <th className="hid-opcol" />}
                </tr>
              </thead>
              <tbody>
                {items.map((it, ri) => (
                  <tr key={it.id}>
                    <td className="forms-rownum">{ri + 1}</td>
                    {COLUMNS.map((c) => {
                      const v = it.fields?.[c.key] ?? "";
                      if (!canEdit) {
                        return (
                          <td key={c.key} className={c.type === "check" ? "wr-center" : undefined} title={c.type === "check" ? undefined : v || undefined}>
                            {c.type === "check" ? (v ? "✓" : "") : v}
                          </td>
                        );
                      }
                      if (c.type === "check") {
                        return (
                          <td key={c.key} className="wr-center">
                            <input
                              type="checkbox"
                              className="wr-chk"
                              checked={!!v}
                              onChange={(e) => saveField(it.id, c.key, e.target.checked)}
                              aria-label={c.label}
                            />
                          </td>
                        );
                      }
                      if (c.type === "select") {
                        return (
                          <td key={c.key}>
                            <select
                              className="wr-input hid-select"
                              value={v}
                              onChange={(e) => saveField(it.id, c.key, e.target.value)}
                            >
                              <option value="">—</option>
                              {c.options.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          </td>
                        );
                      }
                      if (c.type === "date") {
                        return (
                          <td key={c.key} className="wr-center">
                            <input
                              type="date"
                              className="wr-input wr-date"
                              value={v}
                              onChange={(e) => saveField(it.id, c.key, e.target.value)}
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={c.key}>
                          <input
                            type="text"
                            className="wr-input"
                            defaultValue={v}
                            placeholder="—"
                            onBlur={(e) => {
                              if ((e.target.value || "") !== (v || "")) saveField(it.id, c.key, e.target.value);
                            }}
                          />
                        </td>
                      );
                    })}
                    {canEdit && (
                      <td className="hid-opcol">
                        <button className="forms-op danger" onClick={() => setDelTarget(it)} title="削除" aria-label="削除">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!delTarget}
        title="依頼の削除"
        onClose={() => setDelTarget(null)}
        footer={
          <>
            <button className="mini-btn" onClick={() => setDelTarget(null)} disabled={saving}>キャンセル</button>
            <button className="save-btn danger-btn" onClick={doDelete} disabled={saving}>削除する</button>
          </>
        }
      >
        この行を削除します。よろしいですか？
      </Modal>
    </div>
  );
}
