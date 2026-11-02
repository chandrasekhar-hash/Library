"""Subprocess isolation runner for Aks OCR Engine.

Guarantees hard timeout enforcement, OOM protection, and prevents native C++ state
corruption by running OCR workloads in an isolated OS process. Enforces strict
concurrency limits to protect system memory.
"""

import os
import gc
import sys
import time
import queue
import logging
import multiprocessing as mp
from pathlib import Path
from typing import Any, Dict, Optional

from .config import config, OCRConfig

logger = logging.getLogger("aks.ocr.isolation")


class ConcurrencyLimitExceededError(Exception):
    """Raised when incoming OCR requests exceed the configured concurrency limit."""
    pass


def _child_process_entrypoint(
    pdf_path: str,
    lang: str,
    dpi: Optional[int],
    start_page: int,
    max_pages: Optional[int],
    enable_doc_orientation: Optional[bool],
    enable_textline_orientation: Optional[bool],
    page_timeout: Optional[float],
    result_queue: mp.Queue,
):
    """Entrypoint executed inside the spawned isolated child process."""
    try:
        from .worker import OCRWorker
        from .config import config

        worker = OCRWorker(config)
        # In child process, execute sequentially without outer isolation recursion
        res = worker.process_pdf(
            pdf_path=pdf_path,
            lang=lang,
            dpi=dpi,
            start_page=start_page,
            max_pages=max_pages,
            enable_doc_orientation=enable_doc_orientation,
            enable_textline_orientation=enable_textline_orientation,
            page_timeout=page_timeout,
            isolated=False,
        )
        result_queue.put({"success": True, "result": res})
    except Exception as e:
        result_queue.put({"success": False, "error": str(e), "type": type(e).__name__})
    finally:
        gc.collect()


