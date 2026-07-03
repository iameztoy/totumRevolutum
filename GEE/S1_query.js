var aoi = geometry;

var start = '2014-01-01';
var nMonths = 200;

function monthlyCountFeatures(ic, platformProp, label) {
  var months = ee.List.sequence(0, nMonths - 1).map(function(i) {
    var s = ee.Date(start).advance(i, 'month');
    var e = s.advance(1, 'month');
    var c = ic.filterBounds(aoi).filterDate(s, e);

    var hist = ee.Dictionary(c.aggregate_histogram(platformProp));

    return ee.Feature(null, {
      label: label,
      month: s.format('YYYY-MM'),
      total_count: c.size(),

      S1A: ee.Number(hist.get('A', 0))
        .add(ee.Number(hist.get('Sentinel-1A', 0))),

      S1B: ee.Number(hist.get('B', 0))
        .add(ee.Number(hist.get('Sentinel-1B', 0))),

      S1C: ee.Number(hist.get('C', 0))
        .add(ee.Number(hist.get('Sentinel-1C', 0))),

      S1D: ee.Number(hist.get('D', 0))
        .add(ee.Number(hist.get('Sentinel-1D', 0)))
    });
  });

  return ee.FeatureCollection(months);
}

var rawS1Monthly = monthlyCountFeatures(
  ee.ImageCollection('COPERNICUS/S1_GRD'),
  'platform_number',
  'Raw Sentinel-1 GRD'
);

var operaS1Monthly = monthlyCountFeatures(
  ee.ImageCollection('OPERA/DSWX/L3_V1/S1'),
  'SPACECRAFT_NAME',
  'OPERA DSWx-S1'
);

print('Raw Sentinel-1 monthly table', rawS1Monthly);
print('OPERA DSWx-S1 monthly table', operaS1Monthly);

print(ui.Chart.feature.byFeature({
  features: rawS1Monthly,
  xProperty: 'month',
  yProperties: ['S1A', 'S1B', 'S1C', 'S1D', 'total_count']
}).setOptions({
  title: 'Raw Sentinel-1 GRD by Month',
  hAxis: {title: 'Month'},
  vAxis: {title: 'Image count'},
  lineWidth: 2,
  pointSize: 5
}));

print(ui.Chart.feature.byFeature({
  features: operaS1Monthly,
  xProperty: 'month',
  yProperties: ['S1A', 'S1B', 'S1C', 'S1D', 'total_count']
}).setOptions({
  title: 'OPERA DSWx-S1 by Month',
  hAxis: {title: 'Month'},
  vAxis: {title: 'Image count'},
  lineWidth: 2,
  pointSize: 5
}));
