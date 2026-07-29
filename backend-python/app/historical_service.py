"""Hourly in-memory cache for Wikimedia's On This Day feed."""

from __future__ import annotations

import json
from html import unescape
from html.parser import HTMLParser
import logging
import re
import threading
from dataclasses import dataclass
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from urllib.error import URLError
from urllib.request import Request, urlopen
from urllib.parse import quote, urljoin, urlparse

from .models import HistoricalTodayEvent, HistoricalTodayEventPart, HistoricalTodayResponse

logger = logging.getLogger(__name__)


@dataclass
class _WikipediaDayEvent:
    year: int
    text: str
    parts: list[HistoricalTodayEventPart]
    year_href: str | None = None


class _WikipediaDayPageParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url.rstrip("/")
        self.events: list[_WikipediaDayEvent] = []
        self._li_depth = 0
        self._ignored_depth = 0
        self._parts: list[HistoricalTodayEventPart] | None = None
        self._active_link: tuple[str | None, list[str]] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag in {"script", "style"} or (
            tag == "sup" and "reference" in (attributes.get("class") or "")
        ):
            self._ignored_depth += 1
            return
        if self._ignored_depth:
            return
        if tag == "li":
            if self._li_depth == 0:
                self._parts = []
            self._li_depth += 1
            return
        if self._parts is None:
            return
        if tag == "a" and self._active_link is None:
            href = attributes.get("href")
            absolute_href = urljoin(f"{self.base_url}/", href) if href else None
            if absolute_href and urlparse(absolute_href).scheme not in {"http", "https"}:
                absolute_href = None
            self._active_link = (absolute_href, [])
        elif tag in {"br", "p"}:
            self._append_text(" ")

    def handle_endtag(self, tag: str) -> None:
        if self._ignored_depth:
            if tag in {"script", "style", "sup"}:
                self._ignored_depth -= 1
            return
        if tag == "a" and self._active_link is not None:
            href, values = self._active_link
            self._active_link = None
            label = re.sub(r"\s+", " ", "".join(values)).strip()
            if label:
                self._append_part(HistoricalTodayEventPart(text=label, href=href))
            return
        if tag == "li" and self._li_depth:
            self._li_depth -= 1
            if self._li_depth == 0 and self._parts is not None:
                event = self._to_event(self._parts)
                if event is not None:
                    self.events.append(event)
                self._parts = None

    def handle_data(self, data: str) -> None:
        if self._ignored_depth or self._parts is None:
            return
        if self._active_link is not None:
            self._active_link[1].append(data)
        else:
            self._append_text(data)

    def _append_text(self, value: str) -> None:
        if not value or self._parts is None:
            return
        self._append_part(HistoricalTodayEventPart(text=value))

    def _append_part(self, part: HistoricalTodayEventPart) -> None:
        if self._parts is None:
            return
        if self._parts and self._parts[-1].href == part.href:
            self._parts[-1].text += part.text
        else:
            self._parts.append(part)

    @staticmethod
    def _trim_parts(parts: list[HistoricalTodayEventPart], start: int) -> list[HistoricalTodayEventPart]:
        result: list[HistoricalTodayEventPart] = []
        cursor = 0
        for part in parts:
            end = cursor + len(part.text)
            if end <= start:
                cursor = end
                continue
            value = part.text[max(0, start - cursor):]
            if value:
                result.append(HistoricalTodayEventPart(text=value, href=part.href))
            cursor = end
        return result

    @classmethod
    def _to_event(cls, parts: list[HistoricalTodayEventPart]) -> _WikipediaDayEvent | None:
        normalized = [
            HistoricalTodayEventPart(
                text=re.sub(r"\s+", " ", part.text),
                href=part.href,
            )
            for part in parts
            if part.text
        ]
        full_text = "".join(part.text for part in normalized)
        match = re.match(r"\s*(\d{3,4})年\s*[：:]\s*", full_text)
        if not match:
            return None
        year = int(match.group(1))
        remaining = cls._trim_parts(normalized, match.end())
        text = "".join(part.text for part in remaining).strip()
        if not text:
            return None
        year_label = f"{year}年"
        year_href = next(
            (part.href for part in normalized if part.text.strip() == year_label and part.href),
            None,
        )
        if remaining:
            remaining[0].text = remaining[0].text.lstrip()
            remaining[-1].text = remaining[-1].text.rstrip()
        return _WikipediaDayEvent(year=year, text=text, parts=remaining, year_href=year_href)


