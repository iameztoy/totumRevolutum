// =======================================================
// Sentinel-1 / OPERA DSWx-S1 monthly image counts
// Future-proof version for Sentinel-1A/B/C/D and OPERA naming changes
// =======================================================


// -----------------------------
// Area and time range
// -----------------------------

var aoi = geometry;

var start = '2014-01-01';
var nMonths = 200;

var startDate = ee.Date(start);
var endDate = startDate.advance(nMonths, 'month');


// -----------------------------
// Collections
// -----------------------------

var rawS1 = ee.ImageCollection('COPERNICUS/S1_GRD');

var operaS1 = ee.ImageCollection('OPERA/DSWX/L3_V1/S1');


// -----------------------------
// Diagnostics
// -----------------------------
//
// These histograms are useful because they show the exact platform names
// currently stored in each collection. If OTHER > 0 in the charts,
// check these histograms and add the new name to the aliases below.

print(
  'Raw Sentinel-1 platform_number histogram, AOI + date range',
  rawS1
    .filterBounds(aoi)
    .filterDate(startDate, endDate)
    .aggregate_histogram('platform_number')
);

print(
  'OPERA DSWx-S1 SPACECRAFT_NAME histogram, AOI + date range',
  operaS1
    .filterBounds(aoi)
    .filterDate(startDate, endDate)
    .aggregate_histogram('SPACECRAFT_NAME')
);


// -----------------------------
// Helper function
// -----------------------------

function getPlatformCount(hist, aliases) {
  aliases = ee.List(aliases);

  return ee.Number(aliases.iterate(function(alias, acc) {
    alias = ee.String(alias);
    acc = ee.Number(acc);
    return acc.add(ee.Number(hist.get(alias, 0)));
  }, 0));
}


// =======================================================
// Raw Sentinel-1 GRD monthly counts
// =======================================================
//
// COPERNICUS/S1_GRD usually stores platform_number as A, B, C, or D.
// S1D is included so the script is ready if/when it appears.

function monthlyRawS1CountFeatures(ic, label) {
  var months = ee.List.sequence(0, nMonths - 1).map(function(i) {
    var s = startDate.advance(i, 'month');
    var e = s.advance(1, 'month');

    var c = ic
      .filterBounds(aoi)
      .filterDate(s, e);

    var hist = ee.Dictionary(c.aggregate_histogram('platform_number'));

    var s1a = getPlatformCount(hist, [
      'A',
      'S1A',
      'Sentinel-1A',
      'SENTINEL-1A'
    ]);

    var s1b = getPlatformCount(hist, [
      'B',
      'S1B',
      'Sentinel-1B',
      'SENTINEL-1B'
    ]);

    var s1c = getPlatformCount(hist, [
      'C',
      'S1C',
      'Sentinel-1C',
      'SENTINEL-1C'
    ]);

    var s1d = getPlatformCount(hist, [
      'D',
      'S1D',
      'Sentinel-1D',
      'SENTINEL-1D'
    ]);

    var total = ee.Number(c.size());
    var known = s1a.add(s1b).add(s1c).add(s1d);
    var other = total.subtract(known);

    return ee.Feature(null, {
      label: label,
      month: s.format('YYYY-MM'),
      total_count: total,
      S1A: s1a,
      S1B: s1b,
      S1C: s1c,
      S1D: s1d,
      OTHER: other
    });
  });

  return ee.FeatureCollection(months);
}


// =======================================================
// OPERA DSWx-S1 monthly counts
// =======================================================
//
// OPERA uses SPACECRAFT_NAME.
// In your current AOI/date range, you found:
//   Sentinel-1:   233
//   Sentinel-1A/B: 1238
//
// This means OPERA currently does not separate S1A and S1B
// in this property for your data. However, the script below is left open:
// if OPERA starts reporting Sentinel-1A, Sentinel-1B, Sentinel-1C,
// Sentinel-1D, or combined C/D categories in the future, those will be counted.

