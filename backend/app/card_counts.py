"""Estimate how many draft flashcards to create from an upload."""

from __future__ import annotations

import random
import re

MIN_CARDS = 4
MAX_CARDS_PHOTO = 14
MAX_CARDS_DOC = 60


def estimate_pdf_pages(data: bytes) -> int | None:
    """Best-effort PDF page count from object markers (no PDF library)."""
    if not data:
        return None
    # Count page leaf objects; subtract the /Pages tree nodes that often match too.
    pages = data.count(b"/Type /Page") + data.count(b"/Type/Page")
    pages -= data.count(b"/Type /Pages") + data.count(b"/Type/Pages")
    if pages <= 0:
        # Some exporters write /Type\n/Page
        loose = len(re.findall(rb"/Type\s*/Page(?!s)\b", data))
        pages = loose
    return pages if pages > 0 else None


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def estimate_card_count(
    source_type: str,
    file_bytes: bytes | None = None,
    *,
    filename: str = "",
) -> int:
    """
    Pick a card count from how much material the upload likely contains.

    Uses PDF page markers when available, otherwise file size, then applies a
    small random density factor so similar uploads are not always identical.
    """
    size = len(file_bytes) if file_bytes else 0
    lower_name = (filename or "").lower()

    if source_type == "photo" or lower_name.endswith(
        (".jpg", ".jpeg", ".png", ".heic", ".webp"),
    ):
        if size < 200_000:
            low, high = 5, 9
        elif size < 1_200_000:
            low, high = 7, 12
        else:
            low, high = 8, MAX_CARDS_PHOTO
        return random.randint(low, high)

    pages = estimate_pdf_pages(file_bytes) if file_bytes else None
    if pages is None and size > 0:
        # Mixed PDFs often land around 20–80 KB/page; 40 KB is a usable midpoint.
        pages = max(1, size // 40_000)

    if not pages:
        # No file payload — still vary instead of a fixed 12.
        return random.randint(8, 16)

    # ~1 card per page, with density jitter for sparse vs dense notes.
    density = random.uniform(0.85, 1.55)
    target = int(round(pages * density))
    # Short handouts still deserve a handful of review cards.
    if pages <= 2:
        target = max(target, random.randint(6, 10))
    elif pages <= 6:
        target = max(target, random.randint(8, 14))

    return _clamp(target, MIN_CARDS, MAX_CARDS_DOC)
