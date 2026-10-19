FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/app/data PORT=8000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 billing && mkdir /app/data && chown billing:billing /app/data
COPY --chown=billing:billing backend ./backend
COPY --chown=billing:billing frontend ./frontend
COPY scripts/entrypoint.py ./scripts/entrypoint.py
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:'+__import__('os').getenv('PORT','8000')+'/api/health', timeout=4)"
CMD ["python", "scripts/entrypoint.py"]
