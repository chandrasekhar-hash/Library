"""Configuration and safety bounds for the Aks OCR Worker Engine."""

import os
from pathlib import Path
from pydantic import BaseModel, Field

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_CACHE_DIR = os.getenv(
    "PADDLE_PDX_CACHE_HOME", str(BASE_DIR / ".cache")
)
os.environ["PADDLE_PDX_CACHE_HOME"] = MODEL_CACHE_DIR
# Disable telemetry check to speed up inference and keep private
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ["PADDLEOCR_DISABLE_AUTO_LOGGING_CONFIG"] = "1"


class OCRConfig(BaseModel):
    """Runtime configuration, memory bounds, and safety limits for OCR processing."""

    # Rasterization settings
    default_dpi: int = Field(default=250, ge=150, le=400)
    min_dpi: int = 200
    max_dpi: int = 300

    # Safety limits
    max_page_dimension: int = Field(default=5000, description="Max width or height in pixels")
    max_pixels_per_page: int = Field(default=25_000_000, description="Max total pixels per page")
    max_page_count: int = Field(
        default_factory=lambda: int(os.getenv("AKS_OCR_MAX_PAGE_COUNT", "1000")),
        description="Max PDF pages processed in a single job"
    )
    page_timeout_seconds: float = Field(default=30.0, ge=5.0, le=120.0, description="Timeout per page in seconds")
    doc_timeout_seconds: float = Field(default=300.0, ge=30.0, le=900.0, description="Total timeout per document in seconds")

    # High-Performance Detection & Sizing Configuration
    # Uses CPU-optimized PP-OCRv6 medium DBNet detector instead of heavy GPU server models
    detection_model_name: str = Field(default="PP-OCRv6_medium_det")
    text_det_limit_side_len: int = Field(default=1280, ge=640, le=1920, description="Max side length for detection image resizing")
    text_det_limit_type: str = Field(default="max")

    # Concurrency and execution
    concurrency_workers: int = Field(default=1, ge=1, le=4, description="Sequential single-worker default")
    max_concurrent_jobs: int = Field(default=1, ge=1, le=4, description="Global maximum concurrent OCR jobs allowed across the service")
    concurrency_overflow_strategy: str = Field(default="reject", description="Strategy when max_concurrent_jobs reached: 'reject' (HTTP 429) or 'queue'")
    max_queue_wait_seconds: float = Field(default=5.0, ge=0.5, le=60.0, description="Max seconds to wait for a slot when queueing")
    isolation_mode: str = Field(default="direct", description="Execution mode: 'direct' (in-process) or 'subprocess' (hard-isolated child process)")
    normalizer_version: str = "1.0.0"

    # Orientation handling
    # For English: doc orientation classification detects 0, 90, 180, 270 deg rotations
    enable_doc_orientation: bool = True
    # For English: line orientation classification detects inverted lines
    enable_textline_orientation: bool = True

    # Security & Networking
    api_host: str = "127.0.0.1"  # Bound strictly to loopback
    api_port: int = 5060
    api_token: str = Field(
        default_factory=lambda: os.getenv("AKS_OCR_SECRET_KEY", "aks-internal-dev-token")
    )


# Global default configuration instance
config = OCRConfig()
