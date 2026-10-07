/****
 * CHIRPS v2 vs CHIRPS v3 Comparison App
 * Google Earth Engine JavaScript
 *
 * Purpose
 * -------
 * Interactive comparison of CHIRPS v2 Daily and CHIRPS v3 Daily Reanalysis
 * over one of three AOI modes:
 *   1) Draw polygon/rectangle (default)
 *   2) HydroBASINS level + basin selection (click or HYBAS_ID)
 *   3) Continent selection from FAO GAUL 2025
 *
 * Main diagnostics
 * ----------------
 * - Side-by-side maps (v2 on left; v3/difference diagnostic on right)
 * - Selected precipitation statistic
 * - Absolute and relative spatial differences
 * - Pixel-wise monthly MAE and RMSE
 * - Area-weighted monthly time series
 * - Annual totals
 * - Monthly climatology
 * - Monthly v2-v3 scatter with linear fit / R²
 * - Summary metrics: bias, MAE, RMSE, correlation, PBIAS
 * - Adaptive systematic spatial sampling with per-point metric table
 * - Per-sample Bias, MAE, RMSE, PBIAS, r, R², NSE and KGE
 *
 * Important comparability safeguards
 * ----------------------------------
 * - Spatial analysis is restricted to the common CHIRPS v2/v3 latitude
 *   footprint: 50°S to 50°N. CHIRPS v3 extends farther poleward.
 * - Temporal analysis is automatically clipped to the dates available in
 *   BOTH collections, so one version is never summed over extra days.
 *
 * Dataset IDs
 * -----------
 * v2: UCSB-CHG/CHIRPS/DAILY
 * v3: UCSB-CHC/CHIRPS/V3/DAILY_RNL
 * HydroBASINS: WWF/HydroSHEDS/v1/Basins/hybas_[1..12]
 * Continents: FAO/GAUL_SIMPLIFIED_500m/2025/level1 (CONTINENT field)
 ****/

// -----------------------------------------------------------------------------
// 0. DATA AND GLOBAL SETTINGS
// -----------------------------------------------------------------------------

var CHIRPS_V2 = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .select('precipitation');

var CHIRPS_V3 = ee.ImageCollection('UCSB-CHC/CHIRPS/V3/DAILY_RNL')
  .select('precipitation');

var GAUL1_2025 = ee.FeatureCollection(
  'FAO/GAUL_SIMPLIFIED_500m/2025/level1'
);

// CHIRPS v2 is limited to 50°S–50°N. Use the common domain for fair metrics.
var COMMON_DOMAIN = ee.Geometry.Rectangle([-180, -50, 180, 50], null, false);

var V2_FIRST = ee.Date(
  CHIRPS_V2.sort('system:time_start').first().get('system:time_start')
);
var V3_FIRST = ee.Date(
  CHIRPS_V3.sort('system:time_start').first().get('system:time_start')
);
var V2_LAST = ee.Date(
  CHIRPS_V2.sort('system:time_start', false).first().get('system:time_start')
);
var V3_LAST = ee.Date(
  CHIRPS_V3.sort('system:time_start', false).first().get('system:time_start')
);

// Common collection limits, computed dynamically from the collections.
var COMMON_FIRST = ee.Date(
  ee.Number(V2_FIRST.millis()).max(ee.Number(V3_FIRST.millis()))
);
var COMMON_LAST_EXCLUSIVE = ee.Date(
  ee.Number(V2_LAST.millis()).min(ee.Number(V3_LAST.millis()))
).advance(1, 'day');

var NATIVE_SCALE = 5566;
var TILE_SCALE = 4;

// Systematic sampling is carried out on the global equal-area EASE-Grid 2.0
// projection. The spacing is adapted to AOI size to approach the requested
// number of samples, but is never finer than the native CHIRPS scale.
var SAMPLE_PROJECTION = ee.Projection('EPSG:6933');

var SAMPLE_TABLE_PROPERTIES = [
  'lon', 'lat',
  'selected_v2', 'selected_v3', 'selected_diff', 'selected_rel_diff_pct',
  'mean_v2_mm_month', 'mean_v3_mm_month',
  'bias_mm_month', 'mae_mm_month', 'rmse_mm_month',
  'pbias_pct', 'pearson_r', 'r2', 'nse', 'kge'
];

var PRECIP_PALETTE = [
  'f7fbff', 'deebf7', 'c6dbef', '9ecae1',
  '6baed6', '4292c6', '2171b5', '08519c', '08306b'
];

var DIFF_PALETTE = [
  '8c2d04', 'cc4c02', 'ec7014', 'fe9929', 'fee391',
  'f7f7f7',
  'c7e9b4', '7fcdbb', '41b6c4', '1d91c0', '225ea8'
];

var ERROR_PALETTE = [
  'ffffe5', 'fff7bc', 'fee391', 'fec44f', 'fe9929',
  'ec7014', 'cc4c02', '993404', '662506'
];

// App state.
var currentAoi = null;
var currentAoiLabel = 'No AOI selected';
var analysisState = null;

// -----------------------------------------------------------------------------
// 1. MAPS AND ROOT LAYOUT
// -----------------------------------------------------------------------------

var leftMap = ui.Map();
var rightMap = ui.Map();
leftMap.setOptions('HYBRID');
rightMap.setOptions('HYBRID');
leftMap.setCenter(20, 0, 2);
rightMap.setCenter(20, 0, 2);

ui.Map.Linker([leftMap, rightMap]);

var leftMapTitle = ui.Label('CHIRPS v2', {
  position: 'top-center',
  padding: '6px 10px',
  backgroundColor: 'rgba(255,255,255,0.85)',
  fontWeight: 'bold'
});
var rightMapTitle = ui.Label('CHIRPS v3', {
  position: 'top-center',
  padding: '6px 10px',
  backgroundColor: 'rgba(255,255,255,0.85)',
  fontWeight: 'bold'
});
leftMap.add(leftMapTitle);
rightMap.add(rightMapTitle);

var mapSplit = ui.SplitPanel({
  firstPanel: leftMap,
  secondPanel: rightMap,
  orientation: 'horizontal',
  wipe: true,
  style: {stretch: 'both'}
});

var sidebar = ui.Panel({
  layout: ui.Panel.Layout.flow('vertical'),
  style: {
    width: '430px',
    padding: '10px',
    stretch: 'vertical'
  }
});

// ui.SplitPanel can only take ui.Map or ui.Panel as its direct children.
// mapSplit is itself a ui.SplitPanel, so do not nest it inside another SplitPanel.
// Instead, make the root a horizontal flow panel containing the fixed-width
// sidebar and the map SplitPanel.
ui.root.clear();
ui.root.setLayout(ui.Panel.Layout.flow('horizontal'));
ui.root.add(sidebar);
ui.root.add(mapSplit);

// -----------------------------------------------------------------------------
// 2. HELPERS
// -----------------------------------------------------------------------------

function sectionTitle(text) {
  return ui.Label(text, {
    fontWeight: 'bold',
    fontSize: '14px',
    margin: '12px 0 5px 0'
  });
}

function smallNote(text) {
  return ui.Label(text, {
    fontSize: '11px',
    color: '666666',
    whiteSpace: 'pre-wrap',
    margin: '2px 0 6px 0'
  });
}

function formatNumber(x, decimals) {
  if (x === null || x === undefined || !isFinite(Number(x))) return 'n/a';
  return Number(x).toFixed(decimals);
}

function setStatus(text, color) {
  statusLabel.setValue(text);
  statusLabel.style().set('color', color || '444444');
}

function safeClientDates() {
  var startText = startDateBox.getValue().trim();
  var endText = endDateBox.getValue().trim();

  var startJs = new Date(startText + 'T00:00:00Z');
  var endJs = new Date(endText + 'T00:00:00Z');

  if (isNaN(startJs.getTime()) || isNaN(endJs.getTime())) {
    return {ok: false, message: 'Dates must use YYYY-MM-DD.'};
  }
  if (startJs.getTime() > endJs.getTime()) {
    return {ok: false, message: 'Start date must be before or equal to end date.'};
  }
  return {
    ok: true,
    startText: startText,
    endText: endText,
    startJs: startJs,
    endJs: endJs
  };
}

