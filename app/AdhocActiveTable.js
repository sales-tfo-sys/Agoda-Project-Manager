"use client";

import { useEffect, useMemo, useState } from "react";

// 進行中の Ad Hoc タスク（On Track / Behind）を読み取り専用で出す表。
// 完了（Complete）・保留（Onhold）・進捗が未設定のものは出さない。
//
// ※列と値の出し方は app/TaskBoard.js の Ad Hoc 一覧と同じ規則にしてある。
//   あちらを直したらこちらも合わせること（列・優先順の決め方）。
//   ここは見るだけなので、編集まわり（優先順のドラッグ・シート連携の設定等）は持たない。

// ここに出す進捗。完了（Complete）・保留（Onhold）・未設定は出さない。
const ACTIVE_STATUS = ["On Track", "Behind"];

// 列幅の目安。TaskBoard の ADHOC_COLS と同じ並び（null は伸び縮みする列）。
// この表は横スクロールさせずに画面の幅へ収めたいので、
// px ではなく「全体に対する割合」に直して使う。こうすると画面が狭くても
// 全部の列が見えたまま、比率を保って縮む。
const ADHOC_COLS = [50, 330, 106, 106, 70, 70, 70, 66, 96, 116, 92, null, null, 78, 118, 240];
const FLEX_W = 160; // 伸び縮みする列の目安
const ADHOC_TOTAL = ADHOC_COLS.reduce((a, b) => a + (b == null ? FLEX_W : b), 0);
const colPct = (w) => `${(((w == null ? FLEX_W : w) / ADHOC_TOTAL) * 100).toFixed(4)}%`;

function statusClass(st) {
  if (st === "Complete") return "st-done";
  if (st === "Onhold") return "st-hold";
  if (st === "Behind") return "st-behind";
  if (!st) return "st-none";
  return "st-ontrack";
}

function num(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("ja-JP") : "—";
  const n = Number(String(v).replace(/,/g, "").trim());
  return String(v).trim() !== "" && Number.isFinite(n) ? n.toLocaleString("ja-JP") : v;
}

const cell = (v) => (v === null || v === undefined || v === "" ? "—" : v);

