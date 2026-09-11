"use client";

import { useEffect, useMemo, useState } from "react";

// ダッシュボード「進捗表 → Ad Hoc Task → 完了」に出ているタスクを、そのまま読み取り専用で出す表。
//
// ※仕分けと値の出し方は app/TaskBoard.js の Ad Hoc 一覧と同じ規則にしてある。
//   あちらを直したらこちらも合わせること（列・優先順・完了当日の扱い）。
//   ここは見るだけなので、編集まわり（優先順のドラッグ・シート連携の設定等）は持たない。

// 列幅は TaskBoard の ADHOC_COLS と同じ
const ADHOC_COLS = [50, 330, 106, 106, 70, 70, 70, 66, 96, 116, 92, null, null, 78, 118, 240];
const FLEX_MIN = 160;
const ADHOC_W = ADHOC_COLS.reduce((a, b) => a + (b == null ? FLEX_MIN : b), 0);

function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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

export function useAdhocDone() {
  const [state, setState] = useState({ loading: true, rows: [], error: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const get = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json());
        const [aj, cj, oj, nj, gj] = await Promise.all([
          get("/api/adhoc").catch(() => null),
          get("/api/adhoc-tasks").catch(() => null),
          get("/api/override").catch(() => null),
          get("/api/adhoc-counts").catch(() => null),
          get("/api/assign").catch(() => null),
        ]);
        if (!alive) return;

        const adhoc = aj && !aj.error ? aj.tasks || [] : [];
        const custom = cj?.tasks || [];
        const ov = {};
        for (const it of oj?.items || []) {
          if (it.scope === "adhoc") ov[it.key] = it.data || {};
        }
        const counts = nj?.items || {};
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

        // 完了にした当日だけは、まだ「完了」に移さない（ダッシュボードと同じ規則）
        const today = todayKey();
        const done = merged.filter((t) => {
          const o = ov[t.task] || {};
          const st = o.status ?? t.status;
          return st === "Complete" && o.completedOn !== today;
        });

        // 完了は開始日の新しい順
        const startKey = (t) => {
          const s = (ov[t.task] || {}).start ?? t.start;
          const m = s && String(s).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
          return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : -Infinity;
        };

        const rows = [...done]
          .sort((a, b) => startKey(b) - startKey(a))
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
            return {
              task: t.task,
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

export default function AdhocDoneTable({ rows }) {
  const list = useMemo(() => rows || [], [rows]);
  return (
    <div className="qcard adhoc-card">
      <div className="dtw adhoc-tw">
        <table className="dtable adhoc-table" style={{ width: "100%", minWidth: ADHOC_W }}>
          <colgroup>
            {ADHOC_COLS.map((w, ci) => (
              <col key={ci} style={w == null ? undefined : { width: w }} />
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
              <tr key={r.task + i} className="row-done">
                {/* 完了したタスクは優先順を持たない */}
                <td className="prio-td">
                  <span className="prio-none">—</span>
                </td>
                <td className="l tname" title={r.name}>
                  <span className="tname-view">
                    <span className="tname-text">{r.name}</span>
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
