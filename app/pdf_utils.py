import subprocess
import tempfile
import os
import io
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

def get_handle(index):
    result = ""
    while index >= 0:
        result = chr((index % 26) + 65) + result
        index = index // 26 - 1
    return result

def merge_pdfs(input_paths: list[str], output_path: str, pages_config: list = None):
    """Merges multiple PDFs into one using pdftk."""
    if not pages_config:
        cmd = ["pdftk"] + input_paths + ["cat", "output", output_path]
        subprocess.run(cmd, check=True, capture_output=True)
        return

    cmd = ["pdftk"]
    for i, path in enumerate(input_paths):
        handle = get_handle(i)
        cmd.extend([f"{handle}={path}"])
    
    cmd.append("cat")
    for item in pages_config:
        file_idx = item.get('file_index', 0)
        page = item.get('page', 1)
        handle = get_handle(file_idx)
        cmd.append(f"{handle}{page}")
        
    cmd.extend(["output", output_path])
    subprocess.run(cmd, check=True, capture_output=True)

def split_pdf(input_path: str, output_path: str, pages: str):
    """Splits or extracts pages from a PDF using pdftk. pages format: '1-3 5 8-10'"""
    # pdftk accepts spaces instead of commas. Replace commas with spaces.
    pages = pages.replace(",", " ")
    cmd = ["pdftk", input_path, "cat"] + pages.split() + ["output", output_path]
    subprocess.run(cmd, check=True, capture_output=True)

def compress_pdf(input_path: str, output_path: str):
    """Compresses a PDF using ghostscript with /ebook setting."""
    cmd = [
        "gs",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        "-dPDFSETTINGS=/ebook",
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        f"-sOutputFile={output_path}",
        input_path
    ]
    subprocess.run(cmd, check=True, capture_output=True)

def protect_pdf(input_path: str, output_path: str, password: str):
    """Encrypts a PDF with a user password using qpdf."""
    # We set user and owner password to the same for simplicity
    cmd = ["qpdf", "--encrypt", password, password, "256", "--", input_path, output_path]
    subprocess.run(cmd, check=True, capture_output=True)

def unlock_pdf(input_path: str, output_path: str, password: str):
    """Removes encryption from a PDF using qpdf."""
    cmd = ["qpdf", f"--password={password}", "--decrypt", input_path, output_path]
    subprocess.run(cmd, check=True, capture_output=True)

def hex_to_rgb(hex_color: str):
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        return 0.5, 0.5, 0.5
    return tuple(int(hex_color[i:i+2], 16)/255.0 for i in (0, 2, 4))

def create_watermark_pdf(text: str, style: str = "centered", font: str = "Helvetica-Bold", size: int = 60, opacity: int = 30, color: str = "#808080", rotation: int = 45) -> bytes:
    """Creates a temporary PDF with the watermark text."""
    packet = io.BytesIO()
    can = canvas.Canvas(packet, pagesize=letter)
    
    alpha = opacity / 100.0
    
    if style == "fun":
        font_name = "Times-BoldItalic"
        r, g, b = (1.0, 0.1, 0.6) # Vibrant pink
    else:
        font_name = font
        r, g, b = hex_to_rgb(color)
        
    can.setFont(font_name, size)
    can.setFillColorRGB(r, g, b, alpha=alpha)
    
    page_width, page_height = letter
    
    if style == "tiled":
        can.translate(page_width / 2, page_height / 2)
        can.rotate(rotation)
        can.translate(-page_width / 2, -page_height / 2)
        # Larger grid to cover entire rotated canvas
        for x in range(-int(page_width)*2, int(page_width)*3, int(size * 4 + len(text) * size * 0.2)):
            for y in range(-int(page_height)*2, int(page_height)*3, int(size * 3)):
                can.drawString(x, y, text)
    elif style == "fun":
        can.translate(page_width / 2, page_height / 2)
        can.rotate(25)
        can.drawCentredString(0, 0, text)
        can.rotate(-40)
        can.setFont("Helvetica-Oblique", size * 0.5)
        can.setFillColorRGB(0.5, 0.1, 1.0, alpha=alpha*0.8) # Purple accent
        can.drawCentredString(0, size * 1.5, text)
        can.drawCentredString(0, -size * 1.5, text)
    else:
        can.translate(page_width / 2, page_height / 2)
        can.rotate(rotation)
        can.drawCentredString(0, 0, text)
        
    can.save()
    packet.seek(0)
    return packet.read()

def watermark_pdf(input_path: str, output_path: str, text: str, style: str = "centered", font: str = "Helvetica-Bold", size: int = 60, opacity: int = 30, color: str = "#808080", rotation: int = 45):
    """Applies a text watermark to all pages of a PDF using pdftk."""
    watermark_bytes = create_watermark_pdf(text, style, font, size, opacity, color, rotation)
    
    fd, watermark_path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    
    try:
        with open(watermark_path, "wb") as f:
            f.write(watermark_bytes)
            
        cmd = ["pdftk", input_path, "multistamp", watermark_path, "output", output_path]
        subprocess.run(cmd, check=True, capture_output=True)
    finally:
        if os.path.exists(watermark_path):
            os.remove(watermark_path)
