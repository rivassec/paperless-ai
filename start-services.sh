#!/bin/bash
# start-services.sh - start Python RAG service (background) + Node.js app (foreground)

# Activate virtual environment for Python
source /app/venv/bin/activate

# Start the Python RAG service in the background
echo "Starting Python RAG service..."
python main.py --host 127.0.0.1 --port 8000 --initialize &

# Give it a moment to initialize
sleep 2
echo "Python RAG service started"

# Set environment variables for the Node.js service
export RAG_SERVICE_URL="http://localhost:8000"
export RAG_SERVICE_ENABLED="true"

# Start the Node.js application in the foreground (replaces the shell so tini
# delivers signals straight to node; docker restart policy handles crashes).
echo "Starting Node.js Paperless-AI service..."
exec node server.js
