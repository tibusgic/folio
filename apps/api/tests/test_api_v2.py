"""
Integration tests for the Folio v2 Ephemeral API (`apps/api`).
Tests compression, AES-256 encryption + granular permissions + unlock,
Markdown -> LaTeX -> PDF compilation, macro security filtering, and
zero-retention RAM-disk cleanup.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter

from app.main import app

client = TestClient(app)


def make_sample_pdf_bytes() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_health_endpoint() -> None:
    res = client.get("/api/v2/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["retentionPolicy"] == "zero-retention-immediate-wipe"
    assert res.headers["x-folio-zero-retention"] == "purged-in-ram"


def test_compress_endpoint() -> None:
    pdf_bytes = make_sample_pdf_bytes()
    res = client.post(
        "/api/v2/compress",
        files=[("files", ("rapport.pdf", pdf_bytes, "application/pdf"))],
        data={"options": json.dumps({"profile": "editorial", "imageDpi": 150})},
    )
    assert res.status_code == 200
    assert res.content.startswith(b"%PDF-")
    report = json.loads(res.headers["x-folio-report"])
    assert report["zeroRetentionPurged"] is True
    assert report["outputBytes"] == len(res.content)


def test_encrypt_and_unlock_aes256_roundtrip() -> None:
    pdf_bytes = make_sample_pdf_bytes()
    enc_res = client.post(
        "/api/v2/encrypt",
        files=[("files", ("secret.pdf", pdf_bytes, "application/pdf"))],
        data={
            "options": json.dumps(
                {
                    "userPassword": "StrongUserPass!2026",
                    "ownerPassword": "MasterOwnerPass!2026",
                    "printPermission": "none",
                    "allowCopy": False,
                    "allowModify": False,
                }
            )
        },
    )
    assert enc_res.status_code == 200
    encrypted_bytes = enc_res.content
    reader = PdfReader(io.BytesIO(encrypted_bytes))
    assert reader.is_encrypted is True

    # Unlock with wrong password must fail with 400
    bad_unlock = client.post(
        "/api/v2/unlock",
        files=[("files", ("secret-aes256.pdf", encrypted_bytes, "application/pdf"))],
        data={"options": json.dumps({"password": "wrong-password"})},
    )
    assert bad_unlock.status_code == 400

    # Unlock with valid password succeeds
    ok_unlock = client.post(
        "/api/v2/unlock",
        files=[("files", ("secret-aes256.pdf", encrypted_bytes, "application/pdf"))],
        data={"options": json.dumps({"password": "StrongUserPass!2026"})},
    )
    assert ok_unlock.status_code == 200
    unlocked_reader = PdfReader(io.BytesIO(ok_unlock.content))
    assert unlocked_reader.is_encrypted is False


def test_latex_pdf_compilation_and_macro_guard() -> None:
    tex_doc = r"""
\documentclass[11pt,a4paper]{article}
\title{Mémoire Académique Folio}
\author{Dr. Camille Vasseur \and Ing. Henri Delacroix}
\date{2026-10-18}
\begin{document}
\maketitle
\begin{abstract}
Démonstration de la pipeline Markdown vers LaTeX puis PDF.
\end{abstract}
\section{Équations fondamentales}
La relation d'énergie s'écrit $E = mc^2$ et l'intégrale gaussienne :
\[
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
\]
\begin{table}[htbp]
\begin{tabular}{@{}ll@{}}
\toprule
\textbf{Module} & \textbf{Statut} \\
\midrule
LaTeX & Opérationnel \\
\bottomrule
\end{tabular}
\end{table}
\end{document}
"""
    md_bytes = b"# Memoire\n\nContenu."
    res = client.post(
        "/api/v2/latex-pdf",
        files=[("files", ("memoire.md", md_bytes, "text/markdown"))],
        data={"options": json.dumps({"generatedTex": tex_doc, "paper": "a4paper", "fontSize": "11pt"})},
    )
    assert res.status_code == 200
    assert res.content.startswith(b"%PDF-")
    reader = PdfReader(io.BytesIO(res.content))
    assert len(reader.pages) >= 1

    # Verify forbidden macro is blocked with HTTP 400
    malicious_res = client.post(
        "/api/v2/latex-pdf",
        files=[("files", ("evil.md", md_bytes, "text/markdown"))],
        data={"options": json.dumps({"generatedTex": r"\documentclass{article}\begin{document}\write18{id}\end{document}"})},
    )
    assert malicious_res.status_code == 400
    assert malicious_res.json()["detail"]["code"] == "FORBIDDEN_CONTENT"


def test_ocr_endpoint_searchable_pdf_and_markdown() -> None:
    pdf_bytes = make_sample_pdf_bytes()
    pdf_res = client.post(
        "/api/v2/ocr",
        files=[("files", ("scan.pdf", pdf_bytes, "application/pdf"))],
        data={"options": json.dumps({"language": "fra+eng", "outputFormat": "searchable-pdf", "deskew": True})},
    )
    assert pdf_res.status_code == 200
    assert pdf_res.content.startswith(b"%PDF-")
    report = json.loads(pdf_res.headers["x-folio-report"])
    assert report["zeroRetentionPurged"] is True
    assert report["outputFormat"] == "searchable-pdf"

    md_res = client.post(
        "/api/v2/ocr",
        files=[("files", ("scan.pdf", pdf_bytes, "application/pdf"))],
        data={"options": json.dumps({"language": "fra+eng", "outputFormat": "markdown", "deskew": False})},
    )
    assert md_res.status_code == 200
    assert b"# Extraction OCR" in md_res.content

