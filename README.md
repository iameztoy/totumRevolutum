# totumRevolutum

A personal vault of independent geospatial, remote-sensing, satellite-imagery,
and Google Earth Engine (GEE) scripts.

The repository is intentionally heterogeneous. Files are not components of one
application and should not be expected to share a runtime, dependency set, or
release cycle. Each script or notebook should remain understandable and usable
on its own so it can be copied into the appropriate environment when needed.

## Repository layout

- `GEE/` — scripts for the Earth Engine Code Editor and Earth Engine-related
  notebooks.
- `Apps/` — a curated list of useful external geospatial applications.
- `JNotebooks/` — portable Jupyter notebooks for ArcGIS Pro, VS Code, and
  JupyterLab.
- `tools/` — repository-level validation utilities; these do not form part of
  the geospatial scripts themselves.

## Script catalog

| File | Environment | Purpose |
| --- | --- | --- |
| `GEE/AreaCalculator_Widget.js` | GEE Code Editor | Interactive drawing tool that reports polygon area in m², ha, and km². |
| `GEE/CHIRPS_v2_v3_comparison_v2.js` | GEE Code Editor | Africa CHIRPS v2/v3 explorer: linked maps, area-weighted regional/elevation comparisons and annual point histories, 1981–2025. Requires a prepared annual image. |
| `GEE/CHIRPS_Tanganyika_Explorer.js` | GEE Code Editor | Tanganyika basin CHIRPS v2/v3 explorer: exact polygon-area weights, land/lake and elevation comparisons, annual/monthly charts and point inspection. Requires three prepared assets. |
| `GEE/DW_water_retrieval.js` | GEE Code Editor | Dynamic World water/inundated-vegetation viewer and exporter, including batch and SWOT-date-window workflows. |
| `GEE/ExportTile_scheleton.js` | GEE Code Editor | Reusable scaffold for tile- or AOI-based Earth Engine asset exports. |
| `GEE/GEE_noncommercial_eecu_monitor.ipynb` | Google Colab | Cloud Monitoring notebook for reviewing noncommercial Earth Engine EECU consumption. |
| `GEE/Go2Point.js` | GEE Code Editor | Coordinate-entry widget that centers the map and displays a point. |
| `GEE/LanSenView.js` | GEE Code Editor | Point-of-interest Sentinel-2, Landsat, and Sentinel-1 imagery explorer. |
| `GEE/LandSenView_v2.js` | GEE Code Editor | Extended imagery explorer with additional visualization, inspector, water, hotspot, and export functionality. |
| `GEE/maxS1Year.js` | GEE Code Editor | Compact Sentinel-1 VV/VH annual maximum-composite example over Africa. |
| `GEE/MonthYear_IC_availability.js` | GEE Code Editor | Lists the years, months, and year-month combinations available in an ImageCollection. |
| `GEE/Query_HydroBasins.js` | GEE Code Editor | Interactive HydroBASINS level selector and attribute explorer. |
| `GEE/S1_Opera_query.js` | GEE Code Editor | Sentinel-1/OPERA monthly counts and temporal-resolution diagnostics for a supplied geometry. |
| `GEE/Wildfire_detection.js` | GEE Code Editor | Sentinel-2 burned-area and fire-severity workflow with configurable image selection, masks, statistics, and exports. |
| `Apps/List` | Web browser | Small, annotated catalog of useful external geospatial web applications. |
| `JNotebooks/LandSenView_geemap.ipynb` | ArcGIS Pro / VS Code / JupyterLab | Interactive geemap explorer for querying point- or polygon-based Sentinel-2, Landsat, and Sentinel-1 imagery and displaying the LandSenView band combinations. |
| `JNotebooks/Wildfire_detection_geemap.ipynb` | ArcGIS Pro / VS Code / JupyterLab | Sentinel-2 burned-area and fire-severity workflow with a geemap polygon AOI, consolidated settings, selective output catalogue, ArcGIS Scene transfer, statistics, and Drive export definitions. |

## Using a GEE JavaScript file

