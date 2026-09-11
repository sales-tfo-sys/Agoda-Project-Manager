import "./globals.css";
import Shell from "./Shell";

export const metadata = {
  title: "Agoda Management System",
  description: "Agoda 案件の進捗を可視化・管理するプラットフォーム",
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