function requestedAndEffectiveDates() {
  var d = safeClientDates();
  if (!d.ok) return d;

  var requestedStart = ee.Date(d.startText);
  var requestedEndExclusive = ee.Date(d.endText).advance(1, 'day');

  var effectiveStart = ee.Date(
    ee.Number(requestedStart.millis()).max(ee.Number(COMMON_FIRST.millis()))
  );
  var effectiveEndExclusive = ee.Date(
    ee.Number(requestedEndExclusive.millis())
      .min(ee.Number(COMMON_LAST_EXCLUSIVE.millis()))
  );

  d.requestedStart = requestedStart;
  d.requestedEndExclusive = requestedEndExclusive;
  d.effectiveStart = effectiveStart;
  d.effectiveEndExclusive = effectiveEndExclusive;
  return d;
}

function selectedScale() {
  var lookup = {
    'Native (~5.6 km)': 5566,
    '10 km (faster)': 10000,
    '25 km (fastest)': 25000
  };
  return lookup[scaleSelect.getValue()] || NATIVE_SCALE;
}


function selectedSampleTarget() {
  var lookup = {
    '~250 points': 250,
    '~500 points': 500,
    '~1000 points (default)': 1000,
    '~2000 points': 2000
  };
  return lookup[sampleTargetSelect.getValue()] || 1000;
}

function hydroBasins(level) {
  return ee.FeatureCollection(
    'WWF/HydroSHEDS/v1/Basins/hybas_' + String(level)
  );
}

function resetDrawingLayer() {
  var layers = drawingTools.layers();
  while (layers.length() > 0) {
    layers.remove(layers.get(0));
  }
  drawingTools.addLayer([], 'AOI', '23cba7', true, false);
}

function outlineLayer(geometry, color, width, name) {
  var fc = ee.FeatureCollection([ee.Feature(geometry)]);
  var styled = fc.style({
    color: color,
    fillColor: '00000000',
    width: width
  });
  return ui.Map.Layer(styled, {}, name, true, 1);
}

function previewAoi(aoi, label, center) {
  currentAoi = ee.Geometry(aoi);
  currentAoiLabel = label;
  analysisState = null;

  var fullOutlineLeft = outlineLayer(currentAoi, 'ffffff', 2, 'Selected AOI');
  var fullOutlineRight = outlineLayer(currentAoi, 'ffffff', 2, 'Selected AOI');

  leftMap.layers().reset([fullOutlineLeft]);
  rightMap.layers().reset([fullOutlineRight]);

  leftMapTitle.setValue('CHIRPS v2 — run comparison');
  rightMapTitle.setValue('CHIRPS v3 — run comparison');

  aoiStatusLabel.setValue('AOI: ' + label + ' — ready.');
  setStatus('AOI selected. Configure period/statistic and click RUN.', '2b6f3e');

  if (center) leftMap.centerObject(currentAoi);
}

function getAnalysisAoi() {
  return ee.Geometry(currentAoi).intersection(COMMON_DOMAIN, 1000);
}

function statisticUnits(name) {
  var units = {
    'Mean annual precipitation': 'mm/year',
    'Period total': 'mm',
    'Mean daily precipitation': 'mm/day',
    'Wet-day frequency (>= 1 mm/day)': '% of days',
    'Heavy-rain frequency (>= 20 mm/day)': '% of days',
    '95th percentile daily precipitation': 'mm/day',
    'Maximum daily precipitation': 'mm/day'
  };
  return units[name] || '';
}

function makeStatisticImage(collection, start, endExclusive, statisticName) {
  var c = collection.filterDate(start, endExclusive).select('precipitation');
  var out;

  if (statisticName === 'Mean annual precipitation') {
    var years = endExclusive.difference(start, 'day').divide(365.2425);
    out = c.sum().divide(years);
  } else if (statisticName === 'Period total') {
    out = c.sum();
  } else if (statisticName === 'Mean daily precipitation') {
    out = c.mean();
  } else if (statisticName === 'Wet-day frequency (>= 1 mm/day)') {
    out = c.map(function(img) {
      return img.gte(1).rename('precipitation');
    }).mean().multiply(100);
  } else if (statisticName === 'Heavy-rain frequency (>= 20 mm/day)') {
    out = c.map(function(img) {
      return img.gte(20).rename('precipitation');
    }).mean().multiply(100);
  } else if (statisticName === '95th percentile daily precipitation') {
    out = c.reduce(ee.Reducer.percentile([95]));
  } else if (statisticName === 'Maximum daily precipitation') {
    out = c.max();
  } else {
    out = c.sum();
  }

  return ee.Image(out).rename('value');
}

function fixedVisForStatistic(statisticName, clientDates) {
  var years = Math.max(
    1 / 365.2425,
    (clientDates.endJs.getTime() - clientDates.startJs.getTime() + 86400000) /
      (365.2425 * 86400000)
  );

  if (statisticName === 'Mean annual precipitation') {
    return {mainMax: 3000, diffMax: 500};
  }
  if (statisticName === 'Period total') {
    return {mainMax: 3000 * years, diffMax: 500 * years};
  }
  if (statisticName === 'Mean daily precipitation') {
    return {mainMax: 10, diffMax: 2};
  }
  if (statisticName === 'Wet-day frequency (>= 1 mm/day)') {
    return {mainMax: 80, diffMax: 20};
  }
  if (statisticName === 'Heavy-rain frequency (>= 20 mm/day)') {
    return {mainMax: 20, diffMax: 10};
  }
  if (statisticName === '95th percentile daily precipitation') {
    return {mainMax: 50, diffMax: 20};
  }
  if (statisticName === 'Maximum daily precipitation') {
    return {mainMax: 200, diffMax: 100};
  }
  return {mainMax: 3000, diffMax: 500};
}

function makeMonthlyPairs(start, endExclusive) {
  var firstMonth = ee.Date.fromYMD(
    ee.Number(start.get('year')),
    ee.Number(start.get('month')),
    1
  );

  var lastIncluded = endExclusive.advance(-1, 'day');
  var afterLastMonth = ee.Date.fromYMD(
    ee.Number(lastIncluded.get('year')),
    ee.Number(lastIncluded.get('month')),
    1
  ).advance(1, 'month');

  var nMonths = afterLastMonth.difference(firstMonth, 'month').round();
  var indices = ee.List.sequence(0, nMonths.subtract(1));

  var imgs = indices.map(function(i) {
    i = ee.Number(i);
    var monthStart = firstMonth.advance(i, 'month');
    var monthEnd = monthStart.advance(1, 'month');

    var s = ee.Date(ee.Algorithms.If(
      monthStart.millis().gt(start.millis()), monthStart, start
    ));
    var e = ee.Date(ee.Algorithms.If(
      monthEnd.millis().lt(endExclusive.millis()), monthEnd, endExclusive
    ));

    var c2 = CHIRPS_V2.filterDate(s, e);
    var c3 = CHIRPS_V3.filterDate(s, e);

    var v2 = c2.sum().rename('v2');
    var v3 = c3.sum().rename('v3');

    return v2.addBands(v3).set({
      'system:time_start': monthStart.millis(),
      'year': monthStart.get('year'),
      'month': monthStart.get('month'),
      'days_v2': c2.size(),
      'days_v3': c3.size()
    });
  });

  return ee.ImageCollection.fromImages(imgs);
}

function areaWeightedPair(image, region, scale) {
  var area = ee.Image.pixelArea();
  var v2 = image.select('v2');
  var v3 = image.select('v3');

  // Enforce an identical valid-pixel footprint for both versions.
  var commonMask = v2.mask().and(v3.mask());
  v2 = v2.updateMask(commonMask);
  v3 = v3.updateMask(commonMask);
  var validArea = area.updateMask(commonMask).rename('validArea');

  var stack = v2.multiply(area).rename('v2w')
    .addBands(v3.multiply(area).rename('v3w'))
    .addBands(validArea);

  var sums = stack.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: region,
    scale: scale,
    maxPixels: 1e13,
    tileScale: TILE_SCALE
  });

  var denominator = ee.Number(sums.get('validArea'));
  var v2Mean = ee.Number(sums.get('v2w')).divide(denominator);
  var v3Mean = ee.Number(sums.get('v3w')).divide(denominator);

  return ee.Dictionary({v2: v2Mean, v3: v3Mean});
}

