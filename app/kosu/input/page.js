"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUi } from "../../Ui";

// Regular task は従来どおり固定表示（完了・対応者による絞り込みの対象外）
function isRegular(t) {
  return /regular/i.test(t?.task_type || "");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function KosuInputPage() {
  const [configured, setConfigured] = useState(null);
  const [persons, setPersons] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [values, setValues] = useState({}); // { taskId: { personId: value } }（Ad Hoc は稼働時間）
  const [counts, setCounts] = useState({}); // { taskId: { personId: 完了数 } }（Ad Hoc のみ）
  const [initial, setInitial] = useState({}); // 読み込み時の値（削除判定用）
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { setBusy, showToast } = useUi();
  // ダッシュボードのアサイン・進捗（作業内容ごと）
  const [link, setLink] = useState({ idsByContent: {}, statusByContent: {}, completedAtByContent: {}, startByContent: {}, endByContent: {}, ready: true });
  // ログイン中の利用者（管理者以外は自分ぶんだけ入力できる）
  const [me, setMe] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({}));
  }, []);

  // 日付は見た目を自前で描き、カレンダーだけ隠した input から呼び出す
  const dateRef = useRef(null);
  const openPicker = () => {
    const el = dateRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        /* 非対応・ジェスチャ外なら下のフォールバックへ */
      }
    }
    el.focus();
    el.click();
  };

  // マスタ（状態・担当・作業）を読み込み。未接続時はシートから作業内容を種取り。
  const loadMasters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const st = await fetch("/api/kosu-status", { cache: "no-store" }).then((r) => r.json());
      setConfigured(st.configured);
      setPersons(st.persons || []);
      if (st.configured) {
        const [t, asg, ovr, adh] = await Promise.all([
          fetch("/api/kosu-tasks", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/assign", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
          fetch("/api/override", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
          fetch("/api/adhoc", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        ]);
        setTasks(
          (t.tasks || []).map((x) => ({
            id: x.id,
            task_type: x.task_type,
            content: x.content,
            unit: x.unit,
            completed: !!x.completed,
            completed_on: x.completed_on,
          }))
        );

        // ダッシュボードの「対応者」と「進捗」を作業内容に紐づける。
        // ・改名した作業は task_override の name、集約した作業は kosuLink が紐づけ先。
        const renamed = {}; // 元のタスク名 → 変更後の名称
        const linkedTo = {}; // 元のタスク名 → 集約先の作業内容
        const ovStatus = {};
        const ovUpdated = {};
        const ovStart = {};
        const ovEnd = {};
        for (const it of ovr?.items || []) {
          if (it.scope !== "adhoc") continue;
          if (it?.data?.name) renamed[it.key] = it.data.name;
          if (it?.data?.kosuLink) linkedTo[it.key] = it.data.kosuLink;
          if (it?.data?.status) {
            ovStatus[it.key] = it.data.status;
            ovUpdated[it.key] = it.updated_at;
          }
          if (it?.data?.start) ovStart[it.key] = it.data.start;
          if (it?.data?.end) ovEnd[it.key] = it.data.end;
        }
        const sheetStatus = {};
        const sheetUpdated = {};
        const sheetStart = {};
        const sheetEnd = {};
        for (const a of adh?.tasks || []) {
          sheetStatus[a.task] = a.status;
          sheetUpdated[a.task] = a.updated_at;
          sheetStart[a.task] = a.start;
          sheetEnd[a.task] = a.end;
        }
        const statusOf = (k) => ovStatus[k] ?? sheetStatus[k] ?? null;
        const updatedOf = (k) => ovUpdated[k] ?? sheetUpdated[k] ?? null;
        const startOf = (k) => ovStart[k] ?? sheetStart[k] ?? null;
        const endOf = (k) => ovEnd[k] ?? sheetEnd[k] ?? null;

        // 作業内容 → 担当者ID / 紐づくタスクの進捗
        const idsByContent = {};
        const statusByContent = {};
        const completedAtByContent = {};
        const startByContent = {};
        const endByContent = {};
        const targetsOf = (key) => {
          // 集約先が指定されていればそこだけ、無ければ元の名前と改名後の両方に効かせる
          if (linkedTo[key]) return [linkedTo[key]];
          return renamed[key] ? [key, renamed[key]] : [key];
        };
        for (const it of asg?.items || []) {
          for (const c of targetsOf(it.key)) {
            if (!idsByContent[c]) idsByContent[c] = [];
            if (!idsByContent[c].includes(it.person_id)) idsByContent[c].push(it.person_id);
          }
        }
        for (const key of new Set([
          ...Object.keys(sheetStatus),
          ...Object.keys(ovStatus),
          ...Object.keys(linkedTo),
          ...(asg?.items || []).map((i) => i.key),
        ])) {
          for (const c of targetsOf(key)) {
            if (!statusByContent[c]) statusByContent[c] = [];
            statusByContent[c].push(statusOf(key));
            if (!completedAtByContent[c]) completedAtByContent[c] = [];
            completedAtByContent[c].push(updatedOf(key));
            if (!startByContent[c]) startByContent[c] = [];
            startByContent[c].push(startOf(key));
            if (!endByContent[c]) endByContent[c] = [];
            endByContent[c].push(endOf(key));
          }
        }
        setLink({ idsByContent, statusByContent, completedAtByContent, startByContent, endByContent, ready: asg?.ready !== false });
      } else {
        // デモ：工数管理シートの行から作業内容を種取り
        const k = await fetch("/api/kosu", { cache: "no-store" }).then((r) => r.json());
        const seen = new Set();
        const seed = [];
        for (const r of k.rows || []) {
          const key = r.type + "|" + r.detail;
          if (seen.has(key)) continue;
          seen.add(key);
          seed.push({ id: "demo-" + seed.length, task_type: r.type, content: r.detail, unit: r.unit });
        }
        setTasks(seed);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  // 日付の既存入力を読み込み（接続時のみ）
  const loadEntries = useCallback(async () => {
    if (!configured) {
      setValues({});
      setCounts({});
      setInitial({});
      return;
    }
    try {
      const j = await fetch(`/api/kosu-entries?date=${date}`, { cache: "no-store" }).then((r) => r.json());
      const v = {};
      const c = {};
      for (const e of j.entries || []) {
        v[e.task_id] = v[e.task_id] || {};
        v[e.task_id][e.person_id] = e.value;
        if (e.done_count != null) {
          c[e.task_id] = c[e.task_id] || {};
          c[e.task_id][e.person_id] = e.done_count;
        }
      }
      setValues(v);
      setCounts(c);
      // 削除判定は value / count の両方を基準にする
      setInitial({ values: JSON.parse(JSON.stringify(v)), counts: JSON.parse(JSON.stringify(c)) });
    } catch {
      setValues({});
      setCounts({});
      setInitial({});
    }
  }, [configured, date]);

  useEffect(() => {
    if (configured != null) loadEntries();
  }, [configured, date, loadEntries]);

  const setVal = (taskId, person, raw) => {
    setValues((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] || {}), [person]: raw },
    }));
  };
  const setCnt = (taskId, person, raw) => {
    setCounts((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] || {}), [person]: raw },
    }));
  };

  // 作業ごとの担当者ID。アサインが1件も無いとき（未設定・テーブル未作成）は
  // 画面が空になってしまうので、その場合だけ従来どおり全員を対象にする。
  const noAssign = Object.keys(link.idsByContent).length === 0;
  const assigneesOf = useCallback(
    (t) => link.idsByContent[t.content] || [],
    [link]
  );

  // ログイン中がオーナー／管理者か（保護オフ＝未ログインも管理扱い）。
  // 管理者・オーナーは「メンバー全員」の入力欄を編集できる。
  const isManager = !me?.user || ["owner", "admin"].includes(me.user.role);
  const myId = me?.user?.personId || null;
  // メンバー本人は自分ぶんだけ
  const selfOnly = !isManager && myId ? myId : null;

  // 表示する作業：
  //  ・Regular task は従来どおり常に固定表示（完了・担当の絞り込みをしない）
  //  ・Ad Hoc task は完了（Complete）を除外し、対応者が付いているものだけ
  //    ※ただし、タスクの開始日〜期日（完了日）の範囲内の対象日を選んでいる場合は入力可能にする
  //  ・管理者以外は、自分が対応者になっている Ad Hoc だけ
  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (isRegular(t)) return true;

      let isCompleted = false;
      let compDate = null;
      if (t.completed) {
        isCompleted = true;
        compDate = t.completed_on ? String(t.completed_on).slice(0, 10) : null;
      }
      const sts = link.statusByContent[t.content];
      if (sts && sts.length > 0 && sts.every((s) => s === "Complete")) {
        isCompleted = true;
        const dts = link.completedAtByContent[t.content];
        let maxD = null;
        if (dts) {
          for (const d of dts) {
            if (d && (!maxD || d > maxD)) maxD = d;
          }
        }
        if (maxD) compDate = String(maxD).slice(0, 10);
      }

      const starts = link.startByContent[t.content] || [];
      const ends = link.endByContent[t.content] || [];
      
      const parseIso = (s) => {
        if (!s) return null;
        const m = String(s).match(/(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})/);
        return m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : null;
      };

      let minStart = null, maxEnd = null;
      for (const s of starts) {
        const d = parseIso(s);
        if (d && (!minStart || d < minStart)) minStart = d;
      }
      for (const e of ends) {
        const d = parseIso(e);
        if (d && (!maxEnd || d > maxEnd)) maxEnd = d;
      }

      // 期日が未設定の場合、完了していればその完了日を期日とみなす
      let effEnd = maxEnd;
      if (!effEnd && isCompleted) effEnd = compDate;

      const dStr = parseIso(date) || date;

      // 開始日より前なら隠す（未完了・完了問わず）
      if (minStart && dStr < minStart) {
        return false;
      }

      if (isCompleted) {
        // 完了済みの場合、期日（または完了日）より後なら隠す
        if (effEnd && dStr > effEnd) {
          return false;
        }
        // 完了済みで期間設定が一切ない場合は、安全のためそのまま隠すか判断が必要ですが、
        // 現状は上の期間チェックを抜ければ表示されます。
      }

      if (noAssign) return true;
      const ids = link.idsByContent[t.content] || [];
      if (ids.length === 0) return false;
      return selfOnly ? ids.includes(selfOnly) : true;
    });
  }, [tasks, link, noAssign, selfOnly, date]);

  // 表示する担当者：オーナー・管理者は入力対象に含めない（メンバーのみ）。
  // メンバー本人がログイン中は自分の列だけ。
  // Regular task は全員が入力するため、1件でも表示されていれば全員を出す。
  const visiblePersons = useMemo(() => {
    const members = persons.filter(
      (p) => !["owner", "admin"].includes(p.role || "member")
    );
    if (selfOnly) return members.filter((p) => p.id === selfOnly);
    if (noAssign) return members;
    if (visibleTasks.some(isRegular)) return members;
    const used = new Set();
    for (const t of visibleTasks) for (const id of link.idsByContent[t.content] || []) used.add(id);
    return members.filter((p) => used.has(p.id));
  }, [persons, visibleTasks, link, noAssign, selfOnly]);

  const isAssigned = useCallback(
    (t, personId) => isRegular(t) || noAssign || assigneesOf(t).includes(personId),
    [assigneesOf, noAssign]
  );

  const grouped = useMemo(() => {
    const order = [];
    const by = {};
    for (const t of visibleTasks) {
      if (!by[t.task_type]) {
        by[t.task_type] = [];
        order.push(t.task_type);
      }
      by[t.task_type].push(t);
    }
    // Regular task を上、Ad Hoc task を下に固定して並べる
    const rank = (type) => (isRegular({ task_type: type }) ? 0 : /ad\s*hoc/i.test(type || "") ? 2 : 1);
    order.sort((a, b) => rank(a) - rank(b));
    return order.map((type) => ({ type, rows: by[type] }));
  }, [visibleTasks]);

  const dayTotal = (personId) => {
    let s = 0;
    for (const t of visibleTasks) {
      if (!isAssigned(t, personId)) continue;
      const v = Number(values[t.id]?.[personId]);
      if (!Number.isNaN(v)) s += v;
    }
    return Math.round(s * 10) / 10;
  };

  const save = async () => {
    if (!configured) {
      showToast("デモモードのため保存されません（Supabase未接続）", "warn");
      return;
    }
    setSaving(true);
    setBusy("保存中…");
    setError(null);
    try {
      const entries = [];
      const blank = (x) => x === "" || x == null;
      const iv = initial.values || {};
      const ic = initial.counts || {};
      // 画面に出ている作業・担当者ぶんだけを送る（他人の実績には触れない）
      for (const t of visibleTasks) {
        const adhoc = !isRegular(t);
        const vrow = values[t.id] || {};
        const crow = counts[t.id] || {};
        for (const p of visiblePersons) {
          if (!isAssigned(t, p.id)) continue;
          const rawV = vrow[p.id];
          const rawC = adhoc ? crow[p.id] : undefined; // Ad Hoc のみ完了数
          const emptyV = blank(rawV);
          const emptyC = blank(rawC);
          if (emptyV && emptyC) {
            // 両方空。元々値があった場合だけ削除を送る
            const hadV = iv[t.id]?.[p.id];
            const hadC = ic[t.id]?.[p.id];
            if (
              (hadV !== undefined && hadV !== null) ||
              (hadC !== undefined && hadC !== null)
            ) {
              entries.push({ task_id: t.id, person_id: p.id, value: null, done_count: null });
            }
            continue;
          }
          const numV = emptyV ? 0 : Number(rawV);
          if (Number.isNaN(numV)) continue;
          const entry = { task_id: t.id, person_id: p.id, value: numV };
          if (adhoc && !emptyC) {
            const numC = Number(rawC);
            if (!Number.isNaN(numC)) entry.done_count = numC;
          }
          entries.push(entry);
        }
      }
      const res = await fetch("/api/kosu-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, entries }),
      }).then((r) => r.json());
      if (res.error) showToast(res.error, "err");
      else {
        showToast(res.saved === 0 ? "保存しました（変更なし）" : `${res.saved}件を保存しました`);
        await loadEntries(); // 保存後の状態を再読込（削除判定の基準を更新）
      }
    } catch (e) {
      showToast(String(e?.message || e), "err");
    } finally {
      setBusy(null);
      setSaving(false);
    }
  };

  return (
    <div className="wrap">
      <div className="head">
        <div className="head-left">
          <Link href="/kosu" className="back-link" title="工数管理へ戻る" aria-label="工数管理へ戻る">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <span className="page-h page-h-gap">工数入力</span>
        </div>
        <div className="head-right">
          <button className="save-btn" onClick={save} disabled={saving || loading}>
            保存
          </button>
        </div>
      </div>

      {configured === false && (
        <div className="banner warn-banner">
          Supabase 未接続のため<b>保存はできません</b>（画面確認用のデモ）。接続すると入力・保存が有効になります。
        </div>
      )}
      {error && <div className="banner err-banner">エラー：{error}</div>}

      <div className="input-bar">
        <span className="head-year">
          対象日
          {/* ブラウザ既定の日付表示は OS の書式に引きずられて「2026/07/24 ()」の
              ように空のかっこが出るため、表示は自前にしてカレンダーだけ借りる */}
          <span className="date-field">
            <input
              ref={dateRef}
              className="date-native"
              type="date"
              value={date}
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              type="button"
              className="date-face"
              onClick={openPicker}
              aria-label={`対象日 ${date.replace(/-/g, "/")}（クリックでカレンダー）`}
            >
              <span className="date-text">{date.replace(/-/g, "/")}</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
                <line x1="3" y1="9.5" x2="21" y2="9.5" />
                <line x1="8" y1="2.5" x2="8" y2="6.5" />
                <line x1="16" y1="2.5" x2="16" y2="6.5" />
              </svg>
            </button>
          </span>
        </span>
      </div>

      {loading || me === null ? (
        <div className="card">
          <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="card">
          <div className="notice">
            {tasks.length === 0
              ? "作業内容が未登録です。ダッシュボードの Ad Hoc Task から追加してください。"
              : "入力対象の作業がありません。ダッシュボードの Ad Hoc Task で対応者を設定してください（完了した作業は表示されません）。"}
          </div>
        </div>
      ) : (
        <div className="card no-pad">
          <div className="dtw">
            <table className="dtable kosu-input-table">
              <thead>
                <tr>
                  <th className="l">タスク種別</th>
                  <th className="l">作業内容</th>
                  <th>単位</th>
                  {visiblePersons.map((p) => (
                    <th key={p.id}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map((grp) =>
                  grp.rows.map((t, ri) => (
                    <tr key={t.id}>
                      {ri === 0 ? (
                        <td className="l type-cell" rowSpan={grp.rows.length}>
                          {grp.type}
                        </td>
                      ) : null}
                      <td className="l">{t.content}</td>
                      <td>
                        {isRegular(t) ? (
                          <span className={"unit-tag " + (t.unit === "time" ? "u-time" : "u-count")}>
                            {t.unit === "time" ? "時間" : "件数"}
                          </span>
                        ) : (
                          <span className="unit-tag u-time">時間＋件数</span>
                        )}
                      </td>
                      {visiblePersons.map((p) => (
                        <td key={p.id}>
                          {!isAssigned(t, p.id) ? (
                            // 担当に選ばれていない人は入力欄を出さない
                            <span className="cell-na" aria-label="担当外">
                              —
                            </span>
                          ) : isRegular(t) ? (
                            <input
                              className="cell-input"
                              type="number"
                              step="any"
                              inputMode="decimal"
                              value={values[t.id]?.[p.id] ?? ""}
                              onChange={(e) => setVal(t.id, p.id, e.target.value)}
                              placeholder="0"
                            />
                          ) : (
                            // Ad Hoc は 稼働時間(h) と 完了数(件) の2入力
                            <span className="dual-input">
                              <input
                                className="cell-input"
                                type="number"
                                step="any"
                                inputMode="decimal"
                                value={values[t.id]?.[p.id] ?? ""}
                                onChange={(e) => setVal(t.id, p.id, e.target.value)}
                                placeholder="h"
                                title="稼働時間"
                              />
                              <input
                                className="cell-input"
                                type="number"
                                step="any"
                                inputMode="decimal"
                                value={counts[t.id]?.[p.id] ?? ""}
                                onChange={(e) => setCnt(t.id, p.id, e.target.value)}
                                placeholder="件"
                                title="完了数"
                              />
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
                <tr className="qtotal">
                  <td className="l" colSpan={3}>
                    合計
                  </td>
                  {visiblePersons.map((p) => (
                    <td key={p.id}>{dayTotal(p.id)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
