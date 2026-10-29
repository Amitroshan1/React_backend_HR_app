import ClickableImage from "../../../components/ClickableImage";
import { openFirstImageInNewTab } from "../../../utils/openImageInNewTab";
import { useInventoryUpload } from "./InventoryUploadLock";

export { encodeInventoryFiles } from "./InventoryUploadLock";

export const truncateFileName = (name, max = 22) => {
  if (!name) return "";
  return name.length > max ? `${name.slice(0, max - 3)}...` : name;
};

export const readFileAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Failed to read: ${file.name}`));
    reader.readAsDataURL(file);
  });


const FIELD_META = {
  photos: {
    namesKey: "photoNames",
    uploadingKey: "photoUploading",
    pendingKey: "_uploadingPhotoNames",
  },
  receipts: {
    namesKey: "receiptNames",
    uploadingKey: "receiptUploading",
    pendingKey: "_uploadingReceiptNames",
  },
};

export function getFieldMeta(field) {
  return FIELD_META[field] || FIELD_META.photos;
}

/**
 * Table cell: upload button + file name list (photos or receipts).
 */
export function InventoryFileCell({
  row,
  field,
  buttonLabel,
  accept,
  imagesOnly = false,
  onUpload,
  onPreview,
}) {
  const { busy } = useInventoryUpload();
  const meta = getFieldMeta(field);
  const names = row[meta.namesKey] || [];
  const uploading = Boolean(row[meta.uploadingKey]) || busy;
  const pending = row[meta.pendingKey] || [];
  const count = (row[field] || []).length;

  const handleChange = (e) => {
    onUpload(row.id, field, e.target.files, { imagesOnly });
    e.target.value = "";
  };

  return (
    <td className="ana-td-photos">
      <div className="ana-photo-cell">
        <label
          className={`ana-photo-btn ${uploading ? "is-uploading" : ""}`}
          title={uploading ? "Processing file…" : `Select ${buttonLabel.toLowerCase()}`}
        >
          <input
            type="file"
            accept={accept}
            multiple
            style={{ display: "none" }}
            disabled={uploading}
            onChange={handleChange}
          />
          {uploading ? "Uploading…" : buttonLabel}
        </label>

        {(names.length > 0 || pending.length > 0) && (
          <ul className="ana-photo-file-list" aria-live="polite">
            {names.map((name, i) => (
              <li key={`${field}-done-${name}-${i}`} title={name}>
                <span className="ana-photo-file-name">{truncateFileName(name)}</span>
                <span className="ana-photo-file-status ana-photo-file-status--done">Ready</span>
              </li>
            ))}
            {uploading &&
              pending.map((name, i) => (
                <li key={`${field}-pending-${name}-${i}`} className="is-pending" title={name}>
                  <span className="ana-photo-file-name">{truncateFileName(name)}</span>
                  <span className="ana-photo-file-status">Uploading…</span>
                </li>
              ))}
          </ul>
        )}

        {count > 0 && onPreview && (
          <button
            type="button"
            className="ana-photo-count-btn"
            onClick={() => {
              const items = buildPreviewItems(row, field);
              const firstImage = items.find((it) => it.isImage);
              if (firstImage?.data && openFirstImageInNewTab([firstImage.data])) return;
              onPreview(row.id, field);
            }}
            title="Open photo in new tab"
          >
            View ({count})
          </button>
        )}
      </div>
    </td>
  );
}

export function FilePreviewModal({ items, title, onClose, onRemove }) {
  return (
    <div className="ana-photo-modal-backdrop" onClick={onClose}>
      <div className="ana-photo-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ana-photo-modal-head">
          <span>{title || `${items.length} file${items.length !== 1 ? "s" : ""}`}</span>
          <button type="button" className="ana-photo-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ana-photo-modal-body">
          <div className="ana-photo-grid">
            {items.map((item, i) => (
              <div key={i} className="ana-photo-item">
                {item.isImage ? (
                  <ClickableImage src={item.data} alt={item.name || ""} />
                ) : (
                  <div className="ana-file-preview-tag" title={item.name}>
                    📄 {truncateFileName(item.name, 18)}
                  </div>
                )}
                <button type="button" className="ana-photo-remove" onClick={() => onRemove(i)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function isInventoryImage(src) {
  const value = String(src || "");
  return (
    value.startsWith("data:image/") ||
    (value.startsWith("/api/files/") && !/\.pdf$/i.test(value.split("?")[0])) ||
    /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?|$)/i.test(value)
  );
}

/** Build preview items from parallel data + names arrays. */
export function buildPreviewItems(dataUrls = [], names = []) {
  return (dataUrls || []).map((data, i) => {
    const name = names[i] || `File ${i + 1}`;
    const isImage = isInventoryImage(data);
    return { data, name, isImage };
  });
}
