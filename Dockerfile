FROM python:3.11-slim

WORKDIR /app

# Install system dependencies: qpdf, ghostscript, and pdftk-java
RUN apt-get update && apt-get install -y --no-install-recommends \
    qpdf \
    ghostscript \
    pdftk-java \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY app/ ./app/

# Expose port
EXPOSE 8000

# Command to run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
