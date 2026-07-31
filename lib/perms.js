// 権限モデル（3段階の役割＋管理者への個別付与）
//   owner  : フル権限（全ページ閲覧・全編集・アカウント管理／権限付与）
//   admin  : 全ページ閲覧OK。編集は「個別に許可された項目」だけ
//   member : 工数入力のみ編集可。その他は閲覧のみ。アカウント管理は開けない
//
// 管理者への個別付与フラグ（kosu_person の列）:
//   can_edit_accounts : アカウント管理を編集できる
//   can_edit_tasks    : ダッシュボードのタスク（優先・対応者・Ad Hoc等）を編集できる

export const ROLES = ["owner", "admin", "member"];

// person（role と can_edit_* を持つ）から実効権限を算出する。
export function effectivePerms(person) {
  const role = person?.role || "member";
  if (role === "owner") {
    return {
      role: "owner",
      viewAccounts: true,
      editAccounts: true,
      editTasks: true,
      editKosu: true,
      // 役割・権限そのものを変更できるのはオーナーだけ
      grantPerms: true,
    };
  }
  if (role === "admin") {
    return {
      role: "admin",
      viewAccounts: true,
      editAccounts: !!person?.can_edit_accounts,
      editTasks: !!person?.can_edit_tasks,
      editKosu: true,
      grantPerms: false,
    };
  }
  return {
    role: "member",
    viewAccounts: false,
    editAccounts: false,
    editTasks: false,
    editKosu: true,
    grantPerms: false,
  };
}

// 認証が無効（未設定・許可リスト空＝保護オフ）のときのフル権限。
// デモ／開発時に画面が使えなくならないようにする。
export const FULL_PERMS = {
  role: "owner",
  viewAccounts: true,
  editAccounts: true,
  editTasks: true,
  editKosu: true,
  grantPerms: true,
};
