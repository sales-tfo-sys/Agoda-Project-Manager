import "./globals.css";
import Shell from "./Shell";

export const metadata = {
  title: "Agoda案件管理",
  description: "Kintone から取得した Agoda 案件の管理ダッシュボード",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
