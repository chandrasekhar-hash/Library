"""High-efficiency PaddleOCR pipeline with unified CPU detection and script-aware orientation."""

import os
import gc
import sys
import time
import logging
from typing import Any, Dict, List, Optional, Union
import numpy as np
from PIL import Image

from .config import config, OCRConfig

logger = logging.getLogger("aks.ocr.pipeline")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [OCR] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class OCRPipeline:
    """Manages high-efficiency PaddleOCR instances with optimized CPU tensor allocation."""

    _instances: Dict[str, Any] = {}

    def __init__(self, cfg: Optional[OCRConfig] = None):
        self.config = cfg or config
        self._ensure_cache_dir()

    def _ensure_cache_dir(self):
        os.environ["PADDLE_PDX_CACHE_HOME"] = (
            self.config.MODEL_CACHE_DIR
            if hasattr(self.config, "MODEL_CACHE_DIR")
            else os.getenv("PADDLE_PDX_CACHE_HOME", "/tmp/paddlex")
        )
        os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
        os.environ["PADDLEOCR_DISABLE_AUTO_LOGGING_CONFIG"] = "1"

    def get_ocr_engine(
        self,
        lang: str = "en",
        enable_doc_orientation: Optional[bool] = None,
        enable_textline_orientation: Optional[bool] = None,
    ):
        """
        Retrieve or initialize a high-efficiency PaddleOCR engine.
        Uses PP-OCRv6_medium_det for both English and Devanagari to eliminate
        the 195s GPU-server detection bottleneck and keep memory bounded.
        """
        from paddleocr import PaddleOCR

        norm_lang = self._normalize_lang(lang)

        # Devanagari script safety rule:
        # PP-LCNet doc_orientation and textline_orientation were trained on Latin/CJK datasets.
        # In Devanagari, the continuous horizontal line (shirorekha) hangs along the top of glyphs.
        # Latin orientation models misclassify upright Devanagari lines as 180-deg rotated.
        # Thus, default orientation classifiers to False for Devanagari unless explicitly overridden.
        if norm_lang == "hi":
            doc_ori = False if enable_doc_orientation is None else enable_doc_orientation
            line_ori = False if enable_textline_orientation is None else enable_textline_orientation
            rec_model_name = "devanagari_PP-OCRv5_mobile_rec"
        else:
            doc_ori = (
                self.config.enable_doc_orientation
                if enable_doc_orientation is None
                else enable_doc_orientation
            )
            line_ori = (
                self.config.enable_textline_orientation
                if enable_textline_orientation is None
                else enable_textline_orientation
            )
            rec_model_name = "PP-OCRv6_medium_rec"

        det_model_name = self.config.detection_model_name
        side_len = self.config.text_det_limit_side_len
        limit_type = self.config.text_det_limit_type

        cache_key = f"{norm_lang}_det_{det_model_name}_side_{side_len}_doc_{doc_ori}_line_{line_ori}"
        if cache_key in self._instances:
            return self._instances[cache_key]

        logger.info(
            f"Initializing PaddleOCR engine: lang='{norm_lang}', det='{det_model_name}', "
            f"rec='{rec_model_name}', max_side={side_len}, doc_ori={doc_ori}, line_ori={line_ori}..."
        )

        engine = PaddleOCR(
            text_detection_model_name=det_model_name,
            text_recognition_model_name=rec_model_name,
            use_doc_orientation_classify=doc_ori,
            use_doc_unwarping=False,
            use_textline_orientation=line_ori,
            text_det_limit_side_len=side_len,
            text_det_limit_type=limit_type,
        )

        self._instances[cache_key] = engine
        logger.info(f"PaddleOCR engine for '{cache_key}' initialized successfully.")
        return engine

    def clear_cache(self):
        """Release cached engines and invoke garbage collector to free memory."""
        self._instances.clear()
        gc.collect()

    def process_image(
        self,
        image_input: Union[str, np.ndarray, Image.Image],
        lang: str = "en",
        enable_doc_orientation: Optional[bool] = None,
        enable_textline_orientation: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        Run OCR on an image (filepath, PIL image, or numpy array).
        Returns structured dictionary with page-level and line-level results.
        """
        start_time = time.perf_counter()
        engine = self.get_ocr_engine(
            lang=lang,
            enable_doc_orientation=enable_doc_orientation,
            enable_textline_orientation=enable_textline_orientation,
        )

        # Convert PIL Image to RGB numpy array if needed
        if isinstance(image_input, Image.Image):
            img_arr = np.array(image_input.convert("RGB"))
        elif isinstance(image_input, np.ndarray):
            img_arr = image_input
        else:
            img_arr = image_input  # File path

        try:
            predictions = engine.predict(img_arr)
        except Exception as e:
            logger.error(f"Inference failure: {type(e).__name__}")
            raise RuntimeError(f"OCR inference execution failed: {str(e)}") from e

        duration_ms = (time.perf_counter() - start_time) * 1000.0

        if not predictions or len(predictions) == 0:
            return {
                "detected_rotation": 0,
                "lines": [],
                "line_count": 0,
                "average_confidence": 0.0,
                "duration_ms": round(duration_ms, 2),
            }

        pred = predictions[0]

        # Extract detected rotation angle
        detected_rotation = 0
        doc_res = pred.get("doc_preprocessor_res")
        if doc_res and isinstance(doc_res, dict):
            detected_rotation = int(doc_res.get("angle", 0))

        # Extract lines
        rec_texts = pred.get("rec_texts", [])
        rec_scores = pred.get("rec_scores", [])
        rec_polys = pred.get("rec_polys", [])
        rec_boxes = pred.get("rec_boxes", [])

        lines = []
        conf_sum = 0.0

        for i, text in enumerate(rec_texts):
            score = float(rec_scores[i]) if i < len(rec_scores) else 0.0
            conf_sum += score

            # Normalize bbox: [x_min, y_min, x_max, y_max]
            bbox = []
            if i < len(rec_boxes):
                box = rec_boxes[i]
                if hasattr(box, "tolist"):
                    bbox = [int(v) for v in box.tolist()]
                else:
                    bbox = [int(v) for v in box]

            # Polygon coordinates: 4 points
            polygon = []
            if i < len(rec_polys):
                poly = rec_polys[i]
                if hasattr(poly, "tolist"):
                    polygon = [[int(pt[0]), int(pt[1])] for pt in poly.tolist()]
                else:
                    polygon = [[int(pt[0]), int(pt[1])] for pt in poly]

            if not bbox and polygon:
                xs = [pt[0] for pt in polygon]
                ys = [pt[1] for pt in polygon]
                bbox = [min(xs), min(ys), max(xs), max(ys)]

            lines.append({
                "line_index": i,
                "text": text,
                "confidence": round(score, 4),
                "bbox": bbox,
                "polygon": polygon,
            })

        avg_conf = (conf_sum / len(lines)) if lines else 0.0

        return {
            "detected_rotation": detected_rotation,
            "lines": lines,
            "line_count": len(lines),
            "average_confidence": round(avg_conf, 4),
            "duration_ms": round(duration_ms, 2),
        }

    @staticmethod
    def _normalize_lang(lang: str) -> str:
        """Map language codes to PaddleOCR supported codes."""
        lang_lower = (lang or "").strip().lower()
        if lang_lower in {
            "hi",
            "hindi",
            "sa",
            "sanskrit",
            "mr",
            "marathi",
            "ne",
            "nepali",
            "devanagari",
        }:
            return "hi"
        if lang_lower in {"en", "english"}:
            return "en"
        return "en"
