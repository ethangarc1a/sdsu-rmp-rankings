"""
Ranking utilities for professor data.

Weighted score formula:
  score = (quality/5)*0.40 + (would_take_again/100)*0.35 + ((5-difficulty)/5)*0.25

This balances teaching quality, student satisfaction, and manageable difficulty
into a single 0-1 metric.
"""


def compute_weighted_score(
    avg_rating: float,
    would_take_again_pct: float,
    avg_difficulty: float,
) -> float:
    if avg_rating is None or avg_rating <= 0:
        return 0.0
    if would_take_again_pct is None or would_take_again_pct < 0:
        would_take_again_pct = 0.0
    if avg_difficulty is None:
        avg_difficulty = 2.5

    quality_component = (avg_rating / 5.0) * 0.40
    wta_component = (would_take_again_pct / 100.0) * 0.35
    difficulty_component = ((5.0 - avg_difficulty) / 5.0) * 0.25

    return round(quality_component + wta_component + difficulty_component, 3)


def rank_professors(professors: list[dict], min_ratings: int = 5) -> list[dict]:
    """Add rank numbers to a sorted list of professors, filtering by min ratings."""
    filtered = [p for p in professors if p.get("num_ratings", 0) >= min_ratings]
    for i, prof in enumerate(filtered, start=1):
        prof["rank"] = i
    return filtered


def best_per_department(professors: list[dict], min_ratings: int = 5) -> dict:
    """Return the best professor in each department by weighted score."""
    departments: dict[str, dict] = {}
    for prof in professors:
        if prof.get("num_ratings", 0) < min_ratings:
            continue
        dept = prof.get("department", "Unknown")
        if dept == "Unknown":
            continue
        score = prof.get("weighted_score", 0)
        if dept not in departments or score > departments[dept].get("weighted_score", 0):
            departments[dept] = prof
    return dict(sorted(departments.items()))
