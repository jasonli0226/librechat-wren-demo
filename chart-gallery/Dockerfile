# ---- build the SPA and bundle the embedding model ----
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build && node scripts/fetch-model.mjs dist

# ---- runtime: FastAPI serves the API and the built SPA ----
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:0.10.9 /uv /bin/uv
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    GALLERY_STATIC_DIR=/app/static \
    GALLERY_DB_PATH=/data/charts.db
WORKDIR /app
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY api/gallery ./gallery
COPY --from=web /web/dist ./static
RUN useradd --system --uid 10001 gallery && mkdir -p /data && chown gallery /data
USER gallery
EXPOSE 3090
CMD ["/app/.venv/bin/uvicorn", "gallery.main:app", "--host", "0.0.0.0", "--port", "3090", "--workers", "1"]
