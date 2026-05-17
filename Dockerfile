# Use official Python runtime as base image
FROM python:3.10-slim

# Set working directory in container
WORKDIR /app

# Copy requirements files
COPY requirements.txt .
COPY backend/requirements.txt ./backend/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -r backend/requirements.txt

# Copy project files
COPY . .

# Create necessary directories
RUN mkdir -p backend/uploads/digital-documents && \
    mkdir -p database

# Expose port
EXPOSE 5000

# Run gunicorn
CMD ["sh", "-c", "gunicorn app:app --chdir backend --bind 0.0.0.0:${PORT:-5000} --workers 4 --threads 2 --worker-class sync --timeout 60"]
