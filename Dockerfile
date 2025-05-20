
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    postgresql-client \
    libpq-dev \
    gcc \
    wget \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

RUN mkdir -p /app/data && chmod 777 /app/data

USER appuser

EXPOSE 3000

CMD ["python", "app.py", "--host", "0.0.0.0", "--port", "3000"]
