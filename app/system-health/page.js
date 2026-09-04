"use client";

import { useCallback, useEffect, useState } from "react";

/* ── 表示ヘルパー ───────────────────────────────────────── */
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("ja-JP"));

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
const toMB = (n) => (n == null ? null : n / (1024 * 1024));

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
function daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}
function fmtUptime(sec) {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}日 ${h}時間` : `${h}時間`;
}
// 上限到達目安。730日以上は「約N年後」に丸める（桁が大きいと判断できないため）
function fmtEta(days) {
  if (days == null || !Number.isFinite(days)) return null;
  if (days >= 730) return `約 ${Math.round(days / 365).toLocaleString("ja-JP")} 年後`;
  if (days >= 60) return `約 ${Math.round(days / 30)} か月後`;
  return `約 ${Math.round(days)} 日後`;
}

/* ── 良し悪しの判定 ─────────────────────────────────────── */
// 高いほど良い指標：>=90 良好 / >=70 注意 / それ未満 警告
const toneHigh = (v) => (v == null ? "ok" : v >= 90 ? "ok" : v >= 70 ? "warn" : "bad");
// 低いほど良い指標：<=60 良好 / <=80 注意 / それ超 警告
const toneLow = (v) => (v == null ? "ok" : v <= 60 ? "ok" : v <= 80 ? "warn" : "bad");
const TONE_LABEL = { ok: "良好", warn: "注意", bad: "警告" };

/* ── 健全性カード ───────────────────────────────────────── */
function Kpi({ label, value, sub, note, tone = "ok", gauge }) {
  return (
    <div className="sh-card">
      <div className="sh-card-top">
        <span className="sh-card-label">{label}</span>
        <span className={"sh-badge " + tone}>{TONE_LABEL[tone]}</span>
      </div>
      <div className="sh-card-val">{value}</div>
      {sub && <div className="sh-card-sub">{sub}</div>}
      {note && <div className="sh-card-note">{note}</div>}
      <div className="sh-gauge">
        <span
          className={"sh-gauge-fill " + tone}
          style={{ width: Math.min(Math.max(gauge ?? 0, 0), 100) + "%" }}
        />
      </div>
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

  const h = data?.health || null;
  const cap = data?.capacity || null;
  const tables = data?.tables || [];
  const totalBytes = tables.reduce((s, t) => s + (Number(t.bytes) || 0), 0) || 1;

  // 接続数の使用率
  const connPct = h?.max_conns ? (100 * (h.conns ?? 0)) / h.max_conns : null;
  // PostgreSQL バージョン（"PostgreSQL 15.8 on ..." → 先頭だけ）
  const pgVer = h?.version ? String(h.version).split(" on ")[0] : null;

  return (
    <div className="wrap page-compact sys-health">
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
          {/* ① 健全性カード */}
          <div className="sh-cards">
            <Kpi
              label="キャッシュヒット率"
              value={h?.cache_hit != null ? Number(h.cache_hit).toFixed(1) + "%" : "—"}
              sub="メモリから供給された割合（高いほど高速）"
              tone={toneHigh(h?.cache_hit)}
              gauge={h?.cache_hit ?? 0}
            />
            <Kpi
              label="DB容量"
              value={cap?.usedPct != null ? cap.usedPct.toFixed(1) + "%" : "—"}
              sub={
                cap
                  ? `${Math.round(toMB(cap.usedBytes)).toLocaleString("ja-JP")} / ${Math.round(toMB(cap.limitBytes)).toLocaleString("ja-JP")} MB（${cap.planName}）`
                  : "—"
              }
              note={
                cap?.perDayBytes != null
                  ? `増加 ${toMB(cap.perDayBytes).toFixed(2)} MB/日${fmtEta(cap.daysToLimit) ? ` ・ 上限到達目安 ${fmtEta(cap.daysToLimit)}` : ""}`
                  : "増加ペースは算出できませんでした"
              }
              tone={toneLow(cap?.usedPct)}
              gauge={cap?.usedPct ?? 0}
            />
            <Kpi
              label="接続数"
              value={h ? `${num(h.conns)} / ${num(h.max_conns)}` : "—"}
              sub="同時接続（プーラ経由）"
              tone={toneLow(connPct)}
              gauge={connPct ?? 0}
            />
            <Kpi
              label="コミット成功率"
              value={h?.commit_pct != null ? Number(h.commit_pct).toFixed(1) + "%" : "—"}
              sub={`累計 ${num(h?.commits)} 件`}
              tone={toneHigh(h?.commit_pct)}
              gauge={h?.commit_pct ?? 0}
            />
            <Kpi
              label="稼働時間"
              value={fmtUptime(h?.uptime_sec)}
              sub="DB起動からの経過"
              tone="ok"
              gauge={100}
            />
          </div>

          {/* ② 2カラム */}
          <div className="sh-cols">
            {/* 左：テーブル別の使用状況 */}
            <section className="sh-panel">
              <h2 className="sh-h">テーブル別の使用状況</h2>
              <div className="sh-tw sh-tw-300">
                <table className="sh-table">
                  <thead>
                    <tr>
                      <th className="l">テーブル</th>
                      <th className="r">行数</th>
                      <th className="r">サイズ</th>
                      <th className="r">占有率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map((t, i) => {
                      const pct = ((Number(t.bytes) || 0) / totalBytes) * 100;
                      return (
                        <tr key={t.name + "-" + i}>
                          <td className="l mono">{t.name}</td>
                          <td className="r n">{num(t.live)}</td>
                          <td className="r n">{fmtBytes(t.bytes)}</td>
                          <td className="r n sh-share">
                            <span className="sh-share-bar" style={{ width: Math.min(pct, 100) + "%" }} aria-hidden="true" />
                            <span className="sh-share-num">{pct.toFixed(1)}%</span>
                          </td>
                        </tr>
                      );
                    })}
                    {/* 行数が足りないとき、罫線を続けて表が途中で切れて見えないようにする */}
                    <tr className="sh-filler">
                      <td colSpan={4} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 右：データの取り込み状況 */}
            <section className="sh-panel">
              <h2 className="sh-h">データの取り込み状況</h2>
              <div className="sh-tw sh-tw-300">
                <table className="sh-table">
                  <thead>
                    <tr>
                      <th className="l">データ</th>
                      <th className="r">最新日</th>
                      <th className="r">経過</th>
                      <th className="r">件数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.ingest || []).map((r, i) => {
                      const d = daysSince(r.latest);
                      const tone = d == null ? "bad" : d <= 3 ? "ok" : d <= 40 ? "warn" : "bad";
                      return (
                        <tr key={r.label + "-" + i}>
                          <td className="l">{r.label}</td>
                          <td className="r n">{fmtDate(r.latest)}</td>
                          <td className="r">
                            <span className={"sh-chip " + tone}>
                              {d == null ? "—" : d === 0 ? "本日" : `${d}日前`}
                            </span>
                          </td>
                          <td className="r n">{num(r.count)}</td>
                        </tr>
                      );
                    })}
                    <tr className="sh-filler">
                      <td colSpan={4} />
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="sh-foot">
                最終同期：{fmtDateTime(data.ingest?.[0]?.latest)}（JST）／毎日 10:00 に自動同期
              </p>
            </section>
          </div>

          {/* ③ メンテナンス状況 */}
          <section className="sh-panel">
            <h2 className="sh-h">メンテナンス状況（肥大化・インデックス）</h2>
            <div className="sh-tw sh-tw-360">
              <table className="sh-table">
                <thead>
                  <tr>
                    <th className="l">テーブル</th>
                    <th className="r">行数</th>
                    <th className="r">不要タプル</th>
                    <th className="r">不要率</th>
                    <th className="r">Seqスキャン</th>
                    <th className="r">Seq比</th>
                    <th className="r">最終VACUUM</th>
                  </tr>
                </thead>
                <tbody>
                  {[...tables]
                    .sort((a, b) => (b.dead || 0) - (a.dead || 0) || (b.live || 0) - (a.live || 0))
                    .map((t, i) => {
                      const live = Number(t.live) || 0;
                      const dead = Number(t.dead) || 0;
                      const deadPct = live + dead > 0 ? (100 * dead) / (live + dead) : 0;
                      const deadTone = deadPct >= 40 ? "bad" : deadPct >= 20 ? "warn" : "ok";
                      const seq = Number(t.seq_scan) || 0;
                      const idx = Number(t.idx_scan) || 0;
                      const scans = seq + idx;
                      const seqPct = scans > 0 ? (100 * seq) / scans : null;
                      // 小さい表は常にSeqスキャンになるため、誤検知を避けて3条件そろった時だけ黄
                      const seqWarn = seqPct != null && seqPct >= 50 && seq >= 100 && live >= 500;
                      return (
                        <tr key={t.name + "-" + i}>
                          <td className="l mono">{t.name}</td>
                          <td className="r n">{num(live)}</td>
                          <td className="r n">{num(dead)}</td>
                          <td className="r">
                            <span className={"sh-chip " + deadTone}>{deadPct.toFixed(0)}%</span>
                          </td>
                          <td className="r n">{num(seq)}</td>
                          <td className="r n">
                            {seqPct == null ? (
                              "—"
                            ) : seqWarn ? (
                              <span className="sh-chip warn">{seqPct.toFixed(0)}%</span>
                            ) : (
                              `${seqPct.toFixed(0)}%`
                            )}
                          </td>
                          <td className="r n">{t.last_vac ? fmtDate(t.last_vac) : "—"}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ④ 接続先 */}
          <p className="sh-conn">
            ホスト：{data.host || "(不明)"}　／　{pgVer || "(バージョン不明)"}
          </p>
        </>
      )}
    </div>
  );
}
