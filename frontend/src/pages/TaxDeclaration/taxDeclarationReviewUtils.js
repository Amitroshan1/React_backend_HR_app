export async function parseApiResponse(res) {
    const text = await res.text();
    if (!text) return { ok: res.ok, data: {} };
    try {
        return { ok: res.ok, data: JSON.parse(text) };
    } catch {
        throw new Error(
            res.status === 404
                ? "Tax declaration API not found. Restart the backend server."
                : "Server returned an invalid response."
        );
    }
}

export function authHeaders() {
    const token = localStorage.getItem("token");
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}

export function formatAmount(val) {
    const n = Number(val);
    if (!Number.isFinite(n) || n === 0) return "—";
    return `₹${n.toLocaleString("en-IN")}`;
}

export function statusBadgeClass(status) {
    const s = (status || "").toLowerCase();
    if (s === "approved") return "tax-decl-status tax-decl-status--approved";
    if (s === "rejected") return "tax-decl-status tax-decl-status--rejected";
    if (s === "submitted") return "tax-decl-status tax-decl-status--submitted";
    return "tax-decl-status tax-decl-status--draft";
}

export function itemLabel(schema, sectionCode, itemCode) {
    const sec = (schema?.sections || []).find((s) => s.id === sectionCode);
    const item = (sec?.items || []).find((i) => i.code === itemCode);
    return item?.label || itemCode;
}

export function sectionTitle(schema, sectionCode) {
    const sec = (schema?.sections || []).find((s) => s.id === sectionCode);
    return sec?.title || sectionCode;
}

export function groupItemsBySection(items = []) {
    const groups = [];
    const seen = new Set();
    items.forEach((it) => {
        const code = it.section_code || "OTHER";
        if (!seen.has(code)) {
            seen.add(code);
            groups.push({
                sectionCode: code,
                items: items.filter((row) => (row.section_code || "OTHER") === code),
            });
        }
    });
    return groups;
}

export function docFilePath(doc) {
    if (!doc) return null;
    if (doc.file_path) return doc.file_path;
    const url = doc.url || "";
    const prefix = "/static/uploads/";
    if (url.startsWith(prefix)) return url.slice(prefix.length);
    return null;
}

/** Download a tax declaration supporting document (JWT-protected file route). */
export async function downloadDeclarationDocument(
    doc,
    { apiBase = "/api/accounts", downloadName } = {}
) {
    const path = docFilePath(doc);
    if (!path) throw new Error("File not available");

    const token = localStorage.getItem("token");
    if (!token) throw new Error("Session expired. Please login again.");

    const normalized = path.replace(/^\/+/, "").replace(/\\/g, "/");
    const res = await fetch(`${apiBase}/file/${normalized}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        let msg = "Unable to download file";
        try {
            const j = await res.json();
            msg = j?.message || j?.msg || msg;
        } catch {
            // ignore
        }
        throw new Error(msg);
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download =
        downloadName || doc.original_name || path.split("/").pop() || "document";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
}
