import os
import tempfile
import uuid
from typing import List, Optional

import json
from fastapi import FastAPI, UploadFile, File, Form, Request, HTTPException, BackgroundTasks, status
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from app.pdf_utils import merge_pdfs, split_pdf, compress_pdf, protect_pdf, unlock_pdf, watermark_pdf

MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB

class LimitUploadSize(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        if request.method == "POST":
            if "content-length" not in request.headers:
                return HTMLResponse(status_code=status.HTTP_411_LENGTH_REQUIRED, content="Content length required")
            content_length = int(request.headers["content-length"])
            if content_length > MAX_FILE_SIZE_BYTES:
                return HTMLResponse(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, content="File too large. Max 50MB allowed.")
        return await call_next(request)

app = FastAPI(title="Privacy-First PDF Toolkit")
app.add_middleware(LimitUploadSize)

# Ensure directories exist
os.makedirs("app/static", exist_ok=True)
os.makedirs("app/templates", exist_ok=True)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

def cleanup_files(paths: List[str]):
    for path in paths:
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                print(f"Error removing file {path}: {e}")

def create_temp_file(suffix=".pdf") -> str:
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    return path

async def save_upload_file(upload_file: UploadFile, dest_path: str):
    with open(dest_path, "wb") as f:
        while chunk := await upload_file.read(1024 * 1024): # read in 1MB chunks
            f.write(chunk)

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.post("/api/merge")
async def merge(background_tasks: BackgroundTasks, files: List[UploadFile] = File(...), output_filename: Optional[str] = Form(None), pages_config: Optional[str] = Form(None)):
    if not files:
        raise HTTPException(status_code=400, detail="Files required for merging.")
    
    config_data = None
    if pages_config:
        try:
            config_data = json.loads(pages_config)
        except Exception:
            pass
            
    input_paths = []
    output_path = create_temp_file()
    
    try:
        for file in files:
            path = create_temp_file()
            input_paths.append(path)
            await save_upload_file(file, path)
        
        merge_pdfs(input_paths, output_path, config_data)
    except Exception as e:
        cleanup_files(input_paths + [output_path])
        raise HTTPException(status_code=500, detail=str(e))
    
    background_tasks.add_task(cleanup_files, input_paths + [output_path])
    
    final_name = output_filename if output_filename else "merged.pdf"
    if not final_name.endswith(".pdf"):
        final_name += ".pdf"
    return FileResponse(output_path, filename=final_name, media_type="application/pdf")

@app.post("/api/split")
async def split(background_tasks: BackgroundTasks, pages: str = Form(...), file: UploadFile = File(...), output_filename: Optional[str] = Form(None)):
    input_path = create_temp_file()
    output_path = create_temp_file()
    
    try:
        await save_upload_file(file, input_path)
        split_pdf(input_path, output_path, pages)
    except Exception as e:
        cleanup_files([input_path, output_path])
        raise HTTPException(status_code=500, detail=str(e))
    
    background_tasks.add_task(cleanup_files, [input_path, output_path])
    
    final_name = output_filename if output_filename else "split.pdf"
    if not final_name.endswith(".pdf"):
        final_name += ".pdf"
    return FileResponse(output_path, filename=final_name, media_type="application/pdf")

@app.post("/api/compress")
async def compress(background_tasks: BackgroundTasks, file: UploadFile = File(...), output_filename: Optional[str] = Form(None)):
    input_path = create_temp_file()
    output_path = create_temp_file()
    
    try:
        await save_upload_file(file, input_path)
        compress_pdf(input_path, output_path)
    except Exception as e:
        cleanup_files([input_path, output_path])
        raise HTTPException(status_code=500, detail=str(e))
    
    background_tasks.add_task(cleanup_files, [input_path, output_path])
    
    final_name = output_filename if output_filename else "compressed.pdf"
    if not final_name.endswith(".pdf"):
        final_name += ".pdf"
    return FileResponse(output_path, filename=final_name, media_type="application/pdf")

@app.post("/api/protect")
async def protect(background_tasks: BackgroundTasks, password: str = Form(...), file: UploadFile = File(...), output_filename: Optional[str] = Form(None)):
    input_path = create_temp_file()
    output_path = create_temp_file()
    
    try:
        await save_upload_file(file, input_path)
        protect_pdf(input_path, output_path, password)
    except Exception as e:
        cleanup_files([input_path, output_path])
        raise HTTPException(status_code=500, detail=str(e))
    
    background_tasks.add_task(cleanup_files, [input_path, output_path])
    
    final_name = output_filename if output_filename else "protected.pdf"
    if not final_name.endswith(".pdf"):
        final_name += ".pdf"
    return FileResponse(output_path, filename=final_name, media_type="application/pdf")

@app.post("/api/unlock")
async def unlock(background_tasks: BackgroundTasks, password: str = Form(...), file: UploadFile = File(...), output_filename: Optional[str] = Form(None)):
    input_path = create_temp_file()
    output_path = create_temp_file()
    
    try:
        await save_upload_file(file, input_path)
        unlock_pdf(input_path, output_path, password)
    except Exception as e:
        cleanup_files([input_path, output_path])
        raise HTTPException(status_code=500, detail=f"Failed to unlock (wrong password?): {e}")
    
    background_tasks.add_task(cleanup_files, [input_path, output_path])
    
    final_name = output_filename if output_filename else "unlocked.pdf"
    if not final_name.endswith(".pdf"):
        final_name += ".pdf"
    return FileResponse(output_path, filename=final_name, media_type="application/pdf")

@app.post("/api/watermark")
async def watermark(background_tasks: BackgroundTasks, text: str = Form(...), style: str = Form("centered"), font: str = Form("Helvetica-Bold"), size: int = Form(60), opacity: int = Form(30), color: str = Form("#808080"), rotation: int = Form(45), file: UploadFile = File(...), output_filename: Optional[str] = Form(None)):
    input_path = create_temp_file()
    output_path = create_temp_file()
    
    try:
        await save_upload_file(file, input_path)
        watermark_pdf(input_path, output_path, text, style, font, size, opacity, color, rotation)
    except Exception as e:
        cleanup_files([input_path, output_path])
        raise HTTPException(status_code=500, detail=str(e))
    
    background_tasks.add_task(cleanup_files, [input_path, output_path])
    
    final_name = output_filename if output_filename else "watermarked.pdf"
    if not final_name.endswith(".pdf"):
        final_name += ".pdf"
    return FileResponse(output_path, filename=final_name, media_type="application/pdf")
