import httpx
import asyncio
import base64
import json
import re
from typing import Optional

GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql"
AUTH_TOKEN = "Basic dGVzdDp0ZXN0"
SDSU_SCHOOL_ID = 877
SDSU_SCHOOL_ID_B64 = base64.b64encode(f"School-{SDSU_SCHOOL_ID}".encode()).decode()

HEADERS = {
    "Authorization": AUTH_TOKEN,
    "Content-Type": "application/json",
    "Accept": "*/*",
    "Referer": "https://www.ratemyprofessors.com/",
    "Origin": "https://www.ratemyprofessors.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}

TEACHER_SEARCH_QUERY = """
query TeacherSearchPaginationQuery(
    $count: Int!
    $cursor: String
    $query: TeacherSearchQuery!
) {
    search: newSearch {
        teachers(query: $query, first: $count, after: $cursor) {
            didFallback
            edges {
                cursor
                node {
                    id
                    legacyId
                    firstName
                    lastName
                    department
                    avgRating
                    avgDifficulty
                    wouldTakeAgainPercent
                    numRatings
                    teacherRatingTags {
                        tagName
                        tagCount
                    }
                    courseCodes {
                        courseName
                        courseCount
                    }
                }
            }
            pageInfo {
                hasNextPage
                endCursor
            }
            resultCount
        }
    }
}
"""

PAGE_SIZE = 20
CONCURRENCY = 8
REQUEST_DELAY = 0.1

# Maps course prefixes to more specific sub-department names.
# Professors in broad departments like "Engineering" or "Computer Science"
# get re-classified based on the courses they actually teach.
COURSE_PREFIX_TO_SUBDEPT = {
    "COMPE": "Computer Engineering",
    "COMP": "Computer Engineering",
    "EE": "Electrical Engineering",
    "ECE": "Electrical & Computer Engineering",
    "ME": "Mechanical Engineering",
    "AE": "Aerospace Engineering",
    "AERO": "Aerospace Engineering",
    "CE": "Civil Engineering",
    "CIVIL": "Civil Engineering",
    "SE": "Software Engineering",
    "ENVE": "Environmental Engineering",
    "ENV": "Environmental Engineering",
    "CHE": "Chemical Engineering",
    "BENG": "Bioengineering",
    "BIO_E": "Bioengineering",
    "ENGR": "Engineering",
    "ENGIN": "Engineering",
    "CS": "Computer Science",
    "CSC": "Computer Science",
    "PHYS": "Physics",
    "MATH": "Mathematics",
    "STAT": "Statistics",
}

# Only reclassify professors in these broad RMP departments
BROAD_DEPARTMENTS = {
    "Engineering",
    "Computer Science",
    "Science",
}

PREFIX_PATTERN = re.compile(r"^([A-Za-z_]+)")


def _extract_course_prefixes(course_codes: list[dict]) -> list[str]:
    """Pull the alphabetic prefix from each course code, weighted by review count."""
    prefixes: dict[str, int] = {}
    for cc in course_codes:
        name = cc.get("courseName", "")
        count = cc.get("courseCount", 1)
        m = PREFIX_PATTERN.match(name)
        if m:
            prefix = m.group(1).upper()
            if len(prefix) >= 2:
                prefixes[prefix] = prefixes.get(prefix, 0) + count
    return prefixes


def _resolve_subdepartment(department: str, course_codes: list[dict]) -> str:
    """Use course prefixes to assign a more specific department when possible."""
    if department not in BROAD_DEPARTMENTS:
        return department

    prefixes = _extract_course_prefixes(course_codes)
    if not prefixes:
        return department

    best_subdept = None
    best_weight = 0

    for prefix, weight in prefixes.items():
        subdept = COURSE_PREFIX_TO_SUBDEPT.get(prefix)
        if subdept and weight > best_weight:
            best_subdept = subdept
            best_weight = weight

    return best_subdept or department


def _parse_professors(teachers_data: dict) -> list[dict]:
    professors = []
    for edge in teachers_data["edges"]:
        node = edge["node"]
        tags = []
        if node.get("teacherRatingTags"):
            tags = [
                {"name": t["tagName"], "count": t["tagCount"]}
                for t in node["teacherRatingTags"]
                if t["tagCount"] > 0
            ]
            tags.sort(key=lambda t: t["count"], reverse=True)

        course_codes = node.get("courseCodes") or []
        raw_dept = node["department"] or "Unknown"
        resolved_dept = _resolve_subdepartment(raw_dept, course_codes)

        course_list = [
            {"name": c["courseName"], "count": c["courseCount"]}
            for c in course_codes
            if c.get("courseCount", 0) > 0
        ]
        course_list.sort(key=lambda c: c["count"], reverse=True)

        professors.append({
            "rmp_id": node["legacyId"],
            "first_name": node["firstName"],
            "last_name": node["lastName"],
            "department": resolved_dept,
            "raw_department": raw_dept,
            "avg_rating": node["avgRating"],
            "avg_difficulty": node["avgDifficulty"],
            "would_take_again_pct": node["wouldTakeAgainPercent"],
            "num_ratings": node["numRatings"],
            "tags": json.dumps(tags[:5]),
            "courses": json.dumps(course_list[:10]),
        })
    return professors


async def _fetch_letter(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    letter: str,
) -> list[dict]:
    """Fetch all professors for a single search letter, paginating through results."""
    all_profs = []
    cursor = None
    has_next = True

    while has_next:
        async with semaphore:
            variables = {
                "count": PAGE_SIZE,
                "cursor": cursor or "",
                "query": {
                    "text": letter,
                    "schoolID": SDSU_SCHOOL_ID_B64,
                },
            }
            payload = {
                "query": TEACHER_SEARCH_QUERY,
                "variables": variables,
            }

            for attempt in range(3):
                try:
                    response = await client.post(
                        GRAPHQL_URL, json=payload, headers=HEADERS
                    )
                    response.raise_for_status()
                    break
                except (httpx.HTTPStatusError, httpx.TransportError):
                    if attempt == 2:
                        raise
                    await asyncio.sleep(1.0 * (attempt + 1))

            data = response.json()

        teachers_data = data["data"]["search"]["teachers"]
        all_profs.extend(_parse_professors(teachers_data))

        page_info = teachers_data["pageInfo"]
        has_next = page_info["hasNextPage"]
        cursor = page_info["endCursor"]

        if has_next:
            await asyncio.sleep(REQUEST_DELAY)

    return all_profs


async def scrape_all_professors(
    on_progress: Optional[callable] = None,
) -> list[dict]:
    """Scrape all SDSU professors by fanning out searches A-Z concurrently."""
    letters = list("abcdefghijklmnopqrstuvwxyz")
    semaphore = asyncio.Semaphore(CONCURRENCY)
    seen_ids: set[int] = set()
    all_professors: list[dict] = []
    completed = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = [
            asyncio.create_task(_fetch_letter(client, semaphore, letter))
            for letter in letters
        ]

        for coro in asyncio.as_completed(tasks):
            profs = await coro
            completed += 1
            for p in profs:
                if p["rmp_id"] not in seen_ids:
                    seen_ids.add(p["rmp_id"])
                    all_professors.append(p)
            if on_progress:
                on_progress(len(all_professors), completed, len(letters))

    return all_professors


REVIEWS_QUERY = """
query RatingsListQuery($id: ID!, $count: Int!, $cursor: String) {
    node(id: $id) {
        ... on Teacher {
            ratings(first: $count, after: $cursor) {
                edges {
                    node {
                        comment
                        class
                        date
                        helpfulRating
                        difficultyRating
                        grade
                        wouldTakeAgain
                        ratingTags
                        thumbsUpTotal
                        thumbsDownTotal
                    }
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }
    }
}
"""


async def fetch_professor_reviews(rmp_id: int, limit: int = 20) -> list[dict]:
    """Fetch reviews for a single professor by their legacy RMP ID."""
    teacher_b64 = base64.b64encode(f"Teacher-{rmp_id}".encode()).decode()

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GRAPHQL_URL,
            json={
                "query": REVIEWS_QUERY,
                "variables": {
                    "id": teacher_b64,
                    "count": limit,
                    "cursor": "",
                },
            },
            headers=HEADERS,
        )
        response.raise_for_status()
        data = response.json()

    node = data.get("data", {}).get("node")
    if not node or not node.get("ratings"):
        return []

    reviews = []
    for edge in node["ratings"]["edges"]:
        r = edge["node"]
        reviews.append({
            "comment": r.get("comment", ""),
            "class_name": r.get("class", ""),
            "date": r.get("date", ""),
            "quality": r.get("helpfulRating"),
            "difficulty": r.get("difficultyRating"),
            "grade": r.get("grade", ""),
            "would_take_again": r.get("wouldTakeAgain"),
            "tags": r.get("ratingTags", ""),
            "thumbs_up": r.get("thumbsUpTotal", 0),
            "thumbs_down": r.get("thumbsDownTotal", 0),
        })

    return reviews