function monthlyFeatureSeries(monthlyImages, region, scale) {
  return ee.FeatureCollection(monthlyImages.map(function(img) {
    img = ee.Image(img);
    var m = areaWeightedPair(img, region, scale);
    var v2 = ee.Number(m.get('v2'));
    var v3 = ee.Number(m.get('v3'));
    var d = v3.subtract(v2);

    return ee.Feature(null, {
      'system:time_start': img.get('system:time_start'),
      year: img.get('year'),
      month: img.get('month'),
      v2: v2,
      v3: v3,
      diff: d,
      absDiff: d.abs(),
      sqDiff: d.pow(2),
      days_v2: img.get('days_v2'),
      days_v3: img.get('days_v3')
    });
  }));
}

function makeAnnualSeries(monthlyFeatures) {
  var years = ee.List(monthlyFeatures.aggregate_array('year')).distinct().sort();
  return ee.FeatureCollection(years.map(function(y) {
    y = ee.Number(y);
    var sub = monthlyFeatures.filter(ee.Filter.eq('year', y));
    var v2 = ee.Number(sub.aggregate_sum('v2'));
    var v3 = ee.Number(sub.aggregate_sum('v3'));
    return ee.Feature(null, {
      year: y,
      v2: v2,
      v3: v3,
      diff: v3.subtract(v2),
      nMonths: sub.size()
    });
  }));
}

function makeClimatology(monthlyFeatures) {
  var months = ee.List.sequence(1, 12);
  return ee.FeatureCollection(months.map(function(m) {
    m = ee.Number(m);
    var sub = monthlyFeatures.filter(ee.Filter.eq('month', m));
    return ee.Feature(null, {
      month: m,
      v2: sub.aggregate_mean('v2'),
      v3: sub.aggregate_mean('v3'),
      diff: sub.aggregate_mean('diff')
    });
  }));
}


function makeSampleMetricImage(monthlyImages, statV2, statV3, diff, relDiff) {
  // Ensure every monthly pair uses the same valid-pixel mask for v2 and v3.
  var paired = monthlyImages.map(function(img) {
    img = ee.Image(img);
    var commonMask = img.select('v2').mask().and(img.select('v3').mask());
    return img.select(['v2', 'v3']).updateMask(commonMask)
      .copyProperties(img, ['system:time_start', 'year', 'month']);
  });

  var meanV2 = paired.select('v2').mean().rename('mean_v2_mm_month');
  var meanV3 = paired.select('v3').mean().rename('mean_v3_mm_month');
  var sdV2 = paired.select('v2').reduce(ee.Reducer.stdDev())
    .rename('sd_v2_mm_month');
  var sdV3 = paired.select('v3').reduce(ee.Reducer.stdDev())
    .rename('sd_v3_mm_month');

  var diffs = paired.map(function(img) {
    img = ee.Image(img);
    return img.select('v3').subtract(img.select('v2')).rename('d')
      .copyProperties(img, ['system:time_start']);
  });

  var bias = diffs.mean().rename('bias_mm_month');
  var mae = diffs.map(function(img) {
    return ee.Image(img).abs().rename('abs_d');
  }).mean().rename('mae_mm_month');
  var sse = diffs.map(function(img) {
    return ee.Image(img).pow(2).rename('sq_d');
  }).sum().rename('sse');
  var rmse = sse.divide(ee.Number(paired.size())).sqrt()
    .rename('rmse_mm_month');

  var sumV2 = paired.select('v2').sum();
  var sumDiff = diffs.sum();
  var pbias = sumDiff.divide(sumV2).multiply(100)
    .updateMask(sumV2.abs().gt(1e-6))
    .rename('pbias_pct');

  // Multi-input reducer: output bands are correlation and p-value.
  var corrResult = paired.select(['v2', 'v3'])
    .reduce(ee.Reducer.pearsonsCorrelation());
  var r = corrResult.select([0], ['pearson_r']);
  var pValue = corrResult.select([1], ['pearson_p_value']);
  var r2 = r.pow(2).rename('r2');

  // NSE, using CHIRPS v2 as the reference series.
  var sstV2 = paired.map(function(img) {
    img = ee.Image(img);
    return img.select('v2').subtract(meanV2).pow(2).rename('sq_dev_v2');
  }).sum();
  var nse = ee.Image.constant(1).subtract(sse.divide(sstV2))
    .updateMask(sstV2.gt(1e-9))
    .rename('nse');

  // KGE (2009 formulation): r, variability ratio alpha, bias ratio beta.
  var alpha = sdV3.divide(sdV2).updateMask(sdV2.gt(1e-9));
  var beta = meanV3.divide(meanV2).updateMask(meanV2.abs().gt(1e-9));
  var kge = ee.Image.constant(1).subtract(
    r.subtract(1).pow(2)
      .add(alpha.subtract(1).pow(2))
      .add(beta.subtract(1).pow(2))
      .sqrt()
  ).rename('kge');

  return statV2.rename('selected_v2')
    .addBands(statV3.rename('selected_v3'))
    .addBands(diff.rename('selected_diff'))
    .addBands(relDiff.rename('selected_rel_diff_pct'))
    .addBands(meanV2)
    .addBands(meanV3)
    .addBands(sdV2)
    .addBands(sdV3)
    .addBands(bias)
    .addBands(mae)
    .addBands(rmse)
    .addBands(pbias)
    .addBands(r)
    .addBands(pValue)
    .addBands(r2)
    .addBands(nse)
    .addBands(kge);
}

function makeSystematicSampleTable(
  analysisAoi, monthlyImages, statV2, statV3, diff, relDiff
) {
  var target = selectedSampleTarget();
  var areaM2 = analysisAoi.area(1000);

  // For a square grid, sqrt(area / N) is the nominal spacing needed for ~N
  // cells. Irregular boundaries mean the actual number will differ slightly.
  var spacingM = areaM2.divide(target).sqrt().max(NATIVE_SCALE);

  var metricImage = makeSampleMetricImage(
    monthlyImages, statV2, statV3, diff, relDiff
  );

  // Image.sample() without factor/numPixels samples every pixel of the requested
  // projection/scale. Using EPSG:6933 therefore produces a regular equal-area
  // grid of sample centers instead of a random sample.
  var samples = metricImage.sample({
    region: analysisAoi,
    projection: SAMPLE_PROJECTION,
    scale: spacingM,
    dropNulls: false,
    tileScale: TILE_SCALE,
    geometries: true
  }).filter(ee.Filter.notNull([
    'mean_v2_mm_month', 'mean_v3_mm_month',
    'bias_mm_month', 'mae_mm_month', 'rmse_mm_month'
  ])).map(function(f) {
    f = ee.Feature(f);
    var xy = ee.List(f.geometry().coordinates());
    var lon = ee.Number(xy.get(0));
    var lat = ee.Number(xy.get(1));
    var id = ee.String('P_')
      .cat(lat.format('%.4f')).cat('_').cat(lon.format('%.4f'));

    return f.set({
      sample_id: id,
      lon: lon,
      lat: lat,
      spacing_km: spacingM.divide(1000),
      target_samples: target,
      n_months: monthlyImages.size()
    });
  });

  return {
    table: samples,
    spacingM: spacingM,
    target: target,
    metricImage: metricImage
  };
}

function samplingPointLayer(samples) {
  return ui.Map.Layer(
    ee.FeatureCollection(samples).style({
      color: 'ff00ff',
      fillColor: 'ff00ff',
      pointSize: 3,
      width: 1
    }),
    {},
    'Systematic sample points',
    true,
    0.9
  );
}

