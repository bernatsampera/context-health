# steps/info/

One file for each pipeline step, in words. Each file has the same four parts:

1. Input: what must exist before the step can run.
2. Output: what the step writes.
3. External services: which servers or tools the step calls.
4. Variables: the settings that control the step, with the current value.

The code is the source of truth. If a file here and the code do not agree, the code is correct.

Step 7 writes aggregate profiles under `data/<country>/<city>/area_profiles/`.
Step 8 validates and copies them to the frontend. It does not create them.
See [2_build_zones.md](2_build_zones.md) for the shared one-zone population rule.
See [7_build_profiles.md](7_build_profiles.md) for profile inputs and output.
See [8_sync_frontend.md](8_sync_frontend.md) for export and manifest checks.

## How to run one city

    make city-next CITY=barcelona                     # run the first missing step
    make city-step CITY=barcelona STEP=zones           # run one named step
    make city-step CITY=barcelona STEP=zones FORCE=1   # re-run with backup
    make city-step CITY=barcelona STEP=reviews LOCAL=1  # run reviews locally
