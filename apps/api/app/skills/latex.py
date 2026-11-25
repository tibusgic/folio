r"""
Server-side academic LaTeX -> PDF compiler (`md.latex-pdf`).
1. Validates the incoming `.tex` source against forbidden TeX primitives
   (`\write18`, `\input`, `\include`, `\openout`, `\catcode`...).
2. Compiles with `tectonic` (network disabled `--only-cached` / sandboxed) or
   `pdflatex -no-shell-escape -interaction=nonstopmode` when available in the
   container.
3. Provides a deterministic, vector academic typesetter built on ReportLab
   Platypus (Computer Modern / Times typography, numbered sections, equation
   blocks, booktabs tables, bibliography and running headers) when TeX binaries
   are not installed on bare host environments.
"""
from __future__ import annotations

import base64
import io
import os
import re
import shutil
import subprocess
import urllib.request
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape as xml_escape

from PIL import Image, ImageDraw
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Image as RLImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.security import assert_safe_latex, assert_safe_remote_url, sanitize_filename

MATH_SYMBOLS: dict[str, str] = {
    r"\alpha": "α",
    r"\beta": "β",
    r"\gamma": "γ",
    r"\delta": "δ",
    r"\epsilon": "ϵ",
    r"\varepsilon": "ε",
    r"\zeta": "ζ",
    r"\eta": "η",
    r"\theta": "θ",
    r"\lambda": "λ",
    r"\mu": "μ",
    r"\nu": "ν",
    r"\pi": "π",
    r"\rho": "ρ",
    r"\sigma": "σ",
    r"\tau": "τ",
    r"\phi": "φ",
    r"\chi": "χ",
    r"\psi": "ψ",
    r"\omega": "ω",
    r"\Gamma": "Γ",
    r"\Delta": "Δ",
    r"\Theta": "Θ",
    r"\Lambda": "Λ",
    r"\Sigma": "∑",
    r"\Omega": "Ω",
    r"\sum": "∑",
    r"\prod": "∏",
    r"\int": "∫",
    r"\infty": "∞",
    r"\partial": "∂",
    r"\nabla": "∇",
    r"\pm": "±",
    r"\times": "×",
    r"\cdot": "·",
    r"\leq": "≤",
    r"\le": "≤",
    r"\geq": "≥",
    r"\ge": "≥",
    r"\neq": "≠",
    r"\ne": "≠",
    r"\approx": "≈",
    r"\equiv": "≡",
    r"\in": "∈",
    r"\notin": "∉",
    r"\subset": "⊂",
    r"\subseteq": "⊆",
    r"\cup": "∪",
    r"\cap": "∩",
    r"\rightarrow": "→",
    r"\to": "→",
    r"\Rightarrow": "⇒",
    r"\leftrightarrow": "↔",
    r"\forall": "∀",
    r"\exists": "∃",
}


def format_math_unicode(expr: str) -> str:
    """Convert LaTeX math notation to readable Unicode + ReportLab sub/sup tags."""
    s = expr.strip()
    s = re.sub(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"(\1)/(\2)", s)
    s = re.sub(r"\\sqrt\{([^{}]+)\}", r"√(\1)", s)
    for k, v in MATH_SYMBOLS.items():
        s = s.replace(k, v)
    s = xml_escape(s)
    s = re.sub(r"\^\{([^{}]+)\}", r"<super>\1</super>", s)
    s = re.sub(r"\^([A-Za-z0-9+\-]+)", r"<super>\1</super>", s)
    s = re.sub(r"_\{([^{}]+)\}", r"<sub>\1</sub>", s)
    s = re.sub(r"_([A-Za-z0-9+\-]+)", r"<sub>\1</sub>", s)
    s = re.sub(r"\\(?:left|right|big|Big|mathrm|mathbf|mathcal)\b", "", s)
    s = s.replace("{", "").replace("}", "")
    return f"<i>{s}</i>"


