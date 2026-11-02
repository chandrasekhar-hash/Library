"""FastAPI internal service interface with Bearer token authentication."""

import os
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from .config import config, OCRConfig
from .worker import OCRWorker
from .rasterizer import PDFRasterizerError, PDFSecurityError
from .isolation import ConcurrencyLimitExceededError, ProcessIsolatedRunner

app = FastAPI(
    title="Aks Internal OCR Engine",
    description="Internal, authenticated Python OCR Worker service for Aks",
    version="0.2.0",
    docs_url="/docs",
    redoc_url=None,
)

security = HTTPBearer(auto_error=False)
worker_instance: Optional[OCRWorker] = None


def get_worker() -> OCRWorker:
    global worker_instance
    if worker_instance is None:
        worker_instance = OCRWorker(config)
    return worker_instance


def verify_token(credentials: Optional[HTTPAuthorizationCredentials] = Security(security)) -> str:
    """Ensure every internal request provides the valid Bearer secret."""
    expected_token = config.api_token
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication scheme. Bearer token required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if credentials.credentials != expected_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Invalid OCR service authentication token.",
        )
    return credentials.credentials


class OCRPDFRequest(BaseModel):
    pdf_path: str = Field(..., description="Absolute or relative path to source PDF (read-only)")
    lang: str = Field(default="en", description="Target language ('en', 'hi', 'sa', 'devanagari')")
    dpi: int = Field(default=250, ge=200, le=300, description="Rasterization DPI")
    start_page: int = Field(default=0, ge=0)
    max_pages: Optional[int] = Field(default=None, ge=1, le=100)
    enable_doc_orientation: Optional[bool] = None
    page_timeout: Optional[float] = Field(default=None, ge=1.0, le=300.0)
    isolated: Optional[bool] = Field(default=None, description="Run in isolated subprocess with hard timeout")


@app.get("/health")
def health_check(worker: OCRWorker = Depends(get_worker)):
    """Health check reporting process memory, active workers, configuration limits, and architecture."""
    import platform
    return {
        "status": "healthy",
        "service": "aks-ocr-engine",
        "platform": platform.platform(),
        "arch": platform.machine(),
        "python_version": platform.python_version(),
        "peak_rss_mb": round(worker.get_current_rss_mb(), 2),
        "active_workers": ProcessIsolatedRunner.get_active_workers_count(),
        "normalizer_version": config.normalizer_version,
        "limits": {
            "min_dpi": config.min_dpi,
            "max_dpi": config.max_dpi,
            "max_page_count": config.max_page_count,
            "max_page_dimension": config.max_page_dimension,
            "max_pixels_per_page": config.max_pixels_per_page,
            "page_timeout_seconds": config.page_timeout_seconds,
            "doc_timeout_seconds": config.doc_timeout_seconds,
            "detection_model": config.detection_model_name,
            "text_det_limit_side_len": config.text_det_limit_side_len,
            "concurrency_workers": config.concurrency_workers,
            "max_concurrent_jobs": config.max_concurrent_jobs,
            "concurrency_overflow_strategy": config.concurrency_overflow_strategy,
            "max_queue_wait_seconds": config.max_queue_wait_seconds,
        },
    }


@app.post("/ocr/pdf", dependencies=[Depends(verify_token)])
def process_pdf_endpoint(req: OCRPDFRequest, worker: OCRWorker = Depends(get_worker)):
    """Process a PDF page-by-page. Requires valid Bearer authorization."""
    try:
        result = worker.process_pdf(
            pdf_path=req.pdf_path,
            lang=req.lang,
            dpi=req.dpi,
            start_page=req.start_page,
            max_pages=req.max_pages,
            enable_doc_orientation=req.enable_doc_orientation,
            page_timeout=req.page_timeout,
            isolated=req.isolated,
        )
        return result
    except ConcurrencyLimitExceededError as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(e),
            headers={"Retry-After": "5"},
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except (PDFSecurityError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except PDFRasterizerError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"OCR worker error: {str(e)}")


def start_server():
    """CLI entrypoint to start the internal FastAPI server."""
    import uvicorn
    uvicorn.run(
        "src.api:app",
        host=config.api_host,
        port=config.api_port,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    start_server()
