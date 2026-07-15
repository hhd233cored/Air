"""Hourly in-memory cache for Wikimedia's On This Day feed."""

from __future__ import annotations

import json
import logging
import threading
from datetime import date, datetime, timezone
from urllib.error import URLError
from urllib.request import Request, urlopen

from .models import HistoricalTodayEvent, HistoricalTodayResponse

logger = logging.getLogger(__name__)


class HistoricalTodayService:
    _categories = ("selected", "events", "births", "deaths", "holidays")
    _max_events = 5

    def __init__(self, endpoint_base_url: str) -> None:
        self.endpoint_base_url = endpoint_base_url.rstrip("/")
        self._cache_key: tuple[date, datetime] | None = None
        self._cache_response: HistoricalTodayResponse | None = None
        self._lock = threading.Lock()

    def get_today(self) -> HistoricalTodayResponse:
        now = datetime.now().astimezone()
        today = now.date()
        hour = now.replace(minute=0, second=0, microsecond=0)
        key = (today, hour)
        if self._cache_key == key and self._cache_response is not None:
            return self._cache_response

        with self._lock:
            if self._cache_key == key and self._cache_response is not None:
                return self._cache_response
            response = self._fetch(today)
            self._cache_key = key
            self._cache_response = response
            return response

    def _fetch(self, today: date) -> HistoricalTodayResponse:
        events: list[HistoricalTodayEvent] = []
        available = False
        try:
            endpoint = f"{self.endpoint_base_url}/{today.month:02d}/{today.day:02d}"
            request = Request(
                endpoint,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "Air-personal-site/1.0 (local development)",
                },
                method="GET",
            )
            with urlopen(request, timeout=20) as response:
                if 200 <= response.status < 300:
                    root = json.loads(response.read().decode("utf-8"))
                    events = self._parse_events(root)
                    available = True
        except Exception as exc:  # External service failures must not break this API.
            logger.warning("Could not fetch Wikimedia On This Day data: %s", exc)

        return HistoricalTodayResponse(
            date=today,
            fetchedAt=datetime.now(timezone.utc),
            available=available,
            events=events,
        )

    def _parse_events(self, root: object) -> list[HistoricalTodayEvent]:
        if not isinstance(root, dict):
            return []
        events: list[HistoricalTodayEvent] = []
        for category in self._categories:
            items = root.get(category)
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                text = item.get("text")
                if not isinstance(text, str) or not text.strip():
                    continue
                year_value = item.get("year")
                year = year_value if isinstance(year_value, int) and not isinstance(year_value, bool) else None
                events.append(HistoricalTodayEvent(year=year, text=text))
                if len(events) >= self._max_events:
                    return events
        return events
