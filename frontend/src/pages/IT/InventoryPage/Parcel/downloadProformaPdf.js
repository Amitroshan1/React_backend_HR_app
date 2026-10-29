import { jsPDF } from "jspdf";
import { amountInWords, invoiceTotals, lineAmount, money } from "./proformaInvoiceUtils";

const PAGE_W = 210;
const MARGIN = 12;

function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg"));
    };
    img.onerror = () => resolve("");
    img.src = `${window.location.origin}/saffo-logo.jpg`;
  });
}

function wrap(doc, text, x, y, maxW, lineH = 4.2) {
  const lines = doc.splitTextToSize(String(text || ""), maxW);
  lines.forEach((line, i) => doc.text(line, x, y + i * lineH));
  return y + lines.length * lineH;
}

export async function downloadProformaPdf(invoice) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const logo = await loadLogo();
  const totals = invoiceTotals(invoice.lines || []);
  let y = 14;

  if (logo) {
    doc.addImage(logo, "JPEG", MARGIN, 10, 42, 24);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(11, 31, 77);
  doc.text("PERFOMA INVOICE", PAGE_W - MARGIN, 20, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Invoice No: ${invoice.invoiceNo || "-"}`, PAGE_W - MARGIN, 28, { align: "right" });

  y = 40;
  const boxW = (PAGE_W - MARGIN * 2) / 4;
  const boxH = 14;
  const metaRows = [
    [
      ["Invoice Date:", invoice.invoiceDate],
      ["Place of Receipt:", invoice.placeOfReceipt],
      ["Port of Loading:", invoice.portOfLoading],
      ["Country of Origin:", invoice.countryOfOrigin],
    ],
    [
      ["Terms of Delivery:", invoice.termsOfDelivery],
      ["Final Destination:", invoice.finalDestination],
      ["Port of Discharge:", invoice.portOfDischarge],
      ["Buyer Ref:", invoice.buyerRef || "-"],
    ],
  ];
  doc.setDrawColor(216, 222, 232);
  metaRows.forEach((row) => {
    row.forEach((cell, i) => {
      const x = MARGIN + i * boxW;
      doc.setFillColor(247, 249, 252);
      doc.rect(x, y, boxW, boxH, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(cell[0], x + 2, y + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(String(cell[1] || "-"), x + 2, y + 10.5);
    });
    y += boxH;
  });
  y += 7;

  const colW = (PAGE_W - MARGIN * 2 - 4) / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setFillColor(241, 245, 249);
  doc.rect(MARGIN, y, colW, 7, "F");
  doc.rect(MARGIN + colW + 4, y, colW, 7, "F");
  doc.text("CONSIGNOR (FROM)", MARGIN + 2, y + 5);
  doc.text("CONSIGNEE (TO)", MARGIN + colW + 6, y + 5);
  y += 11;

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(invoice.consignor.name || "", MARGIN + 2, y);
  doc.text(invoice.consignee.name || "", MARGIN + colW + 6, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  const leftEnd = wrap(doc, invoice.consignor.address, MARGIN + 2, y, colW - 4);
  const rightEnd = wrap(doc, invoice.consignee.address, MARGIN + colW + 6, y, colW - 4);
  y = Math.max(leftEnd, rightEnd) + 5;
  doc.setFont("helvetica", "bold");
  doc.text(`Contact Person: ${invoice.consignor.contactPerson || "-"}`, MARGIN + 2, y);
  doc.text(`Contact Person: ${invoice.consignee.contactPerson || "-"}`, MARGIN + colW + 6, y);
  y += 5;
  doc.text(`Mobile: ${invoice.consignor.mobile || "-"}`, MARGIN + 2, y);
  doc.text(`Mobile: ${invoice.consignee.mobile || "-"}`, MARGIN + colW + 6, y);
  y += 8;

  const headers = ["S.NO.", "DESCRIPTION & SPECIFICATIONS", "SERIAL NO", "WEIGHT", "QTY", "RATE (INR)", "AMOUNT (INR)"];
  const widths = [12, 62, 32, 18, 14, 22, 26];
  const startX = MARGIN;
  doc.setFillColor(15, 23, 42);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  let x = startX;
  doc.rect(startX, y, widths.reduce((a, b) => a + b, 0), 8, "F");
  headers.forEach((h, i) => {
    const align = i >= 4 ? "right" : "left";
    const tx = align === "right" ? x + widths[i] - 1.5 : x + 1.5;
    doc.text(h, tx, y + 5.2, { align });
    x += widths[i];
  });
  y += 8;
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  (invoice.lines || []).forEach((line, idx) => {
    if (y > 250) {
      doc.addPage();
      y = 16;
    }
    const rowH = 9;
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(startX, y, widths.reduce((a, b) => a + b, 0), rowH, "F");
    }
    const cells = [
      String(idx + 1),
      line.description || "",
      line.serialNo || "-",
      line.weight || "-",
      String(line.qty || "0"),
      money(line.rate),
      money(lineAmount(line)),
    ];
    x = startX;
    cells.forEach((cell, i) => {
      const align = i >= 4 ? "right" : "left";
      const tx = align === "right" ? x + widths[i] - 1.5 : x + 1.5;
      const clipped = doc.splitTextToSize(String(cell), widths[i] - 3)[0] || "";
      doc.text(clipped, tx, y + 5.6, { align });
      x += widths[i];
    });
    y += rowH;
  });

  doc.setFont("helvetica", "bold");
  doc.setFillColor(241, 245, 249);
  doc.rect(startX, y, widths.reduce((a, b) => a + b, 0), 8, "F");
  x = startX;
  const totalCells = ["", "TOTAL", "", `${totals.weight || 0} kg`, String(totals.qty), "", money(totals.amount)];
  totalCells.forEach((cell, i) => {
    const align = i >= 4 ? "right" : "left";
    const tx = align === "right" ? x + widths[i] - 1.5 : x + 1.5;
    doc.text(cell, tx, y + 5.4, { align });
    x += widths[i];
  });
  y += 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Amount in Words: ${amountInWords(totals.amount)}`, MARGIN, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text("Declaration:", MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  y = wrap(
    doc,
    "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
    MARGIN,
    y,
    PAGE_W - MARGIN * 2,
  );
  y += 6;
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("Note: This is a computer-generated bill signature doesn’t Require.", MARGIN, y);
  y += 12;
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("For SAFFO SOLUTION TECHNOLOGY", PAGE_W - MARGIN, y, { align: "right" });
  y += 16;
  doc.setDrawColor(148, 163, 184);
  doc.line(PAGE_W - 70, y, PAGE_W - MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Authorized Signatory", PAGE_W - MARGIN, y + 5, { align: "right" });

  const file = `Perfoma_Invoice_${invoice.invoiceNo || "SAFFO"}.pdf`;
  doc.save(file);
}
