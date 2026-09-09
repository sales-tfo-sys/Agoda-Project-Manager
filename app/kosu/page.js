import { redirect } from "next/navigation";

// 作業工数管理は廃止。中身（作業リソース詳細・工数明細）はダッシュボードの
// 「作業工数グラフ」「作業工数表」タブへ移した。古いブックマーク用にリダイレクトだけ残す。
export default function KosuRedirect() {
  redirect("/dashboard");
}
