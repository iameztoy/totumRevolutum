/* CHIRPS v2 / v3 Africa explorer — 1981–2025.
 * Runtime: Google Earth Engine Code Editor (ee, ui, Map and print globals).
 * Launch: set CONFIG.preparedAsset to an accessible prepared annual image,
 * paste this entire file into a Code Editor script, and click Run.
 * Configuration: asset IDs, dates, grid, regions and palettes are below.
 * Required image: 90 annual rainfall bands, MERIT elevation, region, pixel
 * area and fixed paired support; see the repository README for its contract.
 * An enabled Earth Engine account/project and access to that image are needed.
 * Outputs: linked maps, area-weighted summaries/charts and point inspection.
 * Running this explorer does not create assets, start exports or change sharing.
 * Sources: UCSB CHIRPS v2/v3 final pentads, MERIT DEM and USDOS LSIB (IDs below).
 * Differences between products are not independent accuracy validation.
 * Snapshot: report inputs 12 Oct 2026; original annual cache 15 Oct 2026.
 * Source code publication does not grant access to the original private assets.
 */
var CONFIG = {
  firstYear: 1981,
  lastYear: 2025,
  v2: 'UCSB-CHG/CHIRPS/PENTAD',
  v3: 'UCSB-CHC/CHIRPS/V3/PENTAD',
  boundary: 'USDOS/LSIB_SIMPLE/2017',
  dem: 'MERIT/DEM/v1_0_3',
  crs: 'EPSG:4326',
  transform: [0.05000000074505806, 0, -180, 0, -0.05000000074505806, 50],
  bounds: [-26, -36, 64, 39],
  tileScale: 4,
  maxPixels: 100000000,
  // Created with the supplied preparation logic. Empty = slow public-catalog calculation.
  preparedAsset: 'projects/your-project/assets/chirps_africa_annual_1981_2025_20261015',
  // Optional terrain-only cache, used only when preparedAsset is empty.
  terrainAsset: '', // Optional terrain-only cache; not needed with preparedAsset.
  schema: 'chirps-africa-explorer-v1',
  sourceDate: '2026-10-12',
  extraIslands: ['Mauritius', 'Seychelles', 'Reunion', 'Saint Helena'],
  regions: {
    Northern: ['Algeria', 'Egypt', 'Libya', 'Morocco', 'Sudan', 'Tunisia',
      'Western Sahara', 'Bir Tawil', 'Halaib Triangle', 'Spain (Canary Is)',
      'Portugal (Madeira Is)', 'Spain (Africa)'],
    Western: ['Benin', 'Burkina Faso', 'Cabo Verde', "Cote d'Ivoire", 'Gambia, The',
      'Ghana', 'Guinea', 'Guinea-Bissau', 'Liberia', 'Mali', 'Mauritania', 'Niger',
      'Nigeria', 'Senegal', 'Sierra Leone', 'Togo', 'Koualou Area', 'Saint Helena'],
    Middle: ['Angola', 'Cameroon', 'Central African Rep', 'Chad', 'Dem Rep of the Congo',
      'Rep of the Congo', 'Equatorial Guinea', 'Gabon', 'Sao Tome & Principe'],
    Eastern: ['Burundi', 'Comoros', 'Djibouti', 'Eritrea', 'Ethiopia', 'Kenya',
      'Madagascar', 'Malawi', 'Mauritius', 'Mayotte', 'Mozambique', 'Reunion',
      'Rwanda', 'Seychelles', 'Somalia', 'South Sudan', 'Uganda', 'Tanzania',
      'Zambia', 'Zimbabwe', 'Abyei Area'],
    Southern: ['Botswana', 'Lesotho', 'Namibia', 'South Africa', 'Swaziland']
  },
  elevationEdges: [250, 500, 1000, 1500, 2000, 3000],
  elevationLabels: ['Below 250 m', '250–499 m', '500–999 m', '1,000–1,499 m',
    '1,500–1,999 m', '2,000–2,999 m', '3,000 m and above'],
  rainfallPalette: ['ffffd9', 'edf8b1', 'c7e9b4', '7fcdbb', '41b6c4', '1d91c0', '225ea8', '253494', '081d58'],
  differencePalette: ['8c510a', 'bf812d', 'dfc27d', 'f6e8c3', 'f5f5f5', 'c7eae5', '80cdc1', '35978f', '01665e'],
  regionPalette: ['eab83e', '73b7d2', '71bda6', 'be95c4', 'e98663'],
  elevationPalette: ['f7fcf5', 'e5f5e0', 'c7e9c0', 'a1d99b', '74c476', '31a354', '006d2c']
};

var REGION_NAMES = ['Northern', 'Western', 'Middle', 'Eastern', 'Southern'];

/** Validate a client-side year selection before building an EE graph. */
function checkYears(first, last) {
  if (first % 1 !== 0 || last % 1 !== 0 || first < CONFIG.firstYear ||
      last > CONFIG.lastYear || first > last) {
    throw new Error('Choose whole years between 1981 and 2025, with start <= end.');
  }
}

