/** Shared Day-use request display helpers. */

export function dayUseItemsLabel(row) {
  if (row?.items_summary) return row.items_summary;
  if (Array.isArray(row?.items) && row.items.length) {
    return row.items
      .map((it) =>
        it.line_type === "accessory"
          ? `${it.description || "Accessory"} ×${it.quantity || 1}`
          : `${it.hw_type || "Device"} ×${it.quantity || 1}`,
      )
      .join(", ");
  }
  return row?.requested_hw_type || "—";
}

/** Three lifecycle timestamps for a request. */
export function dayUseTimeline(row) {
  return {
    requestedAt: row?.created_at || null,
    assignedAt: row?.assignment?.assigned_at || null,
    returnedAt: row?.return?.completed_at || row?.return?.received_at || null,
  };
}

export function dayUseItRemark(row) {
  const status = String(row?.status || "").toLowerCase();
  if (status === "rejected") return { label: "Rejection remark", text: (row.rejection_reason || "").trim() };
  if (status === "returned") return { label: "Return remark", text: (row.return?.remarks || "").trim() };
  return { label: "", text: "" };
}
