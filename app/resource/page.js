import { redirect } from "next/navigation";

// 作業リソースはダッシュボードの「作業工数グラフ」タブに統合。旧URLはリダイレクトする。
export default function ResourceRedirect() {
  redirect("/dashboard");
}
