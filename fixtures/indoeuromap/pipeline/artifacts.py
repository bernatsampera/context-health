"""Define pipeline artifact paths and lightweight validation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

MIN_PLACES_THRESHOLD = 20
MIN_REVIEW_COMPLETION_RATIO = 0.8
DATA_ROOT = Path(__file__).resolve().parent.parent / "data"


@dataclass(frozen=True)
class CityPaths:
    country: str
    city: str

    @property
    def root(self) -> Path:
        return DATA_ROOT / self.country / self.city

    @property
    def area_profiles(self) -> Path:
        return self.root / "area_profiles"
