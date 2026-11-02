"""Comprehensive, reproducible real-world benchmark runner for Aks Phase OCR-2.2."""

import os
import sys
import json
import time
import psutil
import platform
import importlib.metadata
from pathlib import Path
from typing import Dict, Any, List

ENGINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE_DIR))

from src.config import config
from src.worker import OCRWorker
from src.postprocessor import evaluate_raw_vs_normalized, DevanagariSearchNormalizer

REAL_SAMPLES_DIR = Path(__file__).resolve().parent / "real_world_samples"
RESULTS_FILE = Path(__file__).resolve().parent / "results_real_world.json"


def run_real_world_benchmarks():
    manifest_path = REAL_SAMPLES_DIR / "manifest.json"
    if not manifest_path.exists():
        print("Manifest not found. Generating real-world samples...")
        from benchmarks.generate_real_world_samples import generate_all_real_world_samples
        generate_all_real_world_samples()

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
            "isolation_mode": config.isolation_mode,
        },
    }

    print("=" * 90)
    print("Aks Phase OCR-2.2 — Real-World Book & Scanned Page Benchmark Suite")
    print(f"Platform: {env_info['platform']} ({env_info['arch']}) | RAM: {env_info['physical_memory_gb']} GB")
    print(f"Engine: PaddlePaddle {env_info['paddle_version']} + PaddleOCR {env_info['paddleocr_version']}")
    print(f"Detector: {config.detection_model_name} (max_side={config.text_det_limit_side_len})")
    print("=" * 90)

    worker = OCRWorker(config)
    suite_results: Dict[str, Any] = {
        "environment": env_info,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "samples": {},
    }

    initial_baseline_rss = proc.memory_info().rss / (1024 * 1024)
    print(f"Initial process baseline RSS: {initial_baseline_rss:.2f} MB\n")

    for s_meta in manifest["samples"]:
        sample_id = s_meta["id"]
        pdf_file = REAL_SAMPLES_DIR / s_meta["pdf"]
        gt_file = REAL_SAMPLES_DIR / s_meta["gt"]
        lang = s_meta["lang"]
        desc = s_meta["description"]

        with open(gt_file, "r", encoding="utf-8") as f:
            gt_text = f.read().strip()

        print("-" * 90)
        print(f"Running Benchmark: [{sample_id}] ({lang})")
        print(f"Description: {desc}")
        print(f"Source file: {pdf_file.name}")

        rss_before = proc.memory_info().rss / (1024 * 1024)
        t0 = time.perf_counter()

        # Run OCR
        res = worker.process_pdf(
            str(pdf_file),
            lang=lang,
            dpi=250,
            isolated=False,
        )

        total_time_sec = time.perf_counter() - t0
        rss_after = proc.memory_info().rss / (1024 * 1024)

        # Extract recognized text lines
        hyp_lines = []
        confidences = []
        for p in res["pages"]:
            for line in p["lines"]:
                hyp_lines.append(line["text"])
                confidences.append(line["confidence"])

        hyp_text = "\n".join(hyp_lines)
        avg_conf = (sum(confidences) / len(confidences)) if confidences else 0.0

        # Evaluate Raw vs NFC vs Search Token Accuracy
        acc_eval = evaluate_raw_vs_normalized(gt_text, hyp_text)

        cold_start = res["pages"][0]["cold_start"]
        page_durations = [p["duration_ms"] for p in res["pages"]]
        avg_page_time_ms = sum(page_durations) / len(page_durations) if page_durations else 0.0

        sample_summary = {
            "sample_id": sample_id,
            "filename": pdf_file.name,
            "description": desc,
            "language": lang,
            "page_count": res["processed_pages_count"],
            "cold_start": cold_start,
            "avg_page_time_ms": round(avg_page_time_ms, 2),
            "total_document_time_sec": round(total_time_sec, 2),
            "peak_rss_mb": res["peak_rss_mb"],
            "memory_delta_mb": round(rss_after - rss_before, 2),
            "line_count": len(hyp_lines),
            "average_confidence": round(avg_conf, 4),
            "raw_accuracy": acc_eval["raw"],
            "nfc_accuracy": acc_eval["nfc"],
            "search_accuracy": acc_eval["search_tokens"],
            "matra_preservation": acc_eval["matra_preservation"],
            "pages": res["pages"],
        }

        suite_results["samples"][sample_id] = sample_summary

        print(f"  Pages: {res['processed_pages_count']} | Time: {total_time_sec:.2f}s ({avg_page_time_ms:.1f}ms/p) | Cold-start: {cold_start}")
        print(f"  Confidence: {avg_conf:.4f} | Lines detected: {len(hyp_lines)}")
        print(f"  Raw Accuracy:    Char={acc_eval['raw']['char_accuracy_pct']:.2f}% (CER={acc_eval['raw']['cer']}) | Word={acc_eval['raw']['word_accuracy_pct']:.2f}% (WER={acc_eval['raw']['wer']})")
        print(f"  Search Accuracy: Char={acc_eval['search_tokens']['search_char_accuracy_pct']:.2f}% | Word={acc_eval['search_tokens']['search_word_accuracy_pct']:.2f}% (WER={acc_eval['search_tokens']['wer']})")
        print(f"  Search Word Accuracy Boost: +{acc_eval['search_tokens']['word_accuracy_improvement_pct']:.2f}%")
        print(f"  Peak RSS: {res['peak_rss_mb']:.2f} MB (Delta: {rss_after - rss_before:+.2f} MB)")

    final_rss = proc.memory_info().rss / (1024 * 1024)
    suite_results["final_rss_mb"] = round(final_rss, 2)
    suite_results["net_memory_growth_mb"] = round(final_rss - initial_baseline_rss, 2)

    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(suite_results, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 90)
    print(f"Real-World Benchmarks Complete. Output saved to: {RESULTS_FILE}")
    print(f"Net Process Memory Growth across 7 real tests: {suite_results['net_memory_growth_mb']:.2f} MB")
    print("=" * 90)


if __name__ == "__main__":
    run_real_world_benchmarks()

