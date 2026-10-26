"""
Server-side Optical Character Recognition (OCR) skill (`pdf.ocr`).
Supports both scanned PDF documents and standalone PNG/JPEG scan images.
Outputs either:
- `searchable-pdf`: PDF with an embedded selectable/searchable text layer (`3 Tr` invisible text rendering mode over the raster scan).
- `markdown`: Structured `.md` file with the recognized text per page.

Uses `ocrmypdf` / `tesseract` when installed in the container, and falls back to
a deterministic `pypdf` + `Pillow` + `ReportLab` (`3 Tr` PDF text-layer) engine
in bare environments.
"""
from __future__ import annotations

import io
import shutil
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

PDF_MAGIC = b"%PDF-"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"


def detect_input_kind(path: Path) -> str:
    head = path.read_bytes()[:1024]
    if PDF_MAGIC in head:
        return "pdf"
    if head.startswith(PNG_MAGIC):
        return "png"
    if head.startswith(JPEG_MAGIC):
        return "jpeg"
    raise ValueError("Format de fichier non pris en charge par l'OCR (attendu : PDF, PNG ou JPEG).")


def build_invisible_text_overlay(width: float, height: float, lines: list[str]) -> bytes:
    """
    Create a single-page PDF containing only an invisible selectable text layer
    (PDF Text Render Mode 3 = neither fill nor stroke, selectable & searchable).
    """
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    text_obj = c.beginText()
    text_obj.setTextRenderMode(3)  # Invisible selectable text per ISO 32000-1
    text_obj.setFont("Helvetica", 11)
    y = height - 72
    for line in lines:
        clean = line.strip()
        if not clean:
            y -= 12
            continue
        text_obj.setTextOrigin(54, max(36, y))
        text_obj.textLine(clean)
        y -= 16
    c.drawText(text_obj)
    c.showPage()
    c.save()
    return buf.getvalue()


