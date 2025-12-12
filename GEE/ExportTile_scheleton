/******************************************************
  Generic tile-based EXPORT SKELETON
  - AOI_MODE: GRID / GLOBAL_AOI
  - TILE_MODE: SINGLE / ALL
  - Fast-queue pattern: one export per tile
******************************************************/

// ---------------------------------------------------
// 0. Base input (placeholder image)
// ---------------------------------------------------
// Replace with the image(s) you actually want to process
var inputImage = ee.Image('projects/your-project/assets/your_input_image');

print('Input projection:', inputImage.projection());

// Native scale (you can change it later if needed)
var NATIVE_SCALE = inputImage.projection().nominalScale();
print('Native scale (m):', NATIVE_SCALE);

// ---------------------------------------------------
// 1. User settings
// ---------------------------------------------------

// 1.1 AOI choice
// 'GRID' -> users/bourgoinclement2/ForestReferenceMap/Grid10deg
// 'GLOBAL_AOI' -> projects/hardy-tenure-383607/assets/Forests/AOIs_Global_v1
var AOI_MODE = 'GLOBAL_AOI';   // or 'GRID'

// 1.2 Tile mode: 'SINGLE' or 'ALL'
var TILE_MODE = 'ALL';         // 'SINGLE' | 'ALL'

// 1.3 ID of the tile/AOI to export in SINGLE mode
//    (Must match the property in the FeatureCollection)
var SELECTED_TILE_ID = 256;    // Example

// 1.4 ID property names in each FeatureCollection
var GRID_ID_PROPERTY = 'id';
var AOI_ID_PROPERTY  = 'id';   // <-- change this if AOIs_Global_v1 uses a different field

// 1.5 Export naming and destination
// Short tag describing the process (used in asset names)
var PROCESS_TAG = 'MyProcess';

// Base path for output assets ("collection" folder)
var OUTPUT_BASE = 'projects/your-project/assets/MyProcessOutputs';

// 1.6 Export scale & CRS
// You can override these if you want a specific resolution/CRS
var EXPORT_SCALE = NATIVE_SCALE;  // or e.g. 30, 100, etc.
var EXPORT_CRS   = 'EPSG:4326';

// ---------------------------------------------------
// 2. Tile / AOI sources
// ---------------------------------------------------

// 10-degree grid tiles (user-provided)
var gridTiles = ee.FeatureCollection(
  'users/bourgoinclement2/ForestReferenceMap/Grid10deg'
);

// Global AOIs (user-provided)
var globalAOIs = ee.FeatureCollection(
  'projects/hardy-tenure-383607/assets/Forests/AOIs_Global_v1'
);

// Select which FeatureCollection to use based on AOI_MODE
var tilesFC;
var idProperty;
if (AOI_MODE === 'GRID') {
  tilesFC = gridTiles;
  idProperty = GRID_ID_PROPERTY;
} else if (AOI_MODE === 'GLOBAL_AOI') {
  tilesFC = globalAOIs;
  idProperty = AOI_ID_PROPERTY;
} else {
  throw new Error('AOI_MODE must be either "GRID" or "GLOBAL_AOI".');
}

print('AOI_MODE:', AOI_MODE);
print('Tile collection size:', tilesFC.size());

// ---------------------------------------------------
// 3. PROCESSING PLACEHOLDER
// ---------------------------------------------------
// Put here your own processing chain.
// The result must be an ee.Image that you want to export.
// Example: for now, we just pass the input image through.

var processedImage = inputImage;  // <<< REPLACE with your real processing

print('Processed image (placeholder):', processedImage);

// ---------------------------------------------------
// 4. Helper: create export for a single tile
// ---------------------------------------------------
var createExportForTile = function(image, feature, tileIdValue) {
  // image: ee.Image to export
  // feature: ee.Feature of this tile/AOI
  // tileIdValue: value of the tile ID (number or string)

  var tileGeom = ee.Feature(feature).geometry();
  var tileImage = image.clip(tileGeom);

  // Build a human-readable asset name
  var assetName =
    PROCESS_TAG + '_' + AOI_MODE + '_' + idProperty + '_' +
    tileIdValue;

  var assetId = OUTPUT_BASE + '/' + assetName;

  print('Queue export for tile ID =', tileIdValue, ' -> ', assetId);

  Export.image.toAsset({
    image: tileImage,
    description: assetName,
    assetId: assetId,
    pyramidingPolicy: "MODE",   // MODE pyramiding (can be adjusted)
    region: tileGeom,
    scale: EXPORT_SCALE,
    crs: EXPORT_CRS,
    maxPixels: 1e13
  });
};

// ---------------------------------------------------
// 5. Tile mode logic: SINGLE or ALL
// ---------------------------------------------------
if (TILE_MODE === 'SINGLE') {
  // --------- SINGLE mode: export only one tile by ID ---------
  var selectedFeature = tilesFC
    .filter(ee.Filter.eq(idProperty, SELECTED_TILE_ID))
    .first();

  print('Selected feature (SINGLE mode):', selectedFeature);

  // Optional: quick visual check (you can adapt or remove)
  /*
  Map.centerObject(selectedFeature, 5);
  Map.addLayer(processedImage.clip(ee.Feature(selectedFeature).geometry()),
               {}, 'Processed image (SINGLE tile)', true);
  */

  // Create one export task
  createExportForTile(processedImage, selectedFeature, SELECTED_TILE_ID);

} else if (TILE_MODE === 'ALL') {
  // --------- ALL mode: export all tiles in the FeatureCollection ---------

  // Fast-queue pattern: one client-side loop queuing all exports
  var tileList = tilesFC.toList(tilesFC.size());
  var idArray = tilesFC.aggregate_array(idProperty).getInfo();
  var nTiles = idArray.length;

  print('ALL mode: number of tiles to export =', nTiles);

  for (var i = 0; i < nTiles; i++) {
    var feat = ee.Feature(tileList.get(i));
    var tileIdValue = idArray[i];
    createExportForTile(processedImage, feat, tileIdValue);
  }

  // Optional: very light global visualization (disabled by default)
  /*
  Map.setCenter(0, 0, 2);
  Map.addLayer(processedImage, {}, 'Processed image (global)', false);
  */

} else {
  print('ERROR: TILE_MODE must be either "SINGLE" or "ALL".');
}
