#!/bin/bash
# Startup script for Render deployment
# Download models if not present
python -c "from backend.app.services.opencv_sface import ensure_models; ensure_models()"
# Start the FastAPI server
uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT

