FROM python:3.11-slim@sha256:da047cb8f9d1d98e5c070f5300ba9f7274e33b8fc0e5be5ed88740aed1b95ba9 AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1


FROM base AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt


FROM base AS dev

WORKDIR /app

COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--no-access-log", "--ws", "none"]


FROM base AS runtime

COPY --from=builder /wheels /wheels
COPY requirements.txt .

# Install pinned deps from the prebuilt wheels only (no network, no source builds),
# then strip pip's own build tooling: wheel/setuptools (and the jaraco.* packages
# setuptools vendors under _vendor/) carry fixable CVEs and are never needed at
# runtime since every dependency is already an installed wheel.
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && (pip uninstall -y wheel setuptools || true) \
    && rm -rf /wheels requirements.txt \
        /usr/local/lib/python3.11/site-packages/setuptools* \
        /usr/local/lib/python3.11/site-packages/wheel* \
        /usr/local/lib/python3.11/site-packages/pkg_resources* \
        /usr/local/lib/python3.11/site-packages/_distutils_hack* \
        /usr/local/lib/python3.11/site-packages/jaraco* \
        /usr/local/lib/python3.11/site-packages/distutils-precedence.pth

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

COPY --chown=app:app src/ ./src/

USER app

EXPOSE 8000

ARG GIT_SHA=unknown
ENV REVISION=$GIT_SHA

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" || exit 1

# The app logs its own access line (JSON, no client IP); uvicorn's would add the IP. There are
# no WebSocket routes, and uvicorn's WebSocket handler logs the client address and query string.
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--ws", "none"]
