"""
Server-side PDF compression skill (`pdf.compress`).
Uses Ghostscript pdfwrite with bicubic image downsampling while keeping all
vector glyphs and paths untouched. Falls back to pypdf content-stream
flate compression when `gs` binary is absent in bare non-container test runs.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

PROFILE_DPI: dict[str, int] = {
    "archive": 300,
    "editorial": 150,
    "compact": 110,
    "screen": 72,
}


def run_compress_pdf(
    input_path: Path,
    output_path: Path,
    options: dict[str, Any],
    timeout_sec: int = 45,
) -> dict[str, Any]:
    profile = str(options.get("profile", "editorial"))
    base_dpi = PROFILE_DPI.get(profile, 150)
    target_dpi = int(options.get("imageDpi") or base_dpi)
    target_dpi = max(72, min(600, target_dpi))
    grayscale = bool(options.get("grayscale", False))
    linearize = bool(options.get("linearize", True))

    input_size = input_path.stat().st_size
    gs_bin = shutil.which("gs")

    if gs_bin:
        cmd = [
            gs_bin,
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.6",
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            "-dSAFER",
            "-dDetectDuplicateImages=true",
            "-dCompressFonts=true",
            "-dSubsetFonts=true",
            "-dDownsampleColorImages=true",
            "-dColorImageDownsampleType=/Bicubic",
            f"-dColorImageResolution={target_dpi}",
            "-dDownsampleGrayImages=true",
            "-dGrayImageDownsampleType=/Bicubic",
            f"-dGrayImageResolution={target_dpi}",
            "-dDownsampleMonoImages=true",
            f"-dMonoImageResolution={min(target_dpi * 2, 600)}",
            f"-dFastWebView={'true' if linearize else 'false'}",
        ]
        if grayscale:
            cmd.extend([
                "-sColorConversionStrategy=Gray",
                "-dProcessColorModel=/DeviceGray",
            ])
        cmd.extend([f"-sOutputFile={output_path}", str(input_path)])

        subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            timeout=timeout_sec,
        )
        engine = "ghostscript-pdfwrite"
    else:
        reader = PdfReader(str(input_path))
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        for page in writer.pages:
            page.compress_content_streams()
        writer.add_metadata({"/Producer": "Folio Compress Engine"})
        with open(output_path, "wb") as fh:
            writer.write(fh)
        engine = "pypdf-flate"

    output_size = output_path.stat().st_size
    ratio = round((1.0 - (output_size / max(1, input_size))) * 100, 2)
    return {
        "engine": engine,
        "profile": profile,
        "targetDpi": target_dpi,
        "grayscale": grayscale,
        "inputBytes": input_size,
        "outputBytes": output_size,
        "reductionPercent": ratio,
    }
