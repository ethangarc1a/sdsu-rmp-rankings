import os
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from database import (
    init_db, is_cache_fresh, save_professors,
    get_professors, get_departments, get_stats, get_professors_by_courses,
    get_department_stats,
)
from scraper import scrape_all_professors, fetch_professor_reviews

logger = logging.getLogger("uvicorn.error")

AUTO_REFRESH_INTERVAL = 7 * 24 * 3600  # 7 days in seconds


async def auto_refresh_loop():
    """Periodically check cache freshness and re-scrape if stale."""
    while True:
        try:
            if not is_cache_fresh():
                logger.info("[auto-refresh] Cache is stale, starting background scrape...")
                professors = await scrape_all_professors()
                save_professors(professors)
                logger.info(f"[auto-refresh] Scraped and saved {len(professors)} professors.")
            else:
                logger.info("[auto-refresh] Cache is fresh, skipping scrape.")
        except Exception as e:
            logger.error(f"[auto-refresh] Scrape failed: {e}")
        await asyncio.sleep(AUTO_REFRESH_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task = asyncio.create_task(auto_refresh_loop())
    yield
    task.cancel()


app = FastAPI(title="SDSU Professor Rankings", lifespan=lifespan)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.post("/api/scrape")
async def trigger_scrape(force: bool = False):
    if not force and is_cache_fresh():
        stats = get_stats()
        return {
            "status": "cached",
            "message": "Data is fresh, no scrape needed.",
            "stats": stats,
        }

    try:
        logger.info("Starting SDSU professor scrape...")
        professors = await scrape_all_professors()
        logger.info(f"Scraped {len(professors)} professors, saving to database...")
        save_professors(professors)
        stats = get_stats()
        logger.info("Scrape complete and saved.")
        return {
            "status": "completed",
            "message": f"Scraped {len(professors)} professors.",
            "stats": stats,
        }
    except Exception as e:
        logger.error(f"Scrape failed: {e}")
        raise HTTPException(status_code=500, detail=f"Scrape failed: {str(e)}")


@app.get("/api/rankings")
async def rankings(
    sort_by: str = Query("weighted_score", pattern="^(avg_rating|avg_difficulty|would_take_again_pct|num_ratings|weighted_score|name)$"),
    department: str = Query(None),
    min_ratings: int = Query(5, ge=0),
):
    professors = get_professors(
        department=department,
        sort_by=sort_by,
        min_ratings=min_ratings,
    )
    for i, p in enumerate(professors, start=1):
        p["rank"] = i
    return {"professors": professors, "total": len(professors)}


@app.get("/api/departments")
async def departments():
    return {"departments": get_departments()}


@app.get("/api/stats")
async def stats():
    return get_stats()


@app.get("/api/department-stats")
async def department_stats():
    return {"departments": get_department_stats()}


class ScheduleRequest(BaseModel):
    courses: list[str]


@app.post("/api/schedule")
async def schedule_lookup(req: ScheduleRequest):
    if not req.courses or len(req.courses) > 20:
        raise HTTPException(status_code=400, detail="Provide between 1 and 20 course codes.")
    grouped = get_professors_by_courses(req.courses)
    return {"results": grouped}


@app.get("/api/professor/{rmp_id}/reviews")
async def professor_reviews(rmp_id: int):
    try:
        reviews = await fetch_professor_reviews(rmp_id, limit=20)
        return {"reviews": reviews}
    except Exception as e:
        logger.error(f"Failed to fetch reviews for {rmp_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch reviews")