function makeLegend(title, min, max, palette) {
  var panel = ui.Panel({style: {margin: '4px 0 8px 0'}});
  panel.add(ui.Label(title, {fontSize: '11px', fontWeight: 'bold'}));

  var gradient = ee.Image.pixelLonLat().select('longitude')
    .subtract(0).divide(100).multiply(max - min).add(min);

  var thumb = ui.Thumbnail({
    image: gradient.visualize({min: min, max: max, palette: palette}),
    params: {bbox: '0,0,100,10', dimensions: '300x18'},
    style: {stretch: 'horizontal', margin: '2px 0 0 0'}
  });

  panel.add(thumb);
  panel.add(ui.Panel([
    ui.Label(formatNumber(min, 1), {fontSize: '10px'}),
    ui.Label(formatNumber(max, 1), {
      fontSize: '10px',
      textAlign: 'right',
      stretch: 'horizontal'
    })
  ], ui.Panel.Layout.flow('horizontal')));
  return panel;
}

function updateRightMapDisplay() {
  if (!analysisState) return;

  var display = rightDisplaySelect.getValue();
  var image;
  var vis;
  var title;
  var legendTitle;

  if (display === 'CHIRPS v3') {
    image = analysisState.v3;
    vis = analysisState.mainVis;
    title = 'CHIRPS v3 — ' + analysisState.statistic;
    legendTitle = 'Right map: v3 (' + analysisState.units + ')';
  } else if (display === 'Absolute difference (v3 - v2)') {
    image = analysisState.diff;
    vis = analysisState.diffVis;
    title = 'v3 - v2 — ' + analysisState.statistic;
    legendTitle = 'Right map: v3 - v2 (' + analysisState.units + ')';
  } else if (display === 'Relative difference (%)') {
    image = analysisState.relDiff;
    vis = {min: -50, max: 50, palette: DIFF_PALETTE};
    title = 'Relative difference (%)';
    legendTitle = 'Right map: 100 × (v3-v2) / v2 (%)';
  } else if (display === 'Monthly MAE (mm/month)') {
    image = analysisState.monthlyMae;
    vis = {min: 0, max: 50, palette: ERROR_PALETTE};
    title = 'Pixel monthly MAE';
    legendTitle = 'Right map: monthly MAE (mm/month)';
  } else if (display === 'Monthly RMSE (mm/month)') {
    image = analysisState.monthlyRmse;
    vis = {min: 0, max: 75, palette: ERROR_PALETTE};
    title = 'Pixel monthly RMSE';
    legendTitle = 'Right map: monthly RMSE (mm/month)';
  } else {
    image = analysisState.v3;
    vis = analysisState.mainVis;
    title = 'CHIRPS v3';
    legendTitle = 'Right map';
  }

  var aoiFull = outlineLayer(
    analysisState.fullAoi, 'ffffff', 2, 'Selected AOI'
  );
  var aoiCommon = outlineLayer(
    analysisState.analysisAoi, 'ffff00', 2, 'Compared footprint'
  );

  var rightLayers = [
    ui.Map.Layer(image, vis, display, true, 1),
    aoiFull,
    aoiCommon
  ];
  if (analysisState.sampleTable &&
      (!showSamplesCheckbox || showSamplesCheckbox.getValue())) {
    rightLayers.push(samplingPointLayer(analysisState.sampleTable));
  }
  rightMap.layers().reset(rightLayers);
  rightMapTitle.setValue(title);

  legendPanel.widgets().reset([
    makeLegend(
      'Left map: CHIRPS v2 (' + analysisState.units + ')',
      analysisState.mainVis.min,
      analysisState.mainVis.max,
      analysisState.mainVis.palette
    ),
    makeLegend(
      legendTitle,
      vis.min,
      vis.max,
      vis.palette
    )
  ]);
}


function updateLeftMapDisplay() {
  if (!analysisState) return;

  var layers = [
    ui.Map.Layer(
      analysisState.v2,
      analysisState.mainVis,
      'CHIRPS v2',
      true,
      1
    ),
    outlineLayer(analysisState.fullAoi, 'ffffff', 2, 'Selected AOI'),
    outlineLayer(analysisState.analysisAoi, 'ffff00', 2, 'Compared footprint')
  ];

  if (analysisState.sampleTable &&
      (!showSamplesCheckbox || showSamplesCheckbox.getValue())) {
    layers.push(samplingPointLayer(analysisState.sampleTable));
  }

  leftMap.layers().reset(layers);
  leftMapTitle.setValue('CHIRPS v2 — ' + analysisState.statistic);
}

// -----------------------------------------------------------------------------
// 3. AOI CONTROLS
// -----------------------------------------------------------------------------

sidebar.add(ui.Label('CHIRPS v2 ↔ v3 Comparison', {
  fontWeight: 'bold',
  fontSize: '20px',
  margin: '0 0 2px 0'
}));
sidebar.add(smallNote(
  'Interactive comparison of CHIRPS v2 Daily and CHIRPS v3 Daily Reanalysis. ' +
  'Metrics use only dates and spatial coverage common to both versions.'
));

sidebar.add(sectionTitle('1. Area of interest'));

var aoiModeSelect = ui.Select({
  items: ['Draw polygon / rectangle', 'HydroBASINS', 'Continent'],
  value: 'Draw polygon / rectangle',
  style: {stretch: 'horizontal'}
});
sidebar.add(aoiModeSelect);

var aoiStatusLabel = smallNote(
  'AOI: draw a polygon or rectangle on the LEFT map.'
);
sidebar.add(aoiStatusLabel);

// Drawing tools.
var drawingTools = leftMap.drawingTools();
drawingTools.setShown(true);
drawingTools.setDrawModes(['polygon', 'rectangle']);
resetDrawingLayer();

var drawPolygonButton = ui.Button({
  label: 'Draw polygon',
  onClick: function() {
    resetDrawingLayer();
    currentAoi = null;
    analysisState = null;
    drawingTools.setShape('polygon');
    drawingTools.draw();
    aoiStatusLabel.setValue('AOI: draw polygon on the LEFT map.');
  },
  style: {stretch: 'horizontal'}
});

var drawRectangleButton = ui.Button({
  label: 'Draw rectangle',
  onClick: function() {
    resetDrawingLayer();
    currentAoi = null;
    analysisState = null;
    drawingTools.setShape('rectangle');
    drawingTools.draw();
    aoiStatusLabel.setValue('AOI: draw rectangle on the LEFT map.');
  },
  style: {stretch: 'horizontal'}
});

var clearDrawingButton = ui.Button({
  label: 'Clear drawing',
  onClick: function() {
    resetDrawingLayer();
    currentAoi = null;
    currentAoiLabel = 'No AOI selected';
    analysisState = null;
    leftMap.layers().reset([]);
    rightMap.layers().reset([]);
    aoiStatusLabel.setValue('AOI: draw a polygon or rectangle on the LEFT map.');
    setStatus('AOI cleared.', '666666');
  }
});

var drawPanel = ui.Panel([
  ui.Panel([drawPolygonButton, drawRectangleButton], ui.Panel.Layout.flow('horizontal')),
  clearDrawingButton
]);
sidebar.add(drawPanel);

function syncDrawnAoi() {
  if (aoiModeSelect.getValue() !== 'Draw polygon / rectangle') return;
  var layers = drawingTools.layers();
  if (layers.length() === 0 || layers.get(0).geometries().length() === 0) return;
  var geom = layers.get(0).getEeObject();
  drawingTools.setShape(null);
  previewAoi(geom, 'Drawn geometry', false);
}

drawingTools.onDraw(syncDrawnAoi);
drawingTools.onEdit(ui.util.debounce(syncDrawnAoi, 500));

// HydroBASINS controls.
var basinLevelSelect = ui.Select({
  items: ['1','2','3','4','5','6','7','8','9','10','11','12'],
  value: '4',
  style: {width: '90px'}
});
var basinIdBox = ui.Textbox({
  placeholder: 'Optional HYBAS_ID',
  style: {stretch: 'horizontal'}
});
var useBasinIdButton = ui.Button({
  label: 'Use HYBAS_ID',
  onClick: function() {
    var raw = basinIdBox.getValue().trim();
    var id = Number(raw);
    if (!raw || !isFinite(id)) {
      setStatus('Enter a numeric HYBAS_ID.', 'a33a2b');
      return;
    }
    var level = Number(basinLevelSelect.getValue());
    var fc = hydroBasins(level).filter(ee.Filter.eq('HYBAS_ID', id));
    fc.size().evaluate(function(n, err) {
      if (err || !n) {
        setStatus('HYBAS_ID not found at HydroBASINS level ' + level + '.', 'a33a2b');
        return;
      }
      var f = ee.Feature(fc.first());
      previewAoi(f.geometry(), 'HydroBASINS L' + level + ' — ' + raw, true);
    });
  },
  style: {stretch: 'horizontal'}
});

