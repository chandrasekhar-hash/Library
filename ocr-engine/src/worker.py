"""Sequential, memory-bounded PDF OCR Worker with genuine timeout guards."""

import os
import gc
import time
import signal
import logging
import psutil
import threading
from typing import Any, Dict, List, Optional
from pathlib import Path

from .config import config, OCRConfig
from .rasterizer import PDFRasterizer, PDFRasterizerError, PDFSecurityError
from .pipeline import OCRPipeline

logger = logging.getLogger("aks.ocr.worker")


class PageTimeoutError(Exception):
    """Raised when a single page exceeds the processing timeout."""
    pass


def _timeout_handler(signum, frame):
    raise PageTimeoutError("Page OCR processing exceeded the configured timeout limit.")


class OCRWorker:
    """Processes PDF documents sequentially with safety guards, memory bounding, and true timeouts."""

    def __init__(self, cfg: Optional[OCRConfig] = None):
        self.config = cfg or config
        self.rasterizer = PDFRasterizer(self.config)
        self.pipeline = OCRPipeline(self.config)
        self.process = psutil.Process(os.getpid())
        self._lock = threading.Lock()

    def process_pdf(
        self,
        pdf_path: str,
        lang: str = "en",
        dpi: Optional[int] = None,
        start_page: int = 0,
        max_pages: Optional[int] = None,
        enable_doc_orientation: Optional[bool] = None,
        enable_textline_orientation: Optional[bool] = None,
        page_timeout: Optional[float] = None,
        isolated: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        Process a PDF file page-by-page.
        Enforces read-only access, genuine page timeouts, and bounds memory RSS.
        """
        use_isolation = isolated if isolated is not None else (self.config.isolation_mode == "subprocess")
        if use_isolation:
            from .isolation import ProcessIsolatedRunner
            runner = ProcessIsolatedRunner(self.config)
            return runner.run(
                pdf_path=pdf_path,
                lang=lang,
                dpi=dpi,
                start_page=start_page,
                max_pages=max_pages,
                enable_doc_orientation=enable_doc_orientation,
                enable_textline_orientation=enable_textline_orientation,
                page_timeout=page_timeout,
            )

        with self._lock:
            return self._process_pdf_in_process(
                pdf_path=pdf_path,
                lang=lang,
                dpi=dpi,
                start_page=start_page,
                max_pages=max_pages,
                enable_doc_orientation=enable_doc_orientation,
                enable_textline_orientation=enable_textline_orientation,
                page_timeout=page_timeout,
            )

    def _process_pdf_in_process(
        self,
        pdf_path: str,
        lang: str = "en",
        dpi: Optional[int] = None,
        start_page: int = 0,
        max_pages: Optional[int] = None,
        enable_doc_orientation: Optional[bool] = None,
        enable_textline_orientation: Optional[bool] = None,
        page_timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        doc_start_time = time.perf_counter()
        initial_rss_mb = self.get_current_rss_mb()
        peak_rss_mb = initial_rss_mb

        pdf_p = Path(pdf_path)
        if not pdf_p.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        total_pages = self.rasterizer.get_page_count(pdf_path)
        if total_pages > self.config.max_page_count:
            raise PDFSecurityError(
                f"PDF has {total_pages} pages, which exceeds the allowed safety limit of {self.config.max_page_count}"
            )

        target_dpi = dpi or self.config.default_dpi
        timeout_limit = page_timeout or self.config.page_timeout_seconds
        can_use_signals = threading.current_thread() is threading.main_thread()

        logger.info(
            f"Starting OCR worker job: {pdf_p.name} (pages={total_pages}, lang={lang}, "
            f"dpi={target_dpi}, page_timeout={timeout_limit}s, signals_enabled={can_use_signals})"
        )

        pages_result: List[Dict[str, Any]] = []
        is_first_page = True

        for page_idx, img_arr, width, height in self.rasterizer.iterate_pages(
            pdf_path, dpi=target_dpi, start_page=start_page, max_pages=max_pages
        ):
            # Check document-level timeout
            elapsed_doc_time = time.perf_counter() - doc_start_time
            if elapsed_doc_time > self.config.doc_timeout_seconds:
                logger.warning(
                    f"Document processing timed out after {elapsed_doc_time:.1f}s at page {page_idx + 1}"
                )
                pages_result.append({
                    "page_number": page_idx + 1,
                    "width": width,
                    "height": height,
                    "dpi": target_dpi,
                    "detected_rotation": 0,
                    "line_count": 0,
                    "average_confidence": 0.0,
                    "duration_ms": 0.0,
                    "cold_start": False,
                    "lines": [],
                    "error": f"Document processing timeout exceeded ({self.config.doc_timeout_seconds}s limit)",
                })
                break

            page_start_time = time.perf_counter()
            old_handler = None

            try:
                # Set hard timeout if on main thread
                if can_use_signals and timeout_limit > 0:
                    old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
                    signal.setitimer(signal.ITIMER_REAL, timeout_limit)

                # Execute OCR inference
                page_ocr = self.pipeline.process_image(
                    img_arr,
                    lang=lang,
                    enable_doc_orientation=enable_doc_orientation,
                    enable_textline_orientation=enable_textline_orientation,
                )

                page_duration_ms = (time.perf_counter() - page_start_time) * 1000.0

                pages_result.append({
                    "page_number": page_idx + 1,
                    "width": width,
                    "height": height,
                    "dpi": target_dpi,
                    "detected_rotation": page_ocr["detected_rotation"],
                    "line_count": page_ocr["line_count"],
                    "average_confidence": page_ocr["average_confidence"],
                    "duration_ms": round(page_duration_ms, 2),
                    "cold_start": is_first_page,
                    "lines": page_ocr["lines"],
                    "error": None,
                })

            except PageTimeoutError as e:
                page_duration_ms = (time.perf_counter() - page_start_time) * 1000.0
                logger.warning(f"Page {page_idx + 1} timed out after {page_duration_ms/1000.0:.2f}s")
                pages_result.append({
                    "page_number": page_idx + 1,
                    "width": width,
                    "height": height,
                    "dpi": target_dpi,
                    "detected_rotation": 0,
                    "line_count": 0,
                    "average_confidence": 0.0,
                    "duration_ms": round(page_duration_ms, 2),
                    "cold_start": is_first_page,
                    "lines": [],
                    "error": f"Page timeout exceeded ({timeout_limit}s)",
                })

            except Exception as e:
                page_duration_ms = (time.perf_counter() - page_start_time) * 1000.0
                logger.error(f"Error processing page {page_idx + 1}: {str(e)}")
                pages_result.append({
                    "page_number": page_idx + 1,
                    "width": width,
                    "height": height,
                    "dpi": target_dpi,
                    "detected_rotation": 0,
                    "line_count": 0,
                    "average_confidence": 0.0,
                    "duration_ms": round(page_duration_ms, 2),
                    "cold_start": is_first_page,
                    "lines": [],
                    "error": str(e),
                })

            finally:
                # Cancel timer immediately
                if can_use_signals and timeout_limit > 0:
                    signal.setitimer(signal.ITIMER_REAL, 0)
                    if old_handler is not None:
                        signal.signal(signal.SIGALRM, old_handler)

                is_first_page = False
                # Release raster buffers and force garbage collection
                del img_arr
                gc.collect()

                current_rss = self.get_current_rss_mb()
                if current_rss > peak_rss_mb:
                    peak_rss_mb = current_rss

        total_duration_ms = (time.perf_counter() - doc_start_time) * 1000.0

        return {
            "document_name": pdf_p.name,
            "language": lang,
            "dpi": target_dpi,
            "total_pages_in_pdf": total_pages,
            "processed_pages_count": len(pages_result),
            "peak_rss_mb": round(peak_rss_mb, 2),
            "memory_delta_mb": round(peak_rss_mb - initial_rss_mb, 2),
            "total_duration_ms": round(total_duration_ms, 2),
            "pages": pages_result,
        }

    def get_current_rss_mb(self) -> float:
        """Get the current process Resident Set Size (RSS) in megabytes."""
        try:
            return self.process.memory_info().rss / (1024.0 * 1024.0)
        except Exception:
            return 0.0