/** Accept equivalent origins shifted by an integer number of native cells. */
function isNativeGrid(projection) {
  if (!projection || projection.crs !== CONFIG.crs || !projection.transform) return false;
  var t = projection.transform;
  for (var i = 0; i < 6; i++) {
    if (i !== 2 && i !== 5 && Math.abs(t[i] - CONFIG.transform[i]) > 1e-10) return false;
  }
  return [2, 5].every(function(index) {
    var cells = (t[index] - CONFIG.transform[index]) / CONFIG.transform[index === 2 ? 0 : 4];
    return Math.abs(cells - Math.round(cells)) < 1e-5;
  });
}

/** Interpret grouped area sums. Missing/empty groups remain null, never zero. */
function summarizeSums(xArea, yArea, area, wetterArea) {
  if (typeof area !== 'number' || !isFinite(area) || !(area > 0) ||
      typeof xArea !== 'number' || typeof yArea !== 'number' ||
      !isFinite(xArea) || !isFinite(yArea)) return null;
  var x = xArea / area;
  var y = yArea / area;
  return {v2: x, v3: y, difference: y - x,
    relative: x > 0 ? 100 * (y - x) / x : null,
    areaKm2: area / 1e6, wetterPct: 100 * wetterArea / area};
}

/** All classes are [lower, upper); the first includes negative elevations. */
function elevationClassNumber(height) {
  if (typeof height !== 'number' || !isFinite(height)) return null;
  return CONFIG.elevationEdges.filter(function(edge) { return height >= edge; }).length;
}


/* SCIENTIFIC CALCULATIONS — intentionally independent of the UI.
 * Arithmetic follows scripts/earth_engine_pipeline.py and scripts/analyze.py.
 * Each reduction explicitly uses the v2 native transform, never map zoom.
 */

/** Build lazily evaluated public-data inputs. No server request is made here. */
function createContext() {
  var countries = ee.FeatureCollection(CONFIG.boundary).filter(ee.Filter.or(
    ee.Filter.eq('wld_rgn', 'Africa'),
    ee.Filter.inList('country_na', CONFIG.extraIslands)));
  function collection(id) {
    return ee.ImageCollection(id).filterDate(CONFIG.firstYear + '-01-01',
      (CONFIG.lastYear + 1) + '-01-01').select('precipitation').map(function(image) {
        return image.updateMask(image.gte(0)); // Zero is genuine rainfall, not nodata.
      });
  }
  return {countries: countries, c2: collection(CONFIG.v2), c3: collection(CONFIG.v3),
    grid: ee.Projection(CONFIG.crs, CONFIG.transform),
    bounds: ee.Geometry.Rectangle(CONFIG.bounds, CONFIG.crs, false),
    prepared: CONFIG.preparedAsset ? ee.Image(CONFIG.preparedAsset) : null,
    terrainPrepared: CONFIG.terrainAsset ? ee.Image(CONFIG.terrainAsset) : null,
    annual: {}, periods: {}};
}

/** Align a reduced image to v2. EE's default nearest-neighbour is retained. */
function onGrid(image, collection, ctx) {
  return image.setDefaultProjection(collection.first().projection()).reproject(ctx.grid);
}

/** MERIT is averaged INSIDE rainfall cells; rainfall is never sharpened to DEM scale. */
function getTerrain(ctx) {
  if (ctx.terrain) return ctx.terrain;
  if (ctx.prepared) {
    ctx.terrain = ctx.prepared.select(['elev_m', 'region_id', 'area_m2']);
  } else if (ctx.terrainPrepared) {
    ctx.terrain = ctx.terrainPrepared.select(['elev_m', 'region_id', 'area_m2']);
  } else {
    var elevation = ee.Image(CONFIG.dem).select('dem')
      .reduceResolution({reducer: ee.Reducer.mean(), bestEffort: false, maxPixels: 8192})
      .reproject(ctx.grid).toFloat().rename('elev_m');
    // Paint before the requested output projection, as in the original exports.
    var regions = ee.Image(0).toByte();
    REGION_NAMES.forEach(function(name, i) {
      regions = regions.paint(ctx.countries.filter(
        ee.Filter.inList('country_na', CONFIG.regions[name])), i + 1);
    });
    // The original exports store area as float32. Reproduce that convention.
    var area = ee.Image.pixelArea().toFloat().rename('area_m2');
    ctx.terrain = elevation.addBands(regions.rename('region_id')).addBands(area)
      .clipToCollection(ctx.countries);
  }
  return ctx.terrain;
}

/** Same land cells in EVERY view/year: both records complete for all 45 years. */
function getSupport(ctx) {
  if (ctx.support) return ctx.support;
  if (ctx.prepared) {
    ctx.support = ctx.prepared.select('fixed_support').eq(1).selfMask();
  } else {
    var expected = 72 * (CONFIG.lastYear - CONFIG.firstYear + 1);
    var count2 = onGrid(ctx.c2.count(), ctx.c2, ctx);
    var count3 = onGrid(ctx.c3.count(), ctx.c3, ctx);
    var terrain = getTerrain(ctx);
    ctx.support = count2.eq(expected).and(count3.eq(expected))
      .and(terrain.select('elev_m').mask().gt(0))
      .and(terrain.select('area_m2').gt(0))
      .and(terrain.select('region_id').gte(1)).and(terrain.select('region_id').lte(5))
      .clipToCollection(ctx.countries).selfMask().rename('fixed_support');
  }
  return ctx.support;
}

/** Paired annual TOTALS. Each year must contain all 72 final pentads. */
function getAnnual(ctx, year) {
  if (ctx.annual[year]) return ctx.annual[year];
  var pair;
  if (ctx.prepared) {
    pair = ctx.prepared.select(['v2_' + year, 'v3_' + year], ['v2_mm', 'v3_mm']);
  } else {
    var p2 = ctx.c2.filterDate(year + '-01-01', (year + 1) + '-01-01');
    var p3 = ctx.c3.filterDate(year + '-01-01', (year + 1) + '-01-01');
    pair = onGrid(p2.sum(), ctx.c2, ctx).rename('v2_mm').toFloat()
      .addBands(onGrid(p3.sum(), ctx.c3, ctx).rename('v3_mm').toFloat());
  }
  ctx.annual[year] = pair.toDouble().updateMask(getSupport(ctx))
    .setDefaultProjection(ctx.grid).set('year', year)
    .set('system:time_start', ee.Date.fromYMD(year, 1, 1).millis());
  return ctx.annual[year];
}

/** Mean of annual totals; every selected year has equal weight. */
function getPeriod(ctx, first, last) {
  checkYears(first, last);
  var key = first + '_' + last;
  if (!ctx.periods[key]) {
    var images = [];
    // These client loops only BUILD the graph; they never call getInfo/evaluate.
    for (var year = first; year <= last; year++) images.push(getAnnual(ctx, year));
    ctx.periods[key] = ee.ImageCollection.fromImages(images).mean()
      .setDefaultProjection(ctx.grid).updateMask(getSupport(ctx));
  }
  return ctx.periods[key];
}

/** Freeze annual totals and support without changing their native-grid values. */
function preparedImage(ctx) {
  var annualBands = [];
  for (var year = CONFIG.firstYear; year <= CONFIG.lastYear; year++) {
    annualBands.push(getAnnual(ctx, year).rename(['v2_' + year, 'v3_' + year]));
  }
  // Annual totals, terrain and area already follow the report's float32 convention.
  return ee.Image.cat(annualBands).addBands(getTerrain(ctx))
    .addBands(getSupport(ctx).rename('fixed_support'))
    .updateMask(getSupport(ctx)).toFloat()
    .set({explorer_schema: CONFIG.schema, first_year: CONFIG.firstYear,
      last_year: CONFIG.lastYear, source_v2: CONFIG.v2, source_v3: CONFIG.v3,
      dem: CONFIG.dem, boundary: CONFIG.boundary,
      crs_transform: JSON.stringify(CONFIG.transform)});
}

/** Mean-elevation category raster; edges match np.digitize in the report. */
function getElevationClasses(ctx) {
  var elevation = getTerrain(ctx).select('elev_m');
  var classes = elevation.multiply(0).toByte();
  CONFIG.elevationEdges.forEach(function(edge) { classes = classes.add(elevation.gte(edge)); });
  return classes.rename('elevation_class').toByte();
}

/** Region/class selection is a raster mask, avoiding a second polygon edge weight. */
function selectionMask(ctx, region, elevationClass) {
  var mask = getSupport(ctx);
  if (region !== 'Africa') {
    var id = REGION_NAMES.indexOf(region) + 1;
    if (id === 0) throw new Error('Unknown region: ' + region);
    mask = mask.and(getTerrain(ctx).select('region_id').eq(id));
  }
  if (elevationClass !== null) mask = mask.and(getElevationClasses(ctx).eq(elevationClass));
  return mask;
}

/** Difference maps. Only pixel percentages use the configurable dry-cell filter. */
function comparisonImage(ctx, first, last, region, elevationClass, threshold) {
  var pair = getPeriod(ctx, first, last);
  var x = pair.select('v2_mm');
  var delta = pair.select('v3_mm').subtract(x).rename('difference_mm');
  var reference = getPeriod(ctx, CONFIG.firstYear, CONFIG.lastYear).select('v2_mm');
  var relative = delta.divide(x).multiply(100).rename('relative_pct')
    .updateMask(reference.gte(threshold).and(x.gt(0)));
  return pair.addBands(delta).addBands(relative).addBands(getTerrain(ctx))
    .addBands(getElevationClasses(ctx)).updateMask(selectionMask(ctx, region, elevationClass))
    // Apply categories and thresholds at rainfall-cell resolution before map display.
    .reproject(ctx.grid);
}

/** Explicit area weights: sum(rainfall * area) / sum(area), both in the same cells. */
function weightedBands(image) {
  var area = image.select('area_m2').toDouble();
  return image.select('v2_mm').multiply(area).rename('v2_area')
    .addBands(image.select('v3_mm').multiply(area).rename('v3_area'))
    .addBands(area.rename('area'))
    .addBands(image.select('difference_mm').gt(0).multiply(area).rename('wetter_area'));
}

