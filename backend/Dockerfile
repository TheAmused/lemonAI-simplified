# Build from the repository root:
#   docker build -f backend/Dockerfile -t lemonai-hub .
FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    LEMON_SCHEMA_DIR=/app/schemas \
    UPLOAD_FOLDER=/data/uploads

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY backend/migrations ./migrations
COPY schemas ./schemas

# Run as an unprivileged user; uploads live on a volume owned by it.
RUN useradd --system --uid 10001 --home-dir /app lemonai \
    && mkdir -p /data/uploads/images \
    && chown -R lemonai:lemonai /data
USER lemonai

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5000/api/scripts', timeout=2).status == 200 else 1)"

CMD ["sh", "-c", "python -m app.cli init-db && exec uvicorn app.main:app --host 0.0.0.0 --port 5000 --workers 2"]