var basinPanel = ui.Panel([
  ui.Panel([
    ui.Label('Level', {width: '50px'}), basinLevelSelect
  ], ui.Panel.Layout.flow('horizontal')),
  smallNote('Then click a basin on the LEFT map, or enter its HYBAS_ID below.'),
  ui.Panel([basinIdBox, useBasinIdButton], ui.Panel.Layout.flow('horizontal'))
]);
basinPanel.style().set('shown', false);
sidebar.add(basinPanel);

leftMap.onClick(function(coords) {
  if (aoiModeSelect.getValue() !== 'HydroBASINS') {
    if (analysisState) inspectPixel(coords);
    return;
  }

  var level = Number(basinLevelSelect.getValue());
  var point = ee.Geometry.Point([coords.lon, coords.lat]);
  var hits = hydroBasins(level).filterBounds(point);

  setStatus('Selecting HydroBASINS level ' + level + ' basin…', '444444');
  hits.size().evaluate(function(n, err) {
    if (err || !n) {
      setStatus('No HydroBASINS polygon found at the clicked point.', 'a33a2b');
      return;
    }
    var basin = ee.Feature(hits.sort('SUB_AREA').first());
    basin.get('HYBAS_ID').evaluate(function(id) {
      previewAoi(
        basin.geometry(),
        'HydroBASINS L' + level + ' — HYBAS_ID ' + String(id),
        true
      );
    });
  });
});

// Continent controls.
var continentSelect = ui.Select({
  items: ['Loading continents…'],
  value: 'Loading continents…',
  style: {stretch: 'horizontal'}
});
var useContinentButton = ui.Button({
  label: 'Use selected continent',
  onClick: function() {
    var name = continentSelect.getValue();
    if (!name || name.indexOf('Loading') === 0) {
      setStatus('Continent list is still loading.', 'a33a2b');
      return;
    }

    var fc = GAUL1_2025.filter(ee.Filter.eq('CONTINENT', name));
    var geom = fc.geometry(1000).dissolve(1000);
    previewAoi(geom, 'Continent — ' + name, true);
  },
  style: {stretch: 'horizontal'}
});
var continentPanel = ui.Panel([
  continentSelect,
  useContinentButton,
  smallNote(
    'Source: FAO GAUL 2025 simplified level-1 boundaries, dissolved by CONTINENT.'
  )
]);
continentPanel.style().set('shown', false);
sidebar.add(continentPanel);

GAUL1_2025.aggregate_array('CONTINENT').distinct().sort().evaluate(function(items) {
  if (!items || !items.length) return;
  continentSelect.items().reset(items);
  if (items.indexOf('Africa') >= 0) continentSelect.setValue('Africa', false);
  else continentSelect.setValue(items[0], false);
});

aoiModeSelect.onChange(function(mode) {
  var isDraw = mode === 'Draw polygon / rectangle';
  var isBasin = mode === 'HydroBASINS';
  var isContinent = mode === 'Continent';

  drawPanel.style().set('shown', isDraw);
  basinPanel.style().set('shown', isBasin);
  continentPanel.style().set('shown', isContinent);
  drawingTools.setShown(isDraw);
  resetDrawingLayer();

  currentAoi = null;
  currentAoiLabel = 'No AOI selected';
  analysisState = null;
  leftMap.layers().reset([]);
  rightMap.layers().reset([]);

  if (isDraw) {
    aoiStatusLabel.setValue('AOI: draw a polygon or rectangle on the LEFT map.');
  } else if (isBasin) {
    aoiStatusLabel.setValue('AOI: choose level, then click a basin on the LEFT map.');
  } else {
    aoiStatusLabel.setValue('AOI: select a continent and click the button.');
  }
});

// -----------------------------------------------------------------------------
// 4. TEMPORAL / METRIC CONTROLS
// -----------------------------------------------------------------------------

sidebar.add(sectionTitle('2. Period'));

var periodPresetSelect = ui.Select({
  items: [
    '2011–2025 (default)',
    '2001–2025',
    '1991–2020 climate normal',
    '1981–2025 full historical',
    'Custom'
  ],
  value: '2011–2025 (default)',
  style: {stretch: 'horizontal'}
});
sidebar.add(periodPresetSelect);

var startDateBox = ui.Textbox({value: '2011-01-01', placeholder: 'YYYY-MM-DD'});
var endDateBox = ui.Textbox({value: '2025-12-31', placeholder: 'YYYY-MM-DD'});
sidebar.add(ui.Panel([
  ui.Label('Start', {width: '45px'}), startDateBox,
  ui.Label('End', {width: '35px'}), endDateBox
], ui.Panel.Layout.flow('horizontal')));

periodPresetSelect.onChange(function(v) {
  if (v === '2011–2025 (default)') {
    startDateBox.setValue('2011-01-01');
    endDateBox.setValue('2025-12-31');
  } else if (v === '2001–2025') {
    startDateBox.setValue('2001-01-01');
    endDateBox.setValue('2025-12-31');
  } else if (v === '1991–2020 climate normal') {
    startDateBox.setValue('1991-01-01');
    endDateBox.setValue('2020-12-31');
  } else if (v === '1981–2025 full historical') {
    startDateBox.setValue('1981-01-01');
    endDateBox.setValue('2025-12-31');
  }
});

sidebar.add(smallNote(
  'The app automatically clips the requested dates to the common temporal ' +
  'availability of v2 and v3.'
));

sidebar.add(sectionTitle('3. Map statistic'));

var statisticSelect = ui.Select({
  items: [
    'Mean annual precipitation',
    'Period total',
    'Mean daily precipitation',
    'Wet-day frequency (>= 1 mm/day)',
    'Heavy-rain frequency (>= 20 mm/day)',
    '95th percentile daily precipitation',
    'Maximum daily precipitation'
  ],
  value: 'Mean annual precipitation',
  style: {stretch: 'horizontal'}
});
sidebar.add(statisticSelect);

var rightDisplaySelect = ui.Select({
  items: [
    'CHIRPS v3',
    'Absolute difference (v3 - v2)',
    'Relative difference (%)',
    'Monthly MAE (mm/month)',
    'Monthly RMSE (mm/month)'
  ],
  value: 'CHIRPS v3',
  style: {stretch: 'horizontal'}
});
sidebar.add(ui.Label('Right map display', {fontSize: '11px'}));
sidebar.add(rightDisplaySelect);
rightDisplaySelect.onChange(updateRightMapDisplay);

var scaleSelect = ui.Select({
  items: ['Native (~5.6 km)', '10 km (faster)', '25 km (fastest)'],
  value: 'Native (~5.6 km)',
  style: {stretch: 'horizontal'}
});
sidebar.add(ui.Label('Regional statistics scale', {fontSize: '11px'}));
sidebar.add(scaleSelect);
sidebar.add(smallNote(
  'Map layers remain at CHIRPS resolution. This setting only controls the ' +
  'regional reductions used for charts and summary metrics.'
));

sidebar.add(sectionTitle('4. Systematic sampling'));

var sampleTargetSelect = ui.Select({
  items: [
    '~250 points',
    '~500 points',
    '~1000 points (default)',
    '~2000 points'
  ],
  value: '~1000 points (default)',
  style: {stretch: 'horizontal'}
});
sidebar.add(ui.Label('Target number of sample locations', {fontSize: '11px'}));
sidebar.add(sampleTargetSelect);

var showSamplesCheckbox = ui.Checkbox({
  label: 'Show systematic sample points on maps',
  value: true,
  onChange: function() {
    if (!analysisState) return;
    updateLeftMapDisplay();
    updateRightMapDisplay();
  }
});
sidebar.add(showSamplesCheckbox);
sidebar.add(smallNote(
  'Sampling uses a regular equal-area grid (EPSG:6933). Grid spacing is ' +
  'adapted to AOI size to approach the target count and is never finer than ' +
  'the native CHIRPS resolution. This is systematic, not random, sampling.'
));

