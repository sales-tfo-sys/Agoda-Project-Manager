// アプリのページ一覧と、ページ単位の権限（閲覧/編集）の計算。
// 「ページ権限」機能（各ユーザーごとに見れる/編集できるページを管理）の土台。

// 画面グループ（モーダルの見出し）とページ定義。
// editable=false のページは「編集」対象外（＝ 一覧では「—」表示・editは常にfalse）。
export const PAGE_GROUPS = [
  {
    group: "業務",
    pages: [
      { key: "dashboard", label: "ダッシュボード", path: "/dashboard", editable: false },
      { key: "facilities", label: "施設一覧", path: "/", editable: false },
      { key: "kosu", label: "工数管理", path: "/kosu", editable: false },
      { key: "kosuInput", label: "工数入力", path: "/kosu/input", editable: true },
      { key: "hid", label: "HID新規発行依頼", path: "/hid-requests", editable: true },
      { key: "workReq", label: "新規作業依頼", path: "/work-requests", editable: true },
      { key: "forms", label: "フォーム回答", path: "/forms", editable: false },
    ],
  },
  {
    group: "管理",
    pages: [
      { key: "project", label: "プロジェクト管理", path: "/project", editable: true },
      { key: "accounts", label: "アカウント管理", path: "/kosu/persons", editable: true },
      { key: "designSpec", label: "設計仕様書", path: "/design-spec", editable: false },
      { key: "systemHealth", label: "システムヘルス", path: "/system-health", editable: false },
    ],
  },
];

export const PAGES = PAGE_GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.group })));
export const PAGE_BY_KEY = Object.fromEntries(PAGES.map((p) => [p.key, p]));

// URLパス → ページキー（具体的なものから順に判定）。カタログ外は null。
const PATH_RULES = [
  ["/dashboard", "dashboard"],
  ["/kosu/persons", "accounts"],
  ["/kosu/input", "kosuInput"],
  ["/kosu", "kosu"],
  ["/hid-requests", "hid"],
  ["/work-requests", "workReq"],
  ["/forms", "forms"],
  ["/project", "project"],
  ["/design-spec", "designSpec"],
  ["/system-health", "systemHealth"],
];
export function pageKeyForPath(pathname) {
  if (pathname === "/") return "facilities";
  for (const [prefix, key] of PATH_RULES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return key;
  }
  return null;
}

// 役割ごとの既定値（ページ権限が未設定のときの初期値＝現行挙動を維持）。
export function defaultPagePerms(role, canEditAccounts, canEditTasks) {
  const p = {};
  for (const pg of PAGES) p[pg.key] = { view: false, edit: false };

  if (role === "owner") {
    for (const pg of PAGES) p[pg.key] = { view: true, edit: pg.editable };
    return p;
  }
  if (role === "admin") {
    for (const pg of PAGES) p[pg.key].view = true;
    p.accounts.edit = !!canEditAccounts;
    p.project.edit = !!canEditTasks;
    p.hid.edit = !!canEditTasks;
    p.workReq.edit = !!canEditTasks;
    p.kosuInput.edit = true;
    return p;
  }
  // member（閲覧中心。工数入力のみ編集可）
  for (const k of ["dashboard", "facilities", "kosu", "kosuInput", "hid", "workReq", "forms"]) {
    p[k].view = true;
  }
  p.kosuInput.edit = true;
  return p;
}

// 既定に「保存済みの上書き（stored.pages）」をマージして実効ページ権限を返す。
// オーナーは常に全権（保存を無視）。editable=false のページは edit を常に false。
export function computePages(role, canEditAccounts, canEditTasks, stored) {
  const base = defaultPagePerms(role, canEditAccounts, canEditTasks);
  if (role === "owner") return base;

  const s = stored && stored.pages && typeof stored.pages === "object" ? stored.pages : null;
  if (s) {
    for (const pg of PAGES) {
      const o = s[pg.key];
      if (o && typeof o === "object") {
        base[pg.key] = { view: !!o.view, edit: pg.editable ? !!o.edit : false };
      }
    }
  }
  for (const pg of PAGES) if (!pg.editable) base[pg.key].edit = false;
  return base;
}
