// =======================================================
// Sentinel-1 / OPERA DSWx-S1 monthly counts
// + combined all-satellite temporal resolution at a point
// + 10-day moving/decadal mean temporal resolution
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
// Temporal-resolution settings
// -----------------------------
//
// temporalWindowDays:
//   Window length used to calculate mean temporal resolution.
//
// temporalStepDays:
//   10 = one value every 10 days, good for a clean decadal time series.
//    1 = true daily moving window, smoother but many more points.

var temporalWindowDays = 10;
var temporalStepDays = 10;


// -----------------------------
// Temporal-resolution point
// -----------------------------
//
// If geometry is a point, the centroid is the same point.
// If geometry is a polygon, this uses the centroid of the polygon.

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
      month_index: ee.Number(i),
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
      month_index: ee.Number(i),
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
// Combined all-satellite observations at cadence point
// =======================================================
//
// This uses all images together, regardless of satellite.
// It does not calculate revisit per satellite.
//
// Same-day acquisitions use the effective fraction rule:
//   2 images same day -> 0.5 days
//   3 images same day -> 0.333 days
//   4 images same day -> 0.25 days

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
        obs_day: t.difference(startDate, 'day'),
        platform_value: platformValue
      });
    });

  // Remove exact duplicated acquisition records with the same timestamp
  // and same platform value.
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
      obs_day: img.get('obs_day'),
      platform_value: img.get('platform_value'),

      image_count_on_date: ee.Number(dateHist.get(dateString, 0))
    });
  });

  return ee.FeatureCollection(features);
}


// =======================================================
// Combined all-satellite interval table
// =======================================================

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
      millis: currentMillis,
      obs_day: current.get('obs_day'),
      platform_value: current.get('platform_value'),
      image_id: current.get('image_id'),

      previous_date: previous.get('date'),
      previous_datetime: previous.get('datetime'),
      previous_millis: previousMillis,
      previous_obs_day: previous.get('obs_day'),
      previous_platform_value: previous.get('platform_value'),
      previous_image_id: previous.get('image_id'),

      image_count_on_date: imagesThisDay,

      effective_interval_days: effectiveIntervalDays,
      calendar_interval_days: calendarIntervalDays,
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
// Moving / decadal temporal-resolution summary
// =======================================================
//
// Each output feature represents one temporal window.
//
// mean_effective_interval_days:
//   Mean of the all-satellite effective revisit intervals whose current
//   acquisition falls inside that window.

function movingWindowTemporalResolution(intervalFc, obsFc, label, windowDays, stepDays) {
  intervalFc = intervalFc.sort('millis');
  obsFc = obsFc.sort('millis');

  var totalDays = endDate.difference(startDate, 'day');

  var nSteps = totalDays
    .divide(stepDays)
    .ceil();

  var indices = ee.List
    .sequence(0, nSteps.subtract(1).max(0))
    .slice(0, nSteps);

  var features = indices.map(function(k) {
    k = ee.Number(k);

    var windowStart = startDate.advance(k.multiply(stepDays), 'day');
    var windowEnd = windowStart.advance(windowDays, 'day');
    var windowMidpoint = windowStart.advance(ee.Number(windowDays).divide(2), 'day');

    var intervalSubset = intervalFc
      .filter(ee.Filter.gte('millis', windowStart.millis()))
      .filter(ee.Filter.lt('millis', windowEnd.millis()));

    var obsSubset = obsFc
      .filter(ee.Filter.gte('millis', windowStart.millis()))
      .filter(ee.Filter.lt('millis', windowEnd.millis()));

    var nIntervals = intervalSubset.size();
    var nObservations = obsSubset.size();

    var meanEffective = ee.Algorithms.If(
      nIntervals.gt(0),
      intervalSubset.aggregate_mean('effective_interval_days'),
      null
    );

    var minEffective = ee.Algorithms.If(
      nIntervals.gt(0),
      intervalSubset.aggregate_min('effective_interval_days'),
      null
    );

    var maxEffective = ee.Algorithms.If(
      nIntervals.gt(0),
      intervalSubset.aggregate_max('effective_interval_days'),
      null
    );

    var meanExact = ee.Algorithms.If(
      nIntervals.gt(0),
      intervalSubset.aggregate_mean('exact_interval_days'),
      null
    );

    return ee.Feature(null, {
      label: label,

      // Human-readable dates for table inspection.
      window_start: windowStart.format('YYYY-MM-dd'),
      window_end: windowEnd.format('YYYY-MM-dd'),
      window_midpoint: windowMidpoint.format('YYYY-MM-dd'),

      // Numeric fields for charts.
      millis: windowStart.millis(),
      window_start_day: windowStart.difference(startDate, 'day'),
      window_midpoint_day: windowMidpoint.difference(startDate, 'day'),

      window_days: windowDays,
      step_days: stepDays,

      observation_count_in_window: nObservations,
      interval_count_in_window: nIntervals,

      mean_effective_interval_days: meanEffective,
      min_effective_interval_days: minEffective,
      max_effective_interval_days: maxEffective,
      mean_exact_interval_days: meanExact
    });
  });

  return ee.FeatureCollection(features);
}


