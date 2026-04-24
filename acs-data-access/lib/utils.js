
export const convert_to_csv = (rows) => {
    if (!rows.length) return "";

    const headers = Object.keys(rows[0]);
    const lines = rows.map(row =>
        headers.map(h => JSON.stringify(row[h] ?? "")).join(",")
    );

    return [headers.join(","), ...lines].join("\n");
}