let uploadedMergeFiles = [];
let mergePagesQueue = [];
let fileCounter = 0;

document.addEventListener('DOMContentLoaded', () => {
    // --- Theme Toggle Logic ---
    const htmlRoot = document.getElementById('html-root');
    const themeToggleBtn = document.getElementById('theme-toggle');
    
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        htmlRoot.classList.remove('dark');
    } else {
        // Default to dark mode
        htmlRoot.classList.add('dark');
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            if (htmlRoot.classList.contains('dark')) {
                htmlRoot.classList.remove('dark');
                localStorage.setItem('theme', 'light');
            } else {
                htmlRoot.classList.add('dark');
                localStorage.setItem('theme', 'dark');
            }
        });
    }
    
    // --- Preview Modal Logic ---
    const previewModal = document.getElementById('preview-modal');
    const previewCloseBtn = document.getElementById('preview-close-btn');
    const previewDownloadBtn = document.getElementById('preview-download-btn');
    window.currentPreviewUrl = '';
    window.currentPreviewFilename = '';

    if (previewCloseBtn) {
        previewCloseBtn.addEventListener('click', () => {
            previewModal.classList.add('opacity-0');
            setTimeout(() => { 
                previewModal.classList.add('hidden'); 
                document.getElementById('preview-frame').src = '';
                if(window.currentPreviewUrl) URL.revokeObjectURL(window.currentPreviewUrl);
            }, 300);
        });
    }

    if (previewDownloadBtn) {
        previewDownloadBtn.addEventListener('click', () => {
            if (window.currentPreviewUrl) {
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = window.currentPreviewUrl;
                a.download = window.currentPreviewFilename;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        });
    }

    // --- Tab Switching Logic ---
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => {
                b.classList.remove('active', 'text-brand-300', 'bg-brand-500/10', 'shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]');
                b.classList.add('text-gray-400');
            });
            tabContents.forEach(content => {
                content.classList.add('hidden');
            });

            btn.classList.add('active', 'text-brand-300', 'bg-brand-500/10', 'shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]');
            btn.classList.remove('text-gray-400');
            
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');
        });
    });

    // --- Merge Tab Specific Logic (Cumulative + Sortable) ---
    const mergeGridContainer = document.getElementById('merge-thumbnail-grid');
    if (mergeGridContainer) {
        Sortable.create(mergeGridContainer, {
            animation: 150,
            handle: '.thumbnail-item',
            onEnd: function (evt) {
                const item = mergePagesQueue.splice(evt.oldIndex, 1)[0];
                mergePagesQueue.splice(evt.newIndex, 0, item);
                renderMergeThumbnails(); 
            }
        });
    }

    // --- Drag and Drop Logic ---
    const dropZones = document.querySelectorAll('.drop-zone');
    
    dropZones.forEach(zone => {
        const fileInput = zone.querySelector('.file-input');
        const fileListContainer = zone.nextElementSibling;
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            zone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            zone.addEventListener(eventName, () => {
                zone.classList.add('drag-active');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            zone.addEventListener(eventName, () => {
                zone.classList.remove('drag-active');
            }, false);
        });

        zone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            handleFiles(fileInput, files, fileListContainer);
        });

        fileInput.addEventListener('change', () => {
            handleFiles(fileInput, fileInput.files, fileListContainer);
        });
    });

    async function handleFiles(input, files, container) {
        if (input.id === 'merge-files') {
            const overlay = document.getElementById('loading-overlay');
            overlay.classList.remove('hidden');
            setTimeout(() => { overlay.classList.remove('opacity-0'); }, 10);
            
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileIndex = fileCounter++;
                uploadedMergeFiles.push({ index: fileIndex, file: file });
                await processPdfFile(file, fileIndex);
            }
            renderMergeThumbnails();
            input.value = ''; // Reset input to allow selecting same file again if needed
            
            overlay.classList.add('opacity-0');
            setTimeout(() => { overlay.classList.add('hidden'); }, 300);
        } else {
            // For other single-file tools
            const dataTransfer = new DataTransfer();
            for(let i = 0; i < files.length; i++) {
                dataTransfer.items.add(files[i]);
            }
            input.files = dataTransfer.files;
            updateFileList(input, container);
        }
    }

    function updateFileList(input, container) {
        container.innerHTML = '';
        if (input.files.length > 0) {
            Array.from(input.files).forEach(file => {
                const size = (file.size / 1024 / 1024).toFixed(2);
                container.innerHTML += `
                    <div class="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 animate-fade-in">
                        <div class="flex items-center gap-3 overflow-hidden">
                            <i class="ph ph-file-pdf text-xl text-red-400 shrink-0"></i>
                            <span class="text-sm font-medium text-gray-200 truncate">${file.name}</span>
                        </div>
                        <span class="text-xs text-gray-500 shrink-0 ml-4">${size} MB</span>
                    </div>
                `;
            });
        }
    }
});

async function processPdfFile(file, fileIndex) {
    const fileReader = new FileReader();
    return new Promise((resolve) => {
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 0.5 }); // Lower scale for thumbnail
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                
                await page.render({ canvasContext: context, viewport: viewport }).promise;
                
                mergePagesQueue.push({
                    fileIndex: fileIndex,
                    pageIndex: i,
                    fileName: file.name,
                    canvasData: canvas.toDataURL()
                });
            }
            resolve();
        };
        fileReader.readAsArrayBuffer(file);
    });
}

function renderMergeThumbnails() {
    const container = document.getElementById('merge-thumbnail-grid');
    if(!container) return;
    container.innerHTML = '';
    if (mergePagesQueue.length > 0) {
        mergePagesQueue.forEach((item, index) => {
            container.innerHTML += `
                <div class="thumbnail-item animate-fade-in" data-index="${index}">
                    <div class="thumbnail-badge">${index + 1}</div>
                    <div class="thumbnail-delete" onclick="removeMergePage(${index})">
                        <i class="ph ph-x text-sm"></i>
                    </div>
                    <img src="${item.canvasData}" class="thumbnail-canvas" draggable="false" />
                    <div class="thumbnail-info" title="${item.fileName}">
                        ${item.fileName}<br>Pg ${item.pageIndex}
                    </div>
                </div>
            `;
        });
    }
}

window.removeMergePage = function(index) {
    mergePagesQueue.splice(index, 1);
    renderMergeThumbnails();
}


// --- Fetch File Download & Error Handling ---

function showError(message) {
    const toast = document.getElementById('error-toast');
    const msgEl = document.getElementById('error-message');
    msgEl.innerHTML = message;
    
    toast.classList.remove('translate-y-24', 'opacity-0');
    
    setTimeout(() => {
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 6000);
}

async function handleFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const loadingProgress = document.getElementById('loading-progress');
    
    overlay.classList.remove('hidden');
    setTimeout(() => { overlay.classList.remove('opacity-0'); }, 10);
    loadingText.textContent = "Uploading...";
    loadingProgress.style.width = '0%';
    
    try {
        const formData = new FormData(form);
        
        if (form.action.endsWith('/api/merge')) {
            formData.delete('files'); 
            if (mergePagesQueue.length < 2) {
                showError("Please add at least 2 pages to merge.");
                overlay.classList.add('opacity-0');
                setTimeout(() => { overlay.classList.add('hidden'); }, 300);
                return;
            }
            
            const usedFileIndices = new Set(mergePagesQueue.map(p => p.fileIndex));
            const filesToUpload = uploadedMergeFiles.filter(f => usedFileIndices.has(f.index));
            
            const indexMap = {};
            filesToUpload.forEach((f, i) => { indexMap[f.index] = i; });
            
            const pagesConfig = mergePagesQueue.map(p => ({
                file_index: indexMap[p.fileIndex],
                page: p.pageIndex
            }));
            
            formData.set('pages_config', JSON.stringify(pagesConfig));
            
            filesToUpload.forEach(f => {
                formData.append('files', f.file);
            });
        }
        
        const xhr = new XMLHttpRequest();
        xhr.open(form.method, form.action, true);
        
        xhr.upload.onprogress = function(e) {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                loadingProgress.style.width = percent + '%';
                if (percent >= 100) {
                    loadingText.textContent = "Processing PDF...";
                }
            }
        };

        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                const blob = new Blob([xhr.response], {type: 'application/pdf'});
                const url = window.URL.createObjectURL(blob);
                
                let filename = "processed.pdf";
                const disposition = xhr.getResponseHeader('Content-Disposition');
                if (disposition && disposition.indexOf('filename=') !== -1) {
                    const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
                    if (matches != null && matches[1]) {
                        filename = matches[1].replace(/['"]/g, '');
                    }
                }
                
                // Show Preview Modal
                const previewModal = document.getElementById('preview-modal');
                const previewFrame = document.getElementById('preview-frame');
                
                window.currentPreviewUrl = url;
                window.currentPreviewFilename = filename;
                
                previewFrame.src = url;
                previewModal.classList.remove('hidden');
                setTimeout(() => { previewModal.classList.remove('opacity-0'); }, 10);
                
                if (form.action.endsWith('/api/merge')) {
                    uploadedMergeFiles = [];
                    mergePagesQueue = [];
                    fileCounter = 0;
                    renderMergeThumbnails();
                } else {
                    form.reset();
                    const container = form.querySelector('.file-list');
                    if (container) container.innerHTML = '';
                }
            } else {
                let errMsg = "An error occurred during processing.";
                if (xhr.status === 413) errMsg = "<strong>File Too Large</strong><br>The uploaded file exceeds the 50MB limit.";
                else if (xhr.status === 400) errMsg = "<strong>Bad Request</strong><br>Check your input and try again.";
                else if (xhr.status === 500) errMsg = "<strong>Server Error</strong><br>We couldn't process the PDF (might be corrupted or password protected).";
                
                try {
                    const errData = JSON.parse(new TextDecoder().decode(xhr.response));
                    if (errData.detail) errMsg = typeof errData.detail === 'string' ? errData.detail : errData.detail[0].msg;
                } catch (e) {}
                showError(errMsg);
            }
            
            overlay.classList.add('opacity-0');
            setTimeout(() => { overlay.classList.add('hidden'); }, 300);
        };
        
        xhr.onerror = function() {
            showError("<strong>Network error</strong><br>Could not reach the server.");
            overlay.classList.add('opacity-0');
            setTimeout(() => { overlay.classList.add('hidden'); }, 300);
        };
        
        xhr.responseType = 'arraybuffer';
        xhr.send(formData);
        
    } catch (error) {
        showError("<strong>Unexpected error</strong><br>Please try again.");
        overlay.classList.add('opacity-0');
        setTimeout(() => { overlay.classList.add('hidden'); }, 300);
    }
}

// --- Live Watermark Preview Logic ---
let currentWatermarkPdfDoc = null;
let currentWatermarkFile = null;

window.updateWatermarkPreview = async function() {
    const fileInput = document.getElementById('watermark-file');
    const bgCanvas = document.getElementById('wm-preview-bg');
    const fgCanvas = document.getElementById('wm-preview-fg');
    const placeholder = document.getElementById('wm-preview-placeholder');
    
    if (!fileInput || !fileInput.files.length) return;
    
    const file = fileInput.files[0];
    if (currentWatermarkFile !== file) {
        currentWatermarkFile = file;
        const arrayBuffer = await file.arrayBuffer();
        try {
            currentWatermarkPdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
            
            const page = await currentWatermarkPdfDoc.getPage(1);
            const viewport = page.getViewport({ scale: 1.0 });
            
            // Standardize rendering width/height
            bgCanvas.width = viewport.width;
            bgCanvas.height = viewport.height;
            fgCanvas.width = viewport.width;
            fgCanvas.height = viewport.height;
            
            const renderContext = {
                canvasContext: bgCanvas.getContext('2d'),
                viewport: viewport
            };
            await page.render(renderContext).promise;
            
            bgCanvas.classList.remove('opacity-0');
            fgCanvas.classList.remove('opacity-0');
            placeholder.classList.add('opacity-0');
            
        } catch (e) {
            console.error("Error generating watermark preview background", e);
        }
    }
    
    if (!currentWatermarkPdfDoc) return;
    
    const ctx = fgCanvas.getContext('2d');
    ctx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
    
    const textEl = document.getElementById('wm-text');
    if (!textEl) return;
    
    const text = textEl.value;
    if (!text) return;
    
    const style = document.getElementById('wm-style').value;
    const font = document.getElementById('wm-font').value;
    const color = document.getElementById('wm-color').value;
    const size = parseInt(document.getElementById('wm-size').value, 10);
    const opacity = parseInt(document.getElementById('wm-opacity').value, 10) / 100.0;
    const rotation = parseInt(document.getElementById('wm-rotation').value, 10) * Math.PI / 180;
    
    let fontFamily = "Helvetica, Arial, sans-serif";
    if (font === "Times-Roman") fontFamily = '"Times New Roman", Times, serif';
    if (font === "Courier") fontFamily = '"Courier New", Courier, monospace';
    
    ctx.globalAlpha = opacity;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    
    const w = fgCanvas.width;
    const h = fgCanvas.height;
    
    if (style === 'fun') {
        ctx.fillStyle = '#ff1999';
        ctx.font = `italic bold ${size}px "Times New Roman", Times, serif`;
        
        ctx.save();
        ctx.translate(w/2, h/2);
        ctx.rotate(25 * Math.PI/180);
        ctx.fillText(text, 0, 0);
        ctx.restore();
        
        ctx.save();
        ctx.translate(w/2, h/2);
        ctx.rotate(-40 * Math.PI/180);
        ctx.fillStyle = 'rgba(128, 25, 255, 0.8)';
        ctx.font = `italic ${size * 0.5}px "Helvetica", Arial, sans-serif`;
        ctx.fillText(text, 0, size * 1.5);
        ctx.fillText(text, 0, -size * 1.5);
        ctx.restore();
    } else if (style === 'tiled') {
        ctx.fillStyle = color;
        ctx.font = `bold ${size}px ${fontFamily}`;
        
        ctx.save();
        ctx.translate(w/2, h/2);
        ctx.rotate(rotation);
        ctx.translate(-w/2, -h/2);
        
        const stepX = size * 4 + text.length * size * 0.2;
        const stepY = size * 3;
        
        for (let x = -w; x < w * 2; x += stepX) {
            for (let y = -h; y < h * 2; y += stepY) {
                ctx.fillText(text, x, y);
            }
        }
        ctx.restore();
    } else {
        ctx.fillStyle = color;
        ctx.font = `bold ${size}px ${fontFamily}`;
        
        ctx.save();
        ctx.translate(w/2, h/2);
        ctx.rotate(rotation);
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }
};
