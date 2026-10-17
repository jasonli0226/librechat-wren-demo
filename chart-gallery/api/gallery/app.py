"""HTTP API and static SPA for the chart gallery."""

from __future__ import annotations

import asyncio
import hmac
import logging
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from .arrange import ArrangeIn, build_user_message
from .config import Settings
from .headline import headlines_for
from .llm import LlmError, LlmFn, make_openrouter_llm
from .models import ChartIn
from .normalize import dedup_key, normalize_sql
from .ratelimit import RateLimiter
from .repository import ChartRepository, NewChart
from .wren import QueryFn, WrenError, make_wren_query

MAX_BODY_BYTES = 1_000_000
# Paths that must 404 instead of falling back to index.html.
NON_SPA_PREFIXES = ("api/", "internal/", "assets/", "models/", "ort/")
# Live-data limits: a 12-tile dashboard loaded twice (load + rebuild) must fit per client.
DATA_PER_CLIENT = 60
DATA_TOTAL = 300
DATA_WINDOW_S = 60.0
DATA_CONCURRENCY = 4
ARRANGE_PER_CLIENT = 6
ARRANGE_TOTAL = 30
ARRANGE_WINDOW_S = 60.0

logger = logging.getLogger("gallery")
mimetypes.add_type("application/wasm", ".wasm")


def envelope(data: Any = None, error: str | None = None) -> dict[str, Any]:
    return {"success": error is None, "data": data, "error": error}


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(envelope(error=message), status_code=status)


def _read_prompt(path: str | None) -> str | None:
    """The arrange system prompt, read per request; None when missing or unreadable."""
    if not path:
        return None
    try:
        return Path(path).read_text(encoding="utf-8")
    except (OSError, ValueError):
        logger.warning("arrange prompt file unreadable")
        return None


class SpaStaticFiles(StaticFiles):
    """Static files with index.html as the fallback for client-side routes like /charts/12."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path.startswith(NON_SPA_PREFIXES):
                raise
            return await super().get_response("index.html", scope)


def create_app(
    settings: Settings,
    repo: ChartRepository | None = None,
    query: QueryFn | None = None,
    llm: LlmFn | None = None,
) -> FastAPI:
    repository = repo or ChartRepository(settings.db_path)
    repository.init_schema()
    run_query = query or make_wren_query(settings.wren_mcp_url)
    data_limiter = RateLimiter(DATA_PER_CLIENT, DATA_TOTAL, DATA_WINDOW_S)
    arrange_llm = llm or (
        make_openrouter_llm(settings.openrouter_key, settings.llm_model) if settings.openrouter_key else None
    )
    arrange_limiter = RateLimiter(ARRANGE_PER_CLIENT, ARRANGE_TOTAL, ARRANGE_WINDOW_S)
    data_slots = asyncio.Semaphore(DATA_CONCURRENCY)
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

    @app.get("/api/charts/{chart_id}/data", response_model=None)
    async def chart_data(chart_id: int, request: Request) -> dict[str, Any] | JSONResponse:
        client_host = request.client.host if request.client else "unknown"
        if not data_limiter.allow(client_host):
            return _error(429, "too many requests")
        chart = repository.get(chart_id)
        if chart is None:
            return _error(404, "chart not found")
        try:
            async with data_slots:
                result = await run_query(chart["sql"])
        except WrenError as exc:
            logger.warning("live query failed for chart %s: %s", chart_id, exc)
            return _error(502, "live query failed")
        except TimeoutError:
            logger.warning("live query timed out for chart %s", chart_id)
            return _error(504, "live query timed out")
        return envelope(
            {
                "rows": result["rows"],
                "columns": result["columns"],
                "truncated": result["truncated"],
                "ran_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    @app.post("/api/dashboards/arrange", response_model=None)
    async def arrange(request: Request) -> dict[str, Any] | JSONResponse:
        # Rate limit first so rejected and id-probing requests still spend budget.
        client_host = request.client.host if request.client else "unknown"
        if not arrange_limiter.allow(client_host):
            return _error(429, "too many requests")
        # Only JSON: a cross-site text/plain POST needs no preflight and would spend the OpenRouter key.
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if media_type != "application/json":
            return _error(415, "content type must be application/json")
        prompt = _read_prompt(settings.prompt_path)
        if arrange_llm is None or prompt is None:
            return _error(503, "AI arrangement disabled")
        try:
            arrange_in = ArrangeIn.model_validate_json(await request.body())
        except ValidationError as exc:
            raise RequestValidationError([{**err, "loc": ("body", *err["loc"])} for err in exc.errors()]) from None
        charts = []
        for tile in arrange_in.tiles:
            chart = repository.get(tile.chart_id)
            if chart is None:
                return _error(422, f"unknown chart id {tile.chart_id}")
            charts.append(chart)
        headlines = {
            tile.chart_id: headlines_for(chart, tile.allowed_types)
            for chart, tile in zip(charts, arrange_in.tiles)
        }
        try:
            spec = await arrange_llm(prompt, build_user_message(charts, arrange_in.tiles, headlines))
        except LlmError as exc:
            logger.warning("AI arrangement failed: %s", exc)
            return _error(502, "AI arrangement failed")
        except TimeoutError:
            logger.warning("AI arrangement timed out")
            return _error(504, "AI arrangement timed out")
        return envelope({"spec": spec, "headlines": {str(chart_id): value for chart_id, value in headlines.items()}})

    @app.get("/healthz", response_model=None)
    def healthz() -> dict[str, Any] | JSONResponse:
        if not repository.ping():
            return _error(503, "database unavailable")
        return envelope({"status": "ok"})

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))

    if settings.static_dir:
        app.mount("/", SpaStaticFiles(directory=settings.static_dir, html=True), name="spa")
    return app
