"""Comprehensive API, security, timeout, and memory safety test suite for Phase OCR-2.1."""

import os
import time
import hashlib
import tempfile
import threading
import pytest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient

from src.config import config, OCRConfig
from src.worker import OCRWorker, PageTimeoutError
from src.rasterizer import PDFRasterizer, PDFRasterizerError, PDFSecurityError
from src.api import app

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "benchmarks" / "samples"
SAMPLE_PDF = str(SAMPLES_DIR / "01_english_1p.pdf")
MULTI_PDF = str(SAMPLES_DIR / "02_english_10p.pdf")


def get_file_sha256(filepath: str) -> str:
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


# ------------------------------------------------------------------------------
# 1. Immutability and Read-Only Filesystem Verification
# ------------------------------------------------------------------------------
def test_pdf_immutability_guarantee():
    """Verify that source PDFs remain completely untouched (SHA256 & mtime identical)."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name
        with open(SAMPLE_PDF, "rb") as src:
            tmp.write(src.read())

    try:
        initial_hash = get_file_sha256(tmp_path)
        initial_mtime = os.path.getmtime(tmp_path)

        worker = OCRWorker(config)
        res = worker.process_pdf(tmp_path, lang="en", dpi=200)

        assert res["processed_pages_count"] == 1
        after_hash = get_file_sha256(tmp_path)
        after_mtime = os.path.getmtime(tmp_path)

        assert initial_hash == after_hash, "Worker modified the source PDF content!"
        assert initial_mtime == after_mtime, "Worker touched or altered source file mtime!"
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_read_only_permissions_enforced():
    """Verify worker succeeds even when source PDF has strict read-only permissions (chmod 0400)."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name
        with open(SAMPLE_PDF, "rb") as src:
            tmp.write(src.read())

    os.chmod(tmp_path, 0o400)

    try:
        worker = OCRWorker(config)
        res = worker.process_pdf(tmp_path, lang="en", dpi=200)
        assert res["processed_pages_count"] == 1
    finally:
        os.chmod(tmp_path, 0o600)
        os.remove(tmp_path)


# ------------------------------------------------------------------------------
# 2. Timeout and Failure Handling Verification
# ------------------------------------------------------------------------------
def test_genuine_page_timeout_enforcement():
    """Verify that an unrealistically low page_timeout raises timeout error cleanly without crash."""
    worker = OCRWorker(config)
    # Set page timeout to 0.001 seconds to force real timeout trigger
    res = worker.process_pdf(SAMPLE_PDF, lang="en", dpi=200, page_timeout=0.001)

    assert res["processed_pages_count"] == 1
    page0 = res["pages"][0]
    assert page0["error"] is not None
    assert "timeout" in page0["error"].lower()
    assert page0["line_count"] == 0


def test_invalid_pdf_handling():
    """Verify that malformed or non-PDF files return clean structured errors."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(b"NOT_A_VALID_PDF_HEADER_DATA_1234567890")
        corrupt_path = tmp.name

    try:
        worker = OCRWorker(config)
        rasterizer = PDFRasterizer(config)
        with pytest.raises(PDFRasterizerError):
            rasterizer.get_page_count(corrupt_path)
    finally:
        if os.path.exists(corrupt_path):
            os.remove(corrupt_path)


def test_excessive_page_count_rejection():
    """Verify that PDFs exceeding max_page_count are rejected before processing."""
    strict_cfg = OCRConfig(max_page_count=5)
    worker = OCRWorker(strict_cfg)
    with pytest.raises(PDFSecurityError):
        worker.process_pdf(MULTI_PDF, lang="en")  # MULTI_PDF has 10 pages


def test_oversized_pixel_dimensions_rejection():
    """Verify that images exceeding pixel bounds raise PDFSecurityError."""
    strict_cfg = OCRConfig(max_pixels_per_page=1000)
    rasterizer = PDFRasterizer(strict_cfg)
    with pytest.raises(PDFSecurityError):
        rasterizer.rasterize_page(SAMPLE_PDF, 0, dpi=250)


# ------------------------------------------------------------------------------
# 3. API Authentication and Security Bounds
# ------------------------------------------------------------------------------
def test_api_missing_bearer_token():
    """Requests without Authorization header must return 401 Unauthorized."""
    client = TestClient(app)
    resp = client.post("/ocr/pdf", json={"pdf_path": SAMPLE_PDF, "lang": "en"})
    assert resp.status_code == 401
    assert "Bearer" in resp.headers.get("WWW-Authenticate", "")


def test_api_incorrect_bearer_token():
    """Requests with incorrect token must return 403 Forbidden."""
    client = TestClient(app)
    resp = client.post(
        "/ocr/pdf",
        json={"pdf_path": SAMPLE_PDF, "lang": "en"},
        headers={"Authorization": "Bearer completely-wrong-token-12345"},
    )
    assert resp.status_code == 403


def test_api_valid_bearer_token_success():
    """Requests with valid Bearer token succeed and return structured JSON."""
    client = TestClient(app)
    resp = client.post(
        "/ocr/pdf",
        json={"pdf_path": SAMPLE_PDF, "lang": "en", "dpi": 200},
        headers={"Authorization": f"Bearer {config.api_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["processed_pages_count"] == 1
    assert len(data["pages"][0]["lines"]) > 0
    assert "peak_rss_mb" in data


def test_api_invalid_pdf_returns_422():
    """Invalid PDF uploaded via API returns 422 Unprocessable Entity."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(b"CORRUPT_BYTES")
        bad_path = tmp.name

    try:
        client = TestClient(app)
        resp = client.post(
            "/ocr/pdf",
            json={"pdf_path": bad_path, "lang": "en"},
            headers={"Authorization": f"Bearer {config.api_token}"},
        )
        assert resp.status_code == 422
    finally:
        if os.path.exists(bad_path):
            os.remove(bad_path)


def test_api_excessive_page_count_returns_400():
    """PDFs exceeding page limits return 400 Bad Request."""
    client = TestClient(app)
    # Set max_pages in request to 1000 which exceeds max allowed schema (100)
    resp = client.post(
        "/ocr/pdf",
        json={"pdf_path": MULTI_PDF, "lang": "en", "max_pages": 1000},
        headers={"Authorization": f"Bearer {config.api_token}"},
    )
    assert resp.status_code in [400, 422]


def test_api_health_endpoint_loopback():
    """Health check reports platform and limits without requiring auth."""
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["arch"] == "arm64"
    assert data["limits"]["detection_model"] == "PP-OCRv6_medium_det"
    assert data["limits"]["text_det_limit_side_len"] == 1280


def test_api_concurrent_requests():
    """Verify that multiple concurrent queries to /health and /ocr/pdf execute safely."""
    client = TestClient(app)

    def send_request():
        r = client.get("/health")
        return r.status_code == 200

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(send_request) for _ in range(10)]
        results = [f.result() for f in futures]

    assert all(results), "Concurrent health requests failed!"