// =======================================================
// Build tables
// =======================================================

var rawS1Monthly = monthlyRawS1CountFeatures(
  rawS1,
  'Raw Sentinel-1 GRD'
);

var operaS1Monthly = monthlyOperaS1CountFeatures(
  operaS1,
  'OPERA DSWx-S1'
);

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

var rawS1MovingTemporalResolution = movingWindowTemporalResolution(
  rawS1CadenceAllSatellites.intervals,
  rawS1CadenceAllSatellites.observations,
  'Raw Sentinel-1 GRD',
  temporalWindowDays,
  temporalStepDays
);

var operaS1MovingTemporalResolution = movingWindowTemporalResolution(
  operaS1CadenceAllSatellites.intervals,
  operaS1CadenceAllSatellites.observations,
  'OPERA DSWx-S1',
  temporalWindowDays,
  temporalStepDays
);


// =======================================================
// Chart helpers
// =======================================================

function printMonthlyCharts(fc, titlePrefix, platformSeries) {
  print(titlePrefix + ' monthly table', fc);

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


function printMovingWindowMeanChart(movingFc, titlePrefix) {
  // Keep only windows that actually contain intervals.
  // This avoids chart type problems caused by long stretches of null values.
  var validMovingFc = movingFc
    .filter(ee.Filter.gt('interval_count_in_window', 0))
    .filter(ee.Filter.notNull(['mean_effective_interval_days']))
    .sort('window_start_day');

  print(
    titlePrefix + ' valid moving-window temporal-resolution table used for chart',
    validMovingFc
  );

  var xDays = validMovingFc.aggregate_array('window_start_day');
  var yMean = validMovingFc.aggregate_array('mean_effective_interval_days');

  // Safer than ui.Chart.feature.byFeature for this case.
  // Uses a numeric x-axis and a numeric array of mean revisit values.
  print(ui.Chart.array.values({
    array: ee.Array(yMean),
    axis: 0,
    xLabels: xDays
  }).setOptions({
    title: titlePrefix +
      ' Mean Temporal Resolution, ' +
      temporalWindowDays +
      '-Day Window, Step ' +
      temporalStepDays +
      ' Day(s)',
    hAxis: {
      title: 'Days since ' + start
    },
    vAxis: {
      title: 'Mean days between acquisitions'
    },
    lineWidth: 2,
    pointSize: 4
  }));
}


function printTemporalResolutionCharts(cadenceResult, movingFc, titlePrefix) {
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

  print(
    titlePrefix + ' moving-window temporal-resolution table',
    movingFc
  );

  print(
    titlePrefix + ' moving-window mean temporal-resolution summary, days',
    movingFc.aggregate_stats('mean_effective_interval_days')
  );

  // Raw interval-by-interval time series.
  print(ui.Chart.feature.byFeature({
    features: intervalFc,
    xProperty: 'obs_day',
    yProperties: ['effective_interval_days']
  }).setOptions({
    title: titlePrefix + ' Combined All-Satellite Temporal Resolution',
    hAxis: {
      title: 'Days since ' + start
    },
    vAxis: {
      title: 'Effective days since previous acquisition'
    },
    lineWidth: 1,
    pointSize: 4
  }));

  // Histogram of raw all-satellite intervals.
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

  // Number of acquisitions per observation day.
  print(ui.Chart.feature.byFeature({
    features: obsFc,
    xProperty: 'obs_day',
    yProperties: ['image_count_on_date']
  }).setOptions({
    title: titlePrefix + ' Number of Acquisitions on Each Observation Day',
    hAxis: {
      title: 'Days since ' + start
    },
    vAxis: {
      title: 'Images on same date'
    },
    lineWidth: 1,
    pointSize: 3
  }));

  // Replacement for the problematic moving-window feature chart.
  printMovingWindowMeanChart(movingFc, titlePrefix);
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
// Print all-satellite temporal-resolution charts
// =======================================================

printTemporalResolutionCharts(
  rawS1CadenceAllSatellites,
  rawS1MovingTemporalResolution,
  'Raw Sentinel-1 GRD'
);

printTemporalResolutionCharts(
  operaS1CadenceAllSatellites,
  operaS1MovingTemporalResolution,
  'OPERA DSWx-S1'
);
