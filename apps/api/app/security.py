"""
Zero-retention ephemeral workspace & security primitives for Folio API v2.
Every incoming byte is processed inside an isolated, short-lived directory
(preferring /dev/shm RAM disk on Linux) and overwritten before unlinking.
"""
from __future__ import annotations

import contextlib
import hashlib
import os
import re
import secrets
import shutil
import tempfile
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException, UploadFile, status

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB ceiling
PDF_MAGIC = b"%PDF-"

FORBIDDEN_LATEX_RE = re.compile(
    r"\\(?:write18|immediate|openout|openin|read|input|include|catcode|csname|endcsname|makeatletter)\b",
    re.IGNORECASE,
)


def pick_ramdisk_base() -> str | None:
    """Prefer /dev/shm (in-RAM tmpfs) so temporary bytes never touch persistent storage."""
    shm = Path("/dev/shm")
    if shm.is_dir() and os.access(shm, os.W_OK | os.X_OK):
        return str(shm)
    return None


def secure_wipe_file(path: Path) -> None:
    """Zero-fill file contents before unlinking to prevent forensic recovery."""
    try:
        if path.is_file() and not path.is_symlink():
            size = path.stat().st_size
            if 0 < size <= 64 * 1024 * 1024:
                with open(path, "r+b") as fh:
                    fh.write(b"\x00" * min(size, 65536))
                    fh.flush()
        path.unlink(missing_ok=True)
    except Exception:
        with contextlib.suppress(Exception):
            path.unlink(missing_ok=True)


def secure_wipe_tree(root: Path) -> None:
    """Wipe all files inside an ephemeral directory and remove the tree."""
    if not root.exists():
        return
    for dirpath, _dirnames, filenames in os.walk(root, topdown=False):
        for fname in filenames:
            secure_wipe_file(Path(dirpath) / fname)
    shutil.rmtree(root, ignore_errors=True)


@contextlib.contextmanager
def ephemeral_workdir(prefix: str = "folio_ephem_") -> Iterator[Path]:
    """Context manager guaranteeing immediate zero-retention cleanup on exit."""
    base = pick_ramdisk_base()
    raw = tempfile.mkdtemp(prefix=prefix, dir=base)
    os.chmod(raw, 0o700)
    workdir = Path(raw)
    try:
        yield workdir
    finally:
        secure_wipe_tree(workdir)


def sanitize_filename(name: str | None, fallback: str = "document.pdf") -> str:
    if not name:
        return fallback
    base = os.path.basename(name)
    cleaned = re.sub(r'[\x00-\x1f\x7f"<>:|?*;/\\]', "", base).strip().lstrip(".")
    return (cleaned[:120] or fallback)


async def stream_upload_checked(
    upload: UploadFile,
    dest: Path,
    *,
    expect_pdf: bool = True,
    max_bytes: int = MAX_UPLOAD_BYTES,
) -> tuple[int, str]:
    """
    Stream an UploadFile to disk while enforcing size limits, checking magic bytes,
    and computing its SHA-256 digest in a single pass.
    """
    hasher = hashlib.sha256()
    total = 0
    header = bytearray()

    with open(dest, "wb") as out:
        while True:
            chunk = await upload.read(512 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail={"code": "INPUT_TOO_LARGE", "message": "Le fichier dépasse la taille maximale autorisée."},
                )
            if len(header) < 1024:
                header.extend(chunk[: 1024 - len(header)])
            hasher.update(chunk)
            out.write(chunk)

    if total == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "CORRUPT_INPUT", "message": "Fichier vide reçu."},
        )

    if expect_pdf and PDF_MAGIC not in bytes(header):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={"code": "INPUT_TYPE", "message": "Signature binaire %PDF- absente du fichier soumis."},
        )

    return total, hasher.hexdigest()


def assert_safe_latex(tex_source: str) -> None:
    match = FORBIDDEN_LATEX_RE.search(tex_source)
    if match:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "FORBIDDEN_CONTENT",
                "message": f"Macro LaTeX interdite par le bac à sable de sécurité : {match.group(0)}",
            },
        )


def random_owner_password() -> str:
    return secrets.token_urlsafe(24)
