import type { Cell, Sheet } from "./types";

/** RFC 4180-ish parser: quoted fields, embedded delimiters and newlines. */
function parseDelimited(input: string, delimiter: string, sheetName: string): Sheet {
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
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // Normalised before parsing; a stray CR is ignored.
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

/** Comma-separated, as used by the attendance importer. */
export function parseCsv(input: string, sheetName = "Sheet1"): Sheet {
  return parseDelimited(input.replace(/\r\n?/g, "\n").replace(/^﻿/, ""), ",", sheetName);
}

const DELIMITERS = [",", ";", "\t"];

function countOutsideQuotes(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) count += 1;
  }
  return count;
}

/**
 * Delimiter-tolerant parser for arbitrary client exports. Semicolon exports
 * are common in locales where the comma is the decimal separator, and tab is
 * what a spreadsheet puts on the clipboard.
 */
export function parseCsvAuto(input: string, sheetName = "Sheet1"): Sheet {
  const normalised = input.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const firstLine = normalised.split("\n").find((line) => line.trim() !== "") ?? "";

  let best = ",";
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = countOutsideQuotes(firstLine, delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return parseDelimited(normalised, bestCount === 0 ? "," : best, sheetName);
}
