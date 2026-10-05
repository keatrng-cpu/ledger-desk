# Always-on host for the Databento socket. Netlify cannot hold one.
# Build from this directory: docker build -t ledger-gateway gateway
# Secrets stay on the host (DATABASE_URL, DATABENTO_API_KEY). None are baked in.
# Globex closed is a sit. Inside Globex, lag is this process being dead.
FROM python:3.12-slim

WORKDIR /opt/ledger-gateway

COPY requirements.txt databento_live_gateway.py ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir -r requirements.txt \
  && useradd --system --uid 10001 --create-home gateway

USER gateway
ENV PYTHONUNBUFFERED=1

CMD ["python", "-u", "databento_live_gateway.py"]
