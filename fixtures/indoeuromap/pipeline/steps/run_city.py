#!/usr/bin/env python3
"""Run the checkpointed pipeline for one city."""

from __future__ import annotations

STEPS = ("select", "zones", "places", "population", "reviews", "names", "profiles", "sync")


def run_city(city: str, step: str | None = None, force: bool = False) -> None:
    """Run the first missing step, or one named step."""
    if step is not None and step not in STEPS:
        raise ValueError(f"unknown step: {step}")
    print(f"run {city}: step={step or 'next'} force={force}")
