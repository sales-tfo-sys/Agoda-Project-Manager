# デプロイ手順（Vercel）

本アプリは Next.js 15（App Router）製で、`npm run build` が通る本番対応済みです。
Vercel へは **Vercel CLI** か **GitHub 連携** のどちらかでデプロイできます。

---

## 事前準備：環境変数

Vercel のプロジェクト設定（Settings → Environment Variables）に以下を登録します。
値はローカルの `.env.local` と同じものです。**API トークンはコード/Git には含めず、Vercel 側にのみ登録**してください。

| キー | 例 | 必須 |
|---|---|---|
| `KINTONE_SUBDOMAIN` | `cnctor` | ✅ |
| `KINTONE_APP_ID` | `123` | ✅ |
| `KINTONE_API_TOKEN` | （閲覧権限のトークン） | ✅ |
| `KINTONE_DOMAIN` | `cybozu.com` | 任意 |
| `KOSU_SHEET_ID` / `KOSU_GID` / `RESOURCE_GID` | （既定値あり） | 任意 |

> ⚠️ 「作業工数管理」「作業リソース」シートは **リンク共有（閲覧可）** の状態で取得しています。
> 共有を解除するとサイトから読めなくなります。継続利用するにはリンク共有を維持してください。

---

## 方法A：Vercel CLI（最短・GitHub不要）

```bash
npm i -g vercel
cd "C:/Users/Admin/Downloads/Agoda管理"
vercel
```

- 初回はブラウザでログインを求められます（ご自身で実施してください）。
- プロジェクト名などは Enter で既定のまま進めてOK。
- デプロイ後、`vercel env add` で上記の環境変数を登録 →`vercel --prod` で本番公開。

## 方法B：GitHub 連携（自動デプロイしたい場合）

```bash
cd "C:/Users/Admin/Downloads/Agoda管理"
git init
git add .
git commit -m "Agoda案件管理サイト 初期構成"
# GitHub にリポジトリを作成し push（gh CLI or ブラウザ）
```

その後、Vercel ダッシュボードで「Import Project」→ 対象リポジトリを選択 → 環境変数を登録 → Deploy。
以降は push するたびに自動デプロイされます。

---

## デプロイ後の確認

- `/`（一覧）, `/dashboard`, `/graphs`, `/details`, `/kosu` が表示されること
- ヘッダーの「Kintone 接続済み」チェックが緑になっていること（＝環境変数が効いている）

## 認証（クライアント公開時）

現状は認証なしの内部利用向けです。クライアントへ限定公開する場合は Supabase Auth 等の導入が必要です（別フェーズ）。
