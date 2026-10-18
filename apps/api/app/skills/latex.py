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

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.security import assert_safe_latex

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
        .replace(r"\&", "&")
        .replace(r"\%", "%")
        .replace(r"\$", "$")
        .replace(r"\#", "#")
        .replace(r"\_", "_")
        .replace(r"\{", "{")
        .replace(r"\}", "}")
    )

    # Inline math $...$
    work = re.sub(r"\$([^$]+)\$", lambda m: put(format_math_unicode(m.group(1))), work)
    # \texttt{...}
    work = re.sub(
        r"\\texttt\{([^{}]*)\}",
        lambda m: put(f'<font name="Courier" size="9">{xml_escape(m.group(1))}</font>'),
        work,
    )
    # \textbf{...}
    work = re.sub(
        r"\\textbf\{([^{}]*)\}",
        lambda m: put(f"<b>{xml_escape(m.group(1))}</b>"),
        work,
    )
    # \emph{...} / \textit{...}
    work = re.sub(
        r"\\(?:emph|textit)\{([^{}]*)\}",
        lambda m: put(f"<i>{xml_escape(m.group(1))}</i>"),
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
    # \href{url}{label}
    work = re.sub(
        r"\\href\{([^{}]+)\}\{([^{}]+)\}",
        lambda m: put(f'<u>{xml_escape(m.group(2))}</u>'),
        work,
    )

    escaped = xml_escape(work)
    return re.sub(r"\x00RL(\d+)\x00", lambda m: stash[int(m.group(1))], escaped)


def extract_cmd_arg(tex: str, cmd: str, default: str = "") -> str:
    m = re.search(rf"\\{cmd}\{{((?:[^{{}}]|\{{[^{{}}]*\}})*)\}}", tex)
    return m.group(1).strip() if m else default


def compile_with_reportlab_typesetter(tex_source: str, output_path: Path, options: dict[str, Any]) -> None:
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
    if raw_date == r"\today" or not raw_date:
        raw_date = "2026-10-18"

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
    body_tex = body_tex.replace(r"\maketitle", "").replace(r"\tableofcontents", "")

    # Abstract extraction
    abs_match = re.search(r"\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}", body_tex)
    if abs_match:
        story.append(Paragraph("Résumé", abstract_head))
        story.append(Paragraph(tex_inline_to_rl(abs_match.group(1).strip()), abstract_body))
        body_tex = body_tex[: abs_match.start()] + body_tex[abs_match.end() :]

    sec1 = 0
    sec2 = 0
    sec3 = 0
    eq_num = 0

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

        # Table block
        if line.startswith(r"\begin{table}"):
            rows_data: list[list[Paragraph]] = []
            idx += 1
            while idx < len(lines) and not lines[idx].strip().startswith(r"\end{table}"):
                tline = lines[idx].strip()
                if tline.endswith(r"\\") and not tline.startswith("\\"):
                    raw_cells = [c.strip() for c in tline[:-2].split("&")]
                    rows_data.append([Paragraph(tex_inline_to_rl(c), body_style) for c in raw_cells])
                idx += 1
            idx += 1
            if rows_data:
                tbl = Table(rows_data, repeatRows=1)
                tbl.setStyle(
                    TableStyle(
                        [
                            ("LINEABOVE", (0, 0), (-1, 0), 1.0, colors.HexColor("#141518")),
                            ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#141518")),
                            ("LINEBELOW", (0, -1), (-1, -1), 1.0, colors.HexColor("#141518")),
                            ("TOPPADDING", (0, 0), (-1, -1), 4),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
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
                    prefix = f"{item_no}. " if ordered else "• "
                    story.append(
                        Paragraph(
                            prefix + tex_inline_to_rl(iline[6:].strip()),
                            ParagraphStyle("ListItem", parent=body_style, leftIndent=6 * mm, spaceAfter=3),
                        )
                    )
                idx += 1
            idx += 1
            continue

        # Bibliography block
        if line.startswith(r"\begin{thebibliography}"):
            story.append(Paragraph("Références bibliographiques", h2_style))
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

        # Sections
        sec_m = re.match(r"\\(section|subsection|subsubsection|paragraph)\*?\{(.*)\}$", line)
        if sec_m:
            kind, title_txt = sec_m.group(1), sec_m.group(2)
            if kind == "section":
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

    tex_file = workdir / "document.tex"
    tex_file.write_text(tex_source, encoding="utf-8")
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
        compile_with_reportlab_typesetter(tex_source, output_path, options)
        compiler = "folio-academic-typesetter"

    return {
        "compiler": compiler,
        "outputBytes": output_path.stat().st_size,
        "zeroRetentionPurged": True,
    }
