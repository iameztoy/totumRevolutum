# totumRevolutum – Google Earth Engine Script Collection

A practical collection of Google Earth Engine (GEE) scripts for interactive mapping, imagery exploration, export orchestration, and benchmarking workflows.

## Repository structure (`GEE/`)

- `AreaCalculator_Widget.js` — interactive polygon area calculator (m², ha, km²) using drawing tools.
- `Go2Point.js` — simple UI panel to jump to coordinates (`lon, lat`) and place a marker.
- `LanSenView.js` — point-of-interest imagery explorer across Sentinel-2, Landsat, and Sentinel-1 with date-grouped browsing and visualization presets.
- `Wildfire_detection.js` — burned-area and fire-severity workflow (Sentinel-2) with water masking options, thresholding, patch filtering, severity mapping, and exports.
- `maxS1Year.js` — quick Sentinel-1 (VV/VH) annual max composite example over Africa to inspect radar coverage.
- `ExportTile_scheleton.js` — reusable skeleton for tile/AOI-based batch exports to Earth Engine assets.
- `AlphaEarth_Benchmark_Mode.js` — supervised land-cover classification workflow with single-run mode and benchmark mode (AOIs × classifiers).
- `AlphaEarth_Benchmark_Mode_v2.js` — updated benchmark variant with cleaner benchmark execution and CSV-first benchmark exports (Google Drive/Asset).
- `GEE_noncommercial_eecu_monitor.ipynb` — notebook for monitoring noncommercial Earth Engine EECU consumption (adapted from the Earth Engine Community guide).

## Workflow categories

### 1) Fast map utilities

- **Area calculator** (`AreaCalculator_Widget.js`): draw one polygon, compute geodesic area, clear, repeat.
- **Go-to point** (`Go2Point.js`): paste coordinates to center the map and visualize a point of interest.

### 2) Multi-sensor imagery exploration

- **POI exploration** (`LanSenView.js`): inspect Sentinel-2/Landsat mosaics grouped by date, plus Sentinel-1 scene-level browsing.
- Useful for rapid visual QA/QC, temporal checks, and first-pass site interpretation.

### 3) Event-focused analysis

- **Wildfire mapping** (`Wildfire_detection.js`): configurable pre/post windows, optional single-date or median composites, dNBR-based burned area, severity classes, optional admin-level statistics, and Drive exports.

### 4) Export and scaling patterns

- **Tile export template** (`ExportTile_scheleton.js`): choose grid/global AOI collections, run one export per tile, and keep naming/CRS/scale logic centralized.
- **Sentinel-1 annual max prototype** (`maxS1Year.js`): compact pattern for building regional/yearly composites before adapting to production exports.

### 5) Land-cover benchmarking

- **AlphaEarth benchmark scripts** (`AlphaEarth_Benchmark_Mode*.js`): benchmark multiple AOIs (`caatinga`, `cerrado`, `chaco`, `tanzania`) and classifiers (`RF`, `CART`, `GTB`, `KNN`, `NB`, `SVM`, `MIN_DIST`) with configurable export targets.

## How to use these scripts

1. Open the [Google Earth Engine Code Editor](https://code.earthengine.google.com/).
2. Create or open a script, then paste one file from `GEE/`.
3. Update all project-specific settings before running:
   - asset IDs,
   - AOI collections,
   - export destination paths,
   - date windows and thresholds (for analysis scripts).
4. Run the script and review:
   - map UI outputs (interactive tools),
   - Console logs (diagnostics),
   - Tasks tab (exports).

## Important notes

- Several scripts reference project/user assets (for example `projects/...` and `users/...`). Replace with assets you can access.
- `ExportTile_scheleton.js` is intentionally a scaffold; insert your own processing chain in the placeholder section.
- Benchmark reproducibility depends on keeping AOI/year/parameters/seed settings consistent across runs.
- `Wildfire_detection.js` includes many tuning switches; validate thresholds on known events before operational use.

## Source acknowledgement

- `GEE_noncommercial_eecu_monitor.ipynb` source guide: <https://github.com/google/earthengine-community/blob/master/guides/linked/cloud-monitoring/earth_engine_noncommercial_eecu_monitor.ipynb>

- Coauthor: begsud
