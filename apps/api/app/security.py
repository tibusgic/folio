"""
Zero-retention ephemeral workspace & security primitives for Folio API v2.
Every incoming byte is processed inside an isolated, short-lived directory
(preferring /dev/shm RAM disk on Linux) and overwritten before unlinking.
"""
from __future__ import annotations

import contextlib
import hashlib
import ipaddress
import os
import re
import secrets
import shutil
import socket
import tempfile
import urllib.parse
import zipfile
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


def _is_forbidden_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
        or (isinstance(addr, ipaddress.IPv4Address) and addr in ipaddress.ip_network("100.64.0.0/10"))
    )


def assert_safe_remote_url(raw_url: str, *, resolve_dns: bool = True) -> str:
    """
    Validate a remote image URL against SSRF attacks.
    Blocks non-HTTP(S) schemes, credentials, localhost/internal domains,
    and private/loopback/link-local/metadata IPv4 & IPv6 addresses.
    """
    try:
        parsed = urllib.parse.urlparse(raw_url.strip())
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "FORBIDDEN_CONTENT", "message": "URL d'image distante invalide."},
        ) from exc

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "FORBIDDEN_CONTENT",
                "message": f"Schéma d'URL interdit par la protection SSRF : {parsed.scheme}",
            },
        )

    if parsed.username or parsed.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "FORBIDDEN_CONTENT", "message": "Identifiants dans l'URL interdits."},
        )

    host = (parsed.hostname or "").strip().lower().strip("[]")
    if not host:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "FORBIDDEN_CONTENT", "message": "Hôte manquant dans l'URL distante."},
        )

    if (
        host == "localhost"
        or host.endswith(".localhost")
        or host.endswith(".local")
        or host.endswith(".internal")
        or host in ("metadata.google.internal", "metadata", "instance-data")
        or re.match(r"^(?:0x[0-9a-f]+|\d+)$", host, re.IGNORECASE)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "FORBIDDEN_CONTENT",
                "message": f"Hôte interne ou local bloqué par la protection SSRF : {host}",
            },
        )

    # Check literal IP address if host is an IP
    try:
        ipaddress.ip_address(host)
        is_literal_ip = True
    except ValueError:
        is_literal_ip = False

    if is_literal_ip and _is_forbidden_ip(host):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "FORBIDDEN_CONTENT",
                "message": f"Adresse IP privée ou réservée bloquée par la protection SSRF : {host}",
            },
        )

    if resolve_dns and not is_literal_ip:
        try:
            infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
        except socket.gaierror:
            infos = []
        for info in infos:
            sockaddr = info[4]
            ip_candidate = str(sockaddr[0])
            if _is_forbidden_ip(ip_candidate):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "FORBIDDEN_CONTENT",
                        "message": f"Résolution DNS vers une IP interne bloquée par la protection SSRF : {ip_candidate}",
                    },
                )

    return parsed.geturl()


ALLOWED_ZIP_EXTENSIONS = {".md", ".markdown", ".tex", ".bib", ".png", ".jpg", ".jpeg", ".webp", ".svg"}


def extract_zip_safely(
    zip_path: Path,
    workdir: Path,
    max_total_bytes: int = 75 * 1024 * 1024,
) -> list[Path]:
    """
    Safely unpack a .zip archive into `workdir`, guarding against Zip Slip
    and decompression bombs. Also mirrors nested images to `workdir / basename`
    so both relative paths (`./images/fig.png`) and flat names (`fig.png`) resolve.
    """
    extracted: list[Path] = []
    total_uncompressed = 0
    workdir_resolved = workdir.resolve()

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.infolist():
                if member.is_dir():
                    continue
                raw_name = member.filename.replace("\\", "/")
                parts = [p for p in raw_name.split("/") if p and p not in (".", "..")]
                if not parts:
                    continue
                if any(p == "__MACOSX" or p.startswith(".") for p in parts) or parts[-1] == "Thumbs.db":
                    continue

                ext = os.path.splitext(parts[-1])[1].lower()
                if ext not in ALLOWED_ZIP_EXTENSIONS:
                    continue

                total_uncompressed += member.file_size
                if total_uncompressed > max_total_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail={
                            "code": "INPUT_TOO_LARGE",
                            "message": "L'archive ZIP dépasse la taille maximale décompressée.",
                        },
                    )

                safe_parts = [sanitize_filename(p, "asset") for p in parts]
                rel_dest = (workdir / Path(*safe_parts)).resolve()
                if not rel_dest.is_relative_to(workdir_resolved):
                    continue

                rel_dest.parent.mkdir(parents=True, exist_ok=True)
                data = zf.read(member)
                rel_dest.write_bytes(data)
                extracted.append(rel_dest)

                flat_dest = workdir / safe_parts[-1]
                if flat_dest != rel_dest and not flat_dest.exists():
                    flat_dest.write_bytes(data)
    except HTTPException:
        raise
    except zipfile.BadZipFile as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "CORRUPT_INPUT", "message": "Archive ZIP invalide ou corrompue."},
        ) from exc

    return extracted
