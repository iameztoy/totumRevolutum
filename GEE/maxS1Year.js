// ----------------------------------------
// Sentinel-1 GRD max composite over Africa
// Year: 2022
// Google Earth Engine JavaScript
// ----------------------------------------

// 1) Africa boundary
var africa = ee.FeatureCollection('USDOS/LSIB_SIMPLE/2017')
  .filter(ee.Filter.eq('wld_rgn', 'Africa'));

var africaGeom = africa.geometry();

// 2) Sentinel-1 GRD collection for 2022
// Use a homogeneous subset to avoid mixing different modes/resolutions/pols
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterDate('2022-01-01', '2023-01-01')
  .filterBounds(africaGeom)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .select(['VV', 'VH']);

// 3) Per-pixel maximum composite for 2022
var s1Max2022 = s1.max().clipToCollection(africa);

// 4) Display
Map.centerObject(africa, 3);
Map.addLayer(africa, {color: 'yellow'}, 'Africa boundary', false);

Map.addLayer(
  s1Max2022.select('VV'),
  {min: -25, max: 5},
  'Sentinel-1 VV max 2022'
);

Map.addLayer(
  s1Max2022.select('VH'),
  {min: -30, max: 0},
  'Sentinel-1 VH max 2022',
  false
);

// 5) Print info
print('Africa boundary:', africa);
print('Number of Sentinel-1 images used:', s1.size());
print('Max composite image (2022):', s1Max2022);

/* //Not possible at this scale and method
// 6) Optional export to Google Drive
Export.image.toDrive({
  image: s1Max2022,
  description: 'Sentinel1_GRD_Africa_Max_2022',
  folder: 'GEE',
  fileNamePrefix: 'sentinel1_grd_africa_max_2022',
  region: africaGeom,
  scale: 10,
  maxPixels: 1e13
});
*/
