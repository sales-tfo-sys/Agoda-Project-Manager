import { redirect } from "next/navigation";

// 作業工数管理は廃止。中身（作業リソース詳細・工数明細）はダッシュボードの
// 「作業工数表」タブ（一覧＝工数明細／グラフ＝作業リソース詳細）へ移した。古いブックマーク用にリダイレクトだけ残す。
export default function KosuRedirect() {
  redirect("/dashboard");
}
