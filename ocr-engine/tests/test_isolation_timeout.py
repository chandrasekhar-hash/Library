"""Tests for Subprocess Isolation, Thread Safety, Hard Timeouts, and Search Normalization."""

import os
import time
import pytest
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from src.config import config
from src.worker import OCRWorker
from src.isolation import ProcessIsolatedRunner
from src.postprocessor import DevanagariSearchNormalizer, evaluate_raw_vs_normalized

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "benchmarks" / "samples"
SAMPLE_PDF = str(SAMPLES_DIR / "01_english_1p.pdf")


def test_isolated_execution_success():
    """Verify that subprocess-isolated OCR completes and returns structured output."""
    runner = ProcessIsolatedRunner(config)
    res = runner.run(
        pdf_path=SAMPLE_PDF,
        lang="en",
        dpi=200,
        max_pages=1,
        doc_timeout=60.0,
    )
    assert res.get("isolated_execution") is True
    assert res["processed_pages_count"] == 1
    assert len(res["pages"]) == 1
    assert res["pages"][0]["error"] is None
    assert res["pages"][0]["line_count"] > 0


def test_isolated_execution_in_background_thread():
    """Verify that OCR execution inside a non-main thread works cleanly in isolated mode."""
    results = []
    errors = []

    def thread_worker():
        try:
            worker = OCRWorker(config)
            res = worker.process_pdf(SAMPLE_PDF, lang="en", dpi=200, isolated=True)
            results.append(res)
        except Exception as e:
            errors.append(e)

    t = threading.Thread(target=thread_worker)
    t.start()
    t.join(timeout=60.0)

    assert len(errors) == 0, f"Thread execution threw exception: {errors}"
    assert len(results) == 1
    assert results[0]["processed_pages_count"] == 1


def test_isolated_hard_timeout_kills_process():
    """Verify that an isolated child process exceeding timeout is terminated forcefully."""
    runner = ProcessIsolatedRunner(config)
    # Set an impossibly low doc_timeout (e.g. 0.05 seconds)
    res = runner.run(
        pdf_path=SAMPLE_PDF,
        lang="en",
        dpi=200,
        doc_timeout=0.05,
    )
    assert res.get("isolated_execution") is True
    assert res.get("error") is not None
    assert "timeout exceeded" in res["error"].lower()


def test_worker_health_after_timeout():
    """Verify worker and parent process remain completely healthy after a timeout."""
    worker = OCRWorker(config)

    # 1. Trigger a timeout
    timed_out_res = worker.process_pdf(SAMPLE_PDF, lang="en", dpi=200, isolated=True, page_timeout=0.01)

    # 2. Immediately execute a valid request to ensure no corruption
    valid_res = worker.process_pdf(SAMPLE_PDF, lang="en", dpi=200, isolated=False)
    assert valid_res["processed_pages_count"] == 1
    assert len(valid_res["pages"][0]["lines"]) > 0
    assert valid_res["pages"][0]["error"] is None


def test_devanagari_search_normalizer_unit():
    """Verify Devanagari Unicode, nasal, joiner, and punctuation normalization."""
    normalizer = DevanagariSearchNormalizer

    # 1. Punctuation normalization
    assert normalizer.normalize_punctuation("राम गया |") == "राम गया । "
    assert normalizer.normalize_punctuation("पूर्ण विराम ||") == "पूर्ण विराम ॥"
    assert normalizer.normalize_punctuation("नम:") == "नमः"

    # 2. Joiner stripping
    text_with_zwj = "क्\u200Dष"
    assert normalizer.strip_invisible_format_chars(text_with_zwj) == "क्ष"

    # 3. Nasal & Bindu canonicalization
    # Chandrabindu to Anusvara
    assert normalizer.normalize_nasals_and_bindus("गाँव") == "गांव"
    # Pancham Varna before homorganic stops
    assert normalizer.normalize_nasals_and_bindus("सङ्कल्प") == "संकल्प"
    assert normalizer.normalize_nasals_and_bindus("सम्बन्ध") == "संबंध"
    assert normalizer.normalize_nasals_and_bindus("अन्तर") == "अंतर"

    # 4. Search token generation
    tokens = normalizer.to_search_tokens("भारतीय संस्कृति और ज्ञान! संबंध अटूट है।")
    assert "सस्कृति" not in tokens or "संस्कृति" in tokens
    assert "संबंध" in tokens

    # 5. Accuracy evaluation function
    eval_res = evaluate_raw_vs_normalized(
        "भारतीय संस्कृति और ज्ञान। संबंध अटूट है।",
        "भारतीय सस्कृति और जञान । सम्बन्ध अटूट है ।"
    )
    assert eval_res["search_tokens"]["search_word_accuracy_pct"] >= eval_res["raw"]["word_accuracy_pct"]
    assert "chhoti_i" in eval_res["matra_preservation"]
