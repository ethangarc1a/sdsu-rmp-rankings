import sqlite3
import json
import os
from datetime import datetime, timedelta
from typing import Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "sdsu_professors.db")
CACHE_MAX_AGE_DAYS = 7


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS professors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rmp_id INTEGER UNIQUE NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            department TEXT NOT NULL,
            raw_department TEXT,
            avg_rating REAL,
            avg_difficulty REAL,
            would_take_again_pct REAL,
            num_ratings INTEGER DEFAULT 0,
            tags TEXT DEFAULT '[]',
            courses TEXT DEFAULT '[]',
            scraped_at TIMESTAMP NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_department ON professors(department);
        CREATE INDEX IF NOT EXISTS idx_avg_rating ON professors(avg_rating DESC);
        CREATE INDEX IF NOT EXISTS idx_num_ratings ON professors(num_ratings DESC);

        CREATE TABLE IF NOT EXISTS scrape_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_scraped_at TIMESTAMP,
            total_professors INTEGER DEFAULT 0
        );
    """)
    conn.commit()
    conn.close()


def is_cache_fresh() -> bool:
    conn = get_connection()
    row = conn.execute("SELECT last_scraped_at FROM scrape_meta WHERE id = 1").fetchone()
    conn.close()
    if not row or not row["last_scraped_at"]:
        return False
    last_scraped = datetime.fromisoformat(row["last_scraped_at"])
    return datetime.now() - last_scraped < timedelta(days=CACHE_MAX_AGE_DAYS)


def get_last_scraped() -> Optional[str]:
    conn = get_connection()
    row = conn.execute("SELECT last_scraped_at FROM scrape_meta WHERE id = 1").fetchone()
    conn.close()
    if row and row["last_scraped_at"]:
        return row["last_scraped_at"]
    return None


def save_professors(professors: list[dict]):
    conn = get_connection()
    now = datetime.now().isoformat()

    conn.execute("DELETE FROM professors")

    conn.executemany(
        """INSERT OR REPLACE INTO professors
           (rmp_id, first_name, last_name, department, raw_department,
            avg_rating, avg_difficulty, would_take_again_pct, num_ratings,
            tags, courses, scraped_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                p["rmp_id"],
                p["first_name"],
                p["last_name"],
                p["department"],
                p.get("raw_department", p["department"]),
                p["avg_rating"],
                p["avg_difficulty"],
                p["would_take_again_pct"],
                p["num_ratings"],
                p["tags"],
                p.get("courses", "[]"),
                now,
            )
            for p in professors
        ],
    )

    conn.execute(
        """INSERT INTO scrape_meta (id, last_scraped_at, total_professors)
           VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET last_scraped_at=?, total_professors=?""",
        (now, len(professors), now, len(professors)),
    )
    conn.commit()
    conn.close()


def get_professors(
    department: Optional[str] = None,
    sort_by: str = "avg_rating",
    min_ratings: int = 0,
) -> list[dict]:
    conn = get_connection()

    allowed_sorts = {
        "avg_rating": "avg_rating DESC",
        "avg_difficulty": "avg_difficulty DESC",
        "would_take_again_pct": "would_take_again_pct DESC",
        "num_ratings": "num_ratings DESC",
        "weighted_score": "weighted_score DESC",
        "name": "last_name ASC, first_name ASC",
    }
    order = allowed_sorts.get(sort_by, "avg_rating DESC")

    query = """
        SELECT *,
            CASE WHEN num_ratings > 0 AND avg_rating > 0 AND would_take_again_pct >= 0
            THEN (avg_rating / 5.0) * 0.4
                 + (would_take_again_pct / 100.0) * 0.35
                 + ((5.0 - avg_difficulty) / 5.0) * 0.25
            ELSE 0
            END AS weighted_score
        FROM professors
        WHERE num_ratings >= ?
    """
    params: list = [min_ratings]

    if department:
        query += " AND department = ?"
        params.append(department)

    query += f" ORDER BY {order}"

    rows = conn.execute(query, params).fetchall()
    conn.close()

    return [
        {
            "rmp_id": r["rmp_id"],
            "first_name": r["first_name"],
            "last_name": r["last_name"],
            "department": r["department"],
            "avg_rating": r["avg_rating"],
            "avg_difficulty": r["avg_difficulty"],
            "would_take_again_pct": r["would_take_again_pct"],
            "num_ratings": r["num_ratings"],
            "tags": json.loads(r["tags"]) if r["tags"] else [],
            "courses": json.loads(r["courses"]) if r["courses"] else [],
            "weighted_score": round(r["weighted_score"], 3) if r["weighted_score"] else 0,
        }
        for r in rows
    ]