/** A broad bounding box contains the already raster-masked African cells. */
function reductionOptions(ctx, reducer, geometry) {
  return {reducer: reducer, geometry: geometry || ctx.bounds, crs: CONFIG.crs,
    crsTransform: CONFIG.transform, maxPixels: CONFIG.maxPixels,
    tileScale: CONFIG.tileScale, bestEffort: false};
}

function areaSummary(ctx, image, geometry) {
  return weightedBands(image).reduceRegion(reductionOptions(ctx,
    ee.Reducer.sum().unweighted(), geometry));
}

/** Four sums per category in ONE reduction; prevents many simultaneous requests. */
function groupedSummary(ctx, image, groupBand) {
  return weightedBands(image).addBands(image.select(groupBand).rename('class_id'))
    .reduceRegion(reductionOptions(ctx, ee.Reducer.sum().unweighted().repeat(4)
      .group({groupField: 4, groupName: 'class_id'})));
}

/** One native rainfall cell, with no bilinear interpolation or neighbourhood averaging. */
function inspectPoint(ctx, image, longitude, latitude) {
  return image.reduceRegion(reductionOptions(ctx, ee.Reducer.first(),
    ee.Geometry.Point([longitude, latitude], CONFIG.crs)));
}

/** A single reduction of 90 bands, instead of 45 concurrent reduceRegion requests. */
function pointHistory(ctx, longitude, latitude) {
  var bands = [];
  for (var year = CONFIG.firstYear; year <= CONFIG.lastYear; year++) {
    bands.push(getAnnual(ctx, year).rename(['v2_' + year, 'v3_' + year]));
  }
  return ee.Image.cat(bands).reduceRegion(reductionOptions(ctx, ee.Reducer.first(),
    ee.Geometry.Point([longitude, latitude], CONFIG.crs)));
}

/** Archive metadata checked BEFORE displaying live calculations. */
function catalogMetadata(ctx) {
  var result = ee.Dictionary({dates2: ctx.c2.aggregate_array('system:time_start'),
    dates3: ctx.c3.aggregate_array('system:time_start'),
    projection2: ctx.c2.first().projection(), projection3: ctx.c3.first().projection(),
    countries: ctx.countries.aggregate_array('country_na')});
  if (ctx.prepared) result = result.set('preparedProperties', ctx.prepared.toDictionary())
    .set('preparedBands', ctx.prepared.bandNames()).set('preparedProjection', ctx.prepared.projection());
  if (!ctx.prepared && ctx.terrainPrepared) result = result.set('terrainProperties', ctx.terrainPrepared.toDictionary())
    .set('terrainProjection', ctx.terrainPrepared.projection());
  return result;
}

/** Check exact expected timestamps, not just a possibly misleading image count. */
function checkCatalogMetadata(metadata) {
  var expected = [];
  for (var year = CONFIG.firstYear; year <= CONFIG.lastYear; year++) {
    for (var month = 0; month < 12; month++) {
      [1, 6, 11, 16, 21, 26].forEach(function(day) { expected.push(Date.UTC(year, month, day)); });
    }
  }
  ['dates2', 'dates3'].forEach(function(key) {
    var dates = metadata[key].slice().sort(function(a, b) { return a - b; });
    if (dates.length !== expected.length || dates.some(function(t, i) { return t !== expected[i]; })) {
      throw new Error(key + ': missing, duplicated or unexpected pentads; do not continue.');
    }
  });
  if (!isNativeGrid(metadata.projection2) || !isNativeGrid(metadata.projection3)) {
    throw new Error('A catalog grid differs from the recorded native analysis grid.');
  }
  var all = [];
  REGION_NAMES.forEach(function(name) { all = all.concat(CONFIG.regions[name]); });
  metadata.countries.forEach(function(name) {
    if (all.indexOf(name) < 0) throw new Error('Unassigned country/territory: ' + name);
  });
  if (CONFIG.preparedAsset) {
    var props = metadata.preparedProperties || {};
    if (props.explorer_schema !== CONFIG.schema || props.first_year !== CONFIG.firstYear ||
        props.last_year !== CONFIG.lastYear || props.source_v2 !== CONFIG.v2 ||
        props.source_v3 !== CONFIG.v3 || props.dem !== CONFIG.dem || props.boundary !== CONFIG.boundary ||
        !isNativeGrid(metadata.preparedProjection)) throw new Error('Prepared asset has incompatible source, dates or grid.');
    var needed = ['elev_m', 'area_m2', 'region_id', 'fixed_support'];
    for (var y = CONFIG.firstYear; y <= CONFIG.lastYear; y++) needed.push('v2_' + y, 'v3_' + y);
    needed.forEach(function(band) {
      if (metadata.preparedBands.indexOf(band) < 0) throw new Error('Cache missing band: ' + band);
    });
  }
  if (!CONFIG.preparedAsset && CONFIG.terrainAsset) {
    var terrain = metadata.terrainProperties || {};
    var tp = metadata.terrainProjection || {};
    if (terrain.explorer_schema !== CONFIG.schema || terrain.source_dem !== CONFIG.dem ||
        !isNativeGrid(tp)) throw new Error('Terrain cache has incompatible source, schema or grid.');
  }
  return true;
}


