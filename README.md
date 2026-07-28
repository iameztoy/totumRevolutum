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
- `tools/` — repository-level validation utilities; these do not form part of
  the geospatial scripts themselves.

## Script catalog

| File | Environment | Purpose |
| --- | --- | --- |
| `GEE/AreaCalculator_Widget.js` | GEE Code Editor | Interactive drawing tool that reports polygon area in m², ha, and km². |
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
