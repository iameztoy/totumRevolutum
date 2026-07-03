// =======================================================
// Sentinel-1 / OPERA DSWx-S1 monthly counts
// + combined all-satellite temporal resolution at a point
//
// Future-proof version for Sentinel-1A/B/C/D and OPERA naming changes
// =======================================================


// -----------------------------
// Area and time range
// -----------------------------

var aoi = geometry;
var aoiGeom = ee.Geometry(aoi);

var start = '2014-01-01';
var nMonths = 200;

var startDate = ee.Date(start);
var endDate = startDate.advance(nMonths, 'month');


// -----------------------------
// Temporal-resolution point
// -----------------------------
//
// If geometry is a point, the centroid is the same point.
// If geometry is a polygon, this uses the centroid of the polygon.
//
// If you prefer to force your own point, comment the centroid line
// and uncomment/edit the Point line below.

var cadencePoint = aoiGeom.centroid(1);

// Optional manual point override:
// var cadencePoint = ee.Geometry.Point([-3.7038, 40.4168]);  // lon, lat


// -----------------------------
// Collections
// -----------------------------

var rawS1 = ee.ImageCollection('COPERNICUS/S1_GRD');

var operaS1 = ee.ImageCollection('OPERA/DSWX/L3_V1/S1');


// -----------------------------
// Map display
// -----------------------------

Map.centerObject(aoiGeom, 9);
Map.addLayer(aoiGeom, {}, 'AOI');
Map.addLayer(cadencePoint, {color: 'red'}, 'Cadence point');


// -----------------------------
// Diagnostics
// -----------------------------
//
// These histograms show the exact platform names currently stored.
// If OTHER > 0 in the charts, check these histograms and add the
// new name to the alias lists below.

print(
  'Raw Sentinel-1 platform_number histogram, AOI + date range',
  rawS1
    .filterBounds(aoiGeom)
    .filterDate(startDate, endDate)
    .aggregate_histogram('platform_number')
);

print(
  'OPERA DSWx-S1 SPACECRAFT_NAME histogram, AOI + date range',
  operaS1
    .filterBounds(aoiGeom)
    .filterDate(startDate, endDate)
    .aggregate_histogram('SPACECRAFT_NAME')
);

print('Cadence point used for temporal resolution', cadencePoint);


// =======================================================
// Helper functions
// =======================================================

function getPlatformCount(hist, aliases) {
  aliases = ee.List(aliases);

  return ee.Number(aliases.iterate(function(alias, acc) {
    alias = ee.String(alias);
    acc = ee.Number(acc);
    return acc.add(ee.Number(hist.get(alias, 0)));
  }, 0));
}


// =======================================================
// Raw Sentinel-1 GRD monthly counts over AOI
// =======================================================
//
// COPERNICUS/S1_GRD usually stores platform_number as A, B, C, or D.
// S1D is included so the script is ready if/when it appears.