/* INTERFACE — all calculations are in the preceding analysis section.
 * No exports, uploads, asset writes or publication occur when this app runs.
 */
var ctx = createContext();
var state = {first: 1981, last: 2025, region: 'Africa', elevation: null,
  threshold: 100, revision: 0, ready: false, busy: false, point: null, image: null};
var INK = '#163641';
var BLUE = '#21618c';
var ORANGE = '#bc4d22';
var TEAL = '#007c78';
var chartOptions = {colors: [BLUE, ORANGE], legend: {position: 'top'},
  lineWidth: 2, pointSize: 2, curveType: 'none', chartArea: {left: 65, right: 15, top: 55, bottom: 65}};
function label(text, bold) {
  return ui.Label(text, {color: INK, fontSize: '13px', whiteSpace: 'pre-wrap',
    fontWeight: bold ? 'bold' : 'normal', margin: '4px 0'});
}
function heading(text) { return ui.Label(text, {fontSize: '17px', fontWeight: 'bold', color: TEAL, margin: '14px 0 5px'}); }
function fmt(value, digits) { return value === null || value === undefined || !isFinite(value) ? 'Not available' : value.toFixed(digits); }
var sidebar = ui.Panel({style: {width: '410px', padding: '14px', stretch: 'vertical'}});
sidebar.add(ui.Label('CHIRPS v2 and v3 | Africa', {fontSize: '23px', fontWeight: 'bold', color: INK}));
sidebar.add(label('Compare rainfall amounts, geography and elevation. All views use the same complete-record land cells from 1981–2025.'));
var status = label('Checking the public archive…', true);
sidebar.add(status);
var leftMap = ui.Map();
var rightMap = ui.Map();
[leftMap, rightMap].forEach(function(map) {
  map.setOptions('ROADMAP');
  map.setControlVisibility({all: false, zoomControl: true, scaleControl: true});
  map.style().set('cursor', 'crosshair');
});
var linker = ui.Map.Linker([leftMap, rightMap]);
var maps = ui.SplitPanel({firstPanel: leftMap, secondPanel: rightMap,
  orientation: 'horizontal', wipe: false, style: {stretch: 'both'}});
ui.root.clear();
ui.root.setLayout(ui.Panel.Layout.flow('horizontal'));
ui.root.add(sidebar).add(maps);
leftMap.setCenter(18, 2, 3);

var yearStrings = [];
for (var year = CONFIG.firstYear; year <= CONFIG.lastYear; year++) yearStrings.push(String(year));
function dirty() { if (state.ready) status.setValue('Selection changed. Press Apply selection.'); }
sidebar.add(heading('1. Choose the comparison'));
sidebar.add(label('Start year / end year (inclusive)'));
var firstSelect = ui.Select({items: yearStrings, value: '1981', onChange: dirty, style: {width: '170px'}});
var lastSelect = ui.Select({items: yearStrings, value: '2025', onChange: dirty, style: {width: '170px'}});
sidebar.add(ui.Panel([firstSelect, lastSelect], ui.Panel.Layout.flow('horizontal')));
var regionSelect = ui.Select({items: ['Africa'].concat(REGION_NAMES), value: 'Africa', onChange: dirty, style: {stretch: 'horizontal'}});
sidebar.add(label('Region')).add(regionSelect);
var elevationSelect = ui.Select({items: ['All elevations'].concat(CONFIG.elevationLabels), value: 'All elevations', onChange: dirty, style: {stretch: 'horizontal'}});
sidebar.add(label('Mean elevation inside the rainfall cell')).add(elevationSelect);
var thresholdSelect = ui.Select({items: ['50', '100', '200'], value: '100', onChange: dirty, style: {width: '100px'}});
sidebar.add(label('Percentage map: minimum 1981–2025 v2 rainfall (mm/year)')).add(thresholdSelect);
sidebar.add(label('Very dry cells are grey on the percentage map. Absolute differences and area summaries retain these cells.'));
var applyButton = ui.Button({label: 'Apply selection', disabled: true, onClick: applySelection, style: {stretch: 'horizontal'}});
sidebar.add(applyButton);
var selectionLabel = label('', true);
sidebar.add(selectionLabel);

sidebar.add(heading('2. Explore the maps'));
var LAYERS = ['CHIRPS v2', 'CHIRPS v3', 'Difference in mm/year', 'Difference in percent', 'Mean elevation', 'African regions'];
var leftSelect = ui.Select({items: LAYERS, value: 'CHIRPS v2', onChange: renderMaps, style: {stretch: 'horizontal'}});
var rightSelect = ui.Select({items: LAYERS, value: 'Difference in percent', onChange: renderMaps, style: {stretch: 'horizontal'}});
sidebar.add(label('Left map')).add(leftSelect).add(label('Right map')).add(rightSelect);
sidebar.add(ui.Button({label: 'Compare v2 and v3 side by side', onClick: function() {
  leftSelect.setValue('CHIRPS v2', false); rightSelect.setValue('CHIRPS v3', false); renderMaps();
}, style: {stretch: 'horizontal'}}));
var borders = ui.Checkbox({label: 'Show country / territory boundaries', value: false, onChange: renderMaps});
sidebar.add(borders);
sidebar.add(label('Maps pan and zoom together. Fixed colour scales allow direct comparisons. Values beyond a colour scale retain their true values in summaries.'));
sidebar.add(label('Display: Web Mercator. Statistics: native 0.05° grid with square-metre area weights; screen area is not used.'));
var leftLegend = ui.Panel({style: {position: 'bottom-left', padding: '8px', backgroundColor: '#ffffffdd'}});
var rightLegend = ui.Panel({style: {position: 'bottom-left', padding: '8px', backgroundColor: '#ffffffdd'}});
leftMap.add(leftLegend); rightMap.add(rightLegend);

