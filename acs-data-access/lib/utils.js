
export function convert_to_csv (rows){
    if (!rows.length) return "";

    const headers = Object.keys(rows[0]);
    const lines = rows.map(row =>
        headers.map(h => JSON.stringify(row[h] ?? "")).join(",")
    );

    return [headers.join(","), ...lines].join("\n");
}


const toTime = d => d ? new Date(d).getTime() : null;

export function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return toTime(a) > toTime(b) ? a : b;
}

export function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return toTime(a) < toTime(b) ? a : b;
}