"""
Server-side AES-256 encryption & decryption skills (`pdf.encrypt`, `pdf.unlock`).
When `qpdf` is installed, arguments are passed via `@argfile` inside the
RAM-backed workdir so passwords NEVER appear in process argv / `/proc/<pid>/cmdline`.
Falls back to `pypdf` AES-256-R5/R6 encryption when `qpdf` is unavailable.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions

from app.security import random_owner_password


def run_encrypt_pdf(
    input_path: Path,
    output_path: Path,
    workdir: Path,
    options: dict[str, Any],
    timeout_sec: int = 30,
) -> dict[str, Any]:
    user_pw = str(options.get("userPassword", "")).strip()
    if len(user_pw) < 4:
        raise ValueError("userPassword must be at least 4 characters.")

    owner_pw = str(options.get("ownerPassword", "")).strip() or random_owner_password()
    print_perm = str(options.get("printPermission", "full"))
    if print_perm not in ("full", "low", "none"):
        print_perm = "full"

    allow_copy = bool(options.get("allowCopy", False))
    allow_modify = bool(options.get("allowModify", False))
    allow_annotate = bool(options.get("allowAnnotate", True))
    encrypt_meta = bool(options.get("encryptMetadata", True))

    qpdf_bin = shutil.which("qpdf")
    if qpdf_bin:
        argfile = workdir / "qpdf.args"
        modify_flag = "all" if allow_modify else ("annotate" if allow_annotate else "none")
        extract_flag = "y" if allow_copy else "n"
        lines = [
            "--encrypt",
            user_pw,
            owner_pw,
            "256",
            f"--print={print_perm}",
            f"--modify={modify_flag}",
            f"--extract={extract_flag}",
            f"--annotate={'y' if allow_annotate else 'n'}",
        ]
        if not encrypt_meta:
            lines.append("--cleartext-metadata")
        lines.extend(["--", str(input_path), str(output_path)])
        argfile.write_text("\n".join(lines), encoding="utf-8")

        subprocess.run(
            [qpdf_bin, f"@{argfile}"],
            check=True,
            capture_output=True,
            timeout=timeout_sec,
        )
        engine = "qpdf-aes256"
    else:
        reader = PdfReader(str(input_path))
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)

        perms = UserAccessPermissions(0)
        if print_perm in ("full", "low"):
            perms |= UserAccessPermissions.PRINT
        if print_perm == "full":
            perms |= UserAccessPermissions.PRINT_TO_REPRESENTATION
        if allow_copy:
            perms |= UserAccessPermissions.EXTRACT | UserAccessPermissions.EXTRACT_TEXT_AND_GRAPHICS
        if allow_modify:
            perms |= UserAccessPermissions.MODIFY | UserAccessPermissions.ASSEMBLE_DOC
        if allow_annotate:
            perms |= UserAccessPermissions.ADD_OR_MODIFY | UserAccessPermissions.FILL_FORM_FIELDS

        writer.encrypt(
            user_password=user_pw,
            owner_password=owner_pw,
            algorithm="AES-256",
            permissions_flag=perms,
        )
        with open(output_path, "wb") as fh:
            writer.write(fh)
        engine = "pypdf-aes256"

    return {
        "cipher": "AES-256",
        "engine": engine,
        "permissions": {
            "print": print_perm,
            "copy": allow_copy,
            "modify": allow_modify,
            "annotate": allow_annotate,
            "encryptMetadata": encrypt_meta,
        },
    }


def run_unlock_pdf(
    input_path: Path,
    output_path: Path,
    workdir: Path,
    options: dict[str, Any],
    timeout_sec: int = 30,
) -> dict[str, Any]:
    password = str(options.get("password", ""))
    if not password:
        raise ValueError("Password required to unlock PDF.")

    qpdf_bin = shutil.which("qpdf")
    if qpdf_bin:
        argfile = workdir / "qpdf_unlock.args"
        argfile.write_text(
            "\n".join([f"--password={password}", "--decrypt", "--", str(input_path), str(output_path)]),
            encoding="utf-8",
        )
        subprocess.run(
            [qpdf_bin, f"@{argfile}"],
            check=True,
            capture_output=True,
            timeout=timeout_sec,
        )
        engine = "qpdf-decrypt"
    else:
        reader = PdfReader(str(input_path))
        if reader.is_encrypted:
            res = reader.decrypt(password)
            if res == 0:
                raise ValueError("Mot de passe incorrect.")
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        with open(output_path, "wb") as fh:
            writer.write(fh)
        engine = "pypdf-decrypt"

    return {"engine": engine, "unlocked": True}
