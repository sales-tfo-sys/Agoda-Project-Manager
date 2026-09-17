"use client";

import { useCallback, useEffect, useState } from "react";
import { useUi } from "../Ui";

// 月1回の「AI健康診断」。
// Supabase の Security / Performance の点検は Supabase の管理画面で行うので、
// ここでは「今月やったか」「前回いつ・誰が・何が出たか」を残して、やり忘れを防ぐ。

const CHECKS = [
  {
    kind: "security",
    label: "セキュリティ点検",
    tab: "security",
    lead: "権限の抜け漏れや、誰でも読める設定になっていないかを見ます。",
    prompt:
      "このプロジェクトのセキュリティ上の問題を点検してください。" +
      "行レベルセキュリティ（RLS）が無効なテーブル、公開されているビュー、" +
      "権限が広すぎるポリシー、漏れているインデックスや制約があれば、" +
      "危険度の高い順に、影響と直し方を日本語で説明してください。",
  },
  {
    kind: "performance",
    label: "パフォーマンス点検",
    tab: "performance",
    lead: "時間のかかっているデータ取得（遅いクエリ）や、足りないインデックスを見ます。",
    prompt:
      "このプロジェクトのパフォーマンスを点検してください。" +
      "実行時間の長いクエリ、使われていないインデックス、足りないインデックス、" +
      "肥大化しているテーブルがあれば、影響の大きい順に、" +
      "原因と改善案を日本語で説明してください。",
  },
];

const fmt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
};

export default function AiHealth({ canEdit }) {
  const [data, setData] = useState(null); // { items, month, ref }
  const [open, setOpen] = useState(null); // 記録を書いている点検 { kind, note }
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const { flashDone, showToast, setBusy } = useUi();

  // ボタンひとつで点検して、結果を残す
  const run = async () => {
    if (running) return;
    setRunning(true);
    setBusy("診断中…");
    try {
      const j = await fetch("/api/ai-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: true }),
      }).then((r) => r.json());
      if (j.error) {
        setBusy(null);
        showToast(j.error, "err");
      } else {
        flashDone(j.total ? `${j.total} 件の指摘が見つかりました` : "指摘はありませんでした");
        load();
      }
    } catch (e) {
      setBusy(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setRunning(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const j = await fetch("/api/ai-health", { cache: "no-store" }).then((r) => r.json());
      setData(j);
    } catch {
      setData({ items: [] });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const month = data?.month || "";
  const thisMonth = (data?.items || []).find((x) => x.month === month) || {};
  const last = (kind) => {
    const hit = (data?.items || []).find((x) => x[kind]?.at);
    return hit ? { month: hit.month, ...hit[kind] } : null;
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      flashDone("コピーしました");
    } catch {
      showToast("コピーできませんでした", "err");
    }
  };

  const save = async () => {
    if (!open || saving) return;
    setSaving(true);
    try {
      const j = await fetch("/api/ai-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, kind: open.kind, note: open.note }),
      }).then((r) => r.json());
      if (j.error) showToast(j.error, "err");
      else {
        setOpen(null);
        flashDone("記録しました");
        load();
      }
    } catch (e) {
      showToast(String(e?.message || e), "err");
    } finally {
      setSaving(false);
    }
  };

  const linkFor = (tab) =>
    data?.ref
      ? `https://supabase.com/dashboard/project/${data.ref}/advisors/${tab}`
      : "https://supabase.com/dashboard";

  return (
    <section className="sh-panel">
      <h2 className="sh-h">
        AI健康診断（月1回）
        {data && (
          <span className={"aih-badge " + (thisMonth.security && thisMonth.performance ? "ok" : "todo")}>
            {thisMonth.security && thisMonth.performance ? "今月は実施済み" : "今月はまだです"}
          </span>
        )}
      </h2>
      <div className="aih-top">
        <p className="aih-lead">
          「いま診断する」を押すと、データベースを読み取って点検し、結果をここに残します（書き込みはしません）。
          より詳しく見たいときは、Supabase の画面を開いて文面を貼ってください。
        </p>
        {canEdit && (
          <button type="button" className="save-btn" onClick={run} disabled={running}>
            {running ? "診断中…" : "いま診断する"}
          </button>
        )}
      </div>

      <div className="aih-grid">
        {CHECKS.map((c) => {
          const done = thisMonth[c.kind];
          const prev = last(c.kind);
          return (
            <div className={"aih-card" + (done ? " done" : "")} key={c.kind}>
              <div className="aih-card-h">
                <b>{c.label}</b>
                <span className={"aih-state " + (done ? "ok" : "todo")}>
                  {done ? `${fmt(done.at)} 実施${done.findings ? `／指摘 ${done.findings.length} 件` : ""}` : "未実施"}
                </span>
              </div>
              <p className="aih-card-lead">{c.lead}</p>
              <div className="aih-ops">
                <a className="mini-btn" href={linkFor(c.tab)} target="_blank" rel="noreferrer">
                  Supabase を開く
                </a>
                <button type="button" className="mini-btn" onClick={() => copy(c.prompt)}>
                  文面をコピー
                </button>
                {canEdit && (
                  <button
                    type="button"
                    className="save-btn sm"
                    onClick={() => setOpen({ kind: c.kind, note: done?.note || "" })}
                  >
                    {done ? "記録を直す" : "実施を記録"}
                  </button>
                )}
              </div>
              {open?.kind === c.kind ? (
                <div className="aih-form">
                  <textarea
                    rows={3}
                    value={open.note}
                    onChange={(e) => setOpen((v) => ({ ...v, note: e.target.value }))}
                    placeholder="出てきた指摘と、対応したこと（例：RLS未設定の指摘なし／遅いクエリ1件、インデックス追加で対応）"
                  />
                  <div className="aih-form-ops">
                    <button type="button" className="mini-btn" onClick={() => setOpen(null)} disabled={saving}>
                      やめる
                    </button>
                    <button type="button" className="save-btn sm" onClick={save} disabled={saving}>
                      {saving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="aih-last">
                  {done?.findings ? (
                    done.findings.length === 0 ? (
                      <span className="aih-ok">指摘はありませんでした。</span>
                    ) : (
                      <ul className="aih-finds">
                        {done.findings.map((f, i) => (
                          <li key={i} className={"lv-" + (f.level || "low")}>
                            <span className="aih-lv">
                              {f.level === "high" ? "重大" : f.level === "med" ? "注意" : "軽微"}
                            </span>
                            <span className="aih-ft">
                              <b>{f.title}</b>
                              {f.target && <em>{f.target}</em>}
                              <span>{f.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : done?.note ? (
                    <span className="aih-note">{done.note}</span>
                  ) : prev ? (
                    <span className="aih-prev">
                      前回：{prev.month}（{fmt(prev.at)}{prev.by ? " " + prev.by : ""}）
                      {prev.note ? `／${prev.note}` : ""}
                    </span>
                  ) : (
                    <span className="aih-prev">記録はまだありません。</span>
                  )}
                  {done?.note && done?.findings && <span className="aih-note">{done.note}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
