"""Comprehensive, reproducible benchmark suite for Aks Phase OCR-2.1."""

import os
import sys
import json
import time
import psutil
import platform
import importlib.metadata
from pathlib import Path
from typing import Dict, Any, List
from rapidfuzz.distance import Levenshtein

ENGINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE_DIR))

from src.config import config
from src.worker import OCRWorker
from src.pipeline import OCRPipeline

SAMPLES_DIR = Path(__file__).resolve().parent / "samples"
RESULTS_FILE = Path(__file__).resolve().parent / "results.json"


def normalize_text_for_eval(text: str) -> str:
    """Normalize whitespace and strip blank lines for fair evaluation."""
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    return " ".join(lines)


def calculate_metrics(reference: str, hypothesis: str) -> Dict[str, Any]:
    """Calculate Character Error Rate (CER) and Word Error Rate (WER) using Levenshtein distance."""
    ref_norm = normalize_text_for_eval(reference)
    hyp_norm = normalize_text_for_eval(hypothesis)

    ref_chars = len(ref_norm)
    char_dist = Levenshtein.distance(ref_norm, hyp_norm)
    cer = (char_dist / ref_chars) if ref_chars > 0 else 1.0
    char_acc = max(0.0, 1.0 - cer) * 100.0

    ref_words = ref_norm.split()
    hyp_words = hyp_norm.split()
    ref_word_count = len(ref_words)
    word_dist = Levenshtein.distance(ref_words, hyp_words)
    wer = (word_dist / ref_word_count) if ref_word_count > 0 else 1.0
    word_acc = max(0.0, 1.0 - wer) * 100.0

    return {
        "reference_char_count": ref_chars,
        "hypothesis_char_count": len(hyp_norm),
        "char_edit_distance": char_dist,
        "cer": round(cer, 4),
        "char_accuracy_pct": round(char_acc, 2),
        "reference_word_count": ref_word_count,
        "hypothesis_word_count": len(hyp_words),
        "word_edit_distance": word_dist,
        "wer": round(wer, 4),
        "word_accuracy_pct": round(word_acc, 2),
    }


