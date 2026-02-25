# SDSU Professor Rankings

A full-stack web app that helps students find the best professors at San Diego State by ranking 5,000+ RateMyProfessor profiles by quality, difficulty, and a custom composite score.

**[→ Try it live](https://sdsu-rmp-rankings.onrender.com/)** *(Render; first load may take ~30s if the service was idle.)*

---

## What it does

- **Backend**: Scrapes RateMyProfessor’s GraphQL API, normalizes and stores data in SQLite, and exposes a REST API for rankings, departments, stats, and schedule-building.
- **Frontend**: Single-page UI with filters (department, min reviews), sortable tables, schedule builder (enter course codes → get best-rated professors), and links to professor pages.
- **Deployment**: Single service on Render (Python/FastAPI serving API + static frontend).

## Tech stack

| Layer | Technologies |
|-------|--------------|
| Backend | Python, FastAPI, httpx, SQLite |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Data | RateMyProfessor GraphQL API; local SQLite cache with 7-day refresh |
| Hosting | Render |

## Build process

- **Data first**: RateMyProfessor’s public GraphQL API is used instead of scraping HTML, so the pipeline is structured around their schema. Responses are normalized into a simple SQLite schema (professors, departments, stats) so the rest of the app doesn’t depend on the external API shape.
- **Backend**: FastAPI routes for rankings (with sort/filter query params), departments, stats, and a schedule endpoint that takes course codes and returns best-rated professors. A background task checks cache age and re-scrapes when data is older than 7 days; manual refresh is also available via API.
- **Scoring**: The composite “best overall” score is a weighted mix of quality (40%), would-take-again (35%), and inverse difficulty (25%), so high-rated, low-difficulty professors rank at the top.
- **Frontend**: Built as a single page with tabbed sections (Rankings, Schedule Builder, Departments). Vanilla JS was chosen to keep dependencies minimal and to handle state and DOM updates explicitly. The UI calls the backend REST API and renders tables and filters from the JSON responses.
- **Deployment**: One Render web service runs the FastAPI app, which serves both the API and the static frontend. Root directory is set to `backend` so Render runs `pip install` and `uvicorn` in the right place; the app mounts the frontend folder and serves `index.html` at `/`.

## Highlights for recruiters

- **Full-stack**: API design, database modeling, and frontend built from scratch (no React/Vue—vanilla JS for this project).
- **Data pipeline**: Fetching and normalizing external API data, caching, and refresh logic.
- **Deployed**: Live, public URL; one-click for hiring managers to see working software.

## Run locally

```bash
cd backend && pip install -r requirements.txt && python -m uvicorn main:app --reload
```

Then open **http://127.0.0.1:8000**. Data is scraped on first run and cached in SQLite.