export function useAdhocActive() {
  const [state, setState] = useState({ loading: true, rows: [], error: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const get = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json());
        const [aj, cj, oj, nj, gj, pj] = await Promise.all([
          get("/api/adhoc").catch(() => null),
          get("/api/adhoc-tasks").catch(() => null),
          get("/api/override").catch(() => null),
          get("/api/adhoc-counts").catch(() => null),
          get("/api/assign").catch(() => null),
          get("/api/priority").catch(() => null),
        ]);
        if (!alive) return;

        const adhoc = aj && !aj.error ? aj.tasks || [] : [];
        const custom = cj?.tasks || [];
        const ov = {};
        for (const it of oj?.items || []) {
          if (it.scope === "adhoc") ov[it.key] = it.data || {};
        }
        const counts = nj?.items || {};
        // 優先順。一度も設定していないものだけ、シート由来の # を使う（TaskBoard と同じ）
        const prio = {};
        for (const it of pj?.items || []) {
          if (it.scope === "adhoc") prio[it.key] = it.priority;
        }
        const prioOf = (t) => (prio[t.task] === undefined ? t.no ?? null : prio[t.task]);
        const personById = new Map((gj?.persons || []).map((p) => [p.id, p]));
        const assignOf = {};
        for (const it of gj?.items || []) {
          if (it.scope !== "adhoc") continue;
          (assignOf[it.key] = assignOf[it.key] || []).push(it.person_id);
        }

        // シート由来＋サイトで追加したタスク（重複はシート側を優先）
        const merged = [
          ...adhoc,
          ...custom
            .filter((c) => !adhoc.some((a) => a.task === c.task))
            .map((c) => ({ task: c.task, customId: c.id })),
        ];

        // 進行中（On Track / Behind）だけ。完了・保留・未設定は出さない。
        const active = merged.filter((t) => {
          const st = (ov[t.task] || {}).status ?? t.status;
          return ACTIVE_STATUS.includes(st);
        });

        // 並びはダッシュボードの「対応中」と同じ：優先順、同じ優先順の中は手で決めた順（seq）
        const seqOf = (t) => {
          const v = (ov[t.task] || {}).seq;
          const n = Number(v);
          return v != null && Number.isFinite(n) ? n : null;
        };
        const byPriority = (a, b) => {
          const pa = prioOf(a) == null ? Infinity : prioOf(a);
          const pb = prioOf(b) == null ? Infinity : prioOf(b);
          if (pa !== pb) return pa - pb;
          const sa = seqOf(a);
          const sb = seqOf(b);
          if (sa == null && sb == null) return 0;
          if (sa == null) return 1;
          if (sb == null) return -1;
          return sa - sb;
        };

        const rows = [...active]
          .sort(byPriority)
          .map((t) => {
            const o = ov[t.task] || {};
            const val = (k, src) => (o[k] !== undefined ? o[k] : src);
            // 受注数・完了数は「シート連携＞サイト入力＞シート由来」の順で出す。
            // 連携があるときは残件数・進捗率も自動計算する。
            const sc = counts[t.task];
            const scTotal = sc && sc.total != null ? sc.total : null;
            const scDone = sc && sc.done != null ? sc.done : null;
            const hasSheet = scTotal != null || scDone != null;
            const ids = assignOf[t.task] || [];
            const names = ids.map((id) => personById.get(id)).filter(Boolean);
            const nTotal = Number(val("total", t.total));
            const nDone = Number(val("done", t.done));
            const hasCount = Number.isFinite(nTotal) && Number.isFinite(nDone);
            // シート連携のURL。https のものだけボタンにする（変な値を踏まないように）
            const sheetUrl =
              typeof o.sheetUrl === "string" && /^https:\/\//i.test(o.sheetUrl) ? o.sheetUrl : null;
            return {
              task: t.task,
              prio: prioOf(t),
              sheetUrl,
              name: val("name", t.task),
              start: val("start", t.start),
              end: val("end", t.end),
              total: hasSheet ? scTotal : val("total", t.total),
              done: hasSheet ? scDone : val("done", t.done),
              rest:
                scTotal != null && scDone != null
                  ? scTotal - scDone
                  : t.customId
                  ? hasCount
                    ? nTotal - nDone
                    : null
                  : t.rest,
              pct:
                scTotal != null && scDone != null && scTotal > 0
                  ? `${Math.round((scDone / scTotal) * 100)}%`
                  : t.customId
                  ? hasCount && nTotal > 0
                    ? `${Math.round((nDone / nTotal) * 100)}%`
                    : "—"
                  : t.pct,
              auto: hasSheet,
              status: val("status", t.status),
              daily: val("daily", t.daily),
              effort: val("effort", t.effort),
              issue: val("issue", t.issue),
              next: val("next", t.next),
              people: names.length ? names.length : t.people,
              names: names.length ? names : null,
              pic: t.pic,
              memo: val("memo", t.memo),
            };
          });

        setState({ loading: false, rows, error: null });
      } catch (e) {
        if (alive) setState({ loading: false, rows: [], error: String(e?.message || e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

export default function AdhocActiveTable({ rows }) {
  const list = useMemo(() => rows || [], [rows]);
  return (
    <div className="qcard adhoc-card">
      <div className="dtw adhoc-tw">
        <table className="dtable adhoc-table" style={{ width: "100%" }}>
          <colgroup>
            {ADHOC_COLS.map((w, ci) => (
              <col key={ci} style={{ width: colPct(w) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="prio-th">優先</th>
              <th className="l">タスク</th>
              <th>開始</th>
              <th>期日</th>
              <th>受注数</th>
              <th>完了数</th>
              <th>残件数</th>
              <th>進捗率</th>
              <th>進捗</th>
              <th>
                目標対応件数<small>(Daily)</small>
              </th>
              <th>実作業工数</th>
              <th className="l">課題・遅延理由</th>
              <th className="l">次回アクション</th>
              <th>対応人数</th>
              <th className="l">対応者</th>
              <th className="l">メモ</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.task + i}>
                <td className="prio-td">
                  <span className="prio-view">{r.prio ?? "—"}</span>
                </td>
                <td className="l tname" title={r.name}>
                  <span className="tname-view">
                    <span className="tname-text">{r.name}</span>
                    {r.sheetUrl && (
                      <a
                        className="tname-sheet"
                        href={r.sheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={"スプレッドシートを開く\n" + r.sheetUrl}
                        aria-label={`${r.name} のスプレッドシートを開く`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <line x1="3" y1="9" x2="21" y2="9" />
                          <line x1="9" y1="9" x2="9" y2="21" />
                        </svg>
                      </a>
                    )}
                  </span>
                </td>
                <td className="period">{cell(r.start)}</td>
                <td className="period">{cell(r.end)}</td>
                <td className={r.auto ? "v-auto" : ""}>{num(r.total)}</td>
                <td className={r.auto ? "v-auto" : ""}>{num(r.done)}</td>
                <td>{num(r.rest)}</td>
                <td className="c-rate">
                  <span className="prog-val">{cell(r.pct)}</span>
                </td>
                <td>
                  <span className={"st-pill " + statusClass(r.status)}>{r.status || "—"}</span>
                </td>
                <td>{num(r.daily)}</td>
                <td className="nowrap">{cell(r.effort)}</td>
                <td className="l wrapcell" title={r.issue}>
                  {cell(r.issue)}
                </td>
                <td className="l wrapcell" title={r.next}>
                  {cell(r.next)}
                </td>
                <td className={r.names ? "v-auto" : ""}>{num(r.people)}</td>
                <td className="l nowrap asg-td">
                  {r.names
                    ? r.names.map((p) => (
                        <span
                          key={p.id}
                          className={"mng-asg-name" + (p.active === false ? " gone" : "")}
                          title={p.active === false ? `${p.name}（退職）` : undefined}
                        >
                          {p.name}
                        </span>
                      ))
                    : cell(r.pic)}
                </td>
                <td className="l wrapcell" title={r.memo}>
                  {cell(r.memo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
