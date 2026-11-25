FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 MPLBACKEND=Agg PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY pipeline.py .
COPY data ./data
# Train inside the image so the model always matches the installed library versions
ARG N_ITER=3
RUN N_ITER=$N_ITER python pipeline.py > train.log 2>&1 && tail -4 train.log
COPY app ./app
RUN useradd -m appuser && chown -R appuser /srv
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:%s/health'%os.environ.get('PORT','8000'))"
CMD ["sh","-c","uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