def get_professors_by_courses(course_codes: list[str]) -> dict[str, list[dict]]:
    """Return professors grouped by course code, ranked by weighted score."""
    import re

    normalized = []
    for code in course_codes:
        clean = re.sub(r"\s+", "", code).upper()
        if clean:
            normalized.append(clean)

    if not normalized:
        return {}

    conn = get_connection()
    results: dict[str, list[dict]] = {}

    for code in normalized:
        rows = conn.execute(
            """
            SELECT *,
                CASE WHEN num_ratings > 0 AND avg_rating > 0 AND would_take_again_pct >= 0
                THEN (avg_rating / 5.0) * 0.4
                     + (would_take_again_pct / 100.0) * 0.35
                     + ((5.0 - avg_difficulty) / 5.0) * 0.25
                ELSE 0
                END AS weighted_score
            FROM professors
            WHERE courses LIKE ? AND num_ratings >= 1
            ORDER BY weighted_score DESC
            """,
            (f'%"{code}"%',),
        ).fetchall()

        profs = []
        for i, r in enumerate(rows, start=1):
            profs.append({
                "rank": i,
                "rmp_id": r["rmp_id"],
                "first_name": r["first_name"],
                "last_name": r["last_name"],
                "department": r["department"],
                "avg_rating": r["avg_rating"],
                "avg_difficulty": r["avg_difficulty"],
                "would_take_again_pct": r["would_take_again_pct"],
                "num_ratings": r["num_ratings"],
                "tags": json.loads(r["tags"]) if r["tags"] else [],
                "courses": json.loads(r["courses"]) if r["courses"] else [],
                "weighted_score": round(r["weighted_score"], 3) if r["weighted_score"] else 0,
            })

        results[code] = profs

    conn.close()
    return results


def get_departments() -> list[str]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT DISTINCT department FROM professors WHERE department != 'Unknown' ORDER BY department"
    ).fetchall()
    conn.close()
    return [r["department"] for r in rows]


