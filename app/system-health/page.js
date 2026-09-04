"use client";

import { useCallback, useEffect, useState } from "react";

function fmtNum(n) {
  return n == null ? "—" : Number(n).toLocaleString("ja-JP");
}
function fmtBytes(n) {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(n),
    i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}
function agoDays(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}
function fmtAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}
function fmtUptime(sec) {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}日 ${h}時間` : `${h}時間`;
}

// KPIカード（値＋補足＋良好/注意バッジ＋任意のバー）
function Kpi({ label, value, sub, badge, badgeTone = "ok", barPct, barTone = "ok" }) {
  return (
    <div className="hz-kpi">
      <div className="hz-kpi-top">
        <span className="hz-kpi-label">{label}</span>
        {badge && <span className={"hz-badge " + badgeTone}>{badge}</span>}
      </div>
      <div className="hz-kpi-val">{value}</div>
      {sub && <div className="hz-kpi-sub">{sub}</div>}
      {barPct != null && (
        <div className="hz-bar">
          <span className={"hz-bar-fill " + barTone} style={{ width: Math.max(2, Math.min(100, barPct)) + "%" }} />
        </div>
      )}
    </div>
  );
}

export default function SystemHealthPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setErr(null);
    try {
      const j = await fetch("/api/system-health", { cache: "no-store" }).then((r) => r.json());
      if (j.error) setErr(j.error);
      setData(j);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const db = data?.db || null;
  // pg_stat の n_live_tup は ANALYZE 前だと 0 になるため、
  // PostgREST から取った推定行数を優先して補完する。
  const estByName = Object.fromEntries((data?.tables || []).map((t) => [t.name, t.rows]));
  const rowsOf = (t) => {
    const est = estByName[t.name];
    if (est != null && est > 0) return est;
    return t.rows;
  };
  // 使用状況テーブル：DB統計があればサイズ付き、無ければ推定行数のみ
  const usageRows =
    db?.tables?.length
      ? db.tables.map((t) => ({ name: t.name, rows: rowsOf(t), size: t.size_bytes }))
      : (data?.tables || []).map((t) => ({ name: t.name, rows: t.rows, size: null }));
  const totalBasis = usageRows.reduce((s, t) => s + (db ? t.size || 0 : t.rows || 0), 0) || 1;
  const totalRows = (data?.tables || []).reduce((s, t) => s + (t.rows || 0), 0);

  const kfresh = agoDays(data?.kintone?.fetchedAt);
  const kTone = kfresh == null ? "down" : kfresh <= 1 ? "ok" : kfresh <= 3 ? "warn" : "down";

  return (
    <div className="wrap page-compact">
      <div className="head">
        <div className="head-left">
          <span className="conn ok" title="システムヘルス" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </span>
          <span className="page-h page-h-gap">システムヘルス</span>
        </div>
        <div className="head-right">
          {data?.checkedAt && <span className="updated">最終チェック：{fmtDateTime(data.checkedAt)}</span>}
          <button className="icon-btn" onClick={run} disabled={running} title="再チェック" aria-label="再チェック">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={running ? "spin" : undefined}>
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {err && <div className="banner err-banner">エラー：{err}</div>}

      {data === null ? (
        <div className="page-loading"><span className="loader-ring" role="status" aria-label="チェック中" /></div>
      ) : (
        <>
          {/* KPI カード */}
          <div className="hz-kpis">
            {db ? (
              <>
                <Kpi
                  label="キャッシュヒット率"
                  value={db.cache_hit_ratio != null ? db.cache_hit_ratio + "%" : "—"}
                  sub="メモリから供給された割合（高いほど高速）"
                  badge={db.cache_hit_ratio >= 99 ? "良好" : db.cache_hit_ratio >= 95 ? "注意" : "低下"}
                  badgeTone={db.cache_hit_ratio >= 99 ? "ok" : db.cache_hit_ratio >= 95 ? "warn" : "down"}
                  barPct={db.cache_hit_ratio}
                  barTone={db.cache_hit_ratio >= 99 ? "ok" : db.cache_hit_ratio >= 95 ? "warn" : "down"}
                />
                <Kpi label="DB容量" value={fmtBytes(db.db_size_bytes)} sub="データベース全体のサイズ" badge="良好" />
                <Kpi
                  label="接続数"
                  value={`${db.used_conn ?? "—"} / ${db.max_conn ?? "—"}`}
                  sub="同時接続数"
                  badge={db.used_conn / db.max_conn < 0.8 ? "良好" : "逼迫"}
                  badgeTone={db.used_conn / db.max_conn < 0.8 ? "ok" : "warn"}
                  barPct={db.max_conn ? (100 * db.used_conn) / db.max_conn : null}
                  barTone={db.used_conn / db.max_conn < 0.8 ? "ok" : "warn"}
                />
                <Kpi
                  label="コミット成功率"
                  value={db.commit_ratio != null ? db.commit_ratio + "%" : "—"}
                  sub="トランザクションの成功割合"
                  badge={db.commit_ratio >= 99 ? "良好" : "注意"}
                  badgeTone={db.commit_ratio >= 99 ? "ok" : "warn"}
                  barPct={db.commit_ratio}
                  barTone={db.commit_ratio >= 99 ? "ok" : "warn"}
                />
                <Kpi label="稼働時間" value={fmtUptime(db.uptime_seconds)} sub="DB起動からの経過" badge="良好" />
              </>
            ) : (
              <>
                <Kpi
                  label="DB接続"
                  value={data.reachable ? "正常" : "エラー"}
                  sub={data.reachable ? "Supabase に接続できています" : "Supabase に接続できません"}
                  badge={data.reachable ? "良好" : "異常"}
                  badgeTone={data.reachable ? "ok" : "down"}
                />
                <Kpi
                  label="応答速度"
                  value={data.latencyMs != null ? data.latencyMs + " ms" : "—"}
                  sub="1件取得にかかった時間"
                  badge={data.latencyMs < 400 ? "良好" : data.latencyMs < 1200 ? "注意" : "遅延"}
                  badgeTone={data.latencyMs < 400 ? "ok" : data.latencyMs < 1200 ? "warn" : "down"}
                />
                <Kpi label="テーブル数" value={fmtNum((data.tables || []).length)} sub="このアプリのテーブル" badge="良好" />
                <Kpi label="総行数（推定）" value={fmtNum(totalRows)} sub="全テーブル合計" badge="良好" />
                <Kpi
                  label="Kintone 最終取込"
                  value={fmtAgo(data.kintone?.fetchedAt)}
                  sub={fmtDateTime(data.kintone?.fetchedAt)}
                  badge={kTone === "ok" ? "良好" : kTone === "warn" ? "注意" : "古い"}
                  badgeTone={kTone}
                />
              </>
            )}
          </div>

          <div className="hz-cols">
            {/* テーブル別の使用状況 */}
            <div className="card no-pad hz-col">
              <div className="hz-card-h pad">テーブル別の使用状況</div>
              <div className="hz-tw">
                <table className="hz-table">
                  <thead>
                    <tr>
                      <th className="l">テーブル</th>
                      <th>行数</th>
                      {db && <th>サイズ</th>}
                      <th>占有率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageRows.map((t, i) => {
                      const share = ((db ? t.size || 0 : t.rows || 0) / totalBasis) * 100;
                      return (
                        <tr key={t.name + "-" + i}>
                          <td className="l mono">{t.name}</td>
                          <td>{fmtNum(t.rows)}</td>
                          {db && <td>{fmtBytes(t.size)}</td>}
                          <td>
                            <span className="hz-share">
                              <span className="hz-share-bar"><span style={{ width: Math.max(1, share) + "%" }} /></span>
                              <span className="hz-share-n">{share.toFixed(1)}%</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data.kintone?.fetchedAt && (
                <div className="hz-foot">最終同期：{fmtDateTime(data.kintone.fetchedAt)}</div>
              )}
            </div>

            {/* データの取り込み状況 */}
            <div className="card no-pad hz-col">
              <div className="hz-card-h pad">データの取り込み状況</div>
              <div className="hz-tw">
                <table className="hz-table">
                  <thead>
                    <tr>
                      <th className="l">データ</th>
                      <th>最新日</th>
                      <th>経過</th>
                      <th>件数</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="l">Kintone スナップショット</td>
                      <td>{fmtDate(data.kintone?.fetchedAt)}</td>
                      <td>
                        <span className={"hz-elapsed " + kTone}>
                          {kfresh == null ? "—" : kfresh === 0 ? "本日" : `${kfresh}日前`}
                        </span>
                      </td>
                      <td>{fmtNum(data.kintone?.count)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="hz-foot">Kintone は毎日 10:00 JST に自動同期</div>
            </div>
          </div>

          {/* メンテナンス状況（SQL関数 sys_health 導入時のみ） */}
          {db?.tables?.length ? (
            <div className="card no-pad">
              <div className="hz-card-h pad">メンテナンス状況（肥大化・インデックス）</div>
              <div className="hz-tw">
                <table className="hz-table">
                  <thead>
                    <tr>
                      <th className="l">テーブル</th>
                      <th>行数</th>
                      <th>不要タプル</th>
                      <th>不要率</th>
                      <th>Seqスキャン</th>
                      <th>Seq比</th>
                      <th>最終VACUUM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {db.tables.map((t, i) => {
                      const seqRatio =
                        (t.seq_scan || 0) + (t.idx_scan || 0) > 0
                          ? Math.round((100 * (t.seq_scan || 0)) / ((t.seq_scan || 0) + (t.idx_scan || 0)))
                          : 0;
                      const dr = Number(t.dead_ratio) || 0;
                      return (
                        <tr key={t.name + "-" + i}>
                          <td className="l mono">{t.name}</td>
                          <td>{fmtNum(rowsOf(t))}</td>
                          <td>{fmtNum(t.dead_tuples)}</td>
                          <td>
                            <span className={"hz-tag " + (dr >= 20 ? "down" : dr >= 10 ? "warn" : "ok")}>{dr}%</span>
                          </td>
                          <td>{fmtNum(t.seq_scan)}</td>
                          <td>
                            <span className={"hz-tag " + (seqRatio >= 40 ? "warn" : "ok")}>{seqRatio}%</span>
                          </td>
                          <td>{t.last_vacuum ? fmtDate(t.last_vacuum) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="hz-hint">
                <b>キャッシュヒット率・DB容量・接続数・コミット成功率・稼働時間・肥大化/VACUUM 状況</b> を表示するには、
                Supabase に SQL 関数 <code>public.sys_health()</code> を1度だけ導入してください
                （リポジトリの <code>db/sys_health.sql</code> を Supabase の SQL Editor に貼り付けて実行）。
                導入後にこの画面を再チェックすると自動的に表示されます。
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
