"""PDF page rasterizer using pypdfium2 with safety bounds and cleanup."""

import os
from pathlib import Path
from typing import Generator, Optional, Tuple
import numpy as np
from PIL import Image
import pypdfium2 as pdfium

from .config import config, OCRConfig


class PDFRasterizerError(Exception):
    """Base exception for PDF rasterization errors."""
    pass


class PDFSecurityError(PDFRasterizerError):
    """Exception raised when PDF violates safety limits."""
    pass


class PDFRasterizer:
    """Safely rasterizes PDF pages into memory with strict bounds."""

    def __init__(self, cfg: Optional[OCRConfig] = None):
        self.config = cfg or config

    def get_page_count(self, pdf_path: str) -> int:
        """Get the total page count of a PDF without rendering pages."""
        self._validate_file_path(pdf_path)
        try:
            # Read-only open
            doc = pdfium.PdfDocument(pdf_path)
            count = len(doc)
            doc.close()
            return count
        except Exception as e:
            raise PDFRasterizerError(f"Failed to read PDF document: {str(e)}") from e

    def rasterize_page(
        self,
        pdf_path: str,
        page_index: int,
        dpi: Optional[int] = None,
    ) -> Tuple[np.ndarray, int, int]:
        """
        Rasterize a single 0-indexed page to an RGB numpy array.
        Returns: (image_array, width, height)
        """
        self._validate_file_path(pdf_path)
        target_dpi = dpi or self.config.default_dpi
        if target_dpi < self.config.min_dpi or target_dpi > self.config.max_dpi:
            raise ValueError(
                f"DPI {target_dpi} is outside allowable range [{self.config.min_dpi}, {self.config.max_dpi}]"
            )

        try:
            # Open read-only
            doc = pdfium.PdfDocument(pdf_path)
            total_pages = len(doc)
            if total_pages > self.config.max_page_count:
                doc.close()
                raise PDFSecurityError(
                    f"PDF page count ({total_pages}) exceeds safety limit ({self.config.max_page_count})"
                )

            if page_index < 0 or page_index >= total_pages:
                doc.close()
                raise IndexError(f"Page index {page_index} out of range [0, {total_pages - 1}]")

            page = doc[page_index]
            scale = target_dpi / 72.0

            # Pre-check dimensions before rendering
            page_w, page_h = page.get_size()
            est_w = int(page_w * scale)
            est_h = int(page_h * scale)

            if (
                est_w > self.config.max_page_dimension
                or est_h > self.config.max_page_dimension
                or (est_w * est_h) > self.config.max_pixels_per_page
            ):
                doc.close()
                raise PDFSecurityError(
                    f"Page {page_index + 1} dimensions ({est_w}x{est_h}={est_w*est_h} px) "
                    f"exceed max pixel limit ({self.config.max_pixels_per_page})"
                )

            # Render to bitmap
            bitmap = page.render(scale=scale)
            pil_image = bitmap.to_pil()
            rgb_image = pil_image.convert("RGB")
            img_arr = np.array(rgb_image)

            w, h = pil_image.size
            doc.close()
            return img_arr, w, h

        except PDFRasterizerError:
            raise
        except Exception as e:
            raise PDFRasterizerError(f"Error rasterizing page {page_index}: {str(e)}") from e

    def iterate_pages(
        self,
        pdf_path: str,
        dpi: Optional[int] = None,
        start_page: int = 0,
        max_pages: Optional[int] = None,
    ) -> Generator[Tuple[int, np.ndarray, int, int], None, None]:
        """
        Yields (page_index, image_array, width, height) page-by-page.
        Ensures memory is freed after each page.
        """
        self._validate_file_path(pdf_path)
        total_pages = self.get_page_count(pdf_path)
        if total_pages > self.config.max_page_count:
            raise PDFSecurityError(
                f"PDF total pages ({total_pages}) exceeds safety limit ({self.config.max_page_count})"
            )

        end_page = total_pages
        if max_pages is not None:
            end_page = min(start_page + max_pages, total_pages)

        for p_idx in range(start_page, end_page):
            arr, w, h = self.rasterize_page(pdf_path, p_idx, dpi=dpi)
            yield p_idx, arr, w, h

    @staticmethod
    def _validate_file_path(pdf_path: str) -> None:
        """Ensure file exists, is readable, and is not a directory or device."""
        p = Path(pdf_path)
        if not p.exists():
            raise FileNotFoundError(f"Source file not found: {pdf_path}")
        if not p.is_file():
            raise ValueError(f"Path is not a regular file: {pdf_path}")
        if not os.access(pdf_path, os.R_OK):
            raise PermissionError(f"File cannot be read (permission denied): {pdf_path}")

