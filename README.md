# AutoWorth – Used Car Fair-Price Bot (3D)

FastAPI + Three.js app on top of an ML pipeline (Linear Regression, KNN, K-Means, Random Forest, Gradient Boosting, XGBoost) trained on CarDekho listings.

**Features:** live price estimate with 80% range, deal verdict vs asking price, 3D car that reshapes by engine/power with colour options,
animated price reveal, depreciation curves, similar listings.

## Run locally
    pip install -r requirements.txt
    python pipeline.py                      # trains and writes artifacts/ (use N_ITER=3 for a quick run)
    uvicorn app.main:app --reload           # http://localhost:8000

## Docker
    docker build -t autoworth .
    docker run -p 8000:8000 autoworth

The image trains the model at build time, so the saved model always matches the library versions inside it.

## Deploy
- **Render:** push to GitHub, New > Web Service > Docker (uses `render.yaml`). Free tier sleeps when idle; first build takes several minutes.
- **Hugging Face Spaces:** create a Docker Space, push these files, add `app_port: 8000` to the Space README front-matter.
- **Any host with Docker** (Railway, Fly.io, VPS): it reads the `PORT` env var.

Endpoints: `GET /health`, `GET /api/meta`, `POST /api/predict`.
