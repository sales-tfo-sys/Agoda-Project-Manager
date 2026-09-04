"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { holidayName, dowLabel } from "../../lib/holidays";

// 完了タブで作業内容の右端に置く Complete バッジの幅（列幅の計算に使う）
const BADGE_W = 82;

// 作業名の正規化：全角/半角（NFKC）を揃え、空白を詰めて小文字化。
// 進捗シートと作業工数管理シートで（）や空白が食い違っても照合できるように。
function normName(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function getFridayOfWeek(dateStr) {
  if (!dateStr) return "9999-12-31";
  const d = new Date(dateStr.slice(0, 10) + "T12:00:00Z");
  if (isNaN(d.getTime())) return "9999-12-31";
  const day = d.getUTCDay();
  const diff = day === 0 ? -2 : 5 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// 工数明細（日次）。工数管理ページ内と単独ページの両方で使う共通部品。
export default function DetailTable({ title, compact = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [monthIdx, setMonthIdx] = useState(null);
  const [tab, setTab] = useState("active"); // active（対応中）/ done（完了）
  const [completedKeys, setCompletedKeys] = useState(null);
  const [extraRows, setExtraRows] = useState([]); // シートに無い作業（Supabase 側）

  // ダッシュボードで編集した「作業内容（名称）」と「対応者」を反映するための対応表
  const [link, setLink] = useState({ rename: {}, tanto: {}, tasks: {}, done: new Set(), doneNorm: new Set(), compDateByKey: {}, compDateByLink: {}, compDateByNorm: {} });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [json, tk, asg, ovr, adh, cus] = await Promise.all([
        fetch("/api/kosu", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/kosu-tasks", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/assign", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/override", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/adhoc", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/adhoc-tasks", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
      ]);
      if (json.error) setError(json.error);
      else {
        setData(json);
        const done = new Set();
        const tkCompletedOn = {};
        for (const t of tk?.tasks || []) {
          if (t.completed) {
            done.add(`${t.task_type}|${t.content}`);
            if (t.completed_on) tkCompletedOn[`${t.task_type}|${t.content}`] = t.completed_on;
          }
        }
        setCompletedKeys(done);

        // ダッシュボードの編集内容 → 工数明細（作業内容・担当）へ連動。
        // 対象は Ad Hoc Task のみ。Regular Task は工数明細と1対1の関係がないため除外する。
        const nameById = new Map((asg?.persons || []).map((p) => [p.id, p.name]));
        // オーナー・管理者は作業者ではないので工数明細に含めない
        const isWorker = (p) => !["owner", "admin"].includes(p.role || "member");
        const workerIds = new Set((asg?.persons || []).filter(isWorker).map((p) => p.id));
        const nonWorkerNames = new Set(
          (asg?.persons || []).filter((p) => !isWorker(p)).map((p) => p.name)
        );
        const idsByKey = {}; // 元のタスク名 → 担当者ID（主担当が先頭）
        for (const it of asg?.items || []) {
          if (it.scope !== "adhoc") continue;
          if (!workerIds.has(it.person_id)) continue; // 作業者以外は除外
          if (!idsByKey[it.key]) idsByKey[it.key] = [];
          if (it.role === "main") idsByKey[it.key].unshift(it.person_id);
          else idsByKey[it.key].push(it.person_id);
        }
        const renamed = {}; // 元のタスク名 → 変更後の名称
        const linkedTo = {}; // 元のタスク名 → 紐づけ先の作業内容（工数明細側の1行）
        for (const it of ovr?.items || []) {
          if (it.scope !== "adhoc") continue;
          if (it?.data?.name) renamed[it.key] = it.data.name;
          if (it?.data?.kosuLink) linkedTo[it.key] = it.data.kosuLink;
        }

        // 工数明細の行を組み立てる。
        //  ①シートに無い作業（サイトで追加・取り込みした分）→ 担当メンバーぶんの行
        //  ②シートにある Ad hoc の行 → ダッシュボードで割り当てた対応者のうち、
        //    シートに行が無い人を追加（集約先の行には紐づけ元の対応者も含める）
        const iso = json.isoDates || [];
        const first = iso.find(Boolean);
        const last = [...iso].reverse().find(Boolean);
        const inSheet = new Set((json.rows || []).map((r) => r.detail));
        // グルーピングでまとめた作業は、シート側にも元の名前の行が残っている。
        // そのままだと「まとめ先」と「まとめ元」が二重に並ぶので、まとめ元は出さない。
        const groupedAway = new Set(
          Object.keys(linkedTo).filter((k) => linkedTo[k] && linkedTo[k] !== k)
        );
        const sheetRows = (json.rows || []).filter((r) => !groupedAway.has(r.detail));
        const extraTasks = (tk?.tasks || []).filter(
          (t) => !inSheet.has(t.content) && !linkedTo[t.content]
        );
        let extra = [];
        if (first && last) {
          const ent = await fetch(`/api/kosu-entries?from=${first}&to=${last}`, {
            cache: "no-store",
          })
            .then((r) => r.json())
            .catch(() => null);
          const nameOfPerson = new Map((asg?.persons || []).map((p) => [p.id, p.name]));
          const byTask = new Map(); // task_id → Map(person_id → {date: value})
          for (const e of ent?.entries || []) {
            if (!byTask.has(e.task_id)) byTask.set(e.task_id, new Map());
            const pm = byTask.get(e.task_id);
            if (!pm.has(e.person_id)) pm.set(e.person_id, {});
            pm.get(e.person_id)[String(e.entry_date).slice(0, 10)] = Number(e.value) || 0;
          }
          // トータル作業時間（その他）を自動計算するための、担当者×日付の合計「時間」。
          //   ＝ Regular の時間(作業時間) ＋ Ad Hoc の稼働時間。件数系は含めない。
          const taskMeta = new Map(
            (tk?.tasks || []).map((t) => [t.id, { type: t.task_type, unit: t.unit }])
          );
          const totalByPid = new Map(); // person_id → {date: 合計時間}
          for (const e of ent?.entries || []) {
            const meta = taskMeta.get(e.task_id);
            if (!meta) continue;
            const isReg = /regular/i.test(meta.type || "");
            const isAd = /ad\s*hoc/i.test(meta.type || "");
            if (!((isReg && meta.unit === "time") || isAd)) continue;
            const d = String(e.entry_date).slice(0, 10);
            if (!totalByPid.has(e.person_id)) totalByPid.set(e.person_id, {});
            const m = totalByPid.get(e.person_id);
            m[d] = (m[d] || 0) + (Number(e.value) || 0);
          }
          const mIdx = json.dateMonthIdx || [];
          const mLen = (json.months || []).length;
          const mkRow = (type, detail, tanto, unit, vals) => {
            const monthly = new Array(mLen).fill(0);
            const daily = iso.map((d, di) => {
              const v = (d && vals[d]) || 0;
              if (v) monthly[mIdx[di]] = (monthly[mIdx[di]] || 0) + v;
              return v;
            });
            return {
              type,
              detail,
              tanto,
              total: Math.round(daily.reduce((a, b) => a + b, 0) * 10) / 10,
              monthly: monthly.map((v) => Math.round(v * 10) / 10),
              daily,
              byIso: { ...vals }, // 日付→値（全月表示で日付から引く）
              unit: unit === "time" ? "time" : "count",
              fromDb: true, // シートではなくサイト側のデータ
            };
          };

          // 進捗シートの「対応者」（完了済みは担当の割当が無いことが多いため補う）
          const picOf = {};
          for (const t of adh?.tasks || []) {
            if (!t.pic) continue;
            picOf[t.task] = String(t.pic)
              .split(/[、,\/／・\s]+/)
              .map((x) => x.trim())
              .filter(Boolean);
          }

          // ① シートに無い作業
          for (const t of extraTasks) {
            const pm = byTask.get(t.id) || new Map();
            const rowsFor = new Map(); // 担当名 → 日付ごとの値
            for (const pid of idsByKey[t.content] || []) {
              rowsFor.set(nameOfPerson.get(pid) || "?", pm.get(pid) || {});
            }
            for (const [pid, vals] of pm) {
              if (!workerIds.has(pid)) continue; // 作業者以外の実績は出さない
              rowsFor.set(nameOfPerson.get(pid) || "?", vals);
            }
            for (const n of picOf[t.content] || [])
              if (!rowsFor.has(n) && !nonWorkerNames.has(n)) rowsFor.set(n, {});
            if (rowsFor.size === 0) rowsFor.set("", {});
            for (const [tanto, vals] of rowsFor) {
              extra.push(mkRow(t.task_type, t.content, tanto, t.unit, vals));
            }
          }

          // ② シートにある Ad hoc の行に、ダッシュボードで割り当てた対応者を足す
          // 作業内容 → 割り当てられた担当者ID（集約している場合は紐づけ元のぶんも集める）
          const idsByContent = {};
          const addIds = (content, key) => {
            if (!content) return;
            for (const pid of idsByKey[key] || []) {
              if (!idsByContent[content]) idsByContent[content] = [];
              if (!idsByContent[content].includes(pid)) idsByContent[content].push(pid);
            }
          };
          for (const key of Object.keys(idsByKey)) {
            if (linkedTo[key]) addIds(linkedTo[key], key);
            else {
              addIds(key, key);
              if (renamed[key]) addIds(renamed[key], key);
            }
          }
          const taskIdOf = new Map((tk?.tasks || []).map((t) => [t.content, t.id]));

          // 工数入力(kosu_entry)を工数明細のグリッドに上書き反映する。
          // シート行の該当セル（作業内容×担当×日付）に入力があれば、その値で置き換える。
          // これで工数入力がシートを介さず工数明細に反映される。
          const nameToId = new Map();
          for (const [pid, nm] of nameOfPerson) nameToId.set(nm, pid);
          const isTotalRow = (r) => /トータル作業時間/.test(r.detail || "");
          const overlaidRows = sheetRows.map((r) => {
            const pid = nameToId.get(r.tanto);
            // トータル作業時間は入力値ではなく、担当者×日付の合計時間を自動表示する
            let perDates;
            if (isTotalRow(r)) {
              perDates = pid != null ? totalByPid.get(pid) : null;
            } else {
              const tid = taskIdOf.get(r.detail);
              perDates = tid != null && pid != null ? byTask.get(tid)?.get(pid) : null;
            }
            // 日付→値。シートの値をベースに、kosu_entry(工数入力)があれば上書き。
            const byIso = {};
            const daily = (r.daily || []).map((v, di) => {
              const d = iso[di];
              const nv = d && perDates && perDates[d] != null ? perDates[d] : v;
              if (d) byIso[d] = nv;
              return nv;
            });
            // シート列に無い日付の入力も含める（全月表示のため）
            if (perDates) for (const [d, v] of Object.entries(perDates)) byIso[d] = v;
            const monthly = new Array(mLen).fill(0);
            daily.forEach((v, di) => {
              if (v) monthly[mIdx[di]] = (monthly[mIdx[di]] || 0) + v;
            });
            return {
              ...r,
              daily,
              byIso,
              monthly: monthly.map((v) => Math.round(v * 10) / 10),
              total: Math.round(daily.reduce((a, b) => a + b, 0) * 10) / 10,
            };
          });
          setData({ ...json, rows: overlaidRows });

          const sheetOf = {}; // 作業内容 → { type, 既にある担当名 }
          for (const r of sheetRows) {
            if (/regular/i.test(r.type || "")) continue; // Regular は連動対象外
            if (!sheetOf[r.detail]) sheetOf[r.detail] = { type: r.type, names: new Set() };
            if (r.tanto) sheetOf[r.detail].names.add(r.tanto);
          }
          for (const [content, info] of Object.entries(sheetOf)) {
            for (const pid of idsByContent[content] || []) {
              const nm = nameOfPerson.get(pid);
              if (!nm || info.names.has(nm)) continue; // シートに既に行がある人は足さない
              info.names.add(nm);
              const tid = taskIdOf.get(content);
              const vals = (tid && byTask.get(tid)?.get(pid)) || {};
              extra.push(mkRow(info.type, content, nm, "count", vals));
            }
          }

          // Regular task と「トータル作業時間」はメンバー全員が対象なので、
          // シートに行が無い在籍メンバー（後から追加した人）の行を足す。
          // これが無いと、新しく追加したメンバーは工数明細に出ず、
          // 工数入力した値も表示されない。
          const commonOf = {}; // 作業内容 → { type, unit, 既にある担当名 }
          for (const r of sheetRows) {
            if (/ad\s*hoc/i.test(r.type || "")) continue; // Ad Hoc は上のブロックで処理済み
            if (!commonOf[r.detail]) {
              commonOf[r.detail] = { type: r.type, unit: r.unit, names: new Set() };
            }
            if (r.tanto) commonOf[r.detail].names.add(r.tanto);
          }
          for (const [content, info] of Object.entries(commonOf)) {
            const tid = taskIdOf.get(content);
            const isTotal = /トータル作業時間/.test(content);
            for (const p of asg?.persons || []) {
              if (!isWorker(p) || info.names.has(p.name)) continue;
              info.names.add(p.name);
              const vals = isTotal
                ? totalByPid.get(p.id) || {}
                : (tid && byTask.get(tid)?.get(p.id)) || {};
              extra.push(mkRow(info.type, content, p.name, info.unit || "count", vals));
            }
          }
        }
        setExtraRows(extra);

        // ダッシュボードの Ad Hoc タスク一覧（シート由来＋サイト追加分）と、その進捗
        const sheetStatus = {};
        const sheetUpdated = {};
        for (const t of adh?.tasks || []) {
          sheetStatus[t.task] = t.status;
          sheetUpdated[t.task] = t.updated_at;
        }
        const allTasks = new Set([
          ...Object.keys(sheetStatus),
          ...(cus?.tasks || []).map((c) => c.task),
          ...Object.keys(idsByKey),
          ...Object.keys(linkedTo),
        ]);
        // 進捗は「画面で編集した値 → シートの値」の順に採用
        const ovStatus = {};
        const ovUpdated = {};
        for (const it of ovr?.items || []) {
          if (it.scope === "adhoc" && it?.data?.status) {
            ovStatus[it.key] = it.data.status;
            ovUpdated[it.key] = it.updated_at;
          }
        }
        const statusOf = (k) => ovStatus[k] ?? sheetStatus[k] ?? null;
        const updatedOf = (k) => ovUpdated[k] ?? sheetUpdated[k] ?? null;

        // 名前一致で紐づける照合先。Regular task の行は Ad Hoc と対応しないため除外する。
        // 取り込んだ作業（シートに無い分）も照合先に含める。
        const details = new Set(
          [
            ...(json.rows || []).filter((r) => !/regular/i.test(r.type || "")).map((r) => r.detail),
            ...extraTasks.filter((t) => !/regular/i.test(t.task_type || "")).map((t) => t.content),
          ]
        );

        // 作業内容ごとに、対応するタスク名・担当者・進捗を集める。
        // Tier 1〜4 のように複数タスクを1行に紐づけている場合はまとめて持つ。
        const tanto = {};
        const tasksOf = {};
        const statuses = {};
        const updatedAts = {};
        const addTo = (content, key) => {
          if (!content) return;
          if (!tasksOf[content]) tasksOf[content] = [];
          const label = renamed[key] || key;
          if (!tasksOf[content].includes(label)) tasksOf[content].push(label);
          const names = (idsByKey[key] || []).map((id) => nameById.get(id) || "?");
          if (!tanto[content]) tanto[content] = [];
          for (const n of names) if (!tanto[content].includes(n)) tanto[content].push(n);
          if (!statuses[content]) statuses[content] = [];
          statuses[content].push(statusOf(key));
          if (!updatedAts[content]) updatedAts[content] = [];
          updatedAts[content].push(updatedOf(key));
        };
        for (const key of allTasks) {
          if (linkedTo[key]) {
            // ①明示的に紐づけたもの
            addTo(linkedTo[key], key);
          } else {
            // ②指定がなければ、タスク名（改名後を含む）が作業内容と一致する行に紐づく
            if (details.has(key)) addTo(key, key);
            if (renamed[key] && details.has(renamed[key])) addTo(renamed[key], key);
          }
        }
        const tantoStr = {};
        for (const [k, v] of Object.entries(tanto)) tantoStr[k] = v.join("、");
        // 紐づいたタスクが全て Complete なら、その作業内容は完了とみなす
        const doneByLink = new Set();
        const compDateByLink = {};
        for (const [content, sts] of Object.entries(statuses)) {
          if (sts.length > 0 && sts.every((s) => s === "Complete")) {
            doneByLink.add(content);
            const dts = updatedAts[content] || [];
            let maxD = null;
            for (const d of dts) if (d && (!maxD || d > maxD)) maxD = d;
            if (maxD) compDateByLink[content] = maxD;
          }
        }
        // 進捗シートと作業工数管理シートで全角/半角カッコや空白が食い違うと
        // 名前が一致せず完了判定できないので、正規化した名前でも完了集合を作る。
        const doneNorm = new Set();
        const compDateByNorm = {};
        for (const [k, s] of Object.entries(sheetStatus)) {
          if (s === "Complete") {
            const nk = normName(k);
            doneNorm.add(nk);
            compDateByNorm[nk] = sheetUpdated[k];
          }
        }
        for (const [k, s] of Object.entries(ovStatus)) {
          if (s === "Complete") {
            const nk = normName(k);
            doneNorm.add(nk);
            const d = ovUpdated[k];
            if (d && (!compDateByNorm[nk] || d > compDateByNorm[nk])) {
              compDateByNorm[nk] = d;
            }
          }
        }
        setLink({
          rename: renamed,
          tanto: tantoStr,
          tasks: tasksOf,
          done: doneByLink,
          doneNorm,
          compDateByKey: tkCompletedOn,
          compDateByLink,
          compDateByNorm,
        });
      }
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const months = data?.months || [];

  // 対象月は「YYYY/MM」で表示する。日付列からその月の実日付を引いて年を取る
  const monthLabel = (i) => {
    const mIdx = data?.dateMonthIdx || [];
    const iso = data?.isoDates || [];
    const di = mIdx.findIndex((v) => v === i);
    const d = di >= 0 ? iso[di] : null;
    if (d) {
      const [y, m] = String(d).split("-");
      if (y && m) return `${y}/${m}`;
    }
    return months[i];
  };

  // 既定は「当月」。当月のデータが無ければ「実績がある最後の月」。
  useEffect(() => {
    if (!data || monthIdx != null || !data.months?.length) return;
    const iso = data.isoDates || [];
    const mIdx = data.dateMonthIdx || [];
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let cur = null;
    for (let di = 0; di < iso.length; di++) {
      if (iso[di] && String(iso[di]).slice(0, 7) === ym) {
        cur = mIdx[di];
        break;
      }
    }
    if (cur == null) {
      let last = 0;
      mIdx.forEach((mi, di) => {
        if ((data.rows || []).some((r) => (r.daily?.[di] || 0) > 0)) last = mi;
      });
      cur = last;
    }
    setMonthIdx(cur);
  }, [data, monthIdx]);

  // 各月インデックス → その月の { 年, 月 }（シートの日付から求める）
  const monthYM = useMemo(() => {
    const map = {};
    const iso = data?.isoDates || [];
    const mIdx = data?.dateMonthIdx || [];
    iso.forEach((d, di) => {
      if (!d) return;
      const mi = mIdx[di];
      if (map[mi] == null) map[mi] = { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) };
    });
    return map;
  }, [data]);

  // 選択月の全日を列にする（シートの列に依存しない＝月まるごと表示）
  const dayCols = useMemo(() => {
    if (monthIdx == null) return [];
    const ym = monthYM[monthIdx];
    if (!ym) return [];
    const days = new Date(ym.y, ym.m, 0).getDate();
    const out = [];
    for (let d = 1; d <= days; d++) {
      out.push({
        iso: `${ym.y}-${String(ym.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        label: `${ym.m}/${d}`,
        dow: dowLabel(ym.y, ym.m, d),
        holiday: holidayName(ym.y, ym.m, d),
      });
    }
    return out;
  }, [monthIdx, monthYM]);

  // 完了の判定：作業内容管理で完了にしたもの、または
  // 紐づいたダッシュボードの Ad Hoc タスクが全て Complete のもの
  const isDone = useCallback(
    (r) => {
      let isCompleted = false;
      let completedDate = null;
      const key = `${r.type}|${r.detail}`;

      if (completedKeys?.has(key)) {
        isCompleted = true;
        completedDate = link.compDateByKey?.[key];
      } else {
        const name = link.rename[r.detail] || r.detail;
        if (link.done?.has(r.detail)) {
          isCompleted = true;
          completedDate = link.compDateByLink?.[r.detail];
        } else if (link.done?.has(name)) {
          isCompleted = true;
          completedDate = link.compDateByLink?.[name];
        } else if (link.doneNorm?.has(normName(name))) {
          isCompleted = true;
          completedDate = link.compDateByNorm?.[normName(name)];
        }
      }

      if (!isCompleted) return false;

      // 完了済みでも、その週の金曜日までは「対応中」タブに残す
      if (completedDate) {
        const todayStr = getTodayStr();
        if (todayStr <= getFridayOfWeek(completedDate)) {
          return false;
        }
      }

      return true;
    },
    [completedKeys, link]
  );

  // シート由来の行＋サイト側で追加した行
  const allRows = useMemo(
    () => (data ? [...(data.rows || []), ...extraRows] : []),
    [data, extraRows]
  );

  const grouped = useMemo(() => {
    if (!data) return [];
    const order = [];
    const byType = {};
    for (const r of allRows) {
      if (tab === "done" ? !isDone(r) : isDone(r)) continue;
      if (!byType[r.type]) {
        byType[r.type] = [];
        order.push(r.type);
      }
      byType[r.type].push(r);
    }
    // 同じ作業内容の担当者行が隣り合うようにまとめる（後から足した行が離れないように）
    return order.map((t) => {
      const dOrder = [];
      const byDetail = {};
      for (const r of byType[t]) {
        if (!byDetail[r.detail]) {
          byDetail[r.detail] = [];
          dOrder.push(r.detail);
        }
        byDetail[r.detail].push(r);
      }
      return { type: t, rows: dOrder.flatMap((d) => byDetail[d]) };
    });
  }, [data, allRows, tab, isDone]);

  const counts = useMemo(() => {
    if (!allRows.length) return { active: 0, done: 0 };
    let done = 0;
    for (const r of allRows) if (isDone(r)) done += 1;
    return { active: allRows.length - done, done };
  }, [allRows, isDone]);

  // 作業内容は省略表示にしたくないので、実際の文字幅を測って列幅を決める
  const contentW = useMemo(() => {
    if (typeof document === "undefined" || !allRows.length) return 218;
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font =
      '12.5px "Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",YuGothic,"Noto Sans JP",Meiryo,system-ui,sans-serif';
    let max = 0;
    for (const r of allRows) {
      const label = link.rename[r.detail] || r.detail;
      max = Math.max(max, ctx.measureText(label).width);
    }
    // セル余白(18) ＋ 連動マーク(20) ぶんを足す。
    // 完了タブは右端に Complete バッジが入るのでその幅も確保する。
    const badge = tab === "done" ? BADGE_W : 0;
    return Math.max(
      218 + badge,
      Math.min(620 + badge, Math.ceil(max) + 38 + badge)
    );
  }, [allRows, link, tab]);

  if (error) {
    return (
      <div className="card">
        <div className="err">{"取得エラー\n\n" + error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card">
        <div className="page-loading"><span className="loader-ring" role="status" aria-label="読み込み中" /></div>
      </div>
    );
  }

  return (
    <>
      <div className="sec-row">
        {title && <div className="sec-head">{title}</div>}
        <div className="detail-tools">
        {months.length > 0 && (
          <label className="head-year" aria-label="対象月">
            <select value={monthIdx ?? 0} onChange={(e) => setMonthIdx(Number(e.target.value))}>
              {months.map((m, i) => (
                <option key={m + i} value={i}>
                  {monthLabel(i)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="segbar segbar-sm" role="tablist" aria-label="工数明細の表示切替">
          <span
            className="segbar-thumb"
            style={{ transform: `translateX(${tab === "done" ? "100%" : "0%"})` }}
            aria-hidden="true"
          />
          <button
            type="button"
            role="tab"
            aria-selected={tab === "active"}
            className={"segbar-btn" + (tab === "active" ? " active" : "")}
            onClick={() => setTab("active")}
          >
            対応中
            <span className="seg-count">{counts.active}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "done"}
            className={"segbar-btn" + (tab === "done" ? " active" : "")}
            onClick={() => setTab("done")}
          >
            完了
            <span className="seg-count">{counts.done}</span>
          </button>
        </div>
        </div>

        {/* 工数入力へはサイドメニューから移動する（ここのボタンは廃止） */}
      </div>

      <div className="card no-pad">
        <div className={"dtw" + (compact ? " dtw-embed" : "")}>
          <table
            className="dtable kosu-table"
            style={{ width: 92 + contentW + 52 + dayCols.length * 42 }}
          >
            <colgroup>
              <col style={{ width: 92 }} />
              <col style={{ width: contentW }} />
              <col style={{ width: 52 }} />
              {dayCols.map((d) => (
                <col key={d.iso} style={{ width: 42 }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="l c-type">タスク種別</th>
                <th className="l c-content">作業内容</th>
                {/* 担当を固定する位置は作業内容の幅で決まる（CSS の 310px は既定値） */}
                <th className="l c-tanto" style={{ left: 92 + contentW }}>
                  担当
                </th>
                {dayCols.map((d) => (
                  <th
                    key={d.iso}
                    className={
                      "day-th" +
                      (d.holiday || d.dow === "日" ? " is-holiday" : "") +
                      (d.dow === "土" ? " is-sat" : "")
                    }
                    title={d.holiday ? `${d.label}（${d.dow}）${d.holiday}` : undefined}
                  >
                    <span className="d-date">{d.label}</span>
                    <span className="d-dow">{d.dow}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map((grp) =>
                grp.rows.map((r, ri) => (
                  <tr
                    key={grp.type + r.detail + r.tanto + ri}
                    className={r.unit === "time" ? "row-time" : ""}
                  >
                    {ri === 0 ? (
                      <td className="l type-cell c-type" rowSpan={grp.rows.length}>
                        {grp.type}
                      </td>
                    ) : null}
                    {(() => {
                      // 作業内容はダッシュボードで改名していればその名前を出す
                      const name = link.rename[r.detail] || r.detail;
                      const linked = link.tanto[r.detail] || link.tanto[name];
                      // この行に紐づいているダッシュボード側のタスク（複数の場合あり）
                      const srcTasks = link.tasks?.[r.detail] || link.tasks?.[name] || [];
                      // 担当はシートの行ごとの値が正。同じ作業でも担当別に行が分かれているため、
                      // ダッシュボードの対応者で上書きすると別人の行まで同じ名前になってしまう。
                      // 空欄のときだけ補完する。
                      return (
                        <>
                          <td
                            className={"l c-content" + (tab === "done" ? " has-done" : "")}
                          >
                            {name}
                            {tab === "done" && (
                              <span className="done-badge" title="完了">
                                Complete
                              </span>
                            )}
                            {srcTasks.length > 0 && (
                              <span
                                className="link-dot"
                                title={
                                  `ダッシュボードと連動中\nタスク：${srcTasks.join("、")}` +
                                  (linked ? `\n対応者：${linked}` : "")
                                }
                              >
                                {srcTasks.length > 1 && (
                                  <span className="link-n">{srcTasks.length}</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td
                            className="l c-tanto"
                            style={{ left: 92 + contentW }}
                            title={!r.tanto && linked ? "ダッシュボードの対応者" : undefined}
                          >
                            {r.tanto || linked || ""}
                          </td>
                        </>
                      );
                    })()}
                    {dayCols.map((d) => {
                      const v = r.byIso?.[d.iso] || 0;
                      return (
                        <td
                          key={d.iso}
                          className={
                            (v === 0 ? "z" : "") +
                            (d.holiday || d.dow === "日" ? " is-holiday" : "") +
                            (d.dow === "土" ? " is-sat" : "")
                          }
                          title={d.holiday || undefined}
                        >
                          {v === 0 ? "" : v.toLocaleString("ja-JP")}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
