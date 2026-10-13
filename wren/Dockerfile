FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WREN_HOME=/wren/home

RUN pip install "wrenai[postgres,mcp]==0.15.0" "mcp<2" "psycopg2-binary" && mkdir -p /wren/home /wren/scripts /wren/project

COPY entrypoint.sh /wren/entrypoint.sh
COPY scripts/ /wren/scripts/
COPY connection.yml /wren/connection.yml
COPY project/ /wren/project/

RUN chmod +x /wren/entrypoint.sh

WORKDIR /wren/project
ENTRYPOINT ["/wren/entrypoint.sh"]