sidebar.add(heading('3. Calculate and compare'));
sidebar.add(label('These buttons calculate from the Earth Engine rainfall grids. Prepared annual layers make the calculations faster; the preparation code is supplied.'));
var resultsPanel = ui.Panel();
var summaryButton = ui.Button({label: 'Selected-area summary', disabled: true, onClick: calculateSummary, style: {stretch: 'horizontal'}});
var regionButton = ui.Button({label: 'Compare all five regions', disabled: true, onClick: function() { calculateGroups('region_id'); }, style: {stretch: 'horizontal'}});
var elevationButton = ui.Button({label: 'Compare elevation bands', disabled: true, onClick: function() { calculateGroups('elevation_class'); }, style: {stretch: 'horizontal'}});
sidebar.add(summaryButton).add(regionButton).add(elevationButton).add(resultsPanel);
sidebar.add(heading('4. Inspect a rainfall cell'));
var pointPanel = ui.Panel([label('Click either map to inspect the containing rainfall cell.')]);
var historyButton = ui.Button({label: 'Show this cell’s annual history', disabled: true, onClick: showPointHistory, style: {stretch: 'horizontal'}});
sidebar.add(pointPanel).add(historyButton);
sidebar.add(heading('How to interpret the comparison'));
sidebar.add(label('Difference = v3 − v2. Positive values mean more rainfall in v3. A percentage compares the difference with v2.'));
sidebar.add(label('Area mean = sum(rainfall × cell area) / sum(cell area). For example: 20 km² at 100 mm and 30 km² at 200 mm give 160 mm.'));
sidebar.add(label('Regional and elevation percentages use the ratio of group means, not the average of pixel percentages. They can differ from the map’s average percentage.'));
sidebar.add(label('Elevation is the mean MERIT height inside each rainfall cell. Regional classifications follow the report’s UN M49-based grouping. Differences between versions do not establish which is more accurate.'));
sidebar.add(ui.Label('CHIRPS v3 source documentation', {fontSize: '12px'}, 'https://www.chc.ucsb.edu/data/chirps3'));
sidebar.add(ui.Label('Code Editor / publish an Earth Engine App', {fontSize: '12px'}, 'https://developers.google.com/earth-engine/guides/apps'));
sidebar.add(label('Analysis period: 1981–2025. App code: 15 October 2026. ' +
  (CONFIG.preparedAsset ? 'Uses the prepared rainfall snapshot; selections are calculated from its grid cells.' :
    'Recalculates rainfall from the live catalog.')));

/** Invalidate old asynchronous results whenever a selection is applied. */
function applySelection() {
  if (!state.ready || state.busy) return;
  var first = Number(firstSelect.getValue());
  var last = Number(lastSelect.getValue());
  try { checkYears(first, last); } catch (error) { status.setValue(error.message); return; }
  state.first = first; state.last = last; state.region = regionSelect.getValue();
  state.elevation = elevationSelect.getValue() === 'All elevations' ? null :
    CONFIG.elevationLabels.indexOf(elevationSelect.getValue());
  state.threshold = Number(thresholdSelect.getValue());
  state.revision++; state.point = null; historyButton.setDisabled(true);
  state.image = comparisonImage(ctx, first, last, state.region, state.elevation, state.threshold);
  resultsPanel.clear(); pointPanel.clear().add(label('Click a map to inspect a rainfall cell.'));
  selectionLabel.setValue(first + '–' + last + ' | ' + state.region + ' | ' + elevationSelect.getValue());
  renderMaps();
  status.setValue('Maps requested. Choose a calculation or click a cell.');
}

function layerSpec(name) {
  if (name === 'CHIRPS v2' || name === 'CHIRPS v3') return {
    band: name === 'CHIRPS v2' ? 'v2_mm' : 'v3_mm', min: 0, max: 2500,
    palette: CONFIG.rainfallPalette, unit: 'Mean annual rainfall (mm/year)'};
  if (name === 'Difference in mm/year') return {band: 'difference_mm', min: -300, max: 300,
    palette: CONFIG.differencePalette, unit: 'v3 − v2 (mm/year); brown < 0, teal > 0'};
  if (name === 'Difference in percent') return {band: 'relative_pct', min: -40, max: 40,
    palette: CONFIG.differencePalette, unit: '100 × (v3 − v2) / v2 (%)'};
  if (name === 'Mean elevation') return {band: 'elevation_class', min: 0, max: 6,
    palette: CONFIG.elevationPalette, categories: CONFIG.elevationLabels, unit: 'Cell-mean elevation'};
  return {band: 'region_id', min: 1, max: 5, palette: CONFIG.regionPalette,
    categories: REGION_NAMES, unit: 'Regions used in this comparison'};
}

