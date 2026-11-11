# ocr-engine/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for OpenCV and PDF rasterization
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and config
COPY pyproject.toml ./
COPY src/ ./src/

ENV HOST=0.0.0.0
ENV PORT=5060
ENV PYTHONUNBUFFERED=1

EXPOSE 5060

CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "5060"]

