import { useMemo, useState } from "react";
import { toast as rtToast } from "react-toastify";
import { downloadProformaPdf } from "./downloadProformaPdf";
import {
  amountInWords,
  emptyParty,
  invoiceTotals,
  lineAmount,
  linesFromAssets,
  money,
  todayInvoiceDate,
} from "./proformaInvoiceUtils";
import "./ProformaInvoiceForm.css";

function Field({ label, value, onChange, multiline = false, placeholder = "" }) {
  return (
    <label className="pi-field">
      <span>{label}</span>
      {multiline ? (
        <textarea rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export default function ProformaInvoiceForm({ selectedAssets, onExport, onCancel, busy }) {
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayInvoiceDate);
  const [placeOfReceipt, setPlaceOfReceipt] = useState("");
  const [portOfLoading, setPortOfLoading] = useState("");
  const [countryOfOrigin, setCountryOfOrigin] = useState("");
  const [termsOfDelivery, setTermsOfDelivery] = useState("");
  const [finalDestination, setFinalDestination] = useState("");
  const [portOfDischarge, setPortOfDischarge] = useState("");
  const [buyerRef, setBuyerRef] = useState("");
  const [consignor, setConsignor] = useState(emptyParty);
  const [consignee, setConsignee] = useState(emptyParty);
  const [lines, setLines] = useState(() => linesFromAssets(selectedAssets));
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => invoiceTotals(lines), [lines]);

  const updateParty = (setter, key, value) => {
    setter((prev) => ({ ...prev, [key]: value }));
  };

  const updateLine = (id, key, value) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, [key]: value } : line)));
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { id: `custom-${Date.now()}`, description: "", serialNo: "", weight: "1 KG", qty: "1", rate: "" },
    ]);
  };

  const removeLine = (id) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((line) => line.id !== id) : prev));
  };

  const invoicePayload = () => ({
    invoiceNo,
    invoiceDate,
    placeOfReceipt,
    portOfLoading,
    countryOfOrigin,
    termsOfDelivery,
    finalDestination,
    portOfDischarge,
    buyerRef,
    consignor,
    consignee,
    lines,
  });

  const handleExport = async () => {
    if (!consignee.name.trim() && !finalDestination.trim()) {
      rtToast.error("Enter consignee name or final destination.");
      return;
    }
    if (!lines.some((line) => String(line.description || "").trim())) {
      rtToast.error("Add at least one item description.");
      return;
    }
    setSaving(true);
    try {
      await downloadProformaPdf(invoicePayload());
      await onExport({
        destination: finalDestination.trim() || consignee.name.trim(),
        idNo: invoiceNo.trim(),
        exportedBy: consignor.contactPerson.trim() || consignor.name.trim() || "Export",
        parcelPhotos: [],
      });
    } catch (err) {
      rtToast.error(err?.message || "Could not create the invoice PDF.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pi-page">
      <div className="pi-toolbar">
        <button type="button" className="pi-btn-ghost" onClick={onCancel} disabled={saving || busy}>
          ← Back
        </button>
        <div>
          <h1>Proforma Invoice</h1>
          <p>Edit any field, then export to save the shipment and download the PDF.</p>
        </div>
      </div>

      <article className="pi-sheet">
        <header className="pi-head">
          <div className="pi-head-top">
            <img src="/saffo-logo.jpg" alt="Saffo" className="pi-logo" />
            <div className="pi-head-title">
              <h2>PERFOMA INVOICE</h2>
              <label className="pi-invoice-no">
                <span>Invoice No:</span>
                <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
              </label>
            </div>
          </div>
          <table className="pi-meta-table">
            <tbody>
              <tr>
                <td>
                  <Field label="Invoice Date:" value={invoiceDate} onChange={setInvoiceDate} />
                </td>
                <td>
                  <Field label="Place of Receipt:" value={placeOfReceipt} onChange={setPlaceOfReceipt} />
                </td>
                <td>
                  <Field label="Port of Loading:" value={portOfLoading} onChange={setPortOfLoading} />
                </td>
                <td>
                  <Field label="Country of Origin:" value={countryOfOrigin} onChange={setCountryOfOrigin} />
                </td>
              </tr>
              <tr>
                <td>
                  <Field label="Terms of Delivery:" value={termsOfDelivery} onChange={setTermsOfDelivery} />
                </td>
                <td>
                  <Field label="Final Destination:" value={finalDestination} onChange={setFinalDestination} />
                </td>
                <td>
                  <Field label="Port of Discharge:" value={portOfDischarge} onChange={setPortOfDischarge} />
                </td>
                <td>
                  <Field label="Buyer Ref:" value={buyerRef} onChange={setBuyerRef} />
                </td>
              </tr>
            </tbody>
          </table>
        </header>

        <section className="pi-parties">
          <div>
            <h3>CONSIGNOR (FROM)</h3>
            <Field label="Name" value={consignor.name} onChange={(v) => updateParty(setConsignor, "name", v)} />
            <Field label="Address" multiline value={consignor.address} onChange={(v) => updateParty(setConsignor, "address", v)} />
            <Field label="Contact Person" value={consignor.contactPerson} onChange={(v) => updateParty(setConsignor, "contactPerson", v)} />
            <Field label="Mobile" value={consignor.mobile} onChange={(v) => updateParty(setConsignor, "mobile", v)} />
          </div>
          <div>
            <h3>CONSIGNEE (TO)</h3>
            <Field label="Name" value={consignee.name} onChange={(v) => updateParty(setConsignee, "name", v)} />
            <Field label="Address" multiline value={consignee.address} onChange={(v) => updateParty(setConsignee, "address", v)} />
            <Field label="Contact Person" value={consignee.contactPerson} onChange={(v) => updateParty(setConsignee, "contactPerson", v)} />
            <Field label="Mobile" value={consignee.mobile} onChange={(v) => updateParty(setConsignee, "mobile", v)} />
          </div>
        </section>

        <div className="pi-table-wrap">
          <table className="pi-table">
            <thead>
              <tr>
                <th>S.NO.</th>
                <th>DESCRIPTION & SPECIFICATIONS</th>
                <th>SERIAL NO</th>
                <th>WEIGHT</th>
                <th>QTY</th>
                <th>RATE (INR)</th>
                <th>AMOUNT (INR)</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={line.id}>
                  <td>{idx + 1}</td>
                  <td>
                    <input value={line.description} onChange={(e) => updateLine(line.id, "description", e.target.value)} />
                  </td>
                  <td>
                    <input value={line.serialNo} onChange={(e) => updateLine(line.id, "serialNo", e.target.value)} />
                  </td>
                  <td>
                    <input value={line.weight} onChange={(e) => updateLine(line.id, "weight", e.target.value)} />
                  </td>
                  <td>
                    <input type="number" min="1" value={line.qty} onChange={(e) => updateLine(line.id, "qty", e.target.value)} />
                  </td>
                  <td>
                    <input type="number" min="0" step="0.01" value={line.rate} onChange={(e) => updateLine(line.id, "rate", e.target.value)} />
                  </td>
                  <td className="pi-amount">{money(lineAmount(line))}</td>
                  <td>
                    <button type="button" className="pi-remove" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>TOTAL</td>
                <td>{totals.weight ? `${totals.weight} kg` : "—"}</td>
                <td>{totals.qty}</td>
                <td />
                <td className="pi-amount">{money(totals.amount)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <button type="button" className="pi-add-line" onClick={addLine}>+ Add item</button>
        </div>

        <p className="pi-words">
          <strong>Amount in Words:</strong> {amountInWords(totals.amount)}
        </p>
        <p className="pi-decl">
          <strong>Declaration:</strong> We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
        </p>
        <p className="pi-note">Note: This is a computer-generated bill signature doesn’t Require.</p>
        <p className="pi-sign">For SAFFO SOLUTION TECHNOLOGY</p>
      </article>

      <div className="pi-footer">
        <button type="button" className="pi-btn-export" onClick={handleExport} disabled={saving || busy}>
          {saving || busy ? "Exporting…" : "Export & Download PDF"}
        </button>
      </div>
    </div>
  );
}
