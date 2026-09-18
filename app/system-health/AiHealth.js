"use client";

import { useCallback, useEffect, useState } from "react";
import { useUi } from "../Ui";

// 月1回の「AI健康診断」。
// ボタンを押すと Supabase 公式の Advisors で点検し、出てきた指摘をその月の記録として残す
// （トークンが無いときだけ、予備の自作SQLで点検）。毎月1日にも自動で走る。書き込みはしない。

const CHECKS = [
  { kind: "security", label: "セキュリティ点検" },
  { kind: "performance", label: "パフォーマンス点検" },
];

const fmt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
};

export default function AiHealth({ canEdit }) {
  const [data, setData] = useState(null); // { items, month }
  const [running, setRunning] = useState(false);
  const { flashDone, showToast, setBusy } = useUi();

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
  const doneThisMonth = !!(thisMonth.security && thisMonth.performance);

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

  return (
    <section className="sh-panel">
      <h2 className="sh-h">
        AI健康診断（月1回）
        {data && (
          <span className={"aih-badge " + (doneThisMonth ? "ok" : "todo")}>
            {doneThisMonth ? "今月は実施済み" : "今月はまだです"}
          </span>
        )}
        {canEdit && (
          <button type="button" className="save-btn sm aih-run" onClick={run} disabled={running}>
            {running ? "診断中…" : "診断"}
          </button>
        )}
      </h2>

      <div className="aih-grid">
        {CHECKS.map((c) => {
          const done = thisMonth[c.kind];
          const finds = done?.findings;
          return (
            <div className={"aih-card" + (done ? " done" : "")} key={c.kind}>
              <div className="aih-card-h">
                <b>{c.label}</b>
                <span className={"aih-state " + (done ? "ok" : "todo")}>
                  {done
                    ? `${fmt(done.at)} 実施${finds ? `／指摘 ${finds.length} 件` : ""}${
                        done.source === "sql" ? "（予備の点検）" : ""
                      }`
                    : "未実施"}
                </span>
              </div>
              <div className="aih-last">
                {!done ? (
                  <span className="aih-prev">まだ診断していません。</span>
                ) : !finds ? (
                  <span className="aih-note">{done.note || "—"}</span>
                ) : finds.length === 0 ? (
                  <span className="aih-ok">指摘はありませんでした。</span>
                ) : (
                  <ul className="aih-finds">
                    {finds.map((f, i) => (
                      <li key={i} className={"lv-" + (f.level || "low")}>
                        <span className="aih-lv">
                          {f.level === "high" ? "重大" : f.level === "med" ? "注意" : "軽微"}
                        </span>
                        <span className="aih-ft">
                          <b>
                            {f.title}
                            {/* 対訳がずれても取り違えないよう、API の名前を必ず添える */}
                            {f.apiName && <code className="aih-code">{f.apiName}</code>}
                          </b>
                          {f.target && <em>{f.target}</em>}
                          <span>{f.detail}</span>
                          {f.remediation && /^https:\/\//.test(f.remediation) && (
                            <a className="aih-fix" href={f.remediation} target="_blank" rel="noreferrer">
                              直し方（Supabase の説明）
                            </a>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
