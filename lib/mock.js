// 未接続時に画面の動作を確認するためのデモデータ。
// Kintone のレコード形式（各値が { type, value }）を模している。
export const mockFields = {
  施設名: { label: "施設名", type: "SINGLE_LINE_TEXT" },
  案件タイプ: { label: "案件タイプ", type: "DROP_DOWN" },
  ステータス: { label: "ステータス", type: "DROP_DOWN" },
  区分: { label: "区分(full/self)", type: "RADIO_BUTTON" },
  依頼日: { label: "依頼日", type: "DATE" },
  担当者: { label: "担当者", type: "USER_SELECT" },
};

function rec(id, 施設名, 案件タイプ, ステータス, 区分, 依頼日, 担当者) {
  return {
    $id: { type: "__ID__", value: String(id) },
    施設名: { type: "SINGLE_LINE_TEXT", value: 施設名 },
    案件タイプ: { type: "DROP_DOWN", value: 案件タイプ },
    ステータス: { type: "DROP_DOWN", value: ステータス },
    区分: { type: "RADIO_BUTTON", value: 区分 },
    依頼日: { type: "DATE", value: 依頼日 },
    担当者: { type: "USER_SELECT", value: [{ code: "u1", name: 担当者 }] },
  };
}

export const mockRecords = [
  rec(1, "ホテルサンライズ大阪", "Hotel 依頼", "7.販売開始確認（完了）", "full", "2026-01-12", "田中"),
  rec(2, "京都ステイイン", "Hotel 依頼", "3-2.サイン接続待ち", "self", "2026-04-03", "佐藤"),
  rec(3, "THE FIRST ONE 福岡", "ACQ", "完了", "self", "2026-02-20", "鈴木"),
  rec(4, "浅草リバーサイド", "ACQ", "CM情報待ち", "self", "2026-05-09", "田中"),
  rec(5, "札幌グランドイン", "Liberty", "完了", "full", "2026-03-15", "高橋"),
  rec(6, "沖縄ビーチヴィラ", "Temairazu", "7.販売開始確認（完了）", "self", "2026-04-22", "佐藤"),
  rec(7, "神戸ハーバーホテル", "IHM", "完了（Plan）", "self", "2026-06-01", "鈴木"),
  rec(8, "名古屋セントラル", "Hotel 依頼", "2.YCS作業中", "full", "2026-06-18", "田中"),
];
