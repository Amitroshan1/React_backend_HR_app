"""Full-page tiled SAFFO watermark for generated and uploaded PDF downloads."""
from __future__ import annotations

import mimetypes
import os
from io import BytesIO

from flask import send_file
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

WATERMARK_TEXT = "SAFFO"

# Muted warm bronze — professional on white documents.
WATERMARK_RGB = (0.71, 0.55, 0.40)


def draw_page_watermark(
    c,
    text: str = WATERMARK_TEXT,
    page_w: float | None = None,
    page_h: float | None = None,
    *,
    font_size: int = 9,
    alpha: float = 0.13,
    gap_x: float = 7,
    gap_y: float = 5,
) -> None:
    """Tile watermark text horizontally across the full page (background layer)."""
    if page_w is None or page_h is None:
        page_w, page_h = A4

    font_name = "Helvetica-Bold"
    c.saveState()
    c.setFillColor(colors.Color(*WATERMARK_RGB, alpha=alpha))
    c.setFont(font_name, font_size)

    text_w = stringWidth(text, font_name, font_size)
    step_x = text_w + gap_x
    step_y = font_size + gap_y

    cols = int(page_w / step_x) + 2

    y = page_h - font_size - 4
    while y >= -step_y:
        x = 6
        for _ in range(cols):
            c.drawString(x, y, text)
            x += step_x
        y -= step_y

    c.restoreState()


draw_diagonal_watermark = draw_page_watermark


def install_page_watermark(c, pagesize=A4) -> None:
    """Watermark the first page and every page created via showPage()."""
    width, height = pagesize

    def _draw():
        draw_page_watermark(c, WATERMARK_TEXT, width, height)

    _draw()
    _orig_show_page = c.showPage

    def _show_page_with_watermark():
        _orig_show_page()
        _draw()

    c.showPage = _show_page_with_watermark


def is_pdf_bytes(data: bytes) -> bool:
    return bool(data) and data[:5] == b"%PDF-"


def is_pdf_download(name: str = "", mimetype: str = "") -> bool:
    if (mimetype or "").lower() == "application/pdf":
        return True
    return (name or "").lower().endswith(".pdf")


def _watermark_page_pdf_bytes(width: float, height: float) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    draw_page_watermark(c, WATERMARK_TEXT, width, height)
    c.save()
    return buf.getvalue()


def apply_watermark_to_pdf_bytes(pdf_bytes: bytes) -> bytes:
    """Overlay SAFFO watermark under each page of an existing PDF.

    On any failure (encrypted/corrupt PDF, missing pypdf, etc.) returns the
    original bytes so downloads never break solely because of watermarking.
    """
    if not is_pdf_bytes(pdf_bytes):
        return pdf_bytes

    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        return pdf_bytes

    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        if getattr(reader, "is_encrypted", False):
            try:
                reader.decrypt("")
            except Exception:
                return pdf_bytes

        writer = PdfWriter()
        for page in reader.pages:
            w = float(page.mediabox.width)
            h = float(page.mediabox.height)
            wm_reader = PdfReader(BytesIO(_watermark_page_pdf_bytes(w, h)))
            wm_page = wm_reader.pages[0]
            wm_page.merge_page(page)
            writer.add_page(wm_page)

        out = BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:
        return pdf_bytes


def prepare_download_bytes(
    data: bytes,
    download_name: str = "",
    mimetype: str = "",
) -> tuple[bytes, str]:
    mime = (mimetype or "").strip()
    if not mime:
        mime, _ = mimetypes.guess_type(download_name or "")

    if is_pdf_bytes(data) or is_pdf_download(download_name, mime):
        if is_pdf_bytes(data):
            return apply_watermark_to_pdf_bytes(data), "application/pdf"

    return data, mime or "application/octet-stream"


def send_download_file(
    *,
    path: str | None = None,
    data: bytes | None = None,
    buffer: BytesIO | None = None,
    download_name: str = "download",
    mimetype: str | None = None,
    as_attachment: bool = True,
):
    """Send a file download; PDFs are watermarked automatically."""
    if buffer is not None:
        buffer.seek(0)
        payload = buffer.read()
    elif data is not None:
        payload = data
    elif path:
        with open(path, "rb") as fh:
            payload = fh.read()
        if not download_name or download_name == "download":
            download_name = os.path.basename(path)
    else:
        raise ValueError("path, data, or buffer is required")

    payload, mime = prepare_download_bytes(payload, download_name, mimetype or "")
    return send_file(
        BytesIO(payload),
        mimetype=mime,
        as_attachment=as_attachment,
        download_name=download_name,
    )
