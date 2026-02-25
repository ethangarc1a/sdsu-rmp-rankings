# SDSU Professor Rankings

A web app that scrapes RateMyProfessor data for **San Diego State University** and ranks professors by quality, difficulty, and a weighted composite score. Filter by department, sort by any metric, and find the best professors at SDSU.

## Quick Start

```bash
# 1. Install dependencies
cd rmp-rankings/backend
pip install -r requirements.txt

# 2. Run the server
python -m uvicorn main:app --reload

# 3. Open in browser
# http://127.0.0.1:8000
```

The app will automatically scrape SDSU professor data from RateMyProfessor on first launch. Data is cached in a local SQLite database and refreshed when older than 7 days (or manually via the Refresh button).

## Features

- Scrapes all SDSU professors from RateMyProfessor's GraphQL API
- Weighted ranking score combining quality (40%), would-take-again (35%), and inverse difficulty (25%)
- Filter by department, sort by any column
- Minimum ratings threshold to filter out low-sample professors
- Click any professor row to see their top student tags
- Direct links to each professor's RateMyProfessor page

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/scrape?force=true` | POST | Scrape/refresh professor data |
| `/api/rankings?sort_by=weighted_score&department=...&min_ratings=5` | GET | Ranked professor list |
| `/api/departments` | GET | List of all departments |
| `/api/stats` | GET | Overview statistics |

## Tech Stack

- **Backend**: Python, FastAPI, httpx, SQLite
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Data Source**: RateMyProfessor GraphQL API
