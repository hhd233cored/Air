"""Extract a soft dominant cover color during content preparation.

The browser used to inspect cover images with Canvas.  That makes the result
dependent on the image server's CORS headers, so the API now stores the color
alongside the article metadata instead.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable


_HEX_COLOR = re.compile(r"#([0-9a-fA-F]{3,8})\b")
_RGB_COLOR = re.compile(r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})")


def _is_usable(rgb: tuple[int, int, int]) -> bool:
    maximum = max(rgb)
    minimum = min(rgb)
    brightness = sum(rgb) / 3
    saturation = (maximum - minimum) / 255
    return not (brightness > 244 and saturation < 0.12)


def _soften(rgb: tuple[int, int, int]) -> str:
    """Return the frontend's space-separated RGB format, slightly lightened."""

    luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
    brightness_scale = 132 / luminance if luminance > 132 else 1
    adjusted = [min(255, round(channel * brightness_scale)) for channel in rgb]
    white_mix = 0.14
    softened = [round(channel + (255 - channel) * white_mix) for channel in adjusted]
    return " ".join(str(channel) for channel in softened)


def _dominant_from_pixels(pixels: Iterable[tuple[int, int, int, int]]) -> str | None:
    buckets: dict[tuple[int, int, int], float] = {}
    for red, green, blue, alpha in pixels:
        if alpha < 128:
            continue
        if alpha < 255:
            red = round((red * alpha + 255 * (255 - alpha)) / 255)
            green = round((green * alpha + 255 * (255 - alpha)) / 255)
            blue = round((blue * alpha + 255 * (255 - alpha)) / 255)
        rgb = (red, green, blue)
        if not _is_usable(rgb):
            continue
        quantized = tuple(min(255, int(channel / 16 + 0.5) * 16) for channel in rgb)
        maximum = max(quantized)
        minimum = min(quantized)
        saturation = (maximum - minimum) / 255
        buckets[quantized] = buckets.get(quantized, 0.0) + 0.7 + saturation * 1.8

    if not buckets:
        return None
    dominant = max(buckets, key=buckets.get)
    return _soften(dominant)


def _raster_color(path: Path) -> str | None:
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return None

    try:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGBA")
            width, height = image.size
            if not width or not height:
                return None

            # Match the centered cover crop used by the article cards.
            crop_size = min(width, height)
            left = (width - crop_size) // 2
            top = (height - crop_size) // 2
            image = image.crop((left, top, left + crop_size, top + crop_size))
            image.thumbnail((40, 40), Image.Resampling.LANCZOS)
            return _dominant_from_pixels(image.getdata())
    except (OSError, ValueError, TypeError):
        return None


def _svg_color(path: Path) -> str | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    colors: list[tuple[int, int, int]] = []
    for match in _HEX_COLOR.finditer(text):
        value = match.group(1)
        if len(value) in {3, 4}:
            value = "".join(character * 2 for character in value)
        if len(value) not in {6, 8}:
            continue
        colors.append(tuple(int(value[index:index + 2], 16) for index in (0, 2, 4)))
    for match in _RGB_COLOR.finditer(text):
        colors.append(tuple(min(255, int(match.group(index))) for index in (1, 2, 3)))

    usable = [color for color in colors if _is_usable(color)]
    if not usable:
        return None
    return _soften(usable[0])


def extract_cover_color(path: Path) -> str | None:
    """Extract one lightened dominant color as ``"R G B"``."""

    if not path.is_file():
        return None
    if path.suffix.lower() == ".svg":
        return _svg_color(path)
    return _raster_color(path)
