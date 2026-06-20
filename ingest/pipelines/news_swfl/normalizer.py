import re
from datetime import date
from typing import TypedDict

SWFL_TERMS = {
    "fort myers", "cape coral", "naples", "bonita springs", "lehigh acres",
    "marco island", "estero", "bonita", "sanibel", "captiva", "immokalee",
    "collier", "lee county",
}
SWFL_ZIP_RE = re.compile(r"\b(339\d{2}|341\d{2}|342\d{2}|340\d{2})\b")


class ArticleRow(TypedDict):
    article_url: str
    headline: str
    body_text: str
    source_name: str
    published_date: str
    swfl_relevance: bool


def is_swfl_relevant(text: str) -> bool:
    lower = text.lower()
    return bool(SWFL_ZIP_RE.search(text)) or any(t in lower for t in SWFL_TERMS)


def _coerce_pub_date(value: date | str | None) -> str:
    """Return a normalized ISO date string (YYYY-MM-DD). published_date is a
    TEXT column: dlt's postgres insert-values loader will not cast a string
    into a pre-created `date` column, and the value is only ever read back,
    never date-math'd downstream (app/api/cron/news-crawl)."""
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10]).isoformat()
        except ValueError:
            pass
    return date.today().isoformat()


def normalize(
    article_url: str,
    headline: str,
    body_text: str,
    source_name: str,
    published_date: date | str | None,
) -> ArticleRow:
    clean_body = body_text[:3000].strip()
    pub = _coerce_pub_date(published_date)
    return ArticleRow(
        article_url=article_url,
        headline=headline.strip(),
        body_text=clean_body,
        source_name=source_name,
        published_date=pub,
        swfl_relevance=is_swfl_relevant(f"{headline} {clean_body}"),
    )
