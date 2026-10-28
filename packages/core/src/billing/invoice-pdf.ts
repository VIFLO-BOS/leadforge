import PDFDocument from "pdfkit";
import { formatMinor } from "./money.js";

/**
 * Invoice PDFs, rendered with PDFKit (pdfkit, MIT, maintained by the foliojs project; pure
 * JavaScript with the standard PDF fonts built in, so no font files, headless browser or native
 * build). Everything on the page comes from the stored invoice; amounts are formatted from
 * integer minor units.
 */

export interface InvoicePdfInput {
  number: string;
  status: string;
  issuedAt: Date | null;
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  currency: string;
  lines: Array<{ description: string; quantity: number; unitMinor: bigint; amountMinor: bigint }>;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  billTo: { organizationName: string; email: string; country: string | null };
  payment: { reference: string; method: string | null } | null;
  /** Paid with a Paystack test key: no real money moved. Printed on the invoice. */
  testMode: boolean;
}

const day = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "-");

export function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: `Invoice ${input.number}`,
        Author: "LeadForge",
        Subject: `Invoice ${input.number}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 50;
    const right = 545;
    const width = right - left;

    doc.font("Helvetica-Bold").fontSize(20).text("LeadForge", left, 50);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#555555")
      .text("Business lead discovery", left, 74);
    doc
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("INVOICE", left, 50, { width, align: "right" });
    doc.font("Helvetica").fontSize(10);
    doc.text(`Number: ${input.number}`, left, 74, { width, align: "right" });
    doc.text(`Issued: ${day(input.issuedAt)}`, { width: width + left - left, align: "right" });
    doc.text(
      `Status: ${input.status.toUpperCase()}${input.paidAt ? ` (paid ${day(input.paidAt)})` : ""}`,
      { width, align: "right" },
    );

    if (input.testMode) {
      doc.moveDown(0.5);
      doc
        .font("Helvetica-Bold")
        .fillColor("#b3261e")
        .text(
          "TEST MODE: paid with a Paystack test key. No real money was charged.",
          left,
          undefined,
          { width, align: "right" },
        );
      doc.fillColor("#000000").font("Helvetica");
    }

    let y = 150;
    doc.font("Helvetica-Bold").fontSize(10).text("Bill to", left, y);
    doc.font("Helvetica").text(input.billTo.organizationName, left, y + 14);
    doc.text(input.billTo.email, left, y + 28);
    if (input.billTo.country) doc.text(input.billTo.country, left, y + 42);
    if (input.periodStart || input.periodEnd) {
      doc
        .font("Helvetica-Bold")
        .text("Service period", 330, y, { width: right - 330, align: "right" });
      doc
        .font("Helvetica")
        .text(`${day(input.periodStart)} to ${day(input.periodEnd)}`, 330, y + 14, {
          width: right - 330,
          align: "right",
        });
    }

    y = 230;
    const cols = { desc: left, qty: 330, unit: 380, amount: 460 };
    doc.font("Helvetica-Bold");
    doc.text("Description", cols.desc, y);
    doc.text("Qty", cols.qty, y, { width: 40, align: "right" });
    doc.text("Unit price", cols.unit, y, { width: 75, align: "right" });
    doc.text("Amount", cols.amount, y, { width: right - cols.amount, align: "right" });
    y += 16;
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#cccccc").stroke();
    y += 8;
    doc.font("Helvetica");
    for (const line of input.lines) {
      const h = doc.heightOfString(line.description, { width: cols.qty - cols.desc - 10 });
      doc.text(line.description, cols.desc, y, { width: cols.qty - cols.desc - 10 });
      doc.text(String(line.quantity), cols.qty, y, { width: 40, align: "right" });
      doc.text(formatMinor(line.unitMinor, input.currency), cols.unit, y, {
        width: 75,
        align: "right",
      });
      doc.text(formatMinor(line.amountMinor, input.currency), cols.amount, y, {
        width: right - cols.amount,
        align: "right",
      });
      y += Math.max(h, 12) + 8;
    }
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#cccccc").stroke();
    y += 10;
    const total = (label: string, value: bigint, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(label, 330, y, { width: 125, align: "right" });
      doc.text(formatMinor(value, input.currency), cols.amount, y, {
        width: right - cols.amount,
        align: "right",
      });
      y += 16;
    };
    total("Subtotal", input.subtotalMinor);
    total("Tax", input.taxMinor);
    total("Total", input.totalMinor, true);

    y += 20;
    doc.font("Helvetica").fontSize(9).fillColor("#555555");
    if (input.payment) {
      doc.text(
        `Payment reference: ${input.payment.reference}${input.payment.method ? ` (${input.payment.method})` : ""}`,
        left,
        y,
        { width },
      );
      y += 14;
    }
    doc.text(
      `Amounts in ${input.currency}. Payments are processed by Paystack; LeadForge never sees or stores card numbers.`,
      left,
      y,
      { width },
    );
    doc.end();
  });
}