class HistoricalTodayService:
    _categories = ("selected", "events", "births", "deaths", "holidays")
    _max_events = 5
    _known_event_overrides = {
        (7, 29, 1958): {
            "text": "美國總統簽署《美國國家航空暨太空法案》，建立美國國家航空暨太空總署（NASA）。",
            "linked_text": "美國國家航空暨太空法案",
            "href": "https://zh.wikipedia.org/wiki/美國國家航空暨太空法案",
        },
    }

    def __init__(
        self,
        endpoint_base_url: str,
        page_base_url: str = "https://zh.wikipedia.org/wiki",
    ) -> None:
        self.endpoint_base_url = endpoint_base_url.rstrip("/")
        self.page_base_url = page_base_url.rstrip("/")
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
                    events = self._parse_events(root, today)
                    if self._feed_has_page_metadata(root):
                        events = self._enrich_from_wikipedia_day_page(today, events)
                    available = True
        except Exception as exc:  # External service failures must not break this API.
            logger.warning("Could not fetch Wikimedia On This Day data: %s", exc)

        return HistoricalTodayResponse(
            date=today,
            fetchedAt=datetime.now(timezone.utc),
            available=available,
            events=events,
        )

    @classmethod
    def _feed_has_page_metadata(cls, root: object) -> bool:
        if not isinstance(root, dict):
            return False
        for category in cls._categories:
            items = root.get(category)
            if not isinstance(items, list):
                continue
            if any(isinstance(item, dict) and isinstance(item.get("pages"), list) for item in items):
                return True
        return False

    def _parse_events(self, root: object, today: date | None = None) -> list[HistoricalTodayEvent]:
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
                text = self._clean_event_text(text)
                year_value = item.get("year")
                year = year_value if isinstance(year_value, int) and not isinstance(year_value, bool) else None
                text, parts = self._apply_known_override(today, year, text)
                if not parts:
                    parts = self._build_linked_parts(text, item)
                events.append(HistoricalTodayEvent(year=year, text=text, parts=parts))
                if len(events) >= self._max_events:
                    return events
        return events

    @staticmethod
    def _clean_event_text(value: str) -> str:
        cleaned = re.sub(r"<[^>]*>", "", unescape(value))
        cleaned = re.sub(r"《\s*(?:\[\s*\])?\s*》", "", cleaned)
        return re.sub(r"\s+", " ", cleaned).strip()

    @staticmethod
    def _clean_page_title(value: str) -> str:
        cleaned = re.sub(r"<[^>]*>", "", value)
        cleaned = unescape(cleaned).replace("_", " ")
        return re.sub(r"\s+", " ", cleaned).strip()

    @staticmethod
    def _is_generic_page_title(value: str) -> bool:
        return bool(re.fullmatch(r"\d{4}年?", value))

    @classmethod
    def _page_links(cls, item: dict[str, object]) -> list[tuple[str, str]]:
        pages = item.get("pages")
        if not isinstance(pages, list):
            return []
        links: list[tuple[str, str]] = []
        for page in pages:
            if not isinstance(page, dict):
                continue
            titles = page.get("titles")
            title = ""
            if isinstance(titles, dict):
                for key in ("display", "normalized", "canonical"):
                    value = titles.get(key)
                    if isinstance(value, str) and value.strip():
                        title = cls._clean_page_title(value)
                        if title:
                            break
            if not title:
                for key in ("displaytitle", "title"):
                    value = page.get(key)
                    if isinstance(value, str) and value.strip():
                        title = cls._clean_page_title(value)
                        if title:
                            break
            if not title or cls._is_generic_page_title(title):
                continue

            content_urls = page.get("content_urls")
            desktop = content_urls.get("desktop") if isinstance(content_urls, dict) else None
            href = desktop.get("page") if isinstance(desktop, dict) else None
            if not isinstance(href, str) or urlparse(href).scheme not in {"http", "https"}:
                continue
            if (title, href) not in links:
                links.append((title, href))
        return links

    @classmethod
    def _build_linked_parts(cls, text: str, item: dict[str, object]) -> list[HistoricalTodayEventPart]:
        matches: list[tuple[int, int, str]] = []
        for label, href in cls._page_links(item):
            start = text.find(label)
            while start >= 0:
                end = start + len(label)
                if not any(start < existing_end and end > existing_start for existing_start, existing_end, _ in matches):
                    matches.append((start, end, href))
                    break
                start = text.find(label, start + 1)

        if not matches:
            return [HistoricalTodayEventPart(text=text)] if text else []

        matches.sort(key=lambda match: match[0])
        parts: list[HistoricalTodayEventPart] = []
        cursor = 0
        for start, end, href in matches:
            if start > cursor:
                parts.append(HistoricalTodayEventPart(text=text[cursor:start]))
            parts.append(HistoricalTodayEventPart(text=text[start:end], href=href))
            cursor = end
        if cursor < len(text):
            parts.append(HistoricalTodayEventPart(text=text[cursor:]))
        return parts

    def _fetch_wikipedia_day_page(self, today: date) -> list[_WikipediaDayEvent]:
        page_title = f"{today.month}月{today.day}日"
        endpoint = f"{self.page_base_url}/{quote(page_title, safe='')}"
        request = Request(
            endpoint,
            headers={
                "Accept": "text/html",
                "User-Agent": "Air-personal-site/1.0 (local development)",
            },
            method="GET",
        )
        with urlopen(request, timeout=20) as response:
            if not 200 <= response.status < 300:
                return []
            return self._parse_wikipedia_day_page(
                response.read().decode("utf-8"),
                self.page_base_url,
            )

    @staticmethod
    def _parse_wikipedia_day_page(html: str, base_url: str) -> list[_WikipediaDayEvent]:
        parser = _WikipediaDayPageParser(base_url)
        parser.feed(html)
        return parser.events

    @staticmethod
    def _similarity(left: str, right: str) -> float:
        compact_left = re.sub(r"\s+", "", left)
        compact_right = re.sub(r"\s+", "", right)
        return SequenceMatcher(None, compact_left, compact_right).ratio()

    def _enrich_from_wikipedia_day_page(
        self,
        today: date,
        events: list[HistoricalTodayEvent],
    ) -> list[HistoricalTodayEvent]:
        try:
            page_events = self._fetch_wikipedia_day_page(today)
        except Exception as exc:
            logger.warning("Could not enrich On This Day events from Wikipedia day page: %s", exc)
            return events
        if not page_events:
            return events

        enriched: list[HistoricalTodayEvent] = []
        for event in events:
            candidates = [candidate for candidate in page_events if candidate.year == event.year]
            if candidates:
                candidate = max(candidates, key=lambda item: self._similarity(event.text, item.text))
                if self._similarity(event.text, candidate.text) >= 0.3:
                    enriched.append(HistoricalTodayEvent(
                        year=event.year,
                        text=candidate.text,
                        parts=candidate.parts,
                        yearHref=candidate.year_href or event.yearHref,
                    ))
                    continue
            enriched.append(event)
        return enriched

    @classmethod
    def _apply_known_override(
        cls,
        today: date | None,
        year: int | None,
        text: str,
    ) -> tuple[str, list[HistoricalTodayEventPart]]:
        if today is None or year is None:
            return text, []
        override = cls._known_event_overrides.get((today.month, today.day, year))
        if not override or "美國總統簽署" not in text or "建立" not in text:
            return text, []
        linked_text = str(override["linked_text"])
        href = str(override["href"])
        corrected_text = str(override["text"])
        prefix, suffix = corrected_text.split(linked_text, 1)
        return corrected_text, [
            HistoricalTodayEventPart(text=prefix),
            HistoricalTodayEventPart(text=linked_text, href=href),
            HistoricalTodayEventPart(text=suffix),
        ]
