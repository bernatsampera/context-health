"""Expose bounded city factory questions through MCP."""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

server = FastMCP("diversity-map-data")


@server.tool()
def coverage_report(country: str | None = None) -> dict:
    """Return validated and published city counts."""
    return {"country": country, "validated": 0, "published": 0}


def main() -> None:
    server.run()
