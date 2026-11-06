import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { Cell, Sheet } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

const MAX_ROWS = 5000;
const MAX_COLS = 512;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");

  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    let text = "";

    if (typeof record["#text"] === "string") text += record["#text"];

    for (const [key, value] of Object.entries(record)) {
      if (key === "#text" || key.startsWith("@_")) continue;
      if (key === "text:p" || key === "text:span" || key === "text:s" || key === "text:tab") {
        text += textOf(value);
      } else if (typeof value === "object") {
        text += textOf(value);
      }
    }

    return text;
  }

  return "";
}

function numericValue(cell: Record<string, unknown>, text: string): number | null {
  const officeValue = cell["@_office:value"];
  if (typeof officeValue === "string" && officeValue.trim() !== "" && Number.isFinite(Number(officeValue))) {
    return Number(officeValue);
  }

  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned !== "" && /^-?\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  return null;
}

function parseSheet(table: Record<string, unknown>): Sheet {
  const name = String(table["@_table:name"] ?? "Sheet");
  const rows: Cell[][] = [];
  const rawRows = asArray(table["table:table-row"] as Record<string, unknown> | Record<string, unknown>[]);

  for (const row of rawRows) {
    if (rows.length >= MAX_ROWS) break;

    const rowRepeat = Math.min(Number(row["@_table:number-rows-repeated"] ?? 1) || 1, 50);
    const cells: Cell[] = [];
    const rawCells = [
      ...asArray(row["table:table-cell"] as Record<string, unknown> | Record<string, unknown>[]),
    ];

    for (const cell of rawCells) {
      if (cells.length >= MAX_COLS) break;

      const repeat = Math.min(Number(cell["@_table:number-columns-repeated"] ?? 1) || 1, 256);
      const text = textOf(cell["text:p"] ?? cell).replace(/ /g, " ").trim();
      const value = numericValue(cell, text);

      for (let index = 0; index < repeat && cells.length < MAX_COLS; index += 1) {
        cells.push({ text, value });
      }
    }

    // Covered cells keep the column index aligned with headers.
    if (row["table:covered-table-cell"]) {
      const covered = asArray(
        row["table:covered-table-cell"] as Record<string, unknown> | Record<string, unknown>[],
      );
      for (const cell of covered) {
        const repeat = Math.min(Number(cell["@_table:number-columns-repeated"] ?? 1) || 1, 256);
        for (let index = 0; index < repeat && cells.length < MAX_COLS; index += 1) {
          cells.push({ text: "", value: null });
        }
      }
    }

    for (let copy = 0; copy < rowRepeat && rows.length < MAX_ROWS; copy += 1) {
      rows.push(cells.map((cell) => ({ ...cell })));
    }

    // Stop once we are far past the last populated row.
    if (cells.every((cell) => cell.text === "" && cell.value === null)) {
      const tail = rows.slice(-40);
      if (tail.every((candidate) => candidate.every((cell) => cell.text === "" && cell.value === null))) {
        break;
      }
    }
  }

  return { name, rows };
}

export function parseOds(buffer: Uint8Array): Sheet {
  const files = unzipSync(buffer);
  const content = files["content.xml"];
  if (!content) throw new Error("This .ods file has no content.xml");

  const document = parser.parse(strFromU8(content)) as Record<string, unknown>;
  const root = document["office:document-content"] as Record<string, unknown> | undefined;
  const body = root?.["office:body"] as Record<string, unknown> | undefined;
  const spreadsheet = body?.["office:spreadsheet"] as Record<string, unknown> | undefined;
  const tables = asArray(
    spreadsheet?.["table:table"] as Record<string, unknown> | Record<string, unknown>[],
  );

  if (tables.length === 0) throw new Error("No sheets found in the workbook");
  return parseSheet(tables[0] as Record<string, unknown>);
}
