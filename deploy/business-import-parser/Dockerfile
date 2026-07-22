FROM python:3.13-slim-bookworm@sha256:dd86541a59b252667f4c12f8b2ee17216de37dd65ac773bf097bef996fa78860

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-deu \
    tesseract-ocr-eng \
    tesseract-ocr-fra \
    tesseract-ocr-por \
    tesseract-ocr-rus \
    tesseract-ocr-spa \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 65532 --home-dir /nonexistent --shell /usr/sbin/nologin parser

WORKDIR /app
COPY --chown=65532:65532 parser.py /app/parser.py
COPY parser_smoke.py /tmp/parser_smoke.py
RUN PYTHONPATH=/app python /tmp/parser_smoke.py && rm /tmp/parser_smoke.py

ENV PYTHONHASHSEED=random \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TMPDIR=/tmp \
    BUSINESS_IMPORT_PARSER_PORT=8080

USER 65532:65532
EXPOSE 8080

CMD ["python", "-I", "/app/parser.py"]
