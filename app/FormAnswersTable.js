"use client";

// フォーム回答（スプレッドシート）の回答を表で出す。
// 管理 → フォーム回答 と、作業依頼の Temairazu タブで同じものを使う。

// 検索に当たった行だけを返す。番号は元のままにして、シートと突き合わせられるようにする。
// q は全部の列を対象にした部分一致（大文字小文字は区別しない）。
export function filterFormRows(grid, q) {
  const rows = grid?.rows || [];
  const kw = String(q || "").trim().toLowerCase();
  const all = rows.map((r, ri) => ({ r, no: ri + 1 }));
  if (!kw) return all;
  return all.filter(({ r }) => r.some((v) => String(v ?? "").toLowerCase().includes(kw)));
}

export default function FormAnswersTable({ headers, rows, q }) {
  return (
    <div className="card no-pad">
      <div className="tw forms-tw">
        <table>
          <thead>
            <tr>
              <th className="forms-rownum">#</th>
              {headers.map((h, ci) => (
                <th key={ci}>{h || ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, no }) => (
              <tr key={no}>
                <td className="forms-rownum">{no}</td>
                {headers.map((_, ci) => {
                  const v = r[ci] ?? "";
                  // チェックボックス列（TRUE/FALSE）はチェックボックス表記で表示
                  const b = String(v).trim().toUpperCase();
                  const isBool = b === "TRUE" || b === "FALSE";
                  return (
                    <td key={ci} className={isBool ? "forms-check-cell" : undefined} title={v || undefined}>
                      {isBool ? (
                        <span
                          className={"forms-check" + (b === "TRUE" ? " on" : "")}
                          role="img"
                          aria-label={b === "TRUE" ? "チェックあり" : "チェックなし"}
                        />
                      ) : (
                        v
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && q && (
          <div className="notice forms-empty">「{q}」に当てはまる回答はありません。</div>
        )}
      </div>
    </div>
  );
}