var runButton = ui.Button({
  label: 'RUN COMPARISON',
  style: {
    stretch: 'horizontal',
    fontWeight: 'bold',
    margin: '8px 0 4px 0'
  }
});
sidebar.add(runButton);

var statusLabel = ui.Label('Select an AOI to begin.', {
  whiteSpace: 'pre-wrap',
  color: '666666',
  fontSize: '11px'
});
sidebar.add(statusLabel);

sidebar.add(smallNote(
  'Spatial safeguard: metrics are restricted to 50°S–50°N, the common ' +
  'v2/v3 latitude range. The selected AOI itself is still shown in white; ' +
  'the analyzed footprint is shown in yellow.'
));

// -----------------------------------------------------------------------------
// 5. RESULTS PANELS
// -----------------------------------------------------------------------------

sidebar.add(sectionTitle('5. Summary'));
var summaryPanel = ui.Panel([
  smallNote('Run the comparison to calculate metrics.')
]);
sidebar.add(summaryPanel);

var legendPanel = ui.Panel();
sidebar.add(legendPanel);

sidebar.add(sectionTitle('6. Systematic sample table'));
var samplingPanel = ui.Panel([
  smallNote('Run the comparison to build the systematic sample table.')
]);
sidebar.add(samplingPanel);

sidebar.add(sectionTitle('7. Plots'));
var chartPanel = ui.Panel([
  smallNote('Charts will appear after running the comparison.')
]);
sidebar.add(chartPanel);

sidebar.add(sectionTitle('8. Pixel inspector'));
var pixelPanel = ui.Panel([
  smallNote('After running the comparison, click either map to inspect a CHIRPS pixel.')
]);
sidebar.add(pixelPanel);

function inspectPixel(coords) {
  if (!analysisState || !analysisState.monthlyImages) return;

  var point = ee.Geometry.Point([coords.lon, coords.lat]);
  var inside = analysisState.analysisAoi.contains(point, 1000);

  inside.evaluate(function(ok, err) {
    if (err || !ok) {
      pixelPanel.widgets().reset([
        smallNote('Clicked point is outside the compared footprint.')
      ]);
      return;
    }

    pixelPanel.widgets().reset([
      smallNote('Loading pixel time series at ' +
        coords.lon.toFixed(4) + ', ' + coords.lat.toFixed(4) + ' …')
    ]);

    var pixelSeries = ee.FeatureCollection(
      analysisState.monthlyImages.map(function(img) {
        img = ee.Image(img);
        var values = img.reduceRegion({
          reducer: ee.Reducer.first(),
          geometry: point,
          scale: NATIVE_SCALE,
          maxPixels: 1e6
        });

        var v2 = values.get('v2');
        var v3 = values.get('v3');
        return ee.Feature(null, {
          'system:time_start': img.get('system:time_start'),
          v2: v2,
          v3: v3,
          diff: ee.Algorithms.If(
            ee.Algorithms.IsEqual(v2, null),
            null,
            ee.Algorithms.If(
              ee.Algorithms.IsEqual(v3, null),
              null,
              ee.Number(v3).subtract(ee.Number(v2))
            )
          )
        });
      })
    ).filter(ee.Filter.notNull(['v2', 'v3']));

    var statValues = analysisState.v2.rename('v2')
      .addBands(analysisState.v3.rename('v3'))
      .reduceRegion({
        reducer: ee.Reducer.first(),
        geometry: point,
        scale: NATIVE_SCALE,
        maxPixels: 1e6
      });

    var pointSummary = ee.Dictionary({
      v2: statValues.get('v2'),
      v3: statValues.get('v3')
    });

    pointSummary.evaluate(function(v, valueErr) {
      var header;
      if (valueErr || !v || v.v2 === null || v.v3 === null) {
        header = smallNote(
          'No valid CHIRPS value at ' + coords.lon.toFixed(4) + ', ' +
          coords.lat.toFixed(4)
        );
      } else {
        var dv = Number(v.v3) - Number(v.v2);
        var rp = Math.abs(Number(v.v2)) > 1e-9 ?
          100 * dv / Number(v.v2) : null;
        header = ui.Label(
          'Point ' + coords.lon.toFixed(4) + ', ' + coords.lat.toFixed(4) +
          ' | ' + analysisState.statistic +
          ': v2=' + formatNumber(v.v2, 2) +
          ', v3=' + formatNumber(v.v3, 2) +
          ', Δ=' + formatNumber(dv, 2) +
          ' ' + analysisState.units +
          ', Δ%=' + formatNumber(rp, 2) + '%',
          {fontSize: '11px', fontWeight: 'bold', whiteSpace: 'pre-wrap'}
        );
      }

      var pointChart = ui.Chart.feature.byFeature(
        pixelSeries,
        'system:time_start',
        ['v2', 'v3']
      ).setChartType('LineChart').setOptions({
        title: 'Pixel monthly precipitation',
        hAxis: {title: 'Time', format: 'yyyy'},
        vAxis: {title: 'mm/month'},
        lineWidth: 1.5,
        pointSize: 0,
        legend: {position: 'top'},
        series: {
          0: {labelInLegend: 'CHIRPS v2'},
          1: {labelInLegend: 'CHIRPS v3'}
        }
      });

      var pointDiffChart = ui.Chart.feature.byFeature(
        pixelSeries,
        'system:time_start',
        ['diff']
      ).setChartType('LineChart').setOptions({
        title: 'Pixel monthly difference (v3 - v2)',
        hAxis: {title: 'Time', format: 'yyyy'},
        vAxis: {title: 'mm/month'},
        lineWidth: 1,
        pointSize: 0,
        legend: {position: 'none'}
      });

      pixelPanel.widgets().reset([header, pointChart, pointDiffChart]);
    });
  });
}

rightMap.onClick(function(coords) {
  if (analysisState) inspectPixel(coords);
});

// -----------------------------------------------------------------------------
// 9. CORE ANALYSIS
// -----------------------------------------------------------------------------