def run_benchmarks():
    """Execute benchmarks across all 7 Phase OCR-2.1 test suites."""
    manifest_path = SAMPLES_DIR / "manifest.json"
    if not manifest_path.exists():
        print("Manifest not found. Generating samples first...")
        from benchmarks.generate_samples import generate_all_samples
        generate_all_samples()

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    import paddle
    import paddleocr

    proc = psutil.Process(os.getpid())
    env_info = {
        "platform": platform.platform(),
        "arch": platform.machine(),
        "cpu_count": psutil.cpu_count(logical=True),
        "physical_memory_gb": round(psutil.virtual_memory().total / (1024 ** 3), 2),
        "python_version": platform.python_version(),
        "paddle_version": paddle.__version__,
        "paddleocr_version": paddleocr.__version__,
        "pypdfium2_version": importlib.metadata.version("pypdfium2"),
        "backend": "PaddlePaddle CPU (Apple Silicon optimized)",
        "optimizations": {
            "detection_model": config.detection_model_name,
            "text_det_limit_side_len": config.text_det_limit_side_len,
            "text_det_limit_type": config.text_det_limit_type,
            "page_timeout_seconds": config.page_timeout_seconds,
        },
    }

    print("=" * 80)
    print("Aks Phase OCR-2.1 — Optimized PaddleOCR Benchmark Suite")
    print(f"Platform: {env_info['platform']} ({env_info['arch']}) | RAM: {env_info['physical_memory_gb']} GB")
    print(f"Engine: PaddlePaddle {env_info['paddle_version']} + PaddleOCR {env_info['paddleocr_version']}")
    print(f"Detector: {config.detection_model_name} (max_side={config.text_det_limit_side_len})")
    print("=" * 80)

    worker = OCRWorker(config)
    benchmark_results = {
        "environment": env_info,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "samples": {},
    }

    # Selected 7 test suites specified in Phase OCR-2.1 prompt
    target_suites = [
        "01_english_1p",
        "02_english_10p",
        "03_hindi_1p",
        "04_hindi_10p",
        "05_sanskrit_1p",
        "06_rotated_photographed_page",
        "07_shadowed_low_contrast_page",
    ]

    for sample_id in target_suites:
        if sample_id not in manifest:
            continue
        meta = manifest[sample_id]
        pdf_path = meta["path"]
        lang = meta["language"]
        desc = meta["description"]
        expected_page_count = meta.get("page_count", 1)

        print(f"\n>>> Running Benchmark Suite: {sample_id} ({lang.upper()}) <<<")
        print(f"Description: {desc} (Pages: {expected_page_count})")

        rss_before = proc.memory_info().rss / (1024.0 * 1024.0)
        start_t = time.perf_counter()

        ocr_res = worker.process_pdf(
            pdf_path=pdf_path,
            lang=lang,
            dpi=250,
        )

        total_doc_sec = time.perf_counter() - start_t
        rss_after = proc.memory_info().rss / (1024.0 * 1024.0)

        pages = ocr_res.get("pages", [])
        cold_start_time_ms = 0.0
        warm_page_times_ms = []

        # Collect hypothesis text across all pages
        all_hyp_lines = []
        for p in pages:
            if p.get("cold_start"):
                cold_start_time_ms = p.get("duration_ms", 0.0)
            else:
                warm_page_times_ms.append(p.get("duration_ms", 0.0))
            all_hyp_lines.extend([l["text"] for l in p.get("lines", [])])

        avg_warm_time_ms = (
            sum(warm_page_times_ms) / len(warm_page_times_ms)
            if warm_page_times_ms
            else cold_start_time_ms
        )

        # Collect ground truth text across all pages
        if expected_page_count == 1:
            ref_lines = [meta.get("title", "")] + meta.get("body_lines", [])
        else:
            ref_lines = []
            for p_meta in meta.get("pages", []):
                ref_lines.append(p_meta.get("title", ""))
                ref_lines.extend(p_meta.get("body_lines", []))

        ref_text = "\n".join([l for l in ref_lines if l])
        hyp_text = "\n".join(all_hyp_lines)

        metrics = calculate_metrics(ref_text, hyp_text)

        conf_values = [p.get("average_confidence", 0.0) for p in pages if p.get("average_confidence", 0.0) > 0]
        avg_doc_conf = (sum(conf_values) / len(conf_values)) if conf_values else 0.0

        suite_summary = {
            "sample_id": sample_id,
            "filename": os.path.basename(pdf_path),
            "description": desc,
            "language": lang,
            "page_count": len(pages),
            "cold_start_time_ms": round(cold_start_time_ms, 2),
            "avg_warm_time_ms": round(avg_warm_time_ms, 2),
            "total_document_time_sec": round(total_doc_sec, 2),
            "peak_rss_mb": round(ocr_res["peak_rss_mb"], 2),
            "memory_delta_mb": round(rss_after - rss_before, 2),
            "average_confidence": round(avg_doc_conf, 4),
            "metrics": metrics,
            "pages": [
                {
                    "page_number": p["page_number"],
                    "duration_ms": p["duration_ms"],
                    "line_count": p["line_count"],
                    "average_confidence": p["average_confidence"],
                    "detected_rotation": p["detected_rotation"],
                    "cold_start": p["cold_start"],
                    "error": p["error"],
                }
                for p in pages
            ],
        }

        benchmark_results["samples"][sample_id] = suite_summary

        print(f"Pages Processed: {len(pages)}")
        print(f"Cold-Start Time: {cold_start_time_ms / 1000.0:.2f} s")
        print(f"Warm Avg Page Time: {avg_warm_time_ms / 1000.0:.2f} s")
        print(f"Total Document Time: {total_doc_sec:.2f} s")
        print(f"Peak Memory RSS: {suite_summary['peak_rss_mb']:.1f} MB (Delta: {suite_summary['memory_delta_mb']:.1f} MB)")
        print(f"Average Confidence: {avg_doc_conf * 100:.2f}%")
        print(f"Character Accuracy: {metrics['char_accuracy_pct']:.2f}% (CER: {metrics['cer']:.4f})")
        print(f"Word Accuracy: {metrics['word_accuracy_pct']:.2f}% (WER: {metrics['wer']:.4f})")

    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(benchmark_results, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 80)
    print(f"Phase OCR-2.1 Benchmarks complete. Results saved to: {RESULTS_FILE}")
    print("=" * 80)
    return benchmark_results


if __name__ == "__main__":
    run_benchmarks()
