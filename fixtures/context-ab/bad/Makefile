.PHONY: help city-next city-step coverage site-data

help:
	@echo "Targets: city-next city-step coverage site-data"

city-next:
	uv run python -m pipeline.cli city-step --city $(CITY) --step next

city-step:
	uv run python -m pipeline.cli city-step --city $(CITY) --step $(STEP)

coverage:
	uv run python -m pipeline.status.coverage

site-data:
	npm --prefix frontend run sync:data