function monthlyOperaS1CountFeatures(ic, label) {
  var months = ee.List.sequence(0, nMonths - 1).map(function(i) {
    var s = startDate.advance(i, 'month');
    var e = s.advance(1, 'month');

    var c = ic
      .filterBounds(aoi)
      .filterDate(s, e);

    var hist = ee.Dictionary(c.aggregate_histogram('SPACECRAFT_NAME'));

    // Generic Sentinel-1, platform not specified.
    var s1Unspecified = getPlatformCount(hist, [
      'Sentinel-1',
      'SENTINEL-1',
      'S1'
    ]);

    // Separate satellites, if OPERA reports them in the future.
    var s1a = getPlatformCount(hist, [
      'Sentinel-1A',
      'SENTINEL-1A',
      'Sentinel-1 A',
      'SENTINEL-1 A',
      'S1A'
    ]);

    var s1b = getPlatformCount(hist, [
      'Sentinel-1B',
      'SENTINEL-1B',
      'Sentinel-1 B',
      'SENTINEL-1 B',
      'S1B'
    ]);

    var s1c = getPlatformCount(hist, [
      'Sentinel-1C',
      'SENTINEL-1C',
      'Sentinel-1 C',
      'SENTINEL-1 C',
      'S1C'
    ]);

    var s1d = getPlatformCount(hist, [
      'Sentinel-1D',
      'SENTINEL-1D',
      'Sentinel-1 D',
      'SENTINEL-1 D',
      'S1D'
    ]);

    // Combined categories.
    // These should not be split into separate satellites,
    // because that would double-count.
    var s1ab = getPlatformCount(hist, [
      'Sentinel-1A/B',
      'SENTINEL-1A/B',
      'Sentinel-1 A/B',
      'SENTINEL-1 A/B',
      'S1A/B',
      'S1A_B'
    ]);

    var s1cd = getPlatformCount(hist, [
      'Sentinel-1C/D',
      'SENTINEL-1C/D',
      'Sentinel-1 C/D',
      'SENTINEL-1 C/D',
      'S1C/D',
      'S1C_D'
    ]);

    var s1abcd = getPlatformCount(hist, [
      'Sentinel-1A/B/C/D',
      'SENTINEL-1A/B/C/D',
      'Sentinel-1 A/B/C/D',
      'SENTINEL-1 A/B/C/D',
      'S1A/B/C/D',
      'S1A_B_C_D'
    ]);

    var total = ee.Number(c.size());

    var known = s1Unspecified
      .add(s1a)
      .add(s1b)
      .add(s1c)
      .add(s1d)
      .add(s1ab)
      .add(s1cd)
      .add(s1abcd);

    var other = total.subtract(known);

    return ee.Feature(null, {
      label: label,
      month: s.format('YYYY-MM'),
      total_count: total,

      S1_unspecified: s1Unspecified,

      S1A: s1a,
      S1B: s1b,
      S1C: s1c,
      S1D: s1d,

      S1A_B: s1ab,
      S1C_D: s1cd,
      S1A_B_C_D: s1abcd,

      // If this is > 0, OPERA has introduced a new SPACECRAFT_NAME value
      // not captured by the aliases above.
      OTHER: other
    });
  });

  return ee.FeatureCollection(months);
}


// -----------------------------
// Build monthly tables
// -----------------------------

var rawS1Monthly = monthlyRawS1CountFeatures(
  rawS1,
  'Raw Sentinel-1 GRD'
);

var operaS1Monthly = monthlyOperaS1CountFeatures(
  operaS1,
  'OPERA DSWx-S1'
);


// =======================================================
// Chart helpers
// =======================================================

function printMonthlyCharts(fc, titlePrefix, platformSeries) {
  print(titlePrefix + ' monthly table', fc);

  // Chart 1:
  // Platform categories only.
  // total_count is intentionally excluded to avoid overlap.
  print(ui.Chart.feature.byFeature({
    features: fc,
    xProperty: 'month',
    yProperties: platformSeries
  }).setOptions({
    title: titlePrefix + ' by Platform Category',
    hAxis: {
      title: 'Month',
      slantedText: true,
      slantedTextAngle: 45
    },
    vAxis: {
      title: 'Image count'
    },
    lineWidth: 2,
    pointSize: 5
  }));

  // Chart 2:
  // Total count only.
  print(ui.Chart.feature.byFeature({
    features: fc,
    xProperty: 'month',
    yProperties: ['total_count']
  }).setOptions({
    title: titlePrefix + ' Total Count',
    hAxis: {
      title: 'Month',
      slantedText: true,
      slantedTextAngle: 45
    },
    vAxis: {
      title: 'Total image count'
    },
    lineWidth: 3,
    pointSize: 5
  }));

  // Chart 3:
  // Combined summary:
  // platform categories as stacked bars, total_count as line.
  var comboSeries = platformSeries.concat(['total_count']);
  var totalSeriesIndex = platformSeries.length;

  var totalSeriesOptions = {};
  totalSeriesOptions[totalSeriesIndex] = {
    type: 'line',
    lineWidth: 3,
    pointSize: 4
  };

  print(ui.Chart.feature.byFeature({
    features: fc,
    xProperty: 'month',
    yProperties: comboSeries
  })
  .setChartType('ComboChart')
  .setOptions({
    title: titlePrefix + ' Platform Categories and Total',
    hAxis: {
      title: 'Month',
      slantedText: true,
      slantedTextAngle: 45
    },
    vAxis: {
      title: 'Image count'
    },
    seriesType: 'bars',
    isStacked: true,
    series: totalSeriesOptions
  }));
}


// -----------------------------
// Print charts
// -----------------------------

printMonthlyCharts(
  rawS1Monthly,
  'Raw Sentinel-1 GRD',
  [
    'S1A',
    'S1B',
    'S1C',
    'S1D',
    'OTHER'
  ]
);

printMonthlyCharts(
  operaS1Monthly,
  'OPERA DSWx-S1',
  [
    'S1_unspecified',
    'S1A',
    'S1B',
    'S1C',
    'S1D',
    'S1A_B',
    'S1C_D',
    'S1A_B_C_D',
    'OTHER'
  ]
);
