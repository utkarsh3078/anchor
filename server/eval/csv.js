// Minimal CSV for the comparison sheets (eval/external.js): quoted cells may hold commas,
// quotes ("") and line breaks, which pasted answers do. Spreadsheet apps in some locales
// save with semicolons, so the separator is read from the header line.

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// rows: [{ column: value }] -> text with a header line
export function toCsv(columns, rows) {
  return `${[columns, ...rows.map((r) => columns.map((c) => r[c]))].map((line) => line.map(cell).join(',')).join('\r\n')}\r\n`;
}

// text -> [{ column: value }], every value a trimmed string
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const header = src.slice(0, src.search(/\r?\n|$/));
  const sep = !header.includes(',') && header.includes(';') ? ';' : ',';

  const lines = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"' && value === '') quoted = true;
    else if (ch === sep) {
      row.push(value);
      value = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(value);
      lines.push(row);
      row = [];
      value = '';
    } else value += ch;
  }
  if (value !== '' || row.length) {
    row.push(value);
    lines.push(row);
  }

  const [columns, ...body] = lines.filter((l) => l.some((v) => v.trim() !== ''));
  if (!columns) return [];
  const names = columns.map((c) => c.trim());
  return body.map((l) => Object.fromEntries(names.map((name, i) => [name, (l[i] ?? '').trim()])));
}
