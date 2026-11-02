"""Unit tests for PDFRasterizer and safety bounds."""

import os
import pytest
from pathlib import Path
from src.config import OCRConfig
from src.rasterizer import PDFRasterizer, PDFRasterizerError, PDFSecurityError

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "benchmarks" / "samples"
SAMPLE_PDF = str(SAMPLES_DIR / "01_clean_english.pdf")


def test_rasterizer_page_count():
    rasterizer = PDFRasterizer()
    count = rasterizer.get_page_count(SAMPLE_PDF)
    assert count == 1


def test_rasterizer_valid_dpi():
    rasterizer = PDFRasterizer()
    for dpi in [200, 250, 300]:
        img_arr, w, h = rasterizer.rasterize_page(SAMPLE_PDF, 0, dpi=dpi)
        assert img_arr is not None
        assert w > 0 and h > 0
        assert img_arr.ndim == 3  # RGB


def test_rasterizer_invalid_dpi():
    rasterizer = PDFRasterizer()
    with pytest.raises(ValueError):
        rasterizer.rasterize_page(SAMPLE_PDF, 0, dpi=100)  # Below 200 min_dpi
    with pytest.raises(ValueError):
        rasterizer.rasterize_page(SAMPLE_PDF, 0, dpi=450)  # Above 300 max_dpi


def test_rasterizer_page_count_security_limit():
    strict_cfg = OCRConfig(max_page_count=0)
    strict_rasterizer = PDFRasterizer(strict_cfg)
    with pytest.raises(PDFSecurityError):
        strict_rasterizer.rasterize_page(SAMPLE_PDF, 0)


def test_rasterizer_max_pixel_limit():
    strict_cfg = OCRConfig(max_pixels_per_page=1000)
    strict_rasterizer = PDFRasterizer(strict_cfg)
    with pytest.raises(PDFSecurityError):
        strict_rasterizer.rasterize_page(SAMPLE_PDF, 0, dpi=250)


def test_rasterizer_nonexistent_file():
    rasterizer = PDFRasterizer()
    with pytest.raises(FileNotFoundError):
        rasterizer.get_page_count("/tmp/nonexistent_document_12345.pdf")

