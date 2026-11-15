# Celestra: one container that serves the website and the API (Render, Koyeb or any Docker host; port $PORT, default 7860).
# Stage 1 builds the Next.js site as static files; stage 2 runs FastAPI, which serves those files and the API.
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV CELESTRA_EXPORT=1 NEXT_PUBLIC_API_URL="" NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.12-slim
RUN useradd -m -u 1000 user
WORKDIR /app
COPY requirements-deploy.txt .
RUN pip install --no-cache-dir -r requirements-deploy.txt
COPY --chown=user:user backend backend
COPY --chown=user:user ml_engine ml_engine
COPY --chown=user:user data-pipeline data-pipeline
COPY --chown=user:user data/config data/config
COPY --chown=user:user data/processed data/processed
COPY --chown=user:user data/real data/real
COPY --from=web --chown=user:user /web/out frontend/out
RUN mkdir -p data/raw && chown -R user:user /app   # live custom points cache their downloads here
USER user
ENV PYTHONUNBUFFERED=1 HOME=/home/user
# Hosts such as Render pass the port in $PORT; 7860 otherwise
EXPOSE 7860
CMD ["sh", "-c", "python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