function drawLegend(panel, name, spec) {
  panel.clear().add(label(name, true)).add(label(spec.unit));
  if (spec.categories) {
    spec.categories.forEach(function(text, i) {
      panel.add(ui.Panel([ui.Label(' ', {backgroundColor: '#' + spec.palette[i], padding: '7px', margin: '2px 8px 2px 0'}),
        label(text)], ui.Panel.Layout.flow('horizontal')));
    });
  } else {
    panel.add(ui.Thumbnail({image: ee.Image.pixelLonLat().select('longitude'),
      params: {bbox: [0, 0, 1, 0.1], dimensions: '240x14', min: 0, max: 1, palette: spec.palette},
      style: {width: '240px', height: '14px', margin: '4px 0'}}));
    panel.add(label(spec.min + '                         ' + spec.max));
  }
  panel.add(label('Grey = no displayed value / excluded cell'));
  if (spec.band === 'relative_pct') panel.add(label('Dry-cell threshold: ' + state.threshold + ' mm/year'));
}

function renderMaps() {
  if (!state.image) return;
  [leftMap, rightMap].forEach(function(map, i) {
    var name = (i === 0 ? leftSelect : rightSelect).getValue();
    var spec = layerSpec(name);
    var background = ee.Image(1).clipToCollection(ctx.countries).setDefaultProjection(ctx.grid);
    map.layers().reset([
      ui.Map.Layer(background, {min: 0, max: 1, palette: ['dddddd', 'dddddd']}, 'Excluded or undisplayed land'),
      ui.Map.Layer(state.image.select(spec.band), {min: spec.min, max: spec.max, palette: spec.palette}, name)
    ]);
    if (borders.getValue()) map.layers().add(ui.Map.Layer(
      ee.Image().byte().paint(ctx.countries, 1, 1), {palette: ['666666']}, 'Boundaries'));
    if (state.point) map.layers().add(ui.Map.Layer(ee.Geometry.Point(state.point), {color: '202020'}, 'Inspected location'));
    drawLegend(i === 0 ? leftLegend : rightLegend, name, spec);
  });
}

function setBusy(busy) {
  state.busy = busy;
  [applyButton, summaryButton, regionButton, elevationButton].forEach(function(button) {
    button.setDisabled(busy || !state.ready);
  });
  historyButton.setDisabled(busy || !state.point);
}

/** One expensive request at a time; stale responses never replace newer results. */
function request(object, message, callback) {
  var revision = state.revision;
  setBusy(true); status.setValue(message);
  object.evaluate(function(value, error) {
    setBusy(false);
    if (revision !== state.revision) return;
    if (error) {
      status.setValue('Earth Engine request failed: ' + error +
        (CONFIG.preparedAsset ? '\nRetry the calculation. If access is denied, check the prepared asset permissions.' :
          '\nFor a timeout or memory error, use Prepare_CHIRPS_Asset.js and CONFIG.preparedAsset.'));
      return;
    }
    try { callback(value); status.setValue('Calculation complete for ' + state.first + '–' + state.last + '.'); }
    catch (e) { status.setValue('Could not interpret the result: ' + e.message); }
  });
}

function calculateSummary() {
  resultsPanel.clear();
  request(areaSummary(ctx, state.image), 'Calculating exact area-weighted means…', function(sums) {
    var s = summarizeSums(sums.v2_area, sums.v3_area, sums.area, sums.wetter_area);
    if (!s) { resultsPanel.add(label('No complete cells in this selection.')); return; }
    resultsPanel.add(heading('Selected-area results'));
    resultsPanel.add(label('v2: ' + fmt(s.v2, 1) + ' mm/year\nv3: ' + fmt(s.v3, 1) +
      ' mm/year\nDifference: ' + fmt(s.difference, 1) + ' mm/year\nRelative difference: ' + fmt(s.relative, 2) +
      '%\nRepresented area: ' + fmt(s.areaKm2, 0) + ' km²\nArea wetter in v3: ' + fmt(s.wetterPct, 1) + '%', true));
    resultsPanel.add(ui.Chart([['Version', 'Rainfall (mm/year)'], ['v2', s.v2], ['v3', s.v3]],
      'ColumnChart', {title: 'Area-weighted mean annual rainfall', legend: {position: 'none'},
        colors: [TEAL], vAxis: {title: 'mm/year', viewWindow: {min: 0}}, height: 240}));
    if (state.first === 1981 && state.last === 2025 && state.region === 'Africa' && state.elevation === null) {
      resultsPanel.add(label('Report check: v2 676.2; v3 727.8 mm/year; difference 7.63%. Minor last-digit differences can arise from rounding or catalog revisions.'));
    }
  });
}

