"use client";

// ダッシュボードのヘッダーに置く「Daily Report Template」。
// 毎日の報告メールの雛形（宛先・CC・件名・本文）を出して、
// それぞれをコピーボタンで取り出せるようにする。
// 文面を変えるときはこのファイルの定数だけ直せばよい。

import { useState } from "react";
import Modal from "./Modal";

const TO = ["Munenori.Nakatani@agoda.com", "tomoya.iwasaki@agoda.com"];

const CC = [
  "sogo.iikuni@agoda.com",
  "Chiaki.Saji@agoda.com",
  "shiori.hirose@agoda.com",
  "Malisa.Phoongoen@agoda.com",
  "tadashi.ikai@agoda.com",
  "shihoko.pearce@agoda.com",
  "Satomi.Nakabayashi@agoda.com",
];

const SUBJECT = "CNCTOR Support進捗状況 ○.○";

const BODY = `お世話になります。
本日の進捗をご報告致します。

Report：LINK
--------------------------------
■Ad Hoc


■作業リソース
◆ Ad hoc　全体の○○%のリソースを使用
　 Regular　全体の○○%のリソースを使用

◆ ○○に注力


■ACQ
`;

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// クリップボードへ書く。navigator.clipboard が使えない場面
// （権限が無い・古いブラウザ）では、隠しテキストエリア経由で写す。
async function writeClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 下の方法にフォールバックする */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// 押すと一瞬チェックに変わるコピーボタン（アイコンのみ）
function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (!(await writeClipboard(text))) return; // 写せなければ見た目も変えない
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  };
  return (
    <button
      type="button"
      className={"icon-btn drt-copy" + (done ? " done" : "")}
      onClick={copy}
      title={done ? "コピーしました" : `${label}をコピー`}
      aria-label={`${label}をコピー`}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function Row({ label, copyText, children }) {
  return (
    <div className="drt-row">
      <div className="drt-label">{label}</div>
      <div className="drt-value">{children}</div>
      <CopyBtn text={copyText} label={label} />
    </div>
  );
}

export default function DailyReport() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={"icon-btn" + (open ? " on" : "")}
        onClick={() => setOpen(true)}
        title="Daily Report Template（報告メールの雛形）"
        aria-label="Daily Report Template"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </button>

      <Modal
        open={open}
        title="Daily Report Template"
        onClose={() => setOpen(false)}
        footer={
          <button className="save-btn" onClick={() => setOpen(false)}>
            閉じる
          </button>
        }
      >
        <div className="drt">
          {/* メールの宛先欄に貼れるよう、コピーはカンマ区切りでまとめる */}
          <Row label="To" copyText={TO.join(", ")}>
            {TO.map((m) => (
              <div key={m} className="drt-mail">
                {m}
              </div>
            ))}
          </Row>
          <Row label="CC" copyText={CC.join(", ")}>
            {CC.map((m) => (
              <div key={m} className="drt-mail">
                {m}
              </div>
            ))}
          </Row>
          <Row label="件名" copyText={SUBJECT}>
            <div className="drt-subject">{SUBJECT}</div>
          </Row>
          <Row label="本文" copyText={BODY}>
            <pre className="drt-body">{BODY}</pre>
          </Row>
        </div>
      </Modal>
    </>
  );
}
