#!/bin/bash
# start-services.sh - start Python RAG service (background) + Node.js app (foreground)

# Activate virtual environment for Python
source /app/venv/bin/activate

# RAG_SERVICE_ENABLED=false skips the Python RAG service entirely (default: true).
export RAG_SERVICE_ENABLED="${RAG_SERVICE_ENABLED:-true}"
export RAG_SERVICE_URL="${RAG_SERVICE_URL:-http://localhost:8000}"
if [ "$RAG_SERVICE_ENABLED" = "true" ]; then
  echo "Starting Python RAG service..."
  python main.py --host 127.0.0.1 --port 8000 --initialize &
  sleep 2
  echo "Python RAG service started"
else
  echo "RAG service disabled (RAG_SERVICE_ENABLED=$RAG_SERVICE_ENABLED)"
fi

# Start the Node.js application in the foreground (replaces the shell so tini
# delivers signals straight to node; docker restart policy handles crashes).
echo "Starting Node.js Paperless-AI service..."
exec node server.js
