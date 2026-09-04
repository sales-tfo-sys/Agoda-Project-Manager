// 権限モデル（3段階の役割＋管理者への個別付与）
//   owner  : フル権限（全ページ閲覧・全編集・アカウント管理／権限付与）
//   admin  : 全ページ閲覧OK。編集は「個別に許可された項目」だけ
//   member : 工数入力のみ編集可。その他は閲覧のみ。アカウント管理は開けない
//
// 管理者への個別付与フラグ（kosu_person の列）:
//   can_edit_accounts : アカウント管理を編集できる
//   can_edit_tasks    : ダッシュボードのタスク（優先・対応者・Ad Hoc等）を編集できる

import { computePages } from "./pages";

export const ROLES = ["owner", "admin", "member"];

// person（role・can_edit_*・pagePerms を持つ）から実効権限を算出する。
// ページ単位の権限（perms.pages）を計算し、既存の粗い権限フラグはそこから導出する。
//   viewAccounts = pages.accounts.view / editAccounts = pages.accounts.edit
//   editTasks    = pages.project.edit  / editKosu     = pages.kosuInput.edit
//   grantPerms   = オーナーのみ
export function effectivePerms(person) {
  const role = person?.role || "member";
  const cea = !!person?.can_edit_accounts;
  const cet = !!person?.can_edit_tasks;
  const pages = computePages(role, cea, cet, person?.pagePerms || null);
  return {
    role,
    pages,
    viewAccounts: pages.accounts.view,
    editAccounts: pages.accounts.edit,
    editTasks: pages.project.edit,
    editKosu: pages.kosuInput.edit,
    grantPerms: role === "owner",
  };
}

// 認証が無効（未設定・許可リスト空＝保護オフ）のときのフル権限。
// デモ／開発時に画面が使えなくならないようにする。
export const FULL_PERMS = {
  role: "owner",
  pages: computePages("owner", true, true, null),
  viewAccounts: true,
  editAccounts: true,
  editTasks: true,
  editKosu: true,
  grantPerms: true,
};
