import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { Cell, Sheet } from "./types";

/**
 * Minimal XLSX reader: workbook -> sheet relationship -> worksheet XML.
 *
 * Only what a roster needs — cell text and numbers. Formatting, styles and
 * formulas are ignored. Date cells therefore arrive as Excel serial numbers;
 * the employee importer converts them once it knows which column is a date.
 */

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

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");

  const record = node as Record<string, unknown>;
  let text = "";
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("@_")) continue;
    if (key === "t" || key === "#text") text += textOf(value);
    else if (typeof value === "object") text += textOf(value);
  }
  return text;
}

function columnIndex(ref: string | undefined, fallback: number) {
  const letters = typeof ref === "string" ? ref.match(/^[A-Z]+/i)?.[0] : undefined;
  if (!letters) return fallback;
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function rowIndex(ref: string | undefined, fallback: number) {
  if (typeof ref !== "string") return fallback;
  const digits = ref.match(/\d+$/)?.[0];
  return digits ? Number(digits) - 1 : fallback;
}

function resolveTarget(target: string) {
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

function parseWorksheet(xml: string, shared: string[], name: string): Sheet {
  const document = parser.parse(xml) as Record<string, unknown>;
  const worksheet = document["worksheet"] as Record<string, unknown> | undefined;
  const sheetData = worksheet?.["sheetData"] as Record<string, unknown> | undefined;
  const rawRows = asArray(sheetData?.["row"] as Record<string, unknown> | Record<string, unknown>[]);

  const sparse: Cell[][] = [];
  let lastRow = -1;

  for (const row of rawRows) {
    const target = rowIndex(row["@_r"] as string | undefined, lastRow + 1);
    if (target < 0 || target >= MAX_ROWS) continue;

    const cells: Cell[] = [];
    let position = 0;

    for (const cell of asArray(row["c"] as Record<string, unknown> | Record<string, unknown>[])) {
      const column = columnIndex(cell["@_r"] as string | undefined, position);
      position = column + 1;
      if (column < 0 || column >= MAX_COLS) continue;

      while (cells.length < column) cells.push({ text: "", value: null });

      const type = cell["@_t"];
      let text: string;
      if (type === "s") {
        text = shared[Number(cell["v"])] ?? "";
      } else if (type === "inlineStr") {
        text = textOf(cell["is"]);
      } else {
        text = textOf(cell["v"]);
      }

      text = text.replace(/ /g, " ").trim();
      const cleaned = text.replace(/,/g, "");
      const numeric = cleaned !== "" && /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
      cells.push({ text, value: numeric });
    }

    sparse[target] = cells;
    if (target > lastRow) lastRow = target;
  }

  const rows: Cell[][] = Array.from({ length: lastRow + 1 }, (_, index) => sparse[index] ?? []);
  return { name, rows };
}

export function parseXlsx(buffer: Uint8Array): Sheet[] {
  const files = unzipSync(buffer);

  const workbookFile = files["xl/workbook.xml"];
  if (!workbookFile) throw new Error("This .xlsx file has no workbook.xml");

  const workbook = parser.parse(strFromU8(workbookFile)) as Record<string, unknown>;
  const root = workbook["workbook"] as Record<string, unknown> | undefined;
  const sheetsNode = root?.["sheets"] as Record<string, unknown> | undefined;
  const sheetEntries = asArray(
    sheetsNode?.["sheet"] as Record<string, unknown> | Record<string, unknown>[],
  );

  const shared: string[] = [];
  const sharedFile = files["xl/sharedStrings.xml"];
  if (sharedFile) {
    const sst = parser.parse(strFromU8(sharedFile)) as Record<string, unknown>;
    const entries = asArray(
      (sst["sst"] as Record<string, unknown> | undefined)?.["si"] as
        | Record<string, unknown>
        | Record<string, unknown>[],
    );
    for (const entry of entries) shared.push(textOf(entry));
  }

  const relationships = new Map<string, string>();
  const relsFile = files["xl/_rels/workbook.xml.rels"];
  if (relsFile) {
    const rels = parser.parse(strFromU8(relsFile)) as Record<string, unknown>;
    const list = asArray(
      (rels["Relationships"] as Record<string, unknown> | undefined)?.["Relationship"] as
        | Record<string, unknown>
        | Record<string, unknown>[],
    );
    for (const relationship of list) {
      const id = relationship["@_Id"];
      const target = relationship["@_Target"];
      if (typeof id === "string" && typeof target === "string") {
        relationships.set(id, resolveTarget(target));
      }
    }
  }

  const sheets: Sheet[] = [];

  for (const [index, entry] of sheetEntries.entries()) {
    const name = String(entry["@_name"] ?? `Sheet${index + 1}`);
    const relId = entry["@_r:id"];
    const path =
      typeof relId === "string" && relationships.has(relId)
        ? relationships.get(relId)!
        : `xl/worksheets/sheet${index + 1}.xml`;

    const xml = files[path];
    if (!xml) continue;

    sheets.push(parseWorksheet(strFromU8(xml), shared, name));
  }

  if (sheets.length === 0) throw new Error("No sheets found in the workbook");
  return sheets;
}