class ProcessIsolatedRunner:
    """Executes OCR jobs inside isolated subprocesses with hard timeout enforcement and concurrency limits."""

    _mp_ctx = mp.get_context("spawn")
    _process_semaphore: Optional[mp.BoundedSemaphore] = None
    _active_workers_count = mp.Value("i", 0)

    def __init__(self, cfg: Optional[OCRConfig] = None):
        self.config = cfg or config
        if ProcessIsolatedRunner._process_semaphore is None:
            ProcessIsolatedRunner._process_semaphore = self._mp_ctx.BoundedSemaphore(
                self.config.max_concurrent_jobs
            )

    @classmethod
    def get_active_workers_count(cls) -> int:
        """Get the current count of active child OCR processes."""
        with cls._active_workers_count.get_lock():
            return int(cls._active_workers_count.value)

    def run(
        self,
        pdf_path: str,
        lang: str = "en",
        dpi: Optional[int] = None,
        start_page: int = 0,
        max_pages: Optional[int] = None,
        enable_doc_orientation: Optional[bool] = None,
        enable_textline_orientation: Optional[bool] = None,
        page_timeout: Optional[float] = None,
        doc_timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Execute OCR in an isolated subprocess.
        Enforces concurrency gates, monitors execution, and guarantees hard termination.
        """
        pdf_p = Path(pdf_path)
        if not pdf_p.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        timeout_sec = doc_timeout or self.config.doc_timeout_seconds
        strategy = self.config.concurrency_overflow_strategy
        wait_sec = 0.0 if strategy == "reject" else self.config.max_queue_wait_seconds

        # 1. Enforce global concurrency gate
        semaphore = ProcessIsolatedRunner._process_semaphore
        acquired = semaphore.acquire(block=(wait_sec > 0.0), timeout=wait_sec if wait_sec > 0.0 else None)
        if not acquired:
            logger.warning(
                f"Global OCR concurrency limit ({self.config.max_concurrent_jobs}) reached. "
                f"Request for {pdf_p.name} rejected under strategy '{strategy}'."
            )
            raise ConcurrencyLimitExceededError(
                f"OCR Engine busy: Concurrency limit of {self.config.max_concurrent_jobs} reached. "
                f"Please retry after active requests complete."
            )

        with ProcessIsolatedRunner._active_workers_count.get_lock():
            ProcessIsolatedRunner._active_workers_count.value += 1

        result_queue = self._mp_ctx.Queue()
        proc = self._mp_ctx.Process(
            target=_child_process_entrypoint,
            args=(
                str(pdf_p.resolve()),
                lang,
                dpi,
                start_page,
                max_pages,
                enable_doc_orientation,
                enable_textline_orientation,
                page_timeout,
                result_queue,
            ),
        )

        start_time = time.perf_counter()
        child_pid = None

        try:
            proc.start()
            child_pid = proc.pid
            logger.info(
                f"Spawned isolated OCR worker process PID {child_pid} for {pdf_p.name} "
                f"(timeout={timeout_sec}s, active_workers={self.get_active_workers_count()})"
            )

            # Wait for child process up to timeout_sec
            proc.join(timeout=timeout_sec)
            elapsed = time.perf_counter() - start_time

            if proc.is_alive():
                # Hard timeout exceeded - terminate forcefully
                logger.warning(
                    f"Isolated OCR worker PID {child_pid} exceeded timeout ({timeout_sec}s). Terminating process..."
                )
                proc.terminate()
                time.sleep(0.5)
                if proc.is_alive():
                    logger.warning(f"Process PID {child_pid} did not exit after SIGTERM. Sending SIGKILL...")
                    proc.kill()
                proc.join(timeout=2.0)
                try:
                    proc.close()
                except Exception:
                    pass

                return {
                    "document_name": pdf_p.name,
                    "language": lang,
                    "dpi": dpi or self.config.default_dpi,
                    "total_pages_in_pdf": 0,
                    "processed_pages_count": 0,
                    "peak_rss_mb": 0.0,
                    "memory_delta_mb": 0.0,
                    "total_duration_ms": round(elapsed * 1000.0, 2),
                    "pages": [],
                    "error": f"Hard document timeout exceeded ({timeout_sec}s). Process PID {child_pid} terminated.",
                    "isolated_execution": True,
                    "child_pid": child_pid,
                }

            # Check process exit code
            if proc.exitcode != 0:
                logger.error(f"Isolated OCR process PID {child_pid} died abnormally with exit code {proc.exitcode}")
                return {
                    "document_name": pdf_p.name,
                    "language": lang,
                    "dpi": dpi or self.config.default_dpi,
                    "total_pages_in_pdf": 0,
                    "processed_pages_count": 0,
                    "peak_rss_mb": 0.0,
                    "memory_delta_mb": 0.0,
                    "total_duration_ms": round(elapsed * 1000.0, 2),
                    "pages": [],
                    "error": f"Child OCR worker process exited abnormally (code {proc.exitcode})",
                    "isolated_execution": True,
                    "child_pid": child_pid,
                }

            # Retrieve result from queue
            try:
                msg = result_queue.get_nowait()
                if msg.get("success"):
                    res = msg["result"]
                    res["isolated_execution"] = True
                    res["child_pid"] = child_pid
                    return res
                else:
                    err_msg = msg.get("error", "Unknown subprocess failure")
                    err_type = msg.get("type", "RuntimeError")
                    return {
                        "document_name": pdf_p.name,
                        "language": lang,
                        "dpi": dpi or self.config.default_dpi,
                        "total_pages_in_pdf": 0,
                        "processed_pages_count": 0,
                        "peak_rss_mb": 0.0,
                        "memory_delta_mb": 0.0,
                        "total_duration_ms": round(elapsed * 1000.0, 2),
                        "pages": [],
                        "error": f"Child OCR worker failed: {err_msg}",
                        "error_type": err_type,
                        "isolated_execution": True,
                        "child_pid": child_pid,
                    }
            except queue.Empty:
                return {
                    "document_name": pdf_p.name,
                    "language": lang,
                    "dpi": dpi or self.config.default_dpi,
                    "total_pages_in_pdf": 0,
                    "processed_pages_count": 0,
                    "peak_rss_mb": 0.0,
                    "memory_delta_mb": 0.0,
                    "total_duration_ms": round(elapsed * 1000.0, 2),
                    "pages": [],
                    "error": "Child process exited without writing result to queue.",
                    "isolated_execution": True,
                    "child_pid": child_pid,
                }

        finally:
            # Guarantees cleanup: reap process if still alive
            try:
                if proc.is_alive():
                    proc.kill()
                    proc.join(timeout=1.0)
            except (ValueError, Exception):
                pass

            # Close and join queue to release file descriptor pipes
            try:
                result_queue.close()
                result_queue.join_thread()
            except Exception:
                pass

            # Release concurrency gate
            try:
                semaphore.release()
            except ValueError:
                pass

            with ProcessIsolatedRunner._active_workers_count.get_lock():
                ProcessIsolatedRunner._active_workers_count.value = max(
                    0, ProcessIsolatedRunner._active_workers_count.value - 1
                )
