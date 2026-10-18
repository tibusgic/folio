"""
Folio Ephemeral API v2.
Zero-retention processing for operations requiring native binaries:
- `/api/v2/latex-pdf` (Markdown -> LaTeX -> PDF)
- `/api/v2/compress`  (Ghostscript vector-preserving compression)
- `/api/v2/encrypt`   (AES-256 R6 granular permissions)
- `/api/v2/unlock`    (PDF decryption)

Every endpoint executes inside `with ephemeral_workdir():`, reads the resulting
bytes into memory, and wipes the RAM-disk directory BEFORE returning the HTTP
response, guaranteeing zero on-disk retention even if the client disconnects.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.security import (
    MAX_UPLOAD_BYTES,
    ephemeral_workdir,
    pick_ramdisk_base,
    sanitize_filename,
    stream_upload_checked,
)
from app.skills.compress import run_compress_pdf
from app.skills.crypto import run_encrypt_pdf, run_unlock_pdf
from app.skills.latex import run_compile_latex_pdf

app = FastAPI(
    title="Folio Ephemeral Document Engine",
    version="2.0.0",
    docs_url="/api/v2/docs",
    openapi_url="/api/v2/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Folio-Report", "X-Folio-Zero-Retention", "Content-Disposition"],
)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next: Any) -> Response:
    if request.method == "POST":
        cl = request.headers.get("content-length")
        if cl and int(cl) > MAX_UPLOAD_BYTES:
            return JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={
                    "code": "INPUT_TOO_LARGE",
                    "message": "Le fichier dépasse la taille maximale autorisée (100 Mo).",
                },
            )
    response: Response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Folio-Zero-Retention"] = "purged-in-ram"
    return response


def parse_options_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_OPTIONS", "message": "Options JSON invalides."},
        ) from exc


def build_pdf_response(pdf_bytes: bytes, filename: str, report: dict[str, Any]) -> Response:
    clean_name = sanitize_filename(filename, "document.pdf")
    if not clean_name.lower().endswith(".pdf"):
        clean_name += ".pdf"
    out_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    full_report = {
        **report,
        "outputSha256": out_sha256,
        "outputBytes": len(pdf_bytes),
        "zeroRetentionPurged": True,
    }
    encoded_name = quote(clean_name)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"{clean_name}\"; filename*=UTF-8''{encoded_name}",
            "X-Folio-Report": json.dumps(full_report, separators=(",", ":")),
        },
    )


@app.get("/api/v2/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": "2.0.0",
        "ramdisk": pick_ramdisk_base() is not None,
        "retentionPolicy": "zero-retention-immediate-wipe",
    }


@app.post("/api/v2/compress")
async def compress_endpoint(
    files: list[UploadFile] = File(...),
    options: str | None = Form(None),
) -> Response:
    if not files:
        raise HTTPException(status_code=400, detail={"code": "INPUT_COUNT", "message": "Aucun fichier reçu."})
    opts = parse_options_json(options)
    upload = files[0]

    with ephemeral_workdir("folio_compress_") as workdir:
        in_path = workdir / "input.pdf"
        out_path = workdir / "output.pdf"
        _, in_sha = await stream_upload_checked(upload, in_path, expect_pdf=True)
        try:
            report = run_compress_pdf(in_path, out_path, opts)
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail={"code": "TIMEOUT", "message": "Compression expirée."}) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": "SKILL_FAILED", "message": "Impossible de compresser ce PDF."},
            ) from exc
        pdf_bytes = out_path.read_bytes()

    stem = sanitize_filename(upload.filename, "document").removesuffix(".pdf")
    return build_pdf_response(pdf_bytes, f"{stem}-compresse.pdf", {**report, "inputSha256": in_sha})


@app.post("/api/v2/encrypt")
async def encrypt_endpoint(
    files: list[UploadFile] = File(...),
    options: str | None = Form(None),
) -> Response:
    if not files:
        raise HTTPException(status_code=400, detail={"code": "INPUT_COUNT", "message": "Aucun fichier reçu."})
    opts = parse_options_json(options)
    upload = files[0]

    with ephemeral_workdir("folio_encrypt_") as workdir:
        in_path = workdir / "input.pdf"
        out_path = workdir / "output.pdf"
        _, in_sha = await stream_upload_checked(upload, in_path, expect_pdf=True)
        try:
            report = run_encrypt_pdf(in_path, out_path, workdir, opts)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"code": "INVALID_OPTIONS", "message": str(exc)}) from exc
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail={"code": "TIMEOUT", "message": "Chiffrement expiré."}) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": "SKILL_FAILED", "message": "Échec du chiffrement AES-256."},
            ) from exc
        pdf_bytes = out_path.read_bytes()

    stem = sanitize_filename(upload.filename, "document").removesuffix(".pdf")
    return build_pdf_response(pdf_bytes, f"{stem}-aes256.pdf", {**report, "inputSha256": in_sha})


@app.post("/api/v2/unlock")
async def unlock_endpoint(
    files: list[UploadFile] = File(...),
    options: str | None = Form(None),
) -> Response:
    if not files:
        raise HTTPException(status_code=400, detail={"code": "INPUT_COUNT", "message": "Aucun fichier reçu."})
    opts = parse_options_json(options)
    upload = files[0]

    with ephemeral_workdir("folio_unlock_") as workdir:
        in_path = workdir / "input.pdf"
        out_path = workdir / "output.pdf"
        _, in_sha = await stream_upload_checked(upload, in_path, expect_pdf=True)
        try:
            report = run_unlock_pdf(in_path, out_path, workdir, opts)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={"code": "ENCRYPTED_INPUT", "message": "Mot de passe invalide ou déverrouillage impossible."},
            ) from exc
        pdf_bytes = out_path.read_bytes()

    stem = sanitize_filename(upload.filename, "document").removesuffix(".pdf")
    return build_pdf_response(pdf_bytes, f"{stem}-deverrouille.pdf", {**report, "inputSha256": in_sha})


@app.post("/api/v2/latex-pdf")
async def latex_pdf_endpoint(
    files: list[UploadFile] = File(...),
    options: str | None = Form(None),
) -> Response:
    opts = parse_options_json(options)
    generated_tex = str(opts.get("generatedTex") or "").strip()

    with ephemeral_workdir("folio_latex_") as workdir:
        bib_content: str | None = None
        md_filename = "publication"

        for upload in files:
            fname = sanitize_filename(upload.filename, "input.md")
            dest = workdir / fname
            await stream_upload_checked(upload, dest, expect_pdf=False, max_bytes=15 * 1024 * 1024)
            if fname.lower().endswith(".bib"):
                bib_content = dest.read_text(encoding="utf-8", errors="replace")
            elif fname.lower().endswith((".md", ".markdown", ".tex")):
                md_filename = fname.rsplit(".", 1)[0]
                if not generated_tex:
                    raw_text = dest.read_text(encoding="utf-8", errors="replace")
                    if fname.lower().endswith(".tex"):
                        generated_tex = raw_text
                    else:
                        generated_tex = (
                            "\\documentclass[11pt,a4paper]{article}\n"
                            "\\title{" + md_filename + "}\n"
                            "\\begin{document}\n\\maketitle\n"
                            + raw_text
                            + "\n\\end{document}\n"
                        )

        if not generated_tex:
            raise HTTPException(
                status_code=400,
                detail={"code": "INPUT_TYPE", "message": "Source Markdown ou LaTeX manquante."},
            )

        out_path = workdir / "compiled.pdf"
        try:
            report = run_compile_latex_pdf(workdir, generated_tex, bib_content, out_path, opts)
        except HTTPException:
            raise
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(
                status_code=504,
                detail={"code": "TIMEOUT", "message": "Délai de compilation LaTeX dépassé."},
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": "SKILL_FAILED", "message": "Erreur lors de la compilation LaTeX."},
            ) from exc

        pdf_bytes = out_path.read_bytes()

    return build_pdf_response(pdf_bytes, f"{md_filename}.pdf", report)
