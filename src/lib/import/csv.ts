import type { Cell, Sheet } from "./types";

/** RFC 4180-ish parser: quoted fields, embedded commas and newlines. */
export function parseCsv(input: string, sheetName = "Sheet1"): Sheet {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // handled by the following \n
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return {
    name: sheetName,
    rows: rows.map((values) =>
      values.map<Cell>((text) => {
        const cleaned = text.replace(/,/g, "").trim();
        const numeric = cleaned !== "" && /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
        return { text: text.trim(), value: numeric };
      }),
    ),
  };
}
