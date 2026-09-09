"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// 全ページ共通のプルダウン。
// ブラウザ標準の <select> だと開いたときの見た目を揃えられないので、
// 閉じているとき・開いたときの両方を自前で描く。
//
//   <Pulldown value={y} onChange={setY} options={[{value, label}]} icon="calendar" />
//
// 開くパネルは position:fixed で本体の真下に出す。
// 表の中など、はみ出しを隠している場所でも切れないようにするため。

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="8" y1="2.5" x2="8" y2="6" />
      <line x1="16" y1="2.5" x2="16" y2="6" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8v5.5l-4 2V13z" />
    </svg>
  );
}

const ICONS = { calendar: CalendarIcon, filter: FilterIcon };

export default function Pulldown({
  value,
  onChange,
  options,
  icon,
  disabled,
  ariaLabel,
  minWidth,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // パネルの位置（画面基準）
  const [active, setActive] = useState(-1); // キーボードで選んでいる位置
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const list = options || [];
  const idx = list.findIndex((o) => String(o.value) === String(value));
  const current = idx >= 0 ? list[idx] : null;
  const Icon = ICONS[icon];

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    // 下に入りきらなければ上に出す
    const h = Math.min(list.length * 38 + 12, 320);
    const below = window.innerHeight - b.bottom;
    setPos({
      left: b.left,
      top: below < h + 12 && b.top > h + 12 ? b.top - h - 6 : b.bottom + 6,
      width: Math.max(b.width, 132),
      maxHeight: Math.max(120, Math.min(320, below < h + 12 ? b.top - 16 : below - 16)),
    });
  }, [list.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const reposition = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    // 表の横スクロールなどで本体が動いたら位置を合わせ直す
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, place]);

  const pick = (o) => {
    setOpen(false);
    if (String(o.value) !== String(value)) onChange?.(o.value);
  };

  const onBtnKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setActive(idx >= 0 ? idx : 0);
      setOpen(true);
    }
  };
  const onPopKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => {
        const n = list.length;
        const base = a < 0 ? (idx >= 0 ? idx : 0) : a;
        return (base + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      });
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(list[active]);
      btnRef.current?.focus();
    }
  };

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={"pd" + (open ? " open" : "") + (className ? " " + className : "")}
        style={minWidth ? { minWidth } : undefined}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onBtnKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {Icon && (
          <span className="pd-ico" aria-hidden="true">
            <Icon />
          </span>
        )}
        <span className="pd-label">{current ? current.label : ""}</span>
        <span className="pd-caret" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && pos && (
        <div
          ref={popRef}
          className="pd-pop"
          role="listbox"
          tabIndex={-1}
          onKeyDown={onPopKey}
          style={{ left: pos.left, top: pos.top, minWidth: pos.width, maxHeight: pos.maxHeight }}
        >
          {list.map((o, i) => {
            const sel = String(o.value) === String(value);
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={sel}
                className={"pd-item" + (sel ? " sel" : "") + (i === active ? " act" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                <span className="pd-item-label">{o.label}</span>
                {sel && (
                  <svg className="pd-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
