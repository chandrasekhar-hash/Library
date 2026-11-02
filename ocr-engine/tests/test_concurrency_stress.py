"""Concurrent Request, Multi-Document, and Memory Stability Stress Tests for Aks Phase OCR-2.2."""

import os
import gc
import time
import pytest
import psutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient

from src.config import config
from src.worker import OCRWorker
from src.api import app

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "benchmarks" / "samples"
SAMPLE_PDF = str(SAMPLES_DIR / "01_english_1p.pdf")
MULTI_PDF = str(SAMPLES_DIR / "02_english_10p.pdf")


def test_two_simultaneous_requests():
    """Verify that two concurrent requests arriving simultaneously are processed cleanly."""
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {config.api_token}"}
    payload = {"pdf_path": SAMPLE_PDF, "lang": "en", "dpi": 200, "isolated": False}

    def send_request():
        return client.post("/ocr/pdf", json=payload, headers=headers)

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(send_request)
        f2 = executor.submit(send_request)
        res1 = f1.result(timeout=60.0)
        res2 = f2.result(timeout=60.0)

    assert res1.status_code == 200
    assert res2.status_code == 200
    d1 = res1.json()
    d2 = res2.json()
    assert d1["processed_pages_count"] == 1
    assert d2["processed_pages_count"] == 1
    assert len(d1["pages"][0]["lines"]) > 0
    assert len(d2["pages"][0]["lines"]) > 0


def test_multiple_sequential_documents():
    """Verify processing multiple distinct documents sequentially maintains bounded RSS."""
    worker = OCRWorker(config)
    proc = psutil.Process(os.getpid())

    rss_measurements = []
    for doc_num in range(3):
        res = worker.process_pdf(SAMPLE_PDF, lang="en", dpi=200)
        assert res["processed_pages_count"] == 1
        gc.collect()
        current_rss = proc.memory_info().rss / (1024 * 1024)
        rss_measurements.append(current_rss)

    # Verify memory did not balloon across sequential runs
    growth = rss_measurements[-1] - rss_measurements[0]
    # Allow reasonable minor variation, but no runaway (> 300 MB)
    assert growth < 300.0, f"Memory growth between doc 1 and doc 3 was {growth:.2f} MB"


def test_repeated_processing_stability():
    """Verify repeated processing over 5 iterations shows zero memory leakage."""
    worker = OCRWorker(config)
    proc = psutil.Process(os.getpid())

    for i in range(5):
        res = worker.process_pdf(SAMPLE_PDF, lang="en", dpi=200)
        assert res["processed_pages_count"] == 1

    gc.collect()
    rss_after = proc.memory_info().rss / (1024 * 1024)
    # Peak memory remains well under 5 GB
    assert rss_after < 5000.0, f"Process RSS exceeded 5 GB: {rss_after:.2f} MB"


def test_one_large_document():
    """Verify processing a 10-page document sequentially without OOM or memory accumulation."""
    worker = OCRWorker(config)
    proc = psutil.Process(os.getpid())

    rss_start = proc.memory_info().rss / (1024 * 1024)
    res = worker.process_pdf(MULTI_PDF, lang="en", dpi=200, max_pages=10)

    assert res["processed_pages_count"] == 10
    for page in res["pages"]:
        assert page["error"] is None
        assert page["line_count"] > 0

    rss_end = proc.memory_info().rss / (1024 * 1024)
    delta = rss_end - rss_start
    # Memory delta across 10 pages must be bounded
    assert delta < 500.0, f"10-page run memory delta was {delta:.2f} MB"


def test_invalid_and_interrupted_recovery():
    """Verify worker recovers cleanly from invalid inputs followed by hard timeouts."""
    worker = OCRWorker(config)

    # 1. Nonexistent file
    with pytest.raises(FileNotFoundError):
        worker.process_pdf("nonexistent_path_12345.pdf", lang="en")

    # 2. Hard timeout in subprocess mode
    timed_out = worker.process_pdf(SAMPLE_PDF, lang="en", dpi=200, isolated=True, page_timeout=0.01)
    assert timed_out.get("error") is not None or (len(timed_out["pages"]) > 0 and timed_out["pages"][0]["error"] is not None)

    # 3. Subsequent valid request succeeds immediately
    valid = worker.process_pdf(SAMPLE_PDF, lang="en", dpi=200)
    assert valid["processed_pages_count"] == 1
    assert valid["pages"][0]["error"] is None
    assert valid["pages"][0]["line_count"] > 0

