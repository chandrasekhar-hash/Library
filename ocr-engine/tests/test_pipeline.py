"""Unit tests for OCR pipeline and output structures."""

import pytest
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from src.pipeline import OCRPipeline


@pytest.fixture(scope="module")
def pipeline():
    return OCRPipeline()


def test_pipeline_english_synthetic(pipeline):
    img = Image.new("RGB", (600, 150), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((30, 50), "Sanctuary Reader Aks", fill=(0, 0, 0))

    res = pipeline.process_image(img, lang="en")
    assert res is not None
    assert "lines" in res
    assert len(res["lines"]) > 0

    first_line = res["lines"][0]
    assert "text" in first_line
    assert "confidence" in first_line
    assert "bbox" in first_line
    assert len(first_line["bbox"]) == 4
    assert "polygon" in first_line
    assert len(first_line["polygon"]) == 4
    assert first_line["confidence"] > 0.8
    assert "Sanctuary" in first_line["text"] or "Reader" in first_line["text"] or "Aks" in first_line["text"]


def test_pipeline_devanagari_synthetic(pipeline):
    # Test Devanagari recognition with clean font
    img = Image.new("RGB", (600, 150), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/DevanagariMT.ttc", 40)
    draw.text((30, 45), "पुस्तकालय अक्स", font=font, fill=(0, 0, 0))

    res = pipeline.process_image(img, lang="hi")
    assert res is not None
    assert "lines" in res
    assert len(res["lines"]) > 0

    first_line = res["lines"][0]
    assert "text" in first_line
    assert first_line["confidence"] > 0.8
    assert "पुस्तकालय" in first_line["text"] or "अक्स" in first_line["text"]


def test_pipeline_empty_image(pipeline):
    blank = Image.new("RGB", (200, 200), (255, 255, 255))
    res = pipeline.process_image(blank, lang="en")
    assert res is not None
    assert res["line_count"] == 0
    assert len(res["lines"]) == 0