function runComparison() {
  if (!currentAoi) {
    setStatus('Select an AOI first.', 'a33a2b');
    return;
  }

  var d = requestedAndEffectiveDates();
  if (!d.ok) {
    setStatus(d.message, 'a33a2b');
    return;
  }

  var statisticName = statisticSelect.getValue();
  var units = statisticUnits(statisticName);
  var scale = selectedScale();

  var analysisAoi = getAnalysisAoi();
  var fullAoi = ee.Geometry(currentAoi);

  // Validate non-empty common spatial footprint before doing heavier work.
  var commonAreaKm2 = analysisAoi.area(1000).divide(1e6);
  setStatus('Checking AOI and common CHIRPS coverage…', '444444');

  commonAreaKm2.evaluate(function(areaKm2, areaErr) {
    if (areaErr || areaKm2 === null || Number(areaKm2) <= 0) {
      setStatus(
        'The selected AOI has no overlap with the common CHIRPS v2/v3 ' +
        'comparison domain (50°S–50°N).',
        'a33a2b'
      );
      return;
    }

    // Validate the common temporal interval.
    ee.Dictionary({
      start: d.effectiveStart.format('YYYY-MM-dd'),
      end: d.effectiveEndExclusive.advance(-1, 'day').format('YYYY-MM-dd'),
      nDays: d.effectiveEndExclusive.difference(d.effectiveStart, 'day')
    }).evaluate(function(dateInfo, dateErr) {
      if (dateErr || !dateInfo || Number(dateInfo.nDays) <= 0) {
        setStatus(
          'The requested dates do not overlap the common v2/v3 temporal coverage.',
          'a33a2b'
        );
        return;
      }

      setStatus('Building maps, monthly diagnostics and charts…', '444444');

      var v2f = CHIRPS_V2.filterDate(d.effectiveStart, d.effectiveEndExclusive);
      var v3f = CHIRPS_V3.filterDate(d.effectiveStart, d.effectiveEndExclusive);

      var statV2 = makeStatisticImage(
        CHIRPS_V2, d.effectiveStart, d.effectiveEndExclusive, statisticName
      ).clip(analysisAoi);
      var statV3 = makeStatisticImage(
        CHIRPS_V3, d.effectiveStart, d.effectiveEndExclusive, statisticName
      ).clip(analysisAoi);

      var diff = statV3.subtract(statV2).rename('value');
      var relDiff = diff.divide(statV2.abs())
        .multiply(100)
        .updateMask(statV2.abs().gt(1e-6))
        .rename('value');

      var monthlyImages = makeMonthlyPairs(
        d.effectiveStart, d.effectiveEndExclusive
      );

      var monthlyDiff = monthlyImages.map(function(img) {
        img = ee.Image(img);
        return img.select('v3').subtract(img.select('v2'))
          .rename('difference')
          .copyProperties(img, ['system:time_start', 'year', 'month']);
      });

      var monthlyMae = monthlyDiff.map(function(img) {
        return ee.Image(img).abs().rename('abs');
      }).mean().rename('value').clip(analysisAoi);

      var monthlyRmse = monthlyDiff.map(function(img) {
        return ee.Image(img).pow(2).rename('sq');
      }).mean().sqrt().rename('value').clip(analysisAoi);

      var systematic = makeSystematicSampleTable(
        analysisAoi, monthlyImages, statV2, statV3, diff, relDiff
      );

      var fixed = fixedVisForStatistic(statisticName, d);
      var mainVis = {
        min: 0,
        max: fixed.mainMax,
        palette: PRECIP_PALETTE
      };
      var diffVis = {
        min: -fixed.diffMax,
        max: fixed.diffMax,
        palette: DIFF_PALETTE
      };

      analysisState = {
        v2: statV2,
        v3: statV3,
        diff: diff,
        relDiff: relDiff,
        monthlyMae: monthlyMae,
        monthlyRmse: monthlyRmse,
        monthlyImages: monthlyImages,
        statistic: statisticName,
        units: units,
        mainVis: mainVis,
        diffVis: diffVis,
        fullAoi: fullAoi,
        analysisAoi: analysisAoi,
        start: d.effectiveStart,
        endExclusive: d.effectiveEndExclusive,
        sampleTable: systematic.table,
        sampleSpacingM: systematic.spacingM,
        sampleTarget: systematic.target
      };

      updateLeftMapDisplay();
      updateRightMapDisplay();

      // Fit both maps to the selected AOI (the linker synchronizes them).
      leftMap.centerObject(fullAoi);

      // Build area-weighted regional monthly time series.
      var monthlyFeatures = monthlyFeatureSeries(
        monthlyImages, analysisAoi, scale
      );
      var annualFeatures = makeAnnualSeries(monthlyFeatures);
      var climatology = makeClimatology(monthlyFeatures);

      // Charts.
      var monthlyChart = ui.Chart.feature.byFeature(
        monthlyFeatures,
        'system:time_start',
        ['v2', 'v3']
      ).setChartType('LineChart').setOptions({
        title: 'Monthly precipitation — area-weighted AOI mean',
        hAxis: {title: 'Time', format: 'yyyy'},
        vAxis: {title: 'mm/month'},
        lineWidth: 1.5,
        pointSize: 0,
        legend: {position: 'top'},
        series: {
          0: {labelInLegend: 'CHIRPS v2'},
          1: {labelInLegend: 'CHIRPS v3'}
        }
      });

      var diffChart = ui.Chart.feature.byFeature(
        monthlyFeatures,
        'system:time_start',
        ['diff']
      ).setChartType('LineChart').setOptions({
        title: 'Monthly difference: v3 - v2',
        hAxis: {title: 'Time', format: 'yyyy'},
        vAxis: {title: 'mm/month'},
        lineWidth: 1,
        pointSize: 0,
        legend: {position: 'none'}
      });

      var annualChart = ui.Chart.feature.byFeature(
        annualFeatures,
        'year',
        ['v2', 'v3']
      ).setChartType('LineChart').setOptions({
        title: 'Annual precipitation totals (partial first/last years possible)',
        hAxis: {title: 'Year', format: '####'},
        vAxis: {title: 'mm/year'},
        lineWidth: 2,
        pointSize: 3,
        legend: {position: 'top'},
        series: {
          0: {labelInLegend: 'CHIRPS v2'},
          1: {labelInLegend: 'CHIRPS v3'}
        }
      });

      var climChart = ui.Chart.feature.byFeature(
        climatology,
        'month',
        ['v2', 'v3']
      ).setChartType('LineChart').setOptions({
        title: 'Mean seasonal cycle',
        hAxis: {
          title: 'Month',
          ticks: [1,2,3,4,5,6,7,8,9,10,11,12]
        },
        vAxis: {title: 'Mean monthly precipitation (mm)'},
        lineWidth: 2,
        pointSize: 4,
        legend: {position: 'top'},
        series: {
          0: {labelInLegend: 'CHIRPS v2'},
          1: {labelInLegend: 'CHIRPS v3'}
        }
      });

      var scatterChart = ui.Chart.feature.byFeature(
        monthlyFeatures,
        'v2',
        ['v3']
      ).setChartType('ScatterChart').setOptions({
        title: 'Monthly agreement: v2 vs v3',
        hAxis: {title: 'CHIRPS v2 (mm/month)'},
        vAxis: {title: 'CHIRPS v3 (mm/month)'},
        pointSize: 3,
        legend: {position: 'none'},
        trendlines: {
          0: {
            showR2: true,
            visibleInLegend: true,
            labelInLegend: 'Linear fit'
          }
        }
      });

      chartPanel.widgets().reset([
        monthlyChart,
        diffChart,
        annualChart,
        climChart,
        scatterChart
      ]);

      // Systematic spatial sample table. The Table chart is paginated and
      // downloadable; it contains the full sample FeatureCollection.
      var sampleTableChart = ui.Chart.feature.byFeature(
        systematic.table,
        'sample_id',
        SAMPLE_TABLE_PROPERTIES
      ).setSeriesNames([
        'Longitude', 'Latitude',
        'v2 selected (' + units + ')',
        'v3 selected (' + units + ')',
        'v3-v2 selected (' + units + ')',
        'Selected relative difference (%)',
        'Mean v2 (mm/month)', 'Mean v3 (mm/month)',
        'Bias (mm/month)', 'MAE (mm/month)', 'RMSE (mm/month)',
        'PBIAS (%)', 'Pearson r', 'R²', 'NSE', 'KGE'
      ]).setChartType('Table').setOptions({
        allowHtml: true,
        showRowNumber: false,
        page: 'enable',
        pageSize: 20,
        sort: 'enable',
        width: '100%',
        height: '420px'
      });

      var pbiasHistogram = ui.Chart.feature.histogram(
        systematic.table, 'pbias_pct', 30
      ).setOptions({
        title: 'Spatial distribution of sample PBIAS',
        hAxis: {title: 'PBIAS (%)'},
        vAxis: {title: 'Number of sample points'},
        legend: {position: 'none'}
      });

      var rmseHistogram = ui.Chart.feature.histogram(
        systematic.table, 'rmse_mm_month', 30
      ).setOptions({
        title: 'Spatial distribution of sample RMSE',
        hAxis: {title: 'RMSE (mm/month)'},
        vAxis: {title: 'Number of sample points'},
        legend: {position: 'none'}
      });

      var exportSampleButton = ui.Button({
        label: 'Create full sample-table CSV export task',
        style: {stretch: 'horizontal'},
        onClick: function() {
          if (!analysisState || !analysisState.sampleTable) {
            setStatus('Run the comparison first.', 'a33a2b');
            return;
          }
          if (typeof Export === 'undefined' || !Export.table) {
            setStatus(
              'Drive export tasks are available in the Earth Engine Code Editor. ' +
              'You can still use the table chart download control.',
              'a33a2b'
            );
            return;
          }
          Export.table.toDrive({
            collection: analysisState.sampleTable,
            description: 'CHIRPS_v2_v3_systematic_sample_metrics',
            fileNamePrefix: 'CHIRPS_v2_v3_systematic_sample_metrics',
            fileFormat: 'CSV',
            selectors: [
              'sample_id', 'lon', 'lat', 'spacing_km', 'target_samples', 'n_months',
              'selected_v2', 'selected_v3', 'selected_diff',
              'selected_rel_diff_pct',
              'mean_v2_mm_month', 'mean_v3_mm_month',
              'sd_v2_mm_month', 'sd_v3_mm_month',
              'bias_mm_month', 'mae_mm_month', 'rmse_mm_month',
              'pbias_pct', 'pearson_r', 'pearson_p_value', 'r2', 'nse', 'kge'
            ]
          });
          setStatus(
            'CSV export task created. Open the Tasks tab and click RUN.',
            '2b6f3e'
          );
        }
      });

      var sampleInfoLabel = smallNote('Calculating systematic sample count…');
      samplingPanel.widgets().reset([
        sampleInfoLabel,
        sampleTableChart,
        exportSampleButton,
        pbiasHistogram,
        rmseHistogram,
        smallNote(
          'Metric definitions: Bias = mean(v3-v2); MAE = mean absolute monthly ' +
          'difference; RMSE gives extra weight to large monthly errors; PBIAS is ' +
          'the cumulative percentage bias relative to v2; r/R² describe temporal ' +
          'agreement; NSE and KGE use v2 as the reference. The first four value ' +
          'columns use the currently selected map statistic.'
        )
      ]);

      ee.Dictionary({
        nSamples: systematic.table.size(),
        spacingKm: systematic.spacingM.divide(1000),
        target: systematic.target
      }).evaluate(function(info, sampleErr) {
        if (sampleErr || !info) {
          sampleInfoLabel.setValue(
            'Sample table created, but sample count/spacing could not be evaluated.'
          );
          return;
        }
        sampleInfoLabel.setValue(
          'Systematic equal-area grid: target ≈ ' + info.target +
          ' points; actual valid points = ' + info.nSamples +
          '; grid spacing ≈ ' + formatNumber(info.spacingKm, 1) + ' km. ' +
          'Actual count differs from the target because the AOI boundary is irregular ' +
          'and spacing is not allowed below the native CHIRPS scale.'
        );
      });

      // Summary metrics.
      var selectedPair = statV2.rename('v2').addBands(statV3.rename('v3'));
      var selectedMeans = areaWeightedPair(selectedPair, analysisAoi, scale);
      var selectedV2Mean = ee.Number(selectedMeans.get('v2'));
      var selectedV3Mean = ee.Number(selectedMeans.get('v3'));
      var selectedDiffMean = selectedV3Mean.subtract(selectedV2Mean);
      var selectedRelMean = ee.Algorithms.If(
        selectedV2Mean.abs().gt(1e-9),
        selectedDiffMean.divide(selectedV2Mean).multiply(100),
        null
      );

      var corr = monthlyFeatures.reduceColumns(
        ee.Reducer.pearsonsCorrelation(), ['v2', 'v3']
      );

      var rmse = ee.Number(monthlyFeatures.aggregate_mean('sqDiff')).sqrt();
      var mae = monthlyFeatures.aggregate_mean('absDiff');
      var meanBias = monthlyFeatures.aggregate_mean('diff');
      var sumV2 = ee.Number(monthlyFeatures.aggregate_sum('v2'));
      var sumDiff = ee.Number(monthlyFeatures.aggregate_sum('diff'));
      var pBias = ee.Algorithms.If(
        sumV2.abs().gt(1e-9),
        sumDiff.divide(sumV2).multiply(100),
        null
      );

      var fullAreaKm2 = fullAoi.area(1000).divide(1e6);
      var comparedAreaKm2 = analysisAoi.area(1000).divide(1e6);
      var coveragePct = comparedAreaKm2.divide(fullAreaKm2).multiply(100);

      var summary = ee.Dictionary({
        requestedStart: d.requestedStart.format('YYYY-MM-dd'),
        requestedEnd: d.requestedEndExclusive.advance(-1, 'day').format('YYYY-MM-dd'),
        effectiveStart: d.effectiveStart.format('YYYY-MM-dd'),
        effectiveEnd: d.effectiveEndExclusive.advance(-1, 'day').format('YYYY-MM-dd'),
        nDaysV2: v2f.size(),
        nDaysV3: v3f.size(),
        nMonths: monthlyFeatures.size(),
        fullAreaKm2: fullAreaKm2,
        comparedAreaKm2: comparedAreaKm2,
        coveragePct: coveragePct,
        selectedV2Mean: selectedV2Mean,
        selectedV3Mean: selectedV3Mean,
        selectedDiffMean: selectedDiffMean,
        selectedRelMean: selectedRelMean,
        monthlyBias: meanBias,
        monthlyMAE: mae,
        monthlyRMSE: rmse,
        correlation: corr.get('correlation'),
        pValue: corr.get('p-value'),
        pBias: pBias
      });

      summary.evaluate(function(s, err) {
        if (err || !s) {
          setStatus('Map layers are ready, but summary reduction failed.', 'a33a2b');
          summaryPanel.widgets().reset([
            smallNote('Summary metrics failed to evaluate. Try a coarser statistics scale.')
          ]);
          return;
        }

        var dateWasClipped =
          s.requestedStart !== s.effectiveStart || s.requestedEnd !== s.effectiveEnd;

        var labels = [
          ui.Label('AOI: ' + currentAoiLabel, {fontWeight: 'bold'}),
          ui.Label(
            'Compared period: ' + s.effectiveStart + ' → ' + s.effectiveEnd +
            (dateWasClipped ? '  (requested range clipped to common availability)' : '')
          ),
          ui.Label(
            'Images/days: v2 = ' + s.nDaysV2 + ', v3 = ' + s.nDaysV3 +
            '; monthly pairs = ' + s.nMonths
          ),
          ui.Label(
            'Selected AOI area: ' + formatNumber(s.fullAreaKm2, 0) + ' km²; ' +
            'compared common-domain area: ' + formatNumber(s.comparedAreaKm2, 0) +
            ' km² (' + formatNumber(s.coveragePct, 1) + '%)'
          ),
          ui.Label(
            'Systematic sampling target: ≈' + systematic.target +
            ' locations (see sample-table section for actual count and spacing).'
          ),
          ui.Label(
            statisticName + ' — AOI area-weighted mean:',
            {fontWeight: 'bold', margin: '6px 0 0 0'}
          ),
          ui.Label(
            '  v2 = ' + formatNumber(s.selectedV2Mean, 2) + ' ' + units +
            ' | v3 = ' + formatNumber(s.selectedV3Mean, 2) + ' ' + units
          ),
          ui.Label(
            '  v3 - v2 = ' + formatNumber(s.selectedDiffMean, 2) + ' ' + units +
            ' | relative = ' + formatNumber(s.selectedRelMean, 2) + '%'
          ),
          ui.Label('Monthly AOI comparison:', {
            fontWeight: 'bold', margin: '6px 0 0 0'
          }),
          ui.Label(
            '  Bias = ' + formatNumber(s.monthlyBias, 2) + ' mm/month' +
            ' | MAE = ' + formatNumber(s.monthlyMAE, 2) + ' mm/month' +
            ' | RMSE = ' + formatNumber(s.monthlyRMSE, 2) + ' mm/month'
          ),
          ui.Label(
            '  Pearson r = ' + formatNumber(s.correlation, 4) +
            ' | PBIAS = ' + formatNumber(s.pBias, 2) + '%'
          ),
          smallNote(
            'Interpretation: bias/PBIAS show systematic wet/dry shifts; MAE/RMSE ' +
            'show typical monthly disagreement; r indicates whether both versions ' +
            'preserve the same month-to-month variability. Spatial MAE/RMSE maps ' +
            'help locate where revisions are concentrated.'
          )
        ];

        summaryPanel.widgets().reset(labels);
        setStatus('Comparison complete.', '2b6f3e');
      });
    });
  });
}

runButton.onClick(runComparison);

// -----------------------------------------------------------------------------
// 10. INITIAL DRAW MODE
// -----------------------------------------------------------------------------

setStatus(
  'Default mode is drawing. Click “Draw polygon” or “Draw rectangle”, ' +
  'draw on the LEFT map, then RUN COMPARISON.',
  '666666'
);