function calculateGroups(band) {
  resultsPanel.clear();
  var regional = band === 'region_id';
  var image = comparisonImage(ctx, state.first, state.last, regional ? 'Africa' : state.region,
    regional ? state.elevation : null, state.threshold);
  request(groupedSummary(ctx, image, band), 'Calculating ' + (regional ? 'regional' : 'elevation') + ' summaries…', function(value) {
    var groups = value.groups || [];
    if (!groups.length) { resultsPanel.add(label('No complete cells in these groups.')); return; }
    groups.sort(function(a, b) { return a.class_id - b.class_id; });
    var rainfall = [['Group', 'v2', 'v3']];
    var relative = [['Group', 'Difference (%)']];
    var table = [['Group', 'v2 (mm/year)', 'v3 (mm/year)', 'Difference (mm/year)', 'Difference (%)', 'Area (km²)']];
    groups.forEach(function(group) {
      var s = summarizeSums(group.sum[0], group.sum[1], group.sum[2], group.sum[3]);
      if (!s) return;
      var name = regional ? REGION_NAMES[group.class_id - 1] : CONFIG.elevationLabels[group.class_id];
      rainfall.push([name, s.v2, s.v3]); relative.push([name, s.relative]);
      table.push([name, s.v2, s.v3, s.difference, s.relative, s.areaKm2]);
    });
    resultsPanel.add(heading(regional ? 'Five regions' : 'Elevation in ' + state.region));
    resultsPanel.add(label(regional ? 'All regions; selected elevation filter retained.' :
      'All elevation bands; selected region retained.'));
    resultsPanel.add(ui.Chart(rainfall, 'ColumnChart', {title: 'Mean annual rainfall', colors: [BLUE, ORANGE],
      legend: {position: 'top'}, vAxis: {title: 'mm/year', viewWindow: {min: 0}}, height: 300,
      hAxis: {slantedText: true, slantedTextAngle: 40}}));
    resultsPanel.add(ui.Chart(relative, 'BarChart', {title: 'Difference relative to v2', colors: [TEAL],
      legend: {position: 'none'}, hAxis: {title: '%'}, height: 280}));
    resultsPanel.add(ui.Chart(table, 'Table', {width: '100%', height: 250, page: 'enable', pageSize: 7}));
    resultsPanel.add(label('Use each chart’s menu to download the numbers. Small high-elevation areas need cautious interpretation; this explorer does not calculate uncertainty intervals.'));
  });
}

function clicked(coordinates) {
  if (!state.ready || state.busy) return;
  state.point = null; historyButton.setDisabled(true); pointPanel.clear();
  renderMaps(); // Remove the previous marker even if the new location is excluded.
  var lon = coordinates.lon; var lat = coordinates.lat;
  request(inspectPoint(ctx, state.image, lon, lat), 'Reading the containing rainfall cell…', function(p) {
    if (typeof p.v2_mm !== 'number') { pointPanel.add(label('No complete cell in the current selection at this location.')); return; }
    state.point = [lon, lat]; historyButton.setDisabled(false); renderMaps();
    pointPanel.add(label('Clicked ' + fmt(lon, 4) + '°, ' + fmt(lat, 4) + '°\n' +
      REGION_NAMES[Math.round(p.region_id) - 1] + ' | mean elevation ' + fmt(p.elev_m, 0) + ' m', true));
    pointPanel.add(label('v2: ' + fmt(p.v2_mm, 1) + '; v3: ' + fmt(p.v3_mm, 1) + ' mm/year\n' +
      'Difference: ' + fmt(p.difference_mm, 1) + ' mm/year\n' +
      'Pixel percentage: ' + fmt(p.relative_pct, 1) + (p.relative_pct === undefined || p.relative_pct === null ? '' : '%')));
    pointPanel.add(label('Values describe the native rainfall cell, not a rain gauge or an individual slope.'));
  });
}
leftMap.onClick(clicked); rightMap.onClick(clicked);

function showPointHistory() {
  if (!state.point) return;
  request(pointHistory(ctx, state.point[0], state.point[1]), 'Calculating 45 annual values at this cell…', function(value) {
    var data = [['Year', 'v2', 'v3']];
    for (var y = CONFIG.firstYear; y <= CONFIG.lastYear; y++) data.push([y, value['v2_' + y], value['v3_' + y]]);
    var options = {};
    Object.keys(chartOptions).forEach(function(key) { options[key] = chartOptions[key]; });
    options.title = 'This cell: annual totals, 1981–2025'; options.height = 270;
    options.hAxis = {title: 'Year', format: '####'}; options.vAxis = {title: 'mm/year'};
    pointPanel.add(ui.Chart(data, 'LineChart', options));
  });
}

catalogMetadata(ctx).evaluate(function(metadata, error) {
  if (error) { status.setValue('Startup check failed: ' + error +
    '\nCheck your Earth Engine project and access to the prepared asset. See the supplied README for another account.'); return; }
  try {
    checkCatalogMetadata(metadata); state.ready = true; setBusy(false); applySelection();
    print('Archive and grid checks passed: 3240 paired final pentads per version.', metadata);
    print('Area weighting: sum(rainfall * pixelArea) / sum(pixelArea). Native transform:', CONFIG.transform);
  } catch (e) { status.setValue('Stopped: ' + e.message); }
});
