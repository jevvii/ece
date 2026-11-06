import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export type Form2316Data = {
  year: number;
  employee: { name: string; tin: string | null };
  employer: { name: string; tin: string | null; address: string | null };
  figures: {
    gross: number;
    nonTaxable: number;
    taxable: number;
    taxDue: number;
    taxWithheld: number;
    basic: number;
    allowance: number;
    premium: number;
  };
  watermark: boolean;
};

const amount = (value: number) =>
  new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

const parts = (tin: string | null) => (tin ? tin.split("-") : ["", "", "", ""]);

export async function buildForm2316(data: Form2316Data): Promise<Uint8Array> {
  const template = await readFile(path.join(process.cwd(), "public", "forms", "bir-2316-2021.pdf"));
  const pdf = await PDFDocument.load(template);
  const page = pdf.getPages()[0];
  if (!page) throw new Error("The 2316 template has no pages");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const height = page.getHeight();
  const ink = rgb(0.05, 0.05, 0.05);

  const draw = (
    text: string,
    x: number,
    top: number,
    options: { size?: number; align?: "left" | "right"; maxWidth?: number } = {},
  ) => {
    if (!text) return;
    let size = options.size ?? 7.5;
    let value = text;

    if (options.maxWidth) {
      while (size > 5.5 && font.widthOfTextAtSize(value, size) > options.maxWidth) size -= 0.25;
      while (value.length > 4 && font.widthOfTextAtSize(value, size) > options.maxWidth) {
        value = `${value.slice(0, -2)}…`;
      }
    }

    const width = font.widthOfTextAtSize(value, size);
    page.drawText(value, {
      x: options.align === "right" ? x - width : x,
      y: height - top,
      size,
      font,
      color: ink,
    });
  };

  const money = (value: number, x: number, top: number) =>
    draw(amount(value), x, top, { align: "right", size: 7.5 });

  /* Header */
  draw(String(data.year), 130, 105, { size: 8 });
  draw(`01/01/${data.year}`, 390, 105, { size: 7 });
  draw(`12/31/${data.year}`, 516, 105, { size: 7 });

  const employeeTin = parts(data.employee.tin);
  draw(employeeTin[0] ?? "", 90, 133, { size: 7 });
  draw(employeeTin[1] ?? "", 140, 133, { size: 7 });
  draw(employeeTin[2] ?? "", 190, 133, { size: 7 });
  draw(employeeTin[3] ?? "", 240, 133, { size: 7 });

  draw(data.employee.name, 46, 159, { size: 7.5, maxWidth: 205 });
  draw(data.employer.name, 46, 371, { size: 7.5, maxWidth: 258 });
  draw(data.employer.address ?? "", 46, 397, { size: 6.5, maxWidth: 205 });

  const employerTin = parts(data.employer.tin);
  draw(employerTin[0] ?? "", 90, 346, { size: 7 });
  draw(employerTin[1] ?? "", 140, 346, { size: 7 });
  draw(employerTin[2] ?? "", 190, 346, { size: 7 });
  draw(employerTin[3] ?? "", 240, 346, { size: 7 });

  // Main employer marker
  draw("X", 118, 416, { size: 7 });

  /* Part IV-A — summary (left column amounts end at x=272) */
  money(data.figures.gross, 307, 523);
  money(data.figures.nonTaxable, 307, 542);
  money(data.figures.taxable, 307, 561);
  money(0, 307, 581);
  money(data.figures.taxable, 307, 599);
  money(data.figures.taxDue, 307, 619);
  money(data.figures.taxWithheld, 307, 638);
  money(data.figures.taxWithheld, 307, 677);
  money(0, 307, 697);
  money(data.figures.taxWithheld, 307, 717);

  /* Part IV-B — non-taxable (right column amounts end at x=550) */
  money(0, 583, 250); // 34 13th month paid
  money(data.figures.nonTaxable, 583, 288); // 36 SSS/PHIC/Pag-IBIG
  money(data.figures.nonTaxable, 583, 327); // 38 total non-taxable

  /* Part IV-B — taxable regular */
  money(data.figures.basic, 583, 365); // 39 basic
  money(data.figures.allowance, 583, 469); // 44 others
  draw("Allowance", 346, 470, { size: 6.5, maxWidth: 120 }); // 44A specification
  money(data.figures.premium, 583, 610); // 50 overtime
  money(data.figures.taxable, 583, 677); // 52 total taxable

  if (data.watermark) {
    page.drawText("DEMO — NOT FOR FILING", {
      x: 96,
      y: 430,
      size: 34,
      font,
      color: rgb(0.63, 0.18, 0.18),
      opacity: 0.16,
      rotate: degrees(32),
    });
  }

  return pdf.save();
}