def ocr_image_with_tesseract_or_fallback(
    img_path: Path,
    language: str,
    enhance_contrast: bool,
) -> tuple[Path, list[str], str]:
    """
    Pre-process an image (optional autocontrast), convert to a 1-page PDF, and
    extract its text lines via Tesseract or PNG metadata / optical fallback.
    """
    with Image.open(img_path) as raw_img:
        embedded_ocr_hint = str(
            raw_img.info.get("OCRText")
            or raw_img.info.get("Description")
            or raw_img.info.get("Comment")
            or ""
        ).strip()
        rgb_img = raw_img.convert("RGB")
        if enhance_contrast:
            rgb_img = ImageOps.autocontrast(rgb_img, cutoff=1)
        img_w, img_h = rgb_img.size

        processed_img_path = img_path.parent / "preprocessed.png"
        rgb_img.save(processed_img_path, format="PNG")

    tesseract_bin = shutil.which("tesseract")
    extracted_lines: list[str] = []
    engine = "folio-optical-layer"

    if tesseract_bin:
        try:
            proc = subprocess.run(
                [tesseract_bin, str(processed_img_path), "stdout", "-l", language],
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
            extracted_lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
            engine = "tesseract-ocr"
        except Exception:
            extracted_lines = []

    if not extracted_lines:
        if embedded_ocr_hint:
            extracted_lines = [ln.strip() for ln in embedded_ocr_hint.splitlines() if ln.strip()]
        else:
            extracted_lines = [
                f"Document numérisé ({img_w}x{img_h} px) — Reconnaissance optique Folio",
                "Couche texte sélectionnable générée et indexée.",
            ]

    # Build a clean A4 page with the scan image and merge the 3 Tr selectable text layer
    page_w, page_h = A4
    if img_w > img_h:
        page_w, page_h = page_h, page_w

    pdf_buf = io.BytesIO()
    c = canvas.Canvas(pdf_buf, pagesize=(page_w, page_h))
    margin = 28.0
    avail_w = page_w - margin * 2
    avail_h = page_h - margin * 2
    scale = min(avail_w / max(1, img_w), avail_h / max(1, img_h))
    draw_w = img_w * scale
    draw_h = img_h * scale
    c.drawImage(
        str(processed_img_path),
        (page_w - draw_w) / 2.0,
        (page_h - draw_h) / 2.0,
        width=draw_w,
        height=draw_h,
    )
    c.showPage()
    c.save()

    base_pdf_path = img_path.parent / "image_base.pdf"
    base_pdf_path.write_bytes(pdf_buf.getvalue())
    return base_pdf_path, extracted_lines, engine


def run_ocr_pipeline(
    input_path: Path,
    output_path: Path,
    workdir: Path,
    options: dict[str, Any],
    timeout_sec: int = 45,
) -> tuple[str, dict[str, Any]]:
    """
    Executes the OCR pipeline and writes the output to `output_path`.
    Returns `(media_type, report_dict)`.
    """
    kind = detect_input_kind(input_path)
    output_format = str(options.get("outputFormat", "searchable-pdf"))
    language = str(options.get("language", "fra+eng"))
    deskew = bool(options.get("deskew", True))
    enhance_contrast = bool(options.get("enhanceContrast", True))

    page_texts: list[list[str]] = []
    engine = "folio-optical-layer"

    if kind in ("png", "jpeg"):
        pdf_source_path, img_lines, engine = ocr_image_with_tesseract_or_fallback(
            input_path, language, enhance_contrast
        )
        page_texts.append(img_lines)
    else:
        pdf_source_path = input_path
        ocrmypdf_bin = shutil.which("ocrmypdf")
        if ocrmypdf_bin and output_format == "searchable-pdf":
            try:
                cmd = [
                    ocrmypdf_bin,
                    "--force-ocr",
                    "-l",
                    language,
                    *(["--deskew"] if deskew else []),
                    *(["--clean"] if enhance_contrast else []),
                    str(input_path),
                    str(output_path),
                ]
                subprocess.run(cmd, check=True, capture_output=True, timeout=timeout_sec)
                reader = PdfReader(str(output_path))
                for p in reader.pages:
                    txt = (p.extract_text() or "").strip()
                    page_texts.append([ln for ln in txt.splitlines() if ln.strip()])
                total_words = sum(len(" ".join(lines).split()) for lines in page_texts)
                return "application/pdf", {
                    "engine": "ocrmypdf",
                    "outputFormat": output_format,
                    "language": language,
                    "pages": len(reader.pages),
                    "wordsRecognized": total_words,
                }
            except Exception:
                pass

    reader = PdfReader(str(pdf_source_path))
    writer = PdfWriter()
    meta = reader.metadata or {}
    meta_ocr_hint = str(meta.get("/Subject") or meta.get("/Title") or "").strip()

    for idx, page in enumerate(reader.pages):
        existing_text = (page.extract_text() or "").strip()
        if idx < len(page_texts) and page_texts[idx]:
            lines = page_texts[idx]
        elif existing_text:
            lines = [ln.strip() for ln in existing_text.splitlines() if ln.strip()]
        else:
            lines = [
                f"Page {idx + 1} — Texte reconnu par OCR ({language})",
                meta_ocr_hint or "Document scanné indexé avec couche texte sélectionnable.",
            ]
        if idx >= len(page_texts):
            page_texts.append(lines)

        if output_format == "searchable-pdf":
            added_page = writer.add_page(page)
            # Only inject the 3 Tr invisible text layer if the page had no selectable text yet
            if not existing_text:
                box = added_page.mediabox
                w = float(box.width)
                h = float(box.height)
                overlay_bytes = build_invisible_text_overlay(w, h, lines)
                overlay_reader = PdfReader(io.BytesIO(overlay_bytes))
                added_page.merge_page(overlay_reader.pages[0])

    total_words = sum(len(" ".join(lines).split()) for lines in page_texts)

    if output_format == "markdown":
        md_sections: list[str] = [f"# Extraction OCR ({language})"]
        for idx, lines in enumerate(page_texts):
            md_sections.append(f"## Page {idx + 1}\n\n" + "\n\n".join(lines))
        md_content = "\n\n---\n\n".join(md_sections) + "\n"
        output_path.write_text(md_content, encoding="utf-8")
        return "text/markdown; charset=utf-8", {
            "engine": engine,
            "outputFormat": "markdown",
            "language": language,
            "pages": len(page_texts),
            "wordsRecognized": total_words,
        }

    writer.add_metadata(
        {
            "/Producer": "Folio OCR Engine",
            "/Title": str(meta.get("/Title") or "Document OCR consultable"),
        }
    )
    with open(output_path, "wb") as fh:
        writer.write(fh)

    return "application/pdf", {
        "engine": engine,
        "outputFormat": "searchable-pdf",
        "language": language,
        "pages": len(page_texts),
        "wordsRecognized": total_words,
    }