1. Open the [Google Earth Engine Code Editor](https://code.earthengine.google.com/).
2. Create a script and paste in the contents of the selected `.js` file.
3. Read the header and user-settings section before running it.
4. Replace any project-specific asset IDs, export paths, dates, thresholds, or
   AOI definitions.
5. Run the script and inspect the map, Console, and Tasks tab as applicable.

These files use the Code Editor's global `ee`, `Map`, `ui`, `Export`, and
`print` objects. They are valid JavaScript, but they are not Node.js modules.
Some scripts also expect a geometry drawn or imported in the Code Editor. For
example, `GEE/S1_Opera_query.js` expects a variable named `geometry`.

## CHIRPS v2/v3 comparison apps

The [Africa explorer](GEE/CHIRPS_v2_v3_comparison_v2.js) and
[Tanganyika explorer](GEE/CHIRPS_Tanganyika_Explorer.js) are standalone Code
Editor scripts. Copy the complete file into the Code Editor and click **Run**.
Enter the project ID containing the prepared study assets in **Connect to the
study assets**, then click **Connect / retry**. Source publication on GitHub is separate from hosting an Earth
Engine App. Running these explorers does not create assets, start exports or
change sharing permissions.

Only the JavaScript sources are included here. The local HTML application,
embedded basin data, shapefiles, rainfall exports, credentials and original
private asset identifiers are not included in this addition. Asset paths use
`projects/your-project/assets/...` placeholders. The connection field replaces
the project prefix while retaining the study's asset names. Enter a project ID,
not a full asset path. For different asset names or assets in multiple projects,
edit the paths in `CONFIG` and leave the connection field blank. The project
must already contain accessible images/tables; GitHub access does not grant
Earth Engine access or create those assets.

### Loading and recovery

- A placeholder is detected before any server request. A missing or inaccessible
  asset needs a corrected project/path or the appropriate signed-in account;
  waiting will not repair it. Correct the input and click **Connect / retry**.
- Dropdowns remain usable while connecting or calculating. Calculation buttons
  become available after the asset checks pass. After changing years, area or
  elevation, click **Apply selection** once to apply those choices.
- Map tiles and charts load separately, on demand. Allow the requested view to
  finish rather than repeatedly pressing Run. A displayed calculation result
  remains labelled with the selection used to produce it.
- Africa's prepared mode checks the saved asset's schema, sources, dates, grid
  and bands without reading all 6,480 source timestamps at startup. The full
  archive check remains available for preparation and direct-catalog auditing.
- Reconnection discards obsolete callbacks, clears old results and restores the
  study's map extent. Neither app changes the original scientific calculations.

### Required assets

| Configuration | Required input |
| --- | --- |
| Both apps: `CONFIG.preparedAsset` | Native-grid annual image with `v2_1981`/`v3_1981` through `v2_2025`/`v3_2025`, plus `elev_m`, `region_id`, `area_m2` and `fixed_support`. |
| Tanganyika: `CONFIG.supportAsset` | Basin image containing exact polygon-cell overlap areas, monthly climatology and full-record monthly diagnostics. |
| Tanganyika: `CONFIG.boundaryAsset` | Eight features: five supplied polygons and three derived land polygons, identified by the expected `key` properties. |

The annual image is prepared from `UCSB-CHG/CHIRPS/PENTAD`,
`UCSB-CHC/CHIRPS/V3/PENTAD`, `MERIT/DEM/v1_0_3` and
`USDOS/LSIB_SIMPLE/2017`. The Africa source includes the public-data preparation
functions (`createContext`, `catalogMetadata`, `preparedImage`) for review;
preparation and asset sharing are separate actions. Clearing `preparedAsset`
and `terrainAsset` uses the public catalog directly, but continental map tiles
can exceed interactive computation limits. A prepared image is recommended.

The Tanganyika support image uses schema `chirps-tanganyika-explorer-v1` and
the exact weight-file checksum in `CONFIG.weightsSHA256`. Required bands include
`unit_1_area_m2` through `unit_5_area_m2`, `catchment_1_area_m2` through
`catchment_3_area_m2`, `cell_area_equal_m2`, `centre_unit`, the 24
`v2_m01_mm`/`v3_m01_mm` through `v2_m12_mm`/`v3_m12_mm` climatology bands,
`monthly_anomaly_r`, `monthly_anomaly_sd_ratio` and `valid_months` (540).
Additional diagnostic bands may be present. Required boundary keys are
`source_rusizi`, `source_malagarasi`, `source_others`, `land_rusizi`,
`land_malagarasi`, `land_others`, `lake_tanganyika` and `lake_kivu`.
The startup functions check schema, source IDs, dates, required bands, native
grid and polygon keys. Arbitrary replacement datasets will not reproduce the
study; the original basin weights and polygons are required.

### Methods and interpretation

- Both apps retain **1981–2025**, the original CHIRPS v2 grid and fixed complete
  paired coverage. Annual totals give every year equal weight. The scripts show
  the exact affine transform rather than substituting a rounded 5 km scale.
- A group mean is `sum(rainfall × represented area) / sum(represented area)`.
  Africa uses native-grid Earth Engine pixel areas. Tanganyika uses the exact
  EPSG:6933 polygon-cell intersection areas from the basin analysis, preserving
  partial boundary cells. Already weighted values are summed without a second
  polygon-edge weighting.
- Differences are **v3 − v2**. A group percentage divides the difference of
  group means by the v2 group mean; it is not an average of pixel percentages.
  The dry-cell threshold applies to the percentage map, not group totals.
- Tanganyika offers the whole basin, land, lakes, five non-overlapping units
  and the original catchments. The original lake polygons overlap the
  catchments, so their five totals must not be added together. Elevation
  comparisons exclude the two supplied lake polygons.
- Mean MERIT elevation assigns rainfall cells to the same seven classes in
  both apps. Lake comparisons are conditional CHIRPS product comparisons;
  CHIRPS is a land precipitation product. Rainfall volume is not discharge.
- Tanganyika monthly climatology and anomaly diagnostics always use the fixed
  **1981–2025** period even when annual years change. The interface labels this.
- Neither app performs gauge validation, uncertainty resampling or a causal
  elevation analysis. A larger amount or stronger variability does not prove
  greater accuracy.

### Verification and provenance

The original study exports were retrieved on **12 October 2026**. The original
Africa annual cache was prepared on **15 October 2026**. Its calculations were
checked against direct pentad expressions, regional/elevation summaries and
independent raster samples. Fresh continental boundary rasterization differed
at three coastal cells; comparisons with the original report allow 0.02 mm/year
or percentage points and 100 km² in grouped summaries. The original report
inputs were retained unchanged.

For Tanganyika, all **750,510 annual values** (90 bands × 8,339 cells) from the
shared annual cache matched the archived basin exports exactly. The basin uses
its saved exact overlap areas rather than the parent's whole-cell area band.
Eleven shared functions are reused verbatim from the Africa explorer. The
publication copies preserve all named calculation/UI functions; only headers
and account-specific cache configuration were adapted for this repository.

The completed Tanganyika supplemental image was read back at all **350,238
values** (42 bands × 8,339 cells), with exact equality to the saved inputs.
All **396 live calculation checks** passed against unchanged report tables and
point samples, including polygon/elevation summaries and annual/monthly history.
The native-grid indexing was verified before export and after read-back. These
assets remain private; publication here does not change their permissions.

The original source packages passed nine Africa and six Tanganyika arithmetic,
grid, completeness and code-generation tests. JavaScript syntax and repository
catalog checks also run for this publication. These checks do not substitute
for exercising the Code Editor UI with accessible assets. A public repository
does not imply that the private inputs have been made public.

## Using the EECU notebook

`GEE/GEE_noncommercial_eecu_monitor.ipynb` is designed for Google Colab. It
uses:

- `pandas`
- `plotly`
- `google-colab`
- `google-cloud-monitoring`
- `IPython`

Open the notebook in Colab, set `PROJECT_ID`, authenticate with an account that
can view the project's Cloud Monitoring metrics, and then run the cells. Colab
provides several of the imported packages by default; install any missing
package in the notebook environment rather than treating it as a repository-wide
dependency.

## Using the geemap imagery notebook

Open `JNotebooks/LandSenView_geemap.ipynb` in ArcGIS Pro, VS Code, or JupyterLab
and run the cells from top to bottom. In ArcGIS Pro, install missing packages in
a clone of the default `arcgispro-py3` environment. The notebook includes a
commented `%pip` command for other environments.

Earth Engine authenticates through its browser-based OAuth flow and stores the
resulting credentials outside the notebook. Do not paste tokens, API keys,
service-account JSON, or private keys into notebook cells. Before committing
notebook changes, clear outputs so account details, local paths, map state, and
query results are not saved.

For each selected UTC date, the notebook rebuilds the full filtered collection
and mosaics every intersecting granule or scene. When it is run from inside the
ArcGIS Pro application, an optional connection control can also add that Earth
Engine mosaic to a chosen ArcGIS map or 3D scene. External VS Code or Jupyter
kernels cannot alter a scene already open in ArcGIS Pro because they cannot use
the application's `ArcGISProject("CURRENT")` context.

## Using the burned-area geemap notebook

Open `JNotebooks/Wildfire_detection_geemap.ipynb`, run the setup and import
cells, and review the consolidated user-options cell before authenticating
Earth Engine. The attached example polygon is available by default; draw a new
polygon or rectangle in the geemap widget to replace it.

Running the analysis creates an output catalogue without automatically adding
result layers. Select the pre/post imagery, indices, correction masks, burned
area, severity, or enabled threshold diagnostics that you want to inspect.
Selected entries can be previewed in geemap or transferred to an existing
ArcGIS Pro map/3D Scene from the dedicated transfer cell. The transfer does not
open a new Scene view. Statistics are a later optional step and can be skipped
without affecting visualization; raster exports remain available when
statistics are skipped. Google Drive exports are defined separately and remain
unsubmitted until explicitly started. A final optional validation section can
download the burned mask as a projected binary GeoTIFF, polygonize it locally,
save the polygon as a GeoPackage, and compare raster- and polygon-derived areas
with a fresh Earth Engine `pixelArea()` calculation. That optional section uses
`geedim`, `rasterio`, `GeoPandas`, `Shapely`, and `pyproj`; its commented setup
cell provides the installation command for environments that lack them. Its
output defaults to `Desktop/wildfire_local_validation`, and an editable folder
field immediately before the download accepts any writable absolute path.

## Developing the vault

Start work from an up-to-date branch:

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description
```

After making a change, run the repository checks:

```bash
python tools/validate_repository.py
```

The validator checks JavaScript syntax when Node.js is available, Python syntax,
notebook JSON structure, and whether files in `GEE/` and `Apps/` are represented
in this catalog. It does not execute Earth Engine operations; functional
validation still happens in the relevant runtime.

Then review and publish the branch:

```bash
git status
git diff
git add <files>
git commit -m "Describe the change"
git push -u origin feature/short-description
```

For a very small personal change, committing directly to `main` is possible,
but a short-lived branch is safer for substantial script changes. See
`CONTRIBUTING.md` for the repository conventions.

## Repository conventions

- Treat every script or notebook as an independent tool.
- Keep user-editable configuration near the top of the file.
- Document the expected runtime, inputs, outputs, external assets, and important
  limitations in the file header.
- Prefer meaningful filenames over a deep package hierarchy.
- Use Git history for ordinary revisions. Keep a separate `_v2` file only when
  both variants are intentionally useful.
- Do not commit credentials, private keys, local datasets, generated exports, or
  private Earth Engine asset details.
- Validate scientific thresholds and classification results against known data
  before operational use.

## Known portability considerations

- Several scripts use Earth Engine datasets or user/project assets. Access,
  dataset schemas, and asset availability must be checked in the target Earth
  Engine account.
- `GEE/ExportTile_scheleton.js` contains deliberate placeholder asset paths and
  requires a processing chain before use.
- `GEE/S1_Opera_query.js` depends on an imported/drawn `geometry`.
- The larger UI scripts are self-contained but have substantial client/server
  interaction; a syntax check cannot detect Earth Engine runtime, quota, or UI
  lifecycle errors.
- `GEE/Wildfire_detection.js` exposes many methodological switches. Its
  thresholds and outputs require event-specific validation.

## Sources and licensing

- The EECU monitor notebook is adapted from the
  [Earth Engine Community guide](https://github.com/google/earthengine-community/blob/master/guides/linked/cloud-monitoring/earth_engine_noncommercial_eecu_monitor.ipynb)
  and retains its source notices.
- Some individual scripts contain their own author or license statement.
- There is currently no repository-level `LICENSE` file. Do not assume that one
  file's license statement automatically applies to every file in this mixed
  collection.

Coauthor: begsud