function monthlyRawS1CountFeatures(ic, label) {
  var months = ee.List.sequence(0, nMonths - 1).map(function(i) {
    var s = startDate.advance(i, 'month');
    var e = s.advance(1, 'month');

    var c = ic
      .filterBounds(aoiGeom)
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
// OPERA DSWx-S1 monthly counts over AOI
// =======================================================
//
// OPERA uses SPACECRAFT_NAME.
// In your current AOI/date range, you found:
//   Sentinel-1
//   Sentinel-1A/B
//
// The script is left open for future values such as Sentinel-1A,
// Sentinel-1B, Sentinel-1C, Sentinel-1D, or combined C/D categories.

function monthlyOperaS1CountFeatures(ic, label) {
  var months = ee.List.sequence(0, nMonths - 1).map(function(i) {
    var s = startDate.advance(i, 'month');
    var e = s.advance(1, 'month');

    var c = ic
      .filterBounds(aoiGeom)
      .filterDate(s, e);

    var hist = ee.Dictionary(c.aggregate_histogram('SPACECRAFT_NAME'));

    var s1Unspecified = getPlatformCount(hist, [
      'Sentinel-1',
      'SENTINEL-1',
      'S1'
    ]);

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
    // These are not split into separate satellites to avoid double-counting.
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

      OTHER: other
    });
  });

  return ee.FeatureCollection(months);
}


// =======================================================
// Combined all-satellite temporal resolution at cadence point
// =======================================================
//
// This uses all images together, regardless of whether they come from
// S1A, S1B, S1C, S1D, or a combined OPERA category.
//
// Important:
// - Images are sorted by system:time_start.
// - Consecutive acquisitions from different days use calendar-day spacing.
// - Consecutive acquisitions within the same day use an effective fraction:
//      2 images that day -> 0.5 days
//      3 images that day -> 0.333 days
//      4 images that day -> 0.25 days
//
// The script also reports exact time difference in days, using acquisition
// timestamps, as exact_interval_days. The chart uses effective_interval_days.

function observationsAtPointAllSatellites(ic, pointGeom, label, platformProp) {
  var withProps = ic
    .filterBounds(pointGeom)
    .filterDate(startDate, endDate)
    .map(function(img) {
      var t = ee.Date(img.get('system:time_start'));
      var dateString = t.format('YYYY-MM-dd');
      var datetimeString = t.format('YYYY-MM-dd HH:mm:ss');

      var platformValue = ee.String(
        ee.Algorithms.If(
          img.get(platformProp),
          img.get(platformProp),
          'missing'
        )
      );

      return img.set({
        obs_date: dateString,
        obs_datetime: datetimeString,
        obs_millis: t.millis(),
        platform_value: platformValue
      });
    });

  // This removes exact duplicate acquisition records with the same timestamp
  // and same platform value. It helps avoid counting duplicated granules as
  // separate acquisitions.
  var deduped = withProps
    .distinct(['obs_millis', 'platform_value'])
    .sort('system:time_start');

  var dateHist = ee.Dictionary(deduped.aggregate_histogram('obs_date'));

  var n = deduped.size();
  var imgList = deduped.toList(n);

  var indices = ee.List
    .sequence(0, n.subtract(1).max(0))
    .slice(0, n);

  var features = indices.map(function(i) {
    i = ee.Number(i);
    var img = ee.Image(imgList.get(i));

    var dateString = ee.String(img.get('obs_date'));

    return ee.Feature(null, {
      label: label,
      obs_index: i,
      image_id: img.id(),
      datetime: img.get('obs_datetime'),
      date: dateString,
      millis: img.get('obs_millis'),
      platform_value: img.get('platform_value'),

      // Number of acquisitions on this same date, after deduplication.
      image_count_on_date: ee.Number(dateHist.get(dateString, 0))
    });
  });

  return ee.FeatureCollection(features);
}


function combinedCadenceIntervals(obsFc, label) {
  obsFc = obsFc.sort('millis');

  var n = obsFc.size();
  var obsList = obsFc.toList(n);

  var nIntervals = n.subtract(1).max(0);

  var intervalIndices = ee.List
    .sequence(1, n.subtract(1).max(1))
    .slice(0, nIntervals);

  var features = intervalIndices.map(function(i) {
    i = ee.Number(i);

    var current = ee.Feature(obsList.get(i));
    var previous = ee.Feature(obsList.get(i.subtract(1)));

    var currentMillis = ee.Number(current.get('millis'));
    var previousMillis = ee.Number(previous.get('millis'));

    var exactIntervalDays = currentMillis
      .subtract(previousMillis)
      .divide(1000 * 60 * 60 * 24);

    var currentDate = ee.Date(current.get('date'));
    var previousDate = ee.Date(previous.get('date'));

    var calendarIntervalDays = currentDate.difference(previousDate, 'day');

    var sameDay = ee.Algorithms.IsEqual(
      current.get('date'),
      previous.get('date')
    );

    var imagesThisDay = ee.Number(current.get('image_count_on_date'));

    var sameDayFraction = ee.Number(1).divide(imagesThisDay);

    var effectiveIntervalDays = ee.Number(
      ee.Algorithms.If(
        sameDay,
        sameDayFraction,
        calendarIntervalDays
      )
    );

    return ee.Feature(null, {
      label: label,

      date: current.get('date'),
      datetime: current.get('datetime'),
      platform_value: current.get('platform_value'),
      image_id: current.get('image_id'),

      previous_date: previous.get('date'),
      previous_datetime: previous.get('datetime'),
      previous_platform_value: previous.get('platform_value'),
      previous_image_id: previous.get('image_id'),

      image_count_on_date: imagesThisDay,

      // Main value to use for the temporal-resolution chart.
      // This applies the same-day fractional rule.
      effective_interval_days: effectiveIntervalDays,

      // Calendar-day difference between current and previous acquisition.
      // Same-day acquisitions have calendar_interval_days = 0.
      calendar_interval_days: calendarIntervalDays,

      // Exact timestamp difference in days.
      // Useful for checking actual acquisition-time spacing.
      exact_interval_days: exactIntervalDays,

      same_day_fraction_used: ee.Number(
        ee.Algorithms.If(
          sameDay,
          sameDayFraction,
          0
        )
      )
    });
  });

  return ee.FeatureCollection(features);
}


function temporalResolutionAllSatellitesAtPoint(ic, pointGeom, label, platformProp) {
  var obsFc = observationsAtPointAllSatellites(
    ic,
    pointGeom,
    label,
    platformProp
  );

  var intervalFc = combinedCadenceIntervals(
    obsFc,
    label
  );

  return {
    observations: obsFc,
    intervals: intervalFc
  };
}


// =======================================================
// Build monthly tables
// =======================================================

var rawS1Monthly = monthlyRawS1CountFeatures(
  rawS1,
  'Raw Sentinel-1 GRD'
);

var operaS1Monthly = monthlyOperaS1CountFeatures(
  operaS1,
  'OPERA DSWx-S1'
);


// =======================================================
// Build combined all-satellite temporal-resolution tables
// =======================================================

var rawS1CadenceAllSatellites = temporalResolutionAllSatellitesAtPoint(
  rawS1,
  cadencePoint,
  'Raw Sentinel-1 GRD',
  'platform_number'
);

var operaS1CadenceAllSatellites = temporalResolutionAllSatellitesAtPoint(
  operaS1,
  cadencePoint,
  'OPERA DSWx-S1',
  'SPACECRAFT_NAME'
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


function printTemporalResolutionCharts(cadenceResult, titlePrefix) {
  var obsFc = cadenceResult.observations;
  var intervalFc = cadenceResult.intervals;

  print(
    titlePrefix + ' all-satellite observations at cadence point',
    obsFc
  );

  print(
    titlePrefix + ' all-satellite temporal-resolution intervals at cadence point',
    intervalFc
  );

  print(
    titlePrefix + ' all-satellite effective temporal-resolution summary, days',
    intervalFc.aggregate_stats('effective_interval_days')
  );

  print(
    titlePrefix + ' exact timestamp interval summary, days',
    intervalFc.aggregate_stats('exact_interval_days')
  );

  print(
    titlePrefix + ' same-day acquisition count histogram',
    obsFc.aggregate_histogram('image_count_on_date')
  );

  // Chart 1:
  // Combined all-satellite cadence using the effective same-day fraction rule.
  print(ui.Chart.feature.byFeature({
    features: intervalFc,
    xProperty: 'datetime',
    yProperties: ['effective_interval_days']
  }).setOptions({
    title: titlePrefix + ' Combined All-Satellite Temporal Resolution',
    hAxis: {
      title: 'Observation datetime',
      slantedText: true,
      slantedTextAngle: 45
    },
    vAxis: {
      title: 'Effective days since previous acquisition'
    },
    lineWidth: 1,
    pointSize: 4
  }));

  // Chart 2:
  // Histogram of combined all-satellite revisit intervals.
  print(ui.Chart.feature.histogram(
    intervalFc,
    'effective_interval_days',
    50
  ).setOptions({
    title: titlePrefix + ' Combined All-Satellite Revisit Interval Histogram',
    hAxis: {
      title: 'Effective days between acquisitions'
    },
    vAxis: {
      title: 'Number of intervals'
    }
  }));

  // Chart 3:
  // Number of same-day acquisitions.
  // This helps identify northern-latitude cases where cadence can be < 1 day.
  print(ui.Chart.feature.byFeature({
    features: obsFc,
    xProperty: 'datetime',
    yProperties: ['image_count_on_date']
  }).setOptions({
    title: titlePrefix + ' Number of Acquisitions on Each Observation Day',
    hAxis: {
      title: 'Observation datetime',
      slantedText: true,
      slantedTextAngle: 45
    },
    vAxis: {
      title: 'Images on same date'
    },
    lineWidth: 1,
    pointSize: 3
  }));
}


// =======================================================
// Print monthly charts
// =======================================================

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


// =======================================================
// Print combined all-satellite temporal-resolution charts
// =======================================================

printTemporalResolutionCharts(
  rawS1CadenceAllSatellites,
  'Raw Sentinel-1 GRD'
);

printTemporalResolutionCharts(
  operaS1CadenceAllSatellites,
  'OPERA DSWx-S1'
);
