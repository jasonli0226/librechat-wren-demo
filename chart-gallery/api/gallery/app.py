"""HTTP API and static SPA for the chart gallery."""

from __future__ import annotations

import hmac
import logging
import mimetypes
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Settings
from .models import ChartIn
from .normalize import dedup_key, normalize_sql
from .repository import ChartRepository, NewChart

MAX_BODY_BYTES = 1_000_000
# Paths that must 404 instead of falling back to index.html.
NON_SPA_PREFIXES = ("api/", "internal/", "assets/", "models/", "ort/")

logger = logging.getLogger("gallery")
mimetypes.add_type("application/wasm", ".wasm")


def envelope(data: Any = None, error: str | None = None) -> dict[str, Any]:
    return {"success": error is None, "data": data, "error": error}


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(envelope(error=message), status_code=status)


class SpaStaticFiles(StaticFiles):
    """Static files with index.html as the fallback for client-side routes like /charts/12."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path.startswith(NON_SPA_PREFIXES):
                raise
            return await super().get_response("index.html", scope)


def create_app(settings: Settings, repo: ChartRepository | None = None) -> FastAPI:
    repository = repo or ChartRepository(settings.db_path)
    repository.init_schema()
    expected_auth = f"Bearer {settings.token}".encode()
    app = FastAPI(title="Chart Gallery", docs_url=None, redoc_url=None, openapi_url=None)

    def require_token(authorization: str | None = Header(default=None)) -> None:
        if authorization is None or not hmac.compare_digest(authorization.encode(), expected_auth):
            raise HTTPException(status_code=401, detail="invalid or missing token")

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        if request.method == "POST":
            length = request.headers.get("content-length")
            if length is None:
                return _error(411, "content-length required")
            if not length.isdigit() or int(length) > MAX_BODY_BYTES:
                return _error(413, "request body too large")
        return await call_next(request)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _error(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in err['loc'][1:]) or 'body'}: {err['msg']}" for err in exc.errors()
        )
        return _error(422, problems)

    @app.post("/internal/charts", dependencies=[Depends(require_token)])
    def save_chart(chart: ChartIn) -> dict[str, Any]:
        normalized = normalize_sql(chart.sql)
        chart_id, status = repository.upsert(
            NewChart(
                dedup_key=dedup_key(normalized.text, chart.chart_type),
                title=chart.title,
                description=chart.description,
                chart_type=chart.chart_type,
                x_field=chart.x_field,
                y_fields=tuple(chart.y_fields),
                sql=chart.sql,
                normalized_sql=normalized.text,
                tables=normalized.tables,
                rows=tuple(chart.rows),
            )
        )
        logger.info("chart %s %s", chart_id, status)
        return envelope({"id": chart_id, "url": f"{settings.public_url}/charts/{chart_id}", "status": status})

    @app.get("/api/charts")
    def list_charts() -> dict[str, Any]:
        return envelope(repository.list_summaries())

    @app.get("/api/charts/{chart_id}")
    def get_chart(chart_id: int) -> dict[str, Any]:
        chart = repository.get(chart_id)
        if chart is None:
            raise HTTPException(status_code=404, detail="chart not found")
        return envelope(chart)

    @app.get("/healthz", response_model=None)
    def healthz() -> dict[str, Any] | JSONResponse:
        if not repository.ping():
            return _error(503, "database unavailable")
        return envelope({"status": "ok"})

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))

    if settings.static_dir:
        app.mount("/", SpaStaticFiles(directory=settings.static_dir, html=True), name="spa")
    return app
