# totumRevolutum – Google Earth Engine Scripts | Needs to be updated

A practical collection of Google Earth Engine (GEE) scripts for interactive mapping, exploration, and land-cover benchmarking.

## Repository structure

- `GEE/AreaCalculator_Widget.js` – interactive polygon area calculator (m², ha, km²) using drawing tools.
- `GEE/Go2Point.js` – map utility panel to jump to lon/lat coordinates and drop a point marker.
- `GEE/LanSenView.js` – POI imagery explorer combining Sentinel-2, Landsat, and Sentinel-1 visualizations.
- `GEE/ExportTile_scheleton.js` – reusable tile-based export skeleton for batch exports from either grid tiles or global AOIs.
- `GEE/AlphaEarth_Benchmark_Mode.js` – supervised land-cover workflow using satellite embeddings, with single-run and benchmark support.
- `GEE/AlphaEarth_Benchmark_Mode_v2.js` – updated benchmark-oriented variant with CSV-first output and cleaner benchmark execution.

## What these scripts are for

### 1) Fast map utilities
- **Area calculator**: draw one polygon, compute geodesic area, clear, repeat.
- **Go-to point**: paste coordinates as `lon, lat` to center the map and visualize the point.

### 2) Multi-sensor imagery browsing
`LanSenView.js` is designed for point-of-interest review workflows:
- query imagery around a POI,
- browse date-grouped Sentinel-2 and Landsat mosaics,
- inspect Sentinel-1 scenes,
- switch visualization presets (true color, false color, SWIR, NDVI, etc.).

### 3) Scalable exports and benchmark experiments
- `ExportTile_scheleton.js` provides a template for queueing exports per tile/AOI with naming conventions and export controls.
- The `AlphaEarth_*` scripts support supervised classification over multiple AOIs (`caatinga`, `cerrado`, `chaco`, `tanzania`) and multiple classifiers (RF, CART, GTB, KNN, NB, SVM, minimum distance), with configurable export of classified rasters, model assets, metadata, and benchmark tables.

## How to use

1. Open [Google Earth Engine Code Editor](https://code.earthengine.google.com/).
2. Create a new script and paste one of the files from `GEE/`.
3. Update asset paths, AOI IDs, export folders, and toggles to match your GEE project.
4. Run and review in the Tasks tab (for exports) or directly in the map UI (for interactive tools).

## Notes

- Some scripts reference project-specific assets (e.g., `projects/Your-Repo/...`). You will need to replace these with assets you can access.
- `ExportTile_scheleton.js` is intentionally a skeleton: use it as a base pattern for your own processing pipeline.
- Benchmark scripts contain many tunable parameters; for reproducibility, keep AOI/year/method/seed/settings aligned between runs.

## Suggested next additions

- Add example screenshots from each tool in the Code Editor UI.
- Add a small “required assets” table per script.
- Add a changelog section if these scripts are actively iterated.
