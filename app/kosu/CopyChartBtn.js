"use client";

import { useEffect, useState } from "react";

// 工数管理のグラフ（メンバー別リソース割合／Ad Hoc 詳細）を、
// メールに貼れるよう PNG にしてクリップボードへ入れるボタン。
//
// グラフは SVG ＋ 右側の凡例（HTML）でできているので、
// SVG を1枚の画像にしてから、見出し・凡例を canvas に描き足して1枚にまとめる。

// SVG は外部の CSS を読まないので、画面の見た目をそのまま属性に写してから画像にする
const COPY_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "font-family",
  "font-size",
  "font-weight",
  "opacity",
  "text-anchor",
  "dominant-baseline",
];

function inlineStyles(src, dst) {
  const a = [src, ...src.querySelectorAll("*")];
  const b = [dst, ...dst.querySelectorAll("*")];
  for (let i = 0; i < a.length && i < b.length; i++) {
    const cs = getComputedStyle(a[i]);
    let css = "";
    for (const p of COPY_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) css += `${p}:${v};`;
    }
    b[i].setAttribute("style", css);
  }
}

function svgToImage(svg) {
  const clone = svg.cloneNode(true);
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const src =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(new XMLSerializer().serializeToString(clone));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("グラフを画像にできませんでした"));
    img.src = src;
  });
}

// 凡例は作業名が長いことがあるので折り返す。
// 英数字は語の途中で切れると読みにくいので、まず語のまとまりで分けてから並べる。
function tokenize(text) {
  const out = [];
  let buf = "";
  for (const ch of text) {
    if (ch !== " " && ch.charCodeAt(0) < 0x7f) {
      buf += ch;
      continue;
    }
    if (buf) out.push(buf), (buf = "");
    out.push(ch);
  }
  if (buf) out.push(buf);
  return out;
}

function wrapText(ctx, text, maxW) {
  const out = [];
  let line = "";
  const push = () => {
    if (line) out.push(line);
    line = "";
  };
  for (const tk of tokenize(text)) {
    if (!line && tk === " ") continue; // 行頭の空白は捨てる
    if (line && ctx.measureText(line + tk).width > maxW) push();
    // 語そのものが1行に入らないときだけ、文字単位で切る
    if (ctx.measureText(tk).width > maxW) {
      for (const ch of tk) {
        if (line && ctx.measureText(line + ch).width > maxW) push();
        line += ch;
      }
    } else line += tk;
  }
  push();
  return out;
}

function dot(ctx, x, y, size) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 3);
    ctx.fill();
  } else ctx.fillRect(x, y, size, size);
}

/**
 * card: グラフのカード（.chart-card）の DOM
 * sub : 見出しの下に小さく添える文字（対象週など。省略可）
 */
export async function chartCardToBlob(card, sub) {
  // ボタンのアイコンも svg なので、グラフ本体だけを拾う
  const svg = card.querySelector("svg.chart-svg");
  if (!svg) throw new Error("グラフが見つかりません");
  const title = card.querySelector(".chart-title")?.textContent.trim() || "";
  const legend = [...card.querySelectorAll(".side-legend .legend-item")].map((el) => ({
    label: el.textContent.trim(),
    color: getComputedStyle(el.querySelector(".legend-dot")).backgroundColor,
  }));

  const PAD = 18;
  const TITLE_H = 32;
  const SUB_H = sub ? 22 : 0;
  const CHART_W = 760; // 読みやすさ優先で画面より大きめに描く
  const vb = svg.viewBox.baseVal;
  const CHART_H = Math.round((CHART_W * vb.height) / vb.width);
  const GAP = 18;
  const TEXT_W = 210; // 凡例の文字が折り返す幅
  const DOT = 12;
  const LINE_H = 19;
  const ITEM_GAP = 8;

  const meas = document.createElement("canvas").getContext("2d");
  meas.font = "600 13px system-ui, sans-serif";
  const lines = legend.map((it) => wrapText(meas, it.label, TEXT_W));
  const flat = lines.flat();
  const lgW = legend.length
    ? DOT + 8 + Math.ceil(Math.max(...flat.map((l) => meas.measureText(l).width)))
    : 0;
  const lgH = legend.length
    ? lines.reduce((a, ls) => a + ls.length * LINE_H + ITEM_GAP, 0) - ITEM_GAP
    : 0;

  const W = PAD * 2 + CHART_W + (lgW ? GAP + lgW : 0);
  const H = PAD * 2 + TITLE_H + SUB_H + Math.max(CHART_H, lgH);

  const cv = document.createElement("canvas");
  cv.width = W * 2;
  cv.height = H * 2;
  const ctx = cv.getContext("2d");
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1a2540";
  ctx.font = "800 19px system-ui, sans-serif";
  ctx.fillText(title, PAD, PAD + TITLE_H / 2);
  if (sub) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(sub, PAD, PAD + TITLE_H + SUB_H / 2 - 3);
  }

  const top = PAD + TITLE_H + SUB_H;
  const img = await svgToImage(svg);
  ctx.drawImage(img, PAD, top, CHART_W, CHART_H);

  ctx.font = "600 13px system-ui, sans-serif";
  let y = top + Math.max(0, (CHART_H - lgH) / 2);
  legend.forEach((it, i) => {
    ctx.fillStyle = it.color;
    dot(ctx, PAD + CHART_W + GAP, y + 3, DOT);
    ctx.fillStyle = "#374151";
    lines[i].forEach((l, li) =>
      ctx.fillText(l, PAD + CHART_W + GAP + DOT + 8, y + LINE_H / 2 + li * LINE_H)
    );
    y += lines[i].length * LINE_H + ITEM_GAP;
  });

  return new Promise((resolve, reject) =>
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を作れませんでした"))), "image/png")
  );
}

export default function CopyChartBtn({ targetRef, sub, label = "グラフを画像でコピー" }) {
  const [state, setState] = useState(""); // "" / "busy" / "done" / "err"
  useEffect(() => {
    if (state !== "done" && state !== "err") return;
    const t = setTimeout(() => setState(""), 1800);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    if (!targetRef.current || state === "busy") return;
    setState("busy");
    try {
      const blob = await chartCardToBlob(targetRef.current, sub);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setState("done");
    } catch (e) {
      console.error("[copy chart]", e);
      setState("err");
    }
  };

  return (
    <button
      type="button"
      className={"icon-btn copy-btn" + (state ? " " + state : "")}
      onClick={copy}
      disabled={state === "busy"}
      title={
        state === "done"
          ? "コピーしました"
          : state === "err"
          ? "コピーできませんでした"
          : label
      }
      aria-label={label}
    >
      {state === "done" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
