# diversity-map

This project builds area profiles from public place and review signals.
The website shows the prepared profiles on maps.
Name-origin signals are estimates. They do not establish a person's ethnicity or culture.

## Two main parts

- [pipeline/](pipeline/README.md): Country preparation, zones, city extraction, profile generation, and AI job controls.
- [frontend/](frontend/README.md): The public website and its prepared data.

The normal workflow starts with a selected city batch.
The pipeline produces profiles, exports the data, and checks the local website build.
Deployment is a separate process.

## Start here

- [AGENTS.md](AGENTS.md): Work rules and where to start.
- [second-iteration/direction.md](second-iteration/direction.md): Product direction, goals, and limits of the current iteration.
- [second-iteration/status.md](second-iteration/status.md): Current state.
- [llms.txt](llms.txt): Navigation to current source and guides.
- [Pipeline operations](pipeline/city-factory/README.md): Data questions, batches, errors, and frontend export.
- [selfhost/README.md](selfhost/README.md): Separate website database and authentication deployment.

`data/` holds local inputs, caches, outputs, logs, and the factory database.
Use current data and job records to check progress.
`first-iteration/` is the archive of the first iteration. It holds no current instruction.

## Local setup

Run commands from the repository root.

```text
uv sync
uv sync --project pipeline/city-factory
npm --prefix frontend install
npm --prefix frontend run build
```

The build uses the existing frontend data copy.
See the pipeline guide before starting extraction or exporting new data.
