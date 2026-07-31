import { redirect } from "next/navigation";

// 作業リソースは工数管理ページに統合。旧URLはリダイレクトする。
export default function ResourceRedirect() {
  redirect("/kosu");
}