def get_department_stats() -> list[dict]:
    """Return aggregate stats for every department, including top 5 professors and top tags."""
    conn = get_connection()

    dept_rows = conn.execute(
        """SELECT department,
                  COUNT(*) as professor_count,
                  AVG(avg_rating) as avg_rating,
                  AVG(avg_difficulty) as avg_difficulty,
                  AVG(CASE WHEN would_take_again_pct >= 0 THEN would_take_again_pct END) as avg_wta,
                  SUM(num_ratings) as total_reviews
           FROM professors
           WHERE department != 'Unknown' AND num_ratings >= 1
           GROUP BY department
           ORDER BY avg_rating DESC"""
    ).fetchall()

    departments = []
    for dr in dept_rows:
        dept_name = dr["department"]

        top_rows = conn.execute(
            """SELECT rmp_id, first_name, last_name, avg_rating, avg_difficulty,
                      would_take_again_pct, num_ratings, tags,
                      CASE WHEN num_ratings > 0 AND avg_rating > 0 AND would_take_again_pct >= 0
                      THEN (avg_rating / 5.0) * 0.4
                           + (would_take_again_pct / 100.0) * 0.35
                           + ((5.0 - avg_difficulty) / 5.0) * 0.25
                      ELSE 0
                      END AS weighted_score
               FROM professors
               WHERE department = ? AND num_ratings >= 3
               ORDER BY weighted_score DESC LIMIT 5""",
            (dept_name,),
        ).fetchall()

        top_professors = []
        for i, r in enumerate(top_rows, start=1):
            top_professors.append({
                "rank": i,
                "rmp_id": r["rmp_id"],
                "first_name": r["first_name"],
                "last_name": r["last_name"],
                "avg_rating": r["avg_rating"],
                "avg_difficulty": r["avg_difficulty"],
                "would_take_again_pct": r["would_take_again_pct"],
                "num_ratings": r["num_ratings"],
                "weighted_score": round(r["weighted_score"], 3) if r["weighted_score"] else 0,
            })

        tag_rows = conn.execute(
            "SELECT tags FROM professors WHERE department = ? AND num_ratings >= 1 AND tags != '[]'",
            (dept_name,),
        ).fetchall()

        tag_counts: dict[str, int] = {}
        for tr in tag_rows:
            try:
                tags = json.loads(tr["tags"]) if tr["tags"] else []
                for t in tags:
                    name = t.get("name", "") if isinstance(t, dict) else str(t)
                    count = t.get("count", 1) if isinstance(t, dict) else 1
                    if name:
                        tag_counts[name] = tag_counts.get(name, 0) + count
            except (json.JSONDecodeError, TypeError):
                continue

        top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        top_tags = [{"name": n, "count": c} for n, c in top_tags]

        departments.append({
            "name": dept_name,
            "professor_count": dr["professor_count"],
            "avg_rating": round(dr["avg_rating"], 2) if dr["avg_rating"] else 0,
            "avg_difficulty": round(dr["avg_difficulty"], 2) if dr["avg_difficulty"] else 0,
            "avg_wta": round(dr["avg_wta"], 1) if dr["avg_wta"] else None,
            "total_reviews": dr["total_reviews"] or 0,
            "top_professors": top_professors,
            "top_tags": top_tags,
        })

    conn.close()
    return departments


def get_stats() -> dict:
    conn = get_connection()

    total = conn.execute("SELECT COUNT(*) as c FROM professors").fetchone()["c"]
    rated = conn.execute("SELECT COUNT(*) as c FROM professors WHERE num_ratings > 0").fetchone()["c"]

    avg_quality = conn.execute(
        "SELECT AVG(avg_rating) as v FROM professors WHERE num_ratings >= 5"
    ).fetchone()["v"]

    hardest_dept = conn.execute(
        """SELECT department, AVG(avg_difficulty) as avg_diff, SUM(num_ratings) as total_reviews
           FROM professors WHERE num_ratings >= 5 AND department != 'Unknown'
           GROUP BY department HAVING total_reviews >= 100
           ORDER BY avg_diff DESC LIMIT 1"""
    ).fetchone()

    hardest_prof = conn.execute(
        """SELECT first_name, last_name, department, avg_difficulty, num_ratings
           FROM professors WHERE num_ratings >= 50
           ORDER BY avg_difficulty DESC LIMIT 1"""
    ).fetchone()

    last_scraped = get_last_scraped()

    conn.close()

    return {
        "total_professors": total,
        "rated_professors": rated,
        "avg_quality": round(avg_quality, 2) if avg_quality else None,
        "hardest_department": {
            "name": hardest_dept["department"],
            "avg_difficulty": round(hardest_dept["avg_diff"], 2),
        } if hardest_dept else None,
        "hardest_professor": {
            "name": f"{hardest_prof['first_name']} {hardest_prof['last_name']}",
            "department": hardest_prof["department"],
            "avg_difficulty": hardest_prof["avg_difficulty"],
            "num_ratings": hardest_prof["num_ratings"],
        } if hardest_prof else None,
        "last_scraped": last_scraped,
    }
