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

- **Data**: RateMyProfessor’s GraphQL API (not HTML scraping); responses normalized into SQLite so the app isn’t tied to the external schema.
- **Backend**: FastAPI routes for rankings (sort/filter params), departments, stats, and schedule-by-course-codes. Cache refreshes when older than 7 days (background task); manual refresh via API.
- **Scoring**: Composite = 40% quality, 35% would-take-again, 25% inverse difficulty.
- **Frontend**: Single page with tabs (Rankings, Schedule Builder, Departments). Vanilla JS, no framework; state and DOM updates by hand; fetches REST API and renders from JSON.
- **Deployment**: One Render service; FastAPI serves the API and static frontend. Root dir `backend` for build/run; app mounts frontend and serves `index.html` at `/`.

## Run locally

```bash
cd backend && pip install -r requirements.txt && python -m uvicorn main:app --reload
```

Then open **http://127.0.0.1:8000**. Data is scraped on first run and cached in SQLite.