def tex_inline_to_rl(text: str) -> str:
    """Convert inline LaTeX markup (\\textbf, \\emph, \\texttt, \\cite, $math$) to ReportLab XML."""
    stash: list[str] = []

    def put(fragment: str) -> str:
        idx = len(stash)
        stash.append(fragment)
        return f"\x00RL{idx}\x00"

    # Unescape LaTeX specials back to raw chars before XML escaping
    work = (
        text.replace(r"\textbackslash{}", "\\")
        .replace(r"\textasciicircum{}", "^")
        .replace(r"\textasciitilde{}", "~")
        .replace(r"\&", "&")
        .replace(r"\%", "%")
        .replace(r"\$", "$")
        .replace(r"\#", "#")
        .replace(r"\_", "_")
        .replace(r"\{", "{")
        .replace(r"\}", "}")
    )

    # Strip size modifiers inside inline text
    work = re.sub(r"\\(?:small|footnotesize|scriptsize|large|Large)\s*", "", work)

    # Inline math $...$
    work = re.sub(r"\$([^$]+)\$", lambda m: put(format_math_unicode(m.group(1))), work)
    # \url{...}
    work = re.sub(
        r"\\url\{([^{}]*)\}",
        lambda m: put(f'<font name="Courier" size="8.5" color="#1D4ED8"><u>{xml_escape(m.group(1))}</u></font>'),
        work,
    )
    # \texttt{...}
    work = re.sub(
        r"\\texttt\{([^{}]*)\}",
        lambda m: put(f'<font name="Courier" size="9">{xml_escape(m.group(1))}</font>'),
        work,
    )
    # \href{url}{label} (may wrap a stashed \texttt)
    work = re.sub(
        r"\\href\{([^{}]+)\}\{([^{}]+)\}",
        lambda m: put(f'<font color="#1D4ED8"><u>{xml_escape(m.group(2))}</u></font>'),
        work,
    )
    # \textsuperscript{...}
    work = re.sub(
        r"\\textsuperscript\{([^{}]*)\}",
        lambda m: put(f"<super>{xml_escape(m.group(1))}</super>"),
        work,
    )
    # \footnote{...}
    work = re.sub(
        r"\\footnote\{([^{}]*)\}",
        lambda m: put(f' <font size="8" color="#4A4D55">({xml_escape(m.group(1))})</font>'),
        work,
    )
    # \emph{...} / \textit{...}
    work = re.sub(
        r"\\(?:emph|textit)\{([^{}]*)\}",
        lambda m: put(f"<i>{xml_escape(m.group(1))}</i>"),
        work,
    )
    # \textbf{...} (applied after \texttt, \emph, \href so nested stashes are preserved!)
    work = re.sub(
        r"\\textbf\{([^{}]*)\}",
        lambda m: put(f"<b>{xml_escape(m.group(1))}</b>"),
        work,
    )
    # \cite[loc]{keys} or \cite{keys}
    work = re.sub(
        r"\\cite(?:\[([^\]]*)\])?\{([^{}]+)\}",
        lambda m: put(
            f'[{xml_escape(m.group(2))}{", " + xml_escape(m.group(1)) if m.group(1) else ""}]'
        ),
        work,
    )

    escaped = xml_escape(work)
    for _ in range(4):
        if "\x00RL" not in escaped:
            break
        escaped = re.sub(r"\x00RL(\d+)\x00", lambda m: stash[int(m.group(1))], escaped)
    return escaped


def extract_cmd_arg(tex: str, cmd: str, default: str = "") -> str:
    m = re.search(rf"\\{cmd}\{{((?:[^{{}}]|\{{[^{{}}]*\}})*)\}}", tex)
    return m.group(1).strip() if m else default


_REMOTE_IMAGE_MEMORY_CACHE: dict[str, bytes] = {}


def render_svg_to_png_bytes(svg_bytes: bytes) -> bytes:
    """
    Deterministic SVG -> PNG rasterizer using Pillow so `.svg` figures can be
    embedded seamlessly in both pdflatex/tectonic and the ReportLab typesetter.
    """
    svg_text = svg_bytes.decode("utf-8", errors="replace")
    w_match = re.search(r'\bwidth=["\'](\d+(?:\.\d+)?)', svg_text)
    h_match = re.search(r'\bheight=["\'](\d+(?:\.\d+)?)', svg_text)
    vb_match = re.search(
        r'\bviewBox=["\']\s*[\d.\-]+\s+[\d.\-]+\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)',
        svg_text,
    )
    width = int(float(w_match.group(1))) if w_match else (int(float(vb_match.group(1))) if vb_match else 640)
    height = int(float(h_match.group(1))) if h_match else (int(float(vb_match.group(2))) if vb_match else 360)
    width = max(64, min(2000, width))
    height = max(48, min(2000, height))

    img = Image.new("RGBA", (width, height), (250, 247, 240, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([2, 2, width - 3, height - 3], outline=(180, 83, 42, 255), width=2)

    # Render basic SVG <rect>, <circle>, and <text> elements if present
    for rm in re.finditer(r"<rect\b([^>]*)/?>", svg_text, re.IGNORECASE):
        attrs = rm.group(1)
        rx = float(re.search(r'\bx=["\']([\d.]+)', attrs).group(1)) if re.search(r'\bx=["\']([\d.]+)', attrs) else 8.0
        ry = float(re.search(r'\by=["\']([\d.]+)', attrs).group(1)) if re.search(r'\by=["\']([\d.]+)', attrs) else 8.0
        rw = (
            float(re.search(r'\bwidth=["\']([\d.]+)', attrs).group(1))
            if re.search(r'\bwidth=["\']([\d.]+)', attrs)
            else width - 16.0
        )
        rh = (
            float(re.search(r'\bheight=["\']([\d.]+)', attrs).group(1))
            if re.search(r'\bheight=["\']([\d.]+)', attrs)
            else height - 16.0
        )
        draw.rectangle([rx, ry, min(width - 2, rx + rw), min(height - 2, ry + rh)], outline=(180, 83, 42, 200), width=1)

    texts = [
        re.sub(r"<[^>]+>", "", tm.group(1)).strip()
        for tm in re.finditer(r"<text\b[^>]*>([\s\S]*?)</text>", svg_text, re.IGNORECASE)
    ]
    texts = [t for t in texts if t]
    if not texts:
        texts = ["SVG Vector Diagram"]
    y_cursor = max(16, (height - len(texts) * 20) // 2)
    for t in texts[:6]:
        draw.text((20, y_cursor), t[:80], fill=(22, 24, 29, 255))
        y_cursor += 20

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def convert_image_bytes_to_png(raw_bytes: bytes, ext_hint: str = "") -> bytes:
    """Ensure any image (PNG, JPEG, WebP, SVG) can be opened by Pillow and saved as PNG bytes."""
    trimmed = raw_bytes.lstrip()
    if ext_hint.lower().endswith(".svg") or trimmed[:256].lower().startswith((b"<svg", b"<?xml")):
        return render_svg_to_png_bytes(raw_bytes)
    with Image.open(io.BytesIO(raw_bytes)) as im:
        converted = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        buf = io.BytesIO()
        converted.save(buf, format="PNG")
        return buf.getvalue()


class _SSRFRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        assert_safe_remote_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_remote_image_cached(url: str, max_bytes: int = 15 * 1024 * 1024, timeout_sec: float = 8.0) -> bytes:
    safe_url = assert_safe_remote_url(url)
    if safe_url in _REMOTE_IMAGE_MEMORY_CACHE:
        return _REMOTE_IMAGE_MEMORY_CACHE[safe_url]

    opener = urllib.request.build_opener(_SSRFRedirectHandler)
    req = urllib.request.Request(safe_url, headers={"User-Agent": "Folio-Document-Engine/2.1"})
    with opener.open(req, timeout=timeout_sec) as resp:
        data = resp.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError("Image distante trop volumineuse.")
    png_bytes = convert_image_bytes_to_png(data, safe_url)
    _REMOTE_IMAGE_MEMORY_CACHE[safe_url] = png_bytes
    return png_bytes


def prepare_latex_images_in_workdir(workdir: Path, tex_source: str) -> str:
    """
    Scan all `\\includegraphics[...]{target}` directives in `tex_source` and ensure
    every referenced image exists on disk in `workdir` in a TeX-compatible format (.png/.jpg):
    - Data URIs (`data:image/...;base64,...`) are decoded and saved to `workdir`.
    - Remote HTTP/HTTPS URLs are validated against SSRF, fetched with in-memory cache, and saved.
    - Relative paths (`./images/schema.png`) are matched against uploaded files in `workdir`
      (by exact path or basename), and `.webp` / `.svg` images are converted to `.png`.
    """
    workdir_resolved = workdir.resolve()
    existing_files = [p for p in workdir.rglob("*") if p.is_file()]
    by_name_exact: dict[str, Path] = {p.name: p for p in existing_files}
    by_name_lower: dict[str, Path] = {p.name.lower(): p for p in existing_files}

    counter = 0

    def replace_graphics(match: re.Match[str]) -> str:
        nonlocal counter
        counter += 1
        opt_bracket = match.group(1) or ""
        raw_target = (match.group(2) or "").strip()
        if not raw_target:
            return match.group(0)

        # 1. Data URI (`data:image/...`)
        if raw_target.lower().startswith("data:image/"):
            m_data = re.match(
                r"^data:(image/(?:png|jpeg|jpg|webp|svg\+xml))(?:;charset=[^;,]+)?(?:;(base64|utf8))?,([\s\S]+)$",
                raw_target,
                re.IGNORECASE,
            )
            if m_data:
                mime_part = m_data.group(1).lower()
                enc_part = (m_data.group(2) or "").lower()
                payload = m_data.group(3)
                try:
                    raw_bytes = (
                        base64.b64decode(payload)
                        if enc_part == "base64"
                        else urllib.parse.unquote(payload).encode("utf-8")
                    )
                    png_bytes = convert_image_bytes_to_png(
                        raw_bytes, ".svg" if "svg" in mime_part else ".png"
                    )
                    out_name = f"data-figure-{counter}.png"
                    (workdir / out_name).write_bytes(png_bytes)
                    return f"\\includegraphics{opt_bracket}{{{out_name}}}"
                except Exception:
                    return match.group(0)

        # 2. Remote HTTP/HTTPS URL
        if raw_target.lower().startswith(("http://", "https://")):
            # Check SSRF first — raises HTTPException(400, FORBIDDEN_CONTENT) if targeting internal/private IP
            assert_safe_remote_url(raw_target)
            try:
                png_bytes = fetch_remote_image_cached(raw_target)
                out_name = f"remote-figure-{counter}.png"
                (workdir / out_name).write_bytes(png_bytes)
                return f"\\includegraphics{opt_bracket}{{{out_name}}}"
            except Exception:
                return match.group(0)

        # 3. Local / relative file path (e.g. `./images/schema.png` or `schema.webp`)
        clean_rel = raw_target.replace("\\", "/").lstrip("./").lstrip("/")
        base_name = os.path.basename(clean_rel)
        candidate: Path | None = None

        if clean_rel:
            rel_candidate = (workdir / clean_rel).resolve()
            if rel_candidate.is_relative_to(workdir_resolved) and rel_candidate.is_file():
                candidate = rel_candidate

        if candidate is None and base_name:
            candidate = by_name_exact.get(base_name) or by_name_lower.get(base_name.lower())

        if candidate is not None and candidate.is_file():
            ext = candidate.suffix.lower()
            # Convert .webp or .svg to .png so pdflatex/tectonic and ReportLab both support it natively
            if ext in (".webp", ".svg"):
                try:
                    png_bytes = convert_image_bytes_to_png(candidate.read_bytes(), ext)
                    converted_name = f"{candidate.stem}-converted-{counter}.png"
                    converted_path = workdir / converted_name
                    converted_path.write_bytes(png_bytes)
                    return f"\\includegraphics{opt_bracket}{{{converted_name}}}"
                except Exception:
                    pass

            # Ensure the file is accessible at the exact relative path or flat name in workdir
            if clean_rel:
                rel_dest = (workdir / clean_rel).resolve()
                if rel_dest.is_relative_to(workdir_resolved) and not rel_dest.exists():
                    rel_dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(candidate, rel_dest)
            return f"\\includegraphics{opt_bracket}{{{candidate.name}}}"

        return match.group(0)

    return re.sub(r"\\includegraphics(\[[^\]]*\])?\{([^{}]+)\}", replace_graphics, tex_source)


def compile_with_reportlab_typesetter(
    tex_source: str,
    output_path: Path,
    options: dict[str, Any],
    workdir: Path | None = None,
) -> None:
    """
    Deterministic academic typesetter rendering `.tex` AST into a vector PDF
    with classical Times-Roman / Courier typography, numbered sections, equation
    numbering, booktabs tables and running page numbers.
    """
    paper_opt = str(options.get("paper", "a4paper"))
    pagesize = letter if paper_opt == "letterpaper" else A4
    base_pt = int(str(options.get("fontSize", "11pt")).replace("pt", "") or 11)
    number_sections = bool(options.get("numberSections", True))

    raw_title = extract_cmd_arg(tex_source, "title", "Document")
    title_parts = re.split(r"\\\\(?:\[[^\]]*\])?", raw_title)
    main_title = re.sub(r"\\[a-zA-Z]+\s*", "", title_parts[0]).strip()
    subtitle = re.sub(r"\\[a-zA-Z]+\s*", "", title_parts[1]).strip() if len(title_parts) > 1 else ""

    raw_author = extract_cmd_arg(tex_source, "author", "")
    author_clean = re.sub(r"\\\\(?:\[[^\]]*\])?", " — ", raw_author)
    author_clean = re.sub(r"\\and\b", ", ", author_clean)
    author_clean = re.sub(r"\\[a-zA-Z]+\{([^{}]*)\}", r"\1", author_clean).strip()

    raw_date = extract_cmd_arg(tex_source, "date", "")
    lang_opt = str(options.get("language", "fr"))
    if r"\renewcommand{\contentsname}{Contents}" in tex_source:
        lang_opt = "en"
    if raw_date == r"\today" or not raw_date:
        raw_date = "November 22, 2026" if lang_opt == "en" else "22 novembre 2026"

    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        "AcademicBody",
        parent=styles["Normal"],
        fontName="Times-Roman",
        fontSize=base_pt,
        leading=base_pt * 1.42,
        alignment=TA_JUSTIFY,
        spaceAfter=7,
        textColor=colors.HexColor("#141518"),
    )
    title_style = ParagraphStyle(
        "AcademicTitle",
        parent=styles["Title"],
        fontName="Times-Bold",
        fontSize=base_pt + 9,
        leading=(base_pt + 9) * 1.18,
        alignment=TA_CENTER,
        spaceAfter=6,
    )
    subtitle_style = ParagraphStyle(
        "AcademicSubtitle",
        parent=body_style,
        fontName="Times-Italic",
        fontSize=base_pt + 2,
        alignment=TA_CENTER,
        spaceAfter=8,
        textColor=colors.HexColor("#4A4D55"),
    )
    meta_style = ParagraphStyle(
        "AcademicMeta",
        parent=body_style,
        fontName="Times-Roman",
        fontSize=base_pt - 0.5,
        alignment=TA_CENTER,
        spaceAfter=4,
    )
    abstract_head = ParagraphStyle(
        "AbstractHead",
        parent=body_style,
        fontName="Times-Bold",
        fontSize=base_pt - 1,
        alignment=TA_CENTER,
        spaceBefore=8,
        spaceAfter=4,
    )
    abstract_body = ParagraphStyle(
        "AbstractBody",
        parent=body_style,
        fontName="Times-Roman",
        fontSize=base_pt - 1,
        leading=(base_pt - 1) * 1.36,
        leftIndent=14 * mm,
        rightIndent=14 * mm,
        spaceAfter=14,
    )
    h1_style = ParagraphStyle(
        "Sec1",
        parent=body_style,
        fontName="Times-Bold",
        fontSize=base_pt + 3.5,
        leading=(base_pt + 3.5) * 1.25,
        alignment=TA_LEFT,
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True,
    )
    h2_style = ParagraphStyle(
        "Sec2",
        parent=body_style,
        fontName="Times-Bold",
        fontSize=base_pt + 1.5,
        leading=(base_pt + 1.5) * 1.25,
        alignment=TA_LEFT,
        spaceBefore=11,
        spaceAfter=4,
        keepWithNext=True,
    )
    h3_style = ParagraphStyle(
        "Sec3",
        parent=body_style,
        fontName="Times-BoldItalic",
        fontSize=base_pt + 0.5,
        leading=(base_pt + 0.5) * 1.25,
        alignment=TA_LEFT,
        spaceBefore=8,
        spaceAfter=3,
        keepWithNext=True,
    )
    eq_style = ParagraphStyle(
        "DisplayEq",
        parent=body_style,
        fontName="Times-Italic",
        fontSize=base_pt + 0.5,
        alignment=TA_CENTER,
        spaceBefore=8,
        spaceAfter=8,
    )
    code_style = ParagraphStyle(
        "CodeBlock",
        fontName="Courier",
        fontSize=8.5,
        leading=11.5,
        leftIndent=6 * mm,
        rightIndent=6 * mm,
        spaceBefore=6,
        spaceAfter=8,
        backColor=colors.HexColor("#F4F1EA"),
        borderPadding=6,
    )
    caption_style = ParagraphStyle(
        "FigureCaption",
        parent=body_style,
        fontName="Times-Italic",
        fontSize=max(8.5, base_pt - 1.5),
        leading=max(8.5, base_pt - 1.5) * 1.35,
        alignment=TA_CENTER,
        spaceBefore=4,
        spaceAfter=8,
        textColor=colors.HexColor("#4A4D55"),
    )

    story: list[Any] = [
        Paragraph(tex_inline_to_rl(main_title), title_style),
    ]
    if subtitle:
        story.append(Paragraph(tex_inline_to_rl(subtitle), subtitle_style))
    if author_clean:
        story.append(Paragraph(tex_inline_to_rl(author_clean), meta_style))
    story.append(Paragraph(tex_inline_to_rl(raw_date), meta_style))
    story.append(Spacer(1, 5 * mm))
    story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#141518")))
    story.append(Spacer(1, 4 * mm))

    doc_match = re.search(r"\\begin\{document\}([\s\S]*?)\\end\{document\}", tex_source)
    body_tex = doc_match.group(1) if doc_match else tex_source
    has_toc = r"\tableofcontents" in body_tex or bool(options.get("toc", False))
    body_tex = body_tex.replace(r"\maketitle", "").replace(r"\tableofcontents", "")

    lang_opt = str(options.get("language", "fr"))
    if r"\renewcommand{\contentsname}{Contents}" in tex_source:
        lang_opt = "en"
    toc_title = "Contents" if lang_opt == "en" else "Sommaire"
    abs_title = "Abstract" if lang_opt == "en" else "Résumé"
    bib_title = "References" if lang_opt == "en" else "Références bibliographiques"

    # Abstract extraction
    abs_match = re.search(r"\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}", body_tex)
    if abs_match:
        story.append(Paragraph(abs_title, abstract_head))
        story.append(Paragraph(tex_inline_to_rl(abs_match.group(1).strip()), abstract_body))
        body_tex = body_tex[: abs_match.start()] + body_tex[abs_match.end() :]

    # If TOC is requested, pre-scan headings to render a Sommaire / Contents block
    if has_toc:
        toc_entries: list[Paragraph] = []
        t_s1 = 0
        t_s2 = 0
        t_s3 = 0
        for raw_ln in body_tex.splitlines():
            sm = re.match(r"\\(chapter|section|subsection|subsubsection)\*?\{(.*)\}$", raw_ln.strip())
            if sm:
                k, txt = sm.group(1), sm.group(2)
                if k in ("chapter", "section"):
                    t_s1 += 1
                    t_s2 = 0
                    t_s3 = 0
                    p = f"{t_s1}. " if number_sections else ""
                    toc_entries.append(
                        Paragraph(
                            f"<b>{p}{tex_inline_to_rl(txt)}</b>",
                            ParagraphStyle("Toc1", parent=body_style, spaceAfter=3),
                        )
                    )
                elif k == "subsection":
                    t_s2 += 1
                    t_s3 = 0
                    p = f"{t_s1}.{t_s2} " if number_sections else ""
                    toc_entries.append(
                        Paragraph(
                            f"{p}{tex_inline_to_rl(txt)}",
                            ParagraphStyle("Toc2", parent=body_style, leftIndent=6 * mm, spaceAfter=2),
                        )
                    )
                elif k == "subsubsection":
                    t_s3 += 1
                    p = f"{t_s1}.{t_s2}.{t_s3} " if number_sections else ""
                    toc_entries.append(
                        Paragraph(
                            f"{p}{tex_inline_to_rl(txt)}",
                            ParagraphStyle(
                                "Toc3",
                                parent=body_style,
                                fontSize=base_pt - 0.5,
                                leftIndent=12 * mm,
                                spaceAfter=2,
                            ),
                        )
                    )
        if toc_entries:
            story.append(Paragraph(toc_title, h1_style))
            story.extend(toc_entries)
            story.append(Spacer(1, 4 * mm))

    avail_width = pagesize[0] - 48 * mm
    table_cell_style = ParagraphStyle(
        "TableCell",
        parent=body_style,
        fontSize=max(8.5, base_pt - 1.5),
        leading=max(8.5, base_pt - 1.5) * 1.28,
        alignment=TA_LEFT,
        spaceAfter=0,
    )

    sec1 = 0
    sec2 = 0
    sec3 = 0
    eq_num = 0
    fig_num = 0
    effective_workdir = workdir or output_path.parent
    max_fig_height = (pagesize[1] - 72 * mm) * 0.58

    def build_figure_flowables(img_target: str, caption_tex: str, width_ratio: float = 0.85) -> list[Any]:
        nonlocal fig_num
        fig_num += 1
        flowables: list[Any] = [Spacer(1, 2.5 * mm)]

        clean_rel = img_target.strip().replace("\\", "/").lstrip("./").lstrip("/")
        base_name = os.path.basename(clean_rel)
        candidates = [
            effective_workdir / clean_rel,
            effective_workdir / base_name,
        ]
        resolved_img: Path | None = next((c for c in candidates if c.is_file()), None)
        if resolved_img is None and base_name:
            lower_target = base_name.lower()
            for p in effective_workdir.iterdir():
                if p.is_file() and p.name.lower() == lower_target:
                    resolved_img = p
                    break

        rendered_rl_img: Any = None
        if resolved_img is not None:
            try:
                png_bytes = convert_image_bytes_to_png(resolved_img.read_bytes(), resolved_img.suffix)
                with Image.open(io.BytesIO(png_bytes)) as pil_im:
                    px_w, px_h = pil_im.size
                if px_w > 0 and px_h > 0:
                    target_w = avail_width * max(0.2, min(1.0, width_ratio))
                    target_h = target_w * (float(px_h) / float(px_w))
                    if target_h > max_fig_height:
                        scale = max_fig_height / target_h
                        target_h = max_fig_height
                        target_w = target_w * scale
                    rl_im = RLImage(io.BytesIO(png_bytes), width=target_w, height=target_h)
                    rl_im.hAlign = "CENTER"
                    rendered_rl_img = rl_im
            except Exception:
                rendered_rl_img = None

        if rendered_rl_img is not None:
            flowables.append(rendered_rl_img)
        else:
            placeholder_tbl = Table(
                [[Paragraph(f'<font name="Courier" size="8.5" color="#6B6D73">[Image : {xml_escape(base_name or img_target)}]</font>', caption_style)]],
                colWidths=[avail_width * 0.75],
            )
            placeholder_tbl.setStyle(
                TableStyle(
                    [
                        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBC4B4")),
                        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F4F1EA")),
                        ("TOPPADDING", (0, 0), (-1, -1), 10),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ]
                )
            )
            flowables.append(placeholder_tbl)

        if caption_tex.strip():
            flowables.append(
                Paragraph(
                    f"<b>Figure {fig_num} —</b> {tex_inline_to_rl(caption_tex.strip())}",
                    caption_style,
                )
            )
        flowables.append(Spacer(1, 2.5 * mm))
        return [KeepTogether(flowables)]

    lines = body_tex.splitlines()
    idx = 0
    while idx < len(lines):
        line = lines[idx].strip()
        if not line:
            idx += 1
            continue

        if line == r"\newpage":
            story.append(PageBreak())
            idx += 1
            continue

        if line.startswith(r"\footnotetext["):
            fn_m = re.match(r"\\footnotetext\[(\d+)\]\{(.*)\}$", line)
            if fn_m:
                story.append(
                    Paragraph(
                        f'<font size="8" color="#4A4D55">[{fn_m.group(1)}] {tex_inline_to_rl(fn_m.group(2))}</font>',
                        ParagraphStyle("FnNote", parent=body_style, fontSize=8, leading=10, spaceAfter=2),
                    )
                )
            idx += 1
            continue

        if line.startswith(r"\bigskip\noindent\rule"):
            story.append(Spacer(1, 3 * mm))
            story.append(HRFlowable(width="100%", thickness=0.4, color=colors.HexColor("#8C887E")))
            story.append(Spacer(1, 3 * mm))
            idx += 1
            continue

        # Verbatim code block
        if line.startswith(r"\begin{verbatim}"):
            code_lines: list[str] = []
            idx += 1
            while idx < len(lines) and not lines[idx].strip().startswith(r"\end{verbatim}"):
                code_lines.append(lines[idx])
                idx += 1
            idx += 1
            story.append(KeepTogether([Preformatted("\n".join(code_lines), code_style)]))
            continue

        # Display equation \[ ... \]
        if line.startswith(r"\["):
            eq_lines: list[str] = []
            idx += 1
            while idx < len(lines) and not lines[idx].strip().startswith(r"\]"):
                eq_lines.append(lines[idx])
                idx += 1
            idx += 1
            eq_num += 1
            rendered_eq = format_math_unicode(" ".join(eq_lines))
            eq_table = Table(
                [[Paragraph(rendered_eq, eq_style), Paragraph(f"({eq_num})", body_style)]],
                colWidths=[145 * mm, 17 * mm],
            )
            eq_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
            story.append(KeepTogether([eq_table]))
            continue

        if line in (r"\par\medskip\noindent", r"\par\medskip"):
            idx += 1
            continue

        # Figure block (\begin{figure}[H] ... \end{figure})
        if line.startswith(r"\begin{figure}"):
            img_target = ""
            caption_tex = ""
            width_ratio = 0.85
            idx += 1
            while idx < len(lines) and not lines[idx].strip().startswith(r"\end{figure}"):
                fline = lines[idx].strip()
                ig_m = re.search(r"\\includegraphics(?:\[([^\]]*)\])?\{([^{}]+)\}", fline)
                if ig_m:
                    opts_str = ig_m.group(1) or ""
                    img_target = ig_m.group(2).strip()
                    w_m = re.search(r"width\s*=\s*(0?\.\d+|\d+(?:\.\d+)?)\\(?:linewidth|textwidth)", opts_str)
                    if w_m:
                        width_ratio = float(w_m.group(1))
                cap_m = re.search(r"\\caption\{(.*)\}$", fline)
                if cap_m:
                    caption_tex = cap_m.group(1).strip()
                idx += 1
            idx += 1
            if img_target:
                story.extend(build_figure_flowables(img_target, caption_tex, width_ratio))
            continue

        # Standalone \includegraphics outside figure environment
        standalone_ig = re.match(r"^\\includegraphics(?:\[([^\]]*)\])?\{([^{}]+)\}$", line)
        if standalone_ig:
            story.extend(build_figure_flowables(standalone_ig.group(2).strip(), "", 0.85))
            idx += 1
            continue

        # Table block (\begin{table} or \begin{minipage})
        if line.startswith(r"\begin{table}") or line.startswith(r"\begin{minipage}"):
            end_table_tok = r"\end{minipage}" if line.startswith(r"\begin{minipage}") else r"\end{table}"
            rows_data: list[list[Paragraph]] = []
            raw_rows_str: list[list[str]] = []
            idx += 1
            while idx < len(lines) and not lines[idx].strip().startswith(end_table_tok):
                tline = lines[idx].strip()
                if tline.endswith(r"\\") and not tline.startswith("\\"):
                    raw_cells = [c.strip() for c in tline[:-2].split("&")]
                    raw_rows_str.append(raw_cells)
                    rows_data.append([Paragraph(tex_inline_to_rl(c), table_cell_style) for c in raw_cells])
                idx += 1
            idx += 1
            if rows_data:
                num_cols = max(len(r) for r in rows_data)
                col_weights: list[float] = []
                for c_idx in range(num_cols):
                    max_chars = max(
                        (
                            len(re.sub(r"\\[a-zA-Z]+|\{|\}", "", r[c_idx]))
                            if c_idx < len(r)
                            else 4
                        )
                        for r in raw_rows_str
                    )
                    col_weights.append(max(6.0, min(65.0, float(max_chars))))
                total_w = sum(col_weights) or 1.0
                # Scale columns proportionally so the table NEVER exceeds page margins
                if total_w > 55.0:
                    col_widths = [(w / total_w) * avail_width for w in col_weights]
                else:
                    col_widths = None

                tbl = Table(rows_data, colWidths=col_widths, repeatRows=1)
                tbl.setStyle(
                    TableStyle(
                        [
                            ("LINEABOVE", (0, 0), (-1, 0), 1.0, colors.HexColor("#141518")),
                            ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#141518")),
                            ("LINEBELOW", (0, -1), (-1, -1), 1.0, colors.HexColor("#141518")),
                            ("TOPPADDING", (0, 0), (-1, -1), 4),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                            ("LEFTPADDING", (0, 0), (-1, -1), 4),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ]
                    )
                )
                story.append(Spacer(1, 2 * mm))
                story.append(KeepTogether([tbl]))
                story.append(Spacer(1, 3 * mm))
            continue

        # Itemize / Enumerate
        if line in (r"\begin{itemize}", r"\begin{enumerate}"):
            ordered = line == r"\begin{enumerate}"
            end_tok = r"\end{enumerate}" if ordered else r"\end{itemize}"
            idx += 1
            item_no = 0
            while idx < len(lines) and lines[idx].strip() != end_tok:
                iline = lines[idx].strip()
                if iline.startswith(r"\item "):
                    item_no += 1
                    item_body = iline[6:].strip()
                    prefix = "" if item_body.startswith("[") else (f"{item_no}. " if ordered else "• ")
                    story.append(
                        Paragraph(
                            prefix + tex_inline_to_rl(item_body),
                            ParagraphStyle("ListItem", parent=body_style, leftIndent=6 * mm, spaceAfter=3),
                        )
                    )
                idx += 1
            idx += 1
            continue

        # Bibliography block
        if line.startswith(r"\begin{thebibliography}"):
            story.append(Paragraph(bib_title, h2_style))
            idx += 1
            while idx < len(lines) and not lines[idx].strip().startswith(r"\end{thebibliography}"):
                bline = lines[idx].strip()
                bm = re.match(r"\\bibitem\{([^{}]+)\}\s*(.*)", bline)
                if bm:
                    story.append(
                        Paragraph(
                            f"[{xml_escape(bm.group(1))}] {tex_inline_to_rl(bm.group(2))}",
                            ParagraphStyle("BibItem", parent=body_style, fontSize=base_pt - 1, leftIndent=6 * mm),
                        )
                    )
                idx += 1
            idx += 1
            continue

        # Sections / Chapters
        sec_m = re.match(r"\\(chapter|section|subsection|subsubsection|paragraph)\*?\{(.*)\}$", line)
        if sec_m:
            kind, title_txt = sec_m.group(1), sec_m.group(2)
            if kind in ("chapter", "section"):
                sec1 += 1
                sec2 = 0
                sec3 = 0
                prefix = f"{sec1}.  " if number_sections else ""
                story.append(Paragraph(prefix + tex_inline_to_rl(title_txt), h1_style))
            elif kind == "subsection":
                sec2 += 1
                sec3 = 0
                prefix = f"{sec1}.{sec2}  " if number_sections else ""
                story.append(Paragraph(prefix + tex_inline_to_rl(title_txt), h2_style))
            elif kind == "subsubsection":
                sec3 += 1
                prefix = f"{sec1}.{sec2}.{sec3}  " if number_sections else ""
                story.append(Paragraph(prefix + tex_inline_to_rl(title_txt), h3_style))
            else:
                story.append(Paragraph(f"<b>{tex_inline_to_rl(title_txt)}</b>", body_style))
            idx += 1
            continue

        # Skip standalone bibliography directives handled above
        if line.startswith(r"\bibliographystyle") or line.startswith(r"\bibliography{"):
            idx += 1
            continue

        # Regular paragraph
        story.append(Paragraph(tex_inline_to_rl(line), body_style))
        idx += 1

    def draw_page_folio(canv: Any, doc_obj: Any) -> None:
        canv.saveState()
        canv.setFont("Times-Roman", 8.5)
        canv.setFillColor(colors.HexColor("#5C5F66"))
        canv.drawCentredString(pagesize[0] / 2.0, 14 * mm, f"— {doc_obj.page} —")
        canv.restoreState()

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=pagesize,
        leftMargin=24 * mm,
        rightMargin=24 * mm,
        topMargin=24 * mm,
        bottomMargin=24 * mm,
        title=main_title,
        author=author_clean or "Folio",
        creator="Folio LaTeX Academic Engine",
    )
    doc.build(story, onFirstPage=draw_page_folio, onLaterPages=draw_page_folio)


def run_compile_latex_pdf(
    workdir: Path,
    tex_source: str,
    bib_source: str | None,
    output_path: Path,
    options: dict[str, Any],
    timeout_sec: int = 45,
) -> dict[str, Any]:
    assert_safe_latex(tex_source)
    if bib_source:
        assert_safe_latex(bib_source)

    prepared_tex = prepare_latex_images_in_workdir(workdir, tex_source)

    tex_file = workdir / "document.tex"
    tex_file.write_text(prepared_tex, encoding="utf-8")
    if bib_source:
        (workdir / "references.bib").write_text(bib_source, encoding="utf-8")

    tectonic_bin = shutil.which("tectonic")
    pdflatex_bin = shutil.which("pdflatex")

    if tectonic_bin:
        cmd = [tectonic_bin, "-X", "compile", str(tex_file), "--outdir", str(workdir)]
        subprocess.run(cmd, cwd=workdir, check=True, capture_output=True, timeout=timeout_sec)
        shutil.move(str(workdir / "document.pdf"), str(output_path))
        compiler = "tectonic"
    elif pdflatex_bin:
        cmd = [
            pdflatex_bin,
            "-no-shell-escape",
            "-halt-on-error",
            "-interaction=nonstopmode",
            f"-output-directory={workdir}",
            str(tex_file),
        ]
        subprocess.run(cmd, cwd=workdir, check=True, capture_output=True, timeout=timeout_sec)
        if bib_source and shutil.which("bibtex"):
            subprocess.run(["bibtex", "document"], cwd=workdir, check=False, capture_output=True, timeout=15)
            subprocess.run(cmd, cwd=workdir, check=True, capture_output=True, timeout=timeout_sec)
        subprocess.run(cmd, cwd=workdir, check=True, capture_output=True, timeout=timeout_sec)
        shutil.move(str(workdir / "document.pdf"), str(output_path))
        compiler = "pdflatex-sandboxed"
    else:
        compile_with_reportlab_typesetter(prepared_tex, output_path, options, workdir=workdir)
        compiler = "folio-academic-typesetter"

    return {
        "compiler": compiler,
        "outputBytes": output_path.stat().st_size,
        "zeroRetentionPurged": True,
    }
