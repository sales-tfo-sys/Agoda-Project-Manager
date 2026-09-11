import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import Shell from "./Shell";

// 欧文だけ IBM Plex Sans を使う（名前・メール・日付はほぼ欧文なので、
// 個性はここに乗る）。日本語はシステムのゴシックのままにして、
// CJK の webfont を落とさない＝表示が遅くならないようにしている。
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-latin",
  display: "swap",
});

export const metadata = {
  title: "Agoda Management System",
  description: "Agoda 案件の進捗を可視化・管理するプラットフォーム",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja" className={plex.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
