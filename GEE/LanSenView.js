/***************************************
 * POI Imagery Explorer (S2 + Landsat + S1)
 *
 * HARD FIX:
 * - Avoid "Widgets can only be added to one panel at a time" by:
 *   1) Adding ONE uiContainer to map.widgets() ONCE (no re-adding panels)
 *   2) sidePanel is shown/hidden via style('shown') only (no re-parenting)
 *   3) Settings/Results are fixed panels added once; toggle via 'shown'
 *
 * FEATURES:
 * - Group Sentinel-2 & Landsat results by DATE and load mosaics per date
 * - Sentinel-1 per-scene
 ****************************************/

// -------------------------
// Defaults
// -------------------------
var DEFAULTS = {
  bufferKm: 5,
  lookbackDays: 30,
  cloudMax: 30,
  maxImages: 120,
  autoQueryAfterPOI: true,
  s2Level: 'L1C (TOA)',
  landsatLevel: 'TOA',
  s1ModeFilter: 'ANY'
};

var PAGE_SIZE = 10;

// -------------------------
// UI State
// -------------------------
var uiState = {
  panelOpen: true,
  view: 'Settings' // 'Settings' | 'Results' | 'Water Detection' | 'Export'
};

// -------------------------
// Composites / Viz
// -------------------------
var S2_COMPOSITES = [
  {name: 'True Color (4,3,2)',   type: 'rgb', bands: ['B4','B3','B2']},
  {name: 'Highlight Optimized Natural Color (4,3,2)', type: 'highlight_rgb', bands: ['B4','B3','B2']},
  {name: 'False Color (8,4,3)',  type: 'rgb', bands: ['B8','B4','B3']},
  {name: 'SWIR (12,8,4)',        type: 'rgb', bands: ['B12','B8','B4']},
  {name: 'Agriculture (11,8,2)', type: 'rgb', bands: ['B11','B8','B2']},
  {name: 'Geology (12,11,2)',    type: 'rgb', bands: ['B12','B11','B2']},
  {name: 'Bathymetric (4,3,1)',  type: 'rgb', bands: ['B4','B3','B1']},
  {name: 'RGB (8,6,4)',          type: 'rgb', bands: ['B8','B6','B4']},
  {name: 'RGB (8,5,4)',          type: 'rgb', bands: ['B8','B5','B4']},
  {name: 'RGB (8,11,4)',         type: 'rgb', bands: ['B8','B11','B4']},
  {name: 'RGB (8,11,12)',        type: 'rgb', bands: ['B8','B11','B12']},
  {name: 'RGB (11,8,3)',         type: 'rgb', bands: ['B11','B8','B3']},
  {name: 'NDVI',                 type: 'ndvi'}
];

var LS_COMPOSITES = [
  {name: 'Natural Color (L8/9: 4,3,2 | L4-7: 3,2,1)',           type: 'rgb', bands: ['RED','GREEN','BLUE']},
  {name: 'Highlight Optimized Natural Color (L8/9: 4,3,2 | L4-7: 3,2,1)', type: 'highlight_rgb', bands: ['RED','GREEN','BLUE']},
  {name: 'Color Infrared (L8/9: 5,4,3 | L4-7: 4,3,2)',          type: 'rgb', bands: ['NIR','RED','GREEN']},
  {name: 'False Color (Urban) (L8/9: 7,6,4 | L4-7: 7,5,3)',     type: 'rgb', bands: ['SWIR2','SWIR1','RED']},
  {name: 'Agriculture (L8/9: 6,5,2 | L4-7: 5,4,1)',             type: 'rgb', bands: ['SWIR1','NIR','BLUE']},
  {name: 'Geology (L8/9: 7,6,2 | L4-7: 7,5,1)',                 type: 'rgb', bands: ['SWIR2','SWIR1','BLUE']},
  {name: 'Atmospheric Penetration (L8/9: 7,6,5 | L4-7: 7,5,4)', type: 'rgb', bands: ['SWIR2','SWIR1','NIR']},
  {name: 'Healthy Vegetation (L8/9: 5,6,2 | L4-7: 4,5,1)',      type: 'rgb', bands: ['NIR','SWIR1','BLUE']},
  {name: 'Land/Water (L8/9: 5,6,4 | L4-7: 4,5,3)',              type: 'rgb', bands: ['NIR','SWIR1','RED']},
  {name: 'Shortwave Infrared (L8/9: 7,5,4 | L4-7: 7,4,3)',      type: 'rgb', bands: ['SWIR2','NIR','RED']},
  {name: 'Vegetation Analysis (L8/9: 6,5,4 | L4-7: 5,4,3)',     type: 'rgb', bands: ['SWIR1','NIR','RED']},
  {name: 'Bathymetric (L8/9: 4,3,1* | L4-7: 3,2,1)',            type: 'rgb', bands: ['RED','GREEN','BLUE']},
  {name: 'NDVI',                            type: 'ndvi'}
];

var S1_VIZ = [
  {name: 'Auto single (prefer VH)', kind: 'auto_single'},
  {name: 'Auto RGB ratio (dual-pol)', kind: 'auto_rgb_ratio'}, // [co, cross, cross-co] dB
  {name: 'Band: VV', kind: 'band', band: 'VV'},
  {name: 'Band: VH', kind: 'band', band: 'VH'},
  {name: 'Band: HH', kind: 'band', band: 'HH'},
  {name: 'Band: HV', kind: 'band', band: 'HV'},
  {name: 'Index: cross - co (dB) (auto)', kind: 'auto_cross_minus_co'},
  {name: 'NDPI (auto dual-pol)', kind: 'auto_ndpi'},
  {name: 'RVI4S1-like (auto dual-pol)', kind: 'auto_rvi'}
];

function getByName(list, name, fallbackIdx) {
  for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
  return list[fallbackIdx || 0];
}

// -------------------------
// App State
// -------------------------
var state = {
  poi: null,
  poiLayer: null,
  bufferLayer: null,
  poiPicking: true,
  aoiMode: 'Point',
  aoiPolygon: null,

  queryDone: false,

  // Active layers
  resultsLayers: {}, // key -> ui.Map.Layer
  layerMeta: {},     // key -> {group, sensorKey, ids, labelBase, s1:{pols,mode}, baseKey, vizKey, layerName}
  layerFamilies: {}, // baseKey -> [variantKey1, variantKey2, ...]
  waterLayer: null,
  waterEntries: [],
  s1ReducerLayer: null,
  exportDownloadUrl: null,

  // Lists
  // S2/LS: items are {date, ids[], cloudMean, tileCount}
  // S1: items are {date, ids[], tileCount, pass, relOrbit, mode, pols}
  lists: {
    S2: {items: [], page: 0, sensorKey: 'S2_L1C', totalTiles: 0},
    LS: {items: [], page: 0, sensorKey: 'Landsat_TOA', totalTiles: 0},
    S1: {items: [], page: 0, sensorKey: 'S1'}
  }
};

// -------------------------
// Map
// -------------------------
var map = ui.Map();
map.setOptions('SATELLITE');
map.style().set({cursor: 'crosshair'});
ui.root.widgets().reset([map]);

var drawingTools = map.drawingTools();
drawingTools.setShown(false);

function getDrawingLayer() {
  if (drawingTools.layers().length() === 0) {
    drawingTools.layers().add(ui.Map.GeometryLayer({geometries: [], name: 'AOI polygon', color: 'yellow'}));
  }
  return drawingTools.layers().get(0);
}

function clearDrawingLayerGeometry() {
  if (drawingTools.layers().length() === 0) return;
  var gl = drawingTools.layers().get(0);
  gl.geometries().reset([]);
}

function updatePolygonFromDrawing() {
  if (drawingTools.layers().length() === 0) return;
  var gl = drawingTools.layers().get(0);
  var geoms = gl.geometries();
  if (geoms.length() === 0) {
    state.aoiPolygon = null;
    return;
  }
  state.aoiPolygon = ee.Geometry(geoms.get(0));
  poiInfo.setValue('AOI polygon: ready');
  statusLabel.setValue('AOI polygon ready. Click "Query imagery".');
}

drawingTools.onDraw(updatePolygonFromDrawing);
drawingTools.onEdit(updatePolygonFromDrawing);

// -------------------------
// Helpers
// -------------------------
function fmtDateUTC(ms) {
  var d = new Date(Number(ms));
  return d.toISOString().slice(0, 10);
}
function fmtTimeUTC(ms) {
  var d = new Date(Number(ms));
  return d.toISOString().slice(11, 16);
}
function fmtTodayUTC() { return new Date().toISOString().slice(0, 10); }
function isIsoDate(str) { return /^\d{4}-\d{2}-\d{2}$/.test(String(str || '')); }

function smallLabel(txt) {
  return ui.Label(txt, {fontSize: '12px', color: '#555', whiteSpace: 'pre', margin: '0 0 6px 0'});
}
function placeholder(txt) {
  return ui.Label(txt, {fontSize: '12px', color: '#777', whiteSpace: 'pre', margin: '6px 0 0 0'});
}

function listHas(arr, val) {
  if (!arr) return false;
  for (var i = 0; i < arr.length; i++) if (String(arr[i]) === String(val)) return true;
  return false;
}
function dbToLin(dbImg) { return ee.Image(10).pow(dbImg.divide(10)); }

// -------------------------
// Query-time getters
// -------------------------
function getS2Level() { return s2LevelSelect.getValue(); }
function getLSLevel() { return landsatLevelSelect.getValue(); }
function getS1ModeFilter() { return s1ModeSelect.getValue(); }

// -------------------------
// Display-time getters
// -------------------------
function useCloudRemoval() { return cloudRemovalCheckbox.getValue() === true; }
function getS2Composite() { return getByName(S2_COMPOSITES, s2CompositeSelect.getValue(), 0); }
function getLSComposite() { return getByName(LS_COMPOSITES, lsCompositeSelect.getValue(), 0); }
function getS1VizPreset() { return getByName(S1_VIZ, s1VizSelect.getValue(), 0); }

// -------------------------
// Masks & scaling
// -------------------------
function maskS2_L2A_SCL(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(mask);
}
function maskS2_L1C_QA60(img) {
  var qa = img.select('QA60');
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  return img.updateMask(mask);
}
function maskLandsatClouds_QA_PIXEL(img) {
  var qa = img.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(1 << 1).eq(0)
    .and(qa.bitwiseAnd(1 << 2).eq(0))
    .and(qa.bitwiseAnd(1 << 3).eq(0))
    .and(qa.bitwiseAnd(1 << 4).eq(0))
    .and(qa.bitwiseAnd(1 << 5).eq(0));
  return img.updateMask(mask);
}
function scaleLandsatSR(img) {
  var optical = img.select(['SR_B.']).multiply(0.0000275).add(-0.2);
  return img.addBands(optical, null, true);
}


function getLandsatSpacecraftId(img) {
  return ee.String(ee.Algorithms.If(
    img.propertyNames().contains('SPACECRAFT_ID'),
    img.get('SPACECRAFT_ID'),
    ee.Algorithms.If(img.propertyNames().contains('SATELLITE'), img.get('SATELLITE'), 'LANDSAT_8')
  ));
}

function landsatSelectBand(img, sensorKey, oliBand, tmBand) {
  var sc = getLandsatSpacecraftId(img);
  var isOli = ee.List(['LANDSAT_8', 'LANDSAT_9']).contains(sc);

  if (sensorKey === 'Landsat_L2SR') {
    return ee.Image(ee.Algorithms.If(
      isOli,
      img.select('SR_B' + oliBand),
      img.select('SR_B' + tmBand)
    ));
  }

  return ee.Image(ee.Algorithms.If(
    isOli,
    img.select('B' + oliBand),
    img.select('B' + tmBand)
  ));
}

function landsatToCommonBands(img, sensorKey) {
  var src = (sensorKey === 'Landsat_L2SR') ? scaleLandsatSR(img) : img;
  var blue = landsatSelectBand(src, sensorKey, 2, 1);
  var green = landsatSelectBand(src, sensorKey, 3, 2);
  var red = landsatSelectBand(src, sensorKey, 4, 3);
  var nir = landsatSelectBand(src, sensorKey, 5, 4);
  var swir1 = landsatSelectBand(src, sensorKey, 6, 5);
  var swir2 = landsatSelectBand(src, sensorKey, 7, 7);
  return ee.Image.cat([
    blue.rename('BLUE'),
    green.rename('GREEN'),
    red.rename('RED'),
    nir.rename('NIR'),
    swir1.rename('SWIR1'),
    swir2.rename('SWIR2')
  ]);
}

function applyHighlightOptimizedNaturalColor(img, bands, isSurfaceReflectance) {
  var red = img.select(bands[0]).multiply(0.6);
  var green = img.select(bands[1]).multiply(0.6);
  var blue = img.select(bands[2]).multiply(0.6);

  if (!isSurfaceReflectance) {
    red = red.subtract(0.035);
    green = green.subtract(0.035);
    blue = blue.subtract(0.035);
  }

  return ee.Image.cat([
    red.max(0).pow(1 / 3).rename('R'),
    green.max(0).pow(1 / 3).rename('G'),
    blue.max(0).pow(1 / 3).rename('B')
  ]);
}

// -------------------------
// Visualization params
// -------------------------
function opticalVisParams() { return {min: 0.02, max: 0.35, gamma: 1.1}; }
function highlightNaturalColorVisParams() { return {min: 0, max: 0.9, gamma: 1}; }
function ndviVisParams() { return {min: 0, max: 1, palette: ['#8c510a','#d8b365','#f6e8c3','#c7eae5','#5ab4ac','#01665e']}; }
function s1BandVisParams() { return {min: -25, max: 0}; }
function s1DiffVisParams() { return {min: -12, max: 6, palette: ['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c']}; }
function s1Index01VisParams() { return {min: 0, max: 1, palette: ['#8e0152','#de77ae','#f7f7f7','#7fbc41','#276419']}; }

function getVisForSensor(sensorKey) {
  if (sensorKey === 'S1') {
    var p = getS1VizPreset();
    if (p.kind === 'auto_ndpi') return {min: -1, max: 1, palette: ['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c']};
    if (p.kind === 'auto_rvi') return s1Index01VisParams();
    if (p.kind === 'auto_cross_minus_co') return s1DiffVisParams();
    return s1BandVisParams();
  }
  if (sensorKey.indexOf('S2_') === 0) {
    var s2Comp = getS2Composite();
    if (s2Comp.type === 'ndvi') return ndviVisParams();
    if (s2Comp.type === 'highlight_rgb') return highlightNaturalColorVisParams();
    return opticalVisParams();
  }
  if (sensorKey.indexOf('Landsat_') === 0) {
    var lsComp = getLSComposite();
    if (lsComp.type === 'ndvi') return ndviVisParams();
    if (lsComp.type === 'highlight_rgb') return highlightNaturalColorVisParams();
    return opticalVisParams();
  }
  return opticalVisParams();
}

// -------------------------
// Build display images (mosaics for S2/LS/S1)
// -------------------------
function makeDisplayImage(sensorKey, idsOrId, meta) {
  var ids = (Array.isArray(idsOrId)) ? idsOrId : [idsOrId];

  if (sensorKey === 'S1') {
    var s1Mosaic = ee.ImageCollection.fromImages(ids.map(function(id){ return ee.Image(id); })).mosaic();
    return makeS1DisplayImage(s1Mosaic, meta);
  }

  var col = ee.ImageCollection.fromImages(ids.map(function(id){ return ee.Image(id); }));

  if (sensorKey === 'S2_L1C' || sensorKey === 'S2_L2A') {
    var comp = getS2Composite();
    var maskOn = useCloudRemoval();

    col = col.map(function(img) {
      img = ee.Image(img);
      if (maskOn) img = (sensorKey === 'S2_L2A') ? maskS2_L2A_SCL(img) : maskS2_L1C_QA60(img);
      if (comp.type === 'ndvi') return img.normalizedDifference(['B8','B4']).rename('NDVI');
      var scaled = img.select(comp.bands).multiply(0.0001);
      if (comp.type === 'highlight_rgb') {
        return applyHighlightOptimizedNaturalColor(scaled, comp.bands, sensorKey === 'S2_L2A');
      }
      return scaled;
    });

    return col.mosaic();
  }

  if (sensorKey === 'Landsat_TOA' || sensorKey === 'Landsat_L2SR') {
    var compL = getLSComposite();
    var maskOnL = useCloudRemoval();

    col = col.map(function(img) {
      img = ee.Image(img);

      if (maskOnL) {
        img = ee.Image(ee.Algorithms.If(img.bandNames().contains('QA_PIXEL'), maskLandsatClouds_QA_PIXEL(img), img));
      }

      var common = landsatToCommonBands(img, sensorKey);
      if (compL.type === 'ndvi') {
        return common.normalizedDifference(['NIR','RED']).rename('NDVI');
      }

      if (compL.type === 'highlight_rgb') {
        return applyHighlightOptimizedNaturalColor(common, compL.bands, sensorKey === 'Landsat_L2SR');
      }

      return common.select(compL.bands);
    });

    return col.mosaic();
  }

  return null;
}

function makeS1DisplayImage(img, meta) {
  var pols = meta && meta.s1 && meta.s1.pols ? meta.s1.pols : null;

  var hasVV = listHas(pols, 'VV');
  var hasVH = listHas(pols, 'VH');
  var hasHH = listHas(pols, 'HH');
  var hasHV = listHas(pols, 'HV');

  function pickAutoSingle() {
    if (hasVH) return img.select('VH');
    if (hasVV) return img.select('VV');
    if (hasHV) return img.select('HV');
    if (hasHH) return img.select('HH');

    return ee.Image(ee.Algorithms.If(img.bandNames().contains('VH'), img.select('VH'),
      ee.Algorithms.If(img.bandNames().contains('VV'), img.select('VV'),
        ee.Algorithms.If(img.bandNames().contains('HV'), img.select('HV'), img.select('HH')))));
  }

  function chooseCoCross() {
    if (hasVV && hasVH) return {co: 'VV', cross: 'VH'};
    if (hasHH && hasHV) return {co: 'HH', cross: 'HV'};
    return null;
  }

  var preset = getS1VizPreset();

  if (preset.kind === 'auto_single') return pickAutoSingle();

  if (preset.kind === 'band') {
    if (listHas(pols, preset.band)) return img.select(preset.band);
    return pickAutoSingle();
  }

  if (preset.kind === 'auto_rgb_ratio') {
    var cc = chooseCoCross();
    if (!cc) return pickAutoSingle();
    var co = img.select(cc.co);
    var cross = img.select(cc.cross);
    var diff = cross.subtract(co);
    return ee.Image.cat([co.rename('R'), cross.rename('G'), diff.rename('B')]);
  }

  if (preset.kind === 'auto_cross_minus_co') {
    var cc2 = chooseCoCross();
    if (!cc2) return pickAutoSingle();
    return img.select(cc2.cross).subtract(img.select(cc2.co)).rename('cross_minus_co_db');
  }

  if (preset.kind === 'auto_ndpi') {
    var cc3 = chooseCoCross();
    if (!cc3) return pickAutoSingle();
    var coLin = dbToLin(img.select(cc3.co));
    var crossLin = dbToLin(img.select(cc3.cross));
    return coLin.subtract(crossLin).divide(coLin.add(crossLin)).rename('NDPI');
  }

  if (preset.kind === 'auto_rvi') {
    var cc4 = chooseCoCross();
    if (!cc4) return pickAutoSingle();
    var coLin2 = dbToLin(img.select(cc4.co));
    var crossLin2 = dbToLin(img.select(cc4.cross));
    var q = crossLin2.divide(coLin2);
    return q.multiply(q.add(3)).divide(q.add(1).multiply(q.add(1))).rename('RVI4S1_like');
  }

  return pickAutoSingle();
}

function getWaterMethodsForType(sensorType) {
  if (sensorType === 'RADAR') {
    return [
      'Co-pol backscatter threshold (dB)',
      'Cross-pol backscatter threshold (dB)'
    ];
  }
  return [
    'MNDWI (Xu, 2006) threshold',
    'AWEIsh (Feyisa et al., 2014) threshold'
  ];
}

function detectWaterMask(sensorKey, idsOrId, meta, methodName, thresholdVal) {
  var t = Number(thresholdVal);

  if (sensorKey === 'S2_L1C' || sensorKey === 'S2_L2A') {
    var s2 = ee.ImageCollection.fromImages((Array.isArray(idsOrId) ? idsOrId : [idsOrId]).map(function(id){ return ee.Image(id); })).mosaic().multiply(0.0001);
    if (methodName.indexOf('MNDWI') === 0) {
      return s2.normalizedDifference(['B3', 'B11']).rename('water').gt(t);
    }
    var awei = s2.expression(
      '4*(GREEN - SWIR1) - (0.25*NIR + 2.75*SWIR2)',
      {GREEN: s2.select('B3'), SWIR1: s2.select('B11'), NIR: s2.select('B8'), SWIR2: s2.select('B12')}
    );
    return awei.rename('water').gt(t);
  }

  if (sensorKey === 'Landsat_TOA' || sensorKey === 'Landsat_L2SR') {
    var l = ee.ImageCollection.fromImages((Array.isArray(idsOrId) ? idsOrId : [idsOrId]).map(function(id){ return ee.Image(id); })).mosaic();
    var commonL = landsatToCommonBands(l, sensorKey);

    var green = commonL.select('GREEN');
    var nir = commonL.select('NIR');
    var swir1 = commonL.select('SWIR1');
    var swir2 = commonL.select('SWIR2');

    if (methodName.indexOf('MNDWI') === 0) {
      return green.subtract(swir1).divide(green.add(swir1)).rename('water').gt(t);
    }
    var aweiL = ee.Image().expression(
      '4*(GREEN - SWIR1) - (0.25*NIR + 2.75*SWIR2)',
      {GREEN: green, SWIR1: swir1, NIR: nir, SWIR2: swir2}
    );
    return aweiL.rename('water').gt(t);
  }

  if (sensorKey === 'S1') {
    var s1Ids = (Array.isArray(idsOrId) ? idsOrId : [idsOrId]);
    var s1 = ee.ImageCollection.fromImages(s1Ids.map(function(id){ return ee.Image(id); })).mosaic();
    var pols = meta && meta.s1 && meta.s1.pols ? meta.s1.pols : [];

    var coBand = listHas(pols, 'VV') ? 'VV' : (listHas(pols, 'HH') ? 'HH' : 'VV');
    var crossBand = listHas(pols, 'VH') ? 'VH' : (listHas(pols, 'HV') ? 'HV' : null);

    var coImg = ee.Image(ee.Algorithms.If(s1.bandNames().contains(coBand), s1.select(coBand),
      ee.Algorithms.If(s1.bandNames().contains('VV'), s1.select('VV'),
        ee.Algorithms.If(s1.bandNames().contains('HH'), s1.select('HH'), s1.select(0)))));

    if (methodName.indexOf('Co-pol') === 0 || !crossBand) {
      return coImg.rename('water').lt(t);
    }

    var crossImg = ee.Image(ee.Algorithms.If(s1.bandNames().contains(crossBand), s1.select(crossBand),
      ee.Algorithms.If(s1.bandNames().contains('VH'), s1.select('VH'),
        ee.Algorithms.If(s1.bandNames().contains('HV'), s1.select('HV'), coImg))));

    return crossImg.rename('water').lt(t);
  }

  return ee.Image(0);
}

// -------------------------
// UI Widgets (created ONCE)
// -------------------------
var title = ui.Label('POI Imagery Explorer', {fontWeight: 'bold', fontSize: '18px', margin: '0 0 4px 0'});
var subtitle = ui.Label('S2 + Landsat 4/5/7/8/9 + Sentinel-1', {fontSize: '12px', color: '#555', margin: '0 0 8px 0'});

var referenceDateLabel = ui.Label('Reference date: (not queried yet)', {fontSize: '12px', color: '#555', margin: '0 0 6px 0'});
var statusLabel = ui.Label('Click the map to set the POI (first time).', {fontSize: '12px', margin: '0 0 8px 0'});
var poiInfo = ui.Label('POI: (none)', {fontSize: '12px', margin: '0 0 8px 0'});

var panelWidthSlider = ui.Slider({min: 320, max: 900, value: 520, step: 10, style: {stretch: 'horizontal'}});

var panelToggleBtn = ui.Button({
  label: '✕',
  style: {fontWeight: 'bold', width: '42px', height: '34px', margin: '0', padding: '0'},
  onClick: function() {
    uiState.panelOpen = !uiState.panelOpen;
    panelToggleBtn.setLabel(uiState.panelOpen ? '✕' : '☰');
    sidePanel.style().set('shown', uiState.panelOpen);
  }
});

// Buttons
var changePoiBtn = ui.Button({
  label: 'Change POI (enable map click)',
  style: {stretch: 'horizontal'},
  onClick: function() {
    state.poiPicking = true;
    statusLabel.setValue('POI selection enabled: click on the map to update the POI.');
  }
});
var zoomPoiBtn = ui.Button({
  label: 'Zoom to POI',
  style: {stretch: 'horizontal'},
  onClick: function() {
    if (!state.poi) return statusLabel.setValue('⚠️ No POI yet. Click the map to set one.');
    map.centerObject(state.poi, 12);
  }
});
var queryBtn = ui.Button({
  label: 'Query imagery',
  style: {stretch: 'horizontal', fontWeight: 'bold'},
  onClick: function() {
    runQuery();
  }
});
var clearBtn = ui.Button({
  label: 'Start over (clear everything)',
  style: {stretch: 'horizontal'},
  onClick: function() {
    clearAll();
    state.poiPicking = true;
    statusLabel.setValue('Cleared. Click the map to set a new POI.');
    referenceDateLabel.setValue('Reference date: (not queried yet)');
    dateModeSelect.setValue('Current date (lookback)', true);
    aoiModeSelect.setValue('Point', true);
    setView('Settings');
  }
});

// Query-time controls
var bufferSlider = ui.Slider({min: 0.5, max: 50, value: DEFAULTS.bufferKm, step: 0.5, style: {stretch: 'horizontal'}});
bufferSlider.onChange(function(){ if (state.aoiMode === 'Point' && state.poi) drawBuffer(); });

var aoiModeSelect = ui.Select({items: ['Point', 'Polygon'], value: 'Point', style: {stretch: 'horizontal'}});
var drawPolygonBtn = ui.Button({
  label: 'Draw AOI polygon',
  style: {stretch: 'horizontal'},
  onClick: function() {
    if (aoiModeSelect.getValue() !== 'Polygon') return statusLabel.setValue('Switch AOI mode to Polygon first.');
    getDrawingLayer();
    clearDrawingLayerGeometry();
    state.aoiPolygon = null;
    drawingTools.setShown(true);
    drawingTools.setShape('polygon');
    drawingTools.draw();
    statusLabel.setValue('Draw polygon on map (double-click to finish).');
  }
});
var clearPolygonBtn = ui.Button({
  label: 'Clear AOI polygon',
  style: {stretch: 'horizontal'},
  onClick: function() {
    state.aoiPolygon = null;
    clearDrawingLayerGeometry();
    poiInfo.setValue('AOI polygon: (none)');
    statusLabel.setValue('AOI polygon cleared.');
  }
});

function syncAoiModeUi() {
  var mode = aoiModeSelect.getValue();
  state.aoiMode = mode;
  var polygonMode = mode === 'Polygon';

  drawPolygonBtn.setDisabled(!polygonMode);
  clearPolygonBtn.setDisabled(!polygonMode);
  bufferSlider.setDisabled(polygonMode);
  drawingTools.setShown(polygonMode);

  if (polygonMode) {
    if (state.bufferLayer) { map.layers().remove(state.bufferLayer); state.bufferLayer = null; }
    if (state.poiLayer) { map.layers().remove(state.poiLayer); state.poiLayer = null; }
    poiInfo.setValue(state.aoiPolygon ? 'AOI polygon: ready' : 'AOI polygon: (none)');
    statusLabel.setValue('Polygon mode active. Draw AOI polygon, then query imagery.');
  } else {
    drawingTools.stop();
    drawingTools.setShown(false);
    poiInfo.setValue(state.poi ? 'POI: point selected' : 'POI: (none)');
    statusLabel.setValue('Point mode active. Click map to set POI.');
    if (state.poi) {
      state.poiLayer = ui.Map.Layer(state.poi, {color: 'yellow'}, 'POI', true);
      map.layers().add(state.poiLayer);
      drawBuffer();
    }
  }
}

aoiModeSelect.onChange(syncAoiModeUi);

var lookbackSlider = ui.Slider({min: 7, max: 365, value: DEFAULTS.lookbackDays, step: 1, style: {stretch: 'horizontal'}});
var dateModeSelect = ui.Select({items: ['Current date (lookback)', 'Tailored start/end'], value: 'Current date (lookback)', style: {stretch: 'horizontal'}});
var startDateBox = ui.Textbox({placeholder: 'YYYY-MM-DD', value: '', style: {stretch: 'horizontal'}});
var endDateBox = ui.Textbox({placeholder: 'YYYY-MM-DD', value: '', style: {stretch: 'horizontal'}});

function syncDateModeUi() {
  var tailored = dateModeSelect.getValue() === 'Tailored start/end';
  lookbackSlider.setDisabled(tailored);
  startDateBox.setDisabled(!tailored);
  endDateBox.setDisabled(!tailored);
  if (!tailored) {
    startDateBox.setValue('');
    endDateBox.setValue('');
  }
}

dateModeSelect.onChange(syncDateModeUi);
syncDateModeUi();
syncAoiModeUi();

var cloudSlider = ui.Slider({min: 0, max: 100, value: DEFAULTS.cloudMax, step: 1, style: {stretch: 'horizontal'}});
var maxImagesSlider = ui.Slider({min: 5, max: 400, value: DEFAULTS.maxImages, step: 1, style: {stretch: 'horizontal'}});

var autoQueryCheckbox = ui.Checkbox({label: 'Auto-query right after setting POI', value: DEFAULTS.autoQueryAfterPOI});
var s2LevelSelect = ui.Select({items: ['L1C (TOA)', 'L2A (SR)'], value: DEFAULTS.s2Level, style: {stretch: 'horizontal'}});
var landsatLevelSelect = ui.Select({items: ['TOA', 'L2 (SR)'], value: DEFAULTS.landsatLevel, style: {stretch: 'horizontal'}});
var s1ModeSelect = ui.Select({items: ['ANY', 'IW', 'EW', 'SM', 'WV'], value: DEFAULTS.s1ModeFilter, style: {stretch: 'horizontal'}});

// Display controls (Results)
var cloudRemovalCheckbox = ui.Checkbox({label: 'Cloud removal (display only)', value: false});
var s2CompositeSelect = ui.Select({items: S2_COMPOSITES.map(function(c){return c.name;}), value: S2_COMPOSITES[0].name, style: {stretch: 'horizontal'}});
var lsCompositeSelect = ui.Select({items: LS_COMPOSITES.map(function(c){return c.name;}), value: LS_COMPOSITES[0].name, style: {stretch: 'horizontal'}});
var s1VizSelect = ui.Select({items: S1_VIZ.map(function(v){return v.name;}), value: S1_VIZ[0].name, style: {stretch: 'horizontal'}});
var keepPreviousVizCheckbox = ui.Checkbox({label: 'Keep previous visualization when changing bands', value: false});

var s1ReducerSelect = ui.Select({
  items: ['Maximum', 'Minimum', 'Mean', 'Median'],
  value: 'Maximum',
  style: {stretch: 'horizontal'}
});
var runS1ReducerBtn = ui.Button({
  label: 'Add Sentinel-1 reducer layer',
  style: {stretch: 'horizontal'},
  onClick: function() { runS1ReducerLayer(); }
});
var clearS1ReducerBtn = ui.Button({
  label: 'Clear Sentinel-1 reducer layer',
  style: {stretch: 'horizontal'},
  onClick: function() { clearS1ReducerLayer(); }
});

function setDisplayControlsEnabled(isEnabled) {
  cloudRemovalCheckbox.setDisabled(!isEnabled);
  s2CompositeSelect.setDisabled(!isEnabled);
  lsCompositeSelect.setDisabled(!isEnabled);
  s1VizSelect.setDisabled(!isEnabled);
  keepPreviousVizCheckbox.setDisabled(!isEnabled);
  s1ReducerSelect.setDisabled(!isEnabled);
  runS1ReducerBtn.setDisabled(!isEnabled);
  clearS1ReducerBtn.setDisabled(!isEnabled);
  exportSourceSelect.setDisabled(!isEnabled);
  exportTargetSelect.setDisabled(!isEnabled);
  exportFormatSelect.setDisabled(!isEnabled);
  exportScaleBox.setDisabled(!isEnabled);
  exportMaxPixelsBox.setDisabled(!isEnabled);
  exportLargeCheckbox.setDisabled(!isEnabled);
  exportDescriptionBox.setDisabled(!isEnabled);
  runExportBtn.setDisabled(!isEnabled);
}
setDisplayControlsEnabled(false);

// Water detection controls
var waterSourceSelect = ui.Select({items: ['(run query first)'], value: '(run query first)', style: {stretch: 'horizontal'}});
var waterMethodSelect = ui.Select({items: getWaterMethodsForType('OPTICAL'), value: getWaterMethodsForType('OPTICAL')[0], style: {stretch: 'horizontal'}});
var waterThresholdBox = ui.Textbox({placeholder: 'Threshold', value: '0.0', style: {stretch: 'horizontal'}});
var waterStatusLabel = ui.Label('Choose an image and method, then run detection.', {fontSize: '12px', color: '#555'});
var runWaterBtn = ui.Button({
  label: 'Run water detection',
  style: {stretch: 'horizontal', fontWeight: 'bold'},
  onClick: function() {
    runWaterDetection();
  }
});
var clearWaterBtn = ui.Button({
  label: 'Clear water mask',
  style: {stretch: 'horizontal'},
  onClick: function() {
    clearWaterMask();
  }
});

waterSourceSelect.onChange(function() {
  refreshWaterMethodChoices();
});

waterMethodSelect.onChange(function(m) {
  if (m && m.indexOf('Co-pol') === 0) waterThresholdBox.setValue('-17');
  else if (m && m.indexOf('Cross-pol') === 0) waterThresholdBox.setValue('-24');
  else waterThresholdBox.setValue('0.0');
});

// Export controls
var exportSourceSelect = ui.Select({
  items: ['Top visible result layer', 'Visible result layers mosaic'],
  value: 'Top visible result layer',
  style: {stretch: 'horizontal'}
});
var exportTargetSelect = ui.Select({
  items: ['In-app download link', 'Google Drive task'],
  value: 'In-app download link',
  style: {stretch: 'horizontal'}
});
var exportFormatSelect = ui.Select({
  items: ['GeoTIFF', 'Cloud Optimized GeoTIFF'],
  value: 'GeoTIFF',
  style: {stretch: 'horizontal'}
});
var exportScaleBox = ui.Textbox({placeholder: 'Scale (m)', value: '', style: {stretch: 'horizontal'}});
var exportMaxPixelsBox = ui.Textbox({placeholder: 'Max pixels', value: '1e13', style: {stretch: 'horizontal'}});
var exportLargeCheckbox = ui.Checkbox({label: 'Allow large exports (> 2e8 px estimate)', value: false});
var exportDescriptionBox = ui.Textbox({placeholder: 'Export name', value: 'LanSenView_export', style: {stretch: 'horizontal'}});
var exportStatusLabel = ui.Label('Select a visible image layer and run export.', {fontSize: '12px', color: '#555'});
var exportLinkLabel = ui.Label('', {fontSize: '12px', color: '#1a73e8', shown: false});
var runExportBtn = ui.Button({
  label: 'Run export',
  style: {stretch: 'horizontal', fontWeight: 'bold'},
  onClick: function() { runExport(); }
});

function getVisibleResultLayerEntries() {
  var entries = [];
  var layers = map.layers();
  for (var i = 0; i < layers.length(); i++) {
    var lyr = layers.get(i);
    var key = null;
    Object.keys(state.resultsLayers).forEach(function(k) { if (state.resultsLayers[k] === lyr) key = k; });
    if (!key) continue;
    var shown = (lyr.getShown) ? lyr.getShown() : true;
    if (!shown) continue;
    var meta = state.layerMeta[key];
    if (!meta) continue;
    entries.push({index: i, key: key, layer: lyr, meta: meta});
  }
  entries.sort(function(a,b){ return a.index - b.index; });
  return entries;
}

function getMapViewRegion() {
  var b = map.getBounds(true);
  return ee.Geometry.Rectangle([b[0], b[1], b[2], b[3]], null, false);
}

function buildExportImageFromSelection() {
  var entries = getVisibleResultLayerEntries();
  if (!entries.length) return {error: 'No visible result layers. Tick at least one result first.'};

  var sourceMode = exportSourceSelect.getValue();
  if (sourceMode === 'Top visible result layer') {
    var top = entries[entries.length - 1];
    var imgTop = makeDisplayImage(top.meta.sensorKey, top.meta.ids, top.meta);
    return {image: ee.Image(imgTop), count: 1, sensor: top.meta.sensorKey, label: top.meta.labelBase};
  }

  var images = entries.map(function(e) { return makeDisplayImage(e.meta.sensorKey, e.meta.ids, e.meta); });
  var mos = ee.ImageCollection.fromImages(images).mosaic();
  return {image: mos, count: entries.length, sensor: 'MIXED', label: 'Visible layers mosaic'};
}

function getSelectedExportScale(img) {
  var val = String(exportScaleBox.getValue() || '').trim();
  if (val !== '') {
    var parsed = Number(val);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return img.projection().nominalScale();
}

function estimatePixelCount(region, scale, cb) {
  ee.Number(region.area(1).divide(ee.Number(scale).multiply(scale))).evaluate(function(v) { cb(Number(v || 0)); });
}

function runExport() {
  exportLinkLabel.style().set('shown', false);
  exportLinkLabel.setValue('');
  state.exportDownloadUrl = null;

  var sel = buildExportImageFromSelection();
  if (sel.error) {
    exportStatusLabel.setValue('⚠️ ' + sel.error);
    return;
  }

  var region = getMapViewRegion();
  var img = ee.Image(sel.image);
  var scale = getSelectedExportScale(img);
  var maxPixels = Number(String(exportMaxPixelsBox.getValue() || '1e13'));
  if (isNaN(maxPixels) || maxPixels <= 0) {
    exportStatusLabel.setValue('⚠️ Max pixels must be numeric and > 0.');
    return;
  }

  exportStatusLabel.setValue('⏳ Preparing export (' + sel.count + ' layer(s))...');
  estimatePixelCount(region, scale, function(px) {
    if (px > 2e8 && !exportLargeCheckbox.getValue()) {
      exportStatusLabel.setValue('⚠️ Large export (~' + Math.round(px / 1e6) + 'M px). Tick "Allow large exports" or use a larger scale.');
      return;
    }

    var desc = String(exportDescriptionBox.getValue() || 'LanSenView_export').trim() || 'LanSenView_export';
    var fmt = exportFormatSelect.getValue();
    var cloudOptimized = (fmt === 'Cloud Optimized GeoTIFF');

    if (exportTargetSelect.getValue() === 'Google Drive task') {
      Export.image.toDrive({
        image: img,
        description: desc,
        fileNamePrefix: desc,
        region: region,
        scale: scale,
        maxPixels: maxPixels,
        fileFormat: 'GeoTIFF',
        formatOptions: cloudOptimized ? {cloudOptimized: true} : null
      });
      exportStatusLabel.setValue('✅ Drive export task created. Open the Tasks tab to Run/Cancel it.');
      return;
    }

    var params = {
      name: desc,
      region: region,
      scale: scale,
      maxPixels: maxPixels,
      format: 'GEO_TIFF'
    };
    if (cloudOptimized) params.formatOptions = {cloudOptimized: true};

    img.getDownloadURL(params, function(url) {
      state.exportDownloadUrl = url;
      exportLinkLabel.setValue('Download ready: ' + url);
      exportLinkLabel.style().set('shown', true);
      exportStatusLabel.setValue('✅ Download link generated for current map extent.');
    });
  });
}

// Counts + result panels
var s2CountLabel = ui.Label('S2: 0', {fontSize: '12px', color: '#555'});
var lsCountLabel = ui.Label('Landsat: 0', {fontSize: '12px', color: '#555'});
var s1CountLabel = ui.Label('S1: 0', {fontSize: '12px', color: '#555'});

var s2ResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var lsResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var s1ResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});

var s2Pager = makePager('S2', s2ResultsPanel);
var lsPager = makePager('LS', lsResultsPanel);
var s1Pager = makePager('S1', s1ResultsPanel);

s2ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
lsResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
s1ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));

// -------------------------
// Fixed view panels (added ONCE)
// -------------------------
var settingsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var resultsPanel  = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var waterPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var exportPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});

function setView(viewName) {
  uiState.view = viewName;
  settingsPanel.style().set('shown', viewName === 'Settings');
  resultsPanel.style().set('shown', viewName === 'Results');
  waterPanel.style().set('shown', viewName === 'Water Detection');
  exportPanel.style().set('shown', viewName === 'Export');
}

// View buttons
var viewBar = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '0 0 8px 0'}});
viewBar.add(ui.Button({label:'Settings', style:{margin:'0 4px 0 0'}, onClick:function(){ setView('Settings'); }}));
viewBar.add(ui.Button({label:'Results',  style:{margin:'0 4px 0 0'}, onClick:function(){ setView('Results'); }}));
viewBar.add(ui.Button({label:'Water Detection', style:{margin:'0 4px 0 0'}, onClick:function(){ setView('Water Detection'); }}));
viewBar.add(ui.Button({label:'Export', style:{margin:'0 4px 0 0'}, onClick:function(){ setView('Export'); }}));

// Fill settings panel once
settingsPanel.add(smallLabel(
  'How to use:\n' +
  '1) Click map to set POI\n' +
  '2) Query imagery\n' +
  '3) Results: tick dates (S2/LS mosaics) or scenes (S1).'
));
settingsPanel.add(smallLabel('AOI mode')); settingsPanel.add(aoiModeSelect);
settingsPanel.add(drawPolygonBtn);
settingsPanel.add(clearPolygonBtn);
settingsPanel.add(referenceDateLabel);
settingsPanel.add(statusLabel);
settingsPanel.add(poiInfo);
settingsPanel.add(changePoiBtn);
settingsPanel.add(zoomPoiBtn);
settingsPanel.add(queryBtn);
settingsPanel.add(clearBtn);

settingsPanel.add(smallLabel('\nQuery settings'));
settingsPanel.add(smallLabel('Buffer (km)')); settingsPanel.add(bufferSlider);
settingsPanel.add(smallLabel('Date mode')); settingsPanel.add(dateModeSelect);
settingsPanel.add(smallLabel('Lookback (days; current-date mode)')); settingsPanel.add(lookbackSlider);
settingsPanel.add(smallLabel('Tailored start date (YYYY-MM-DD)')); settingsPanel.add(startDateBox);
settingsPanel.add(smallLabel('Tailored end date (YYYY-MM-DD)')); settingsPanel.add(endDateBox);
settingsPanel.add(smallLabel('Max cloud (%) (optical filter)')); settingsPanel.add(cloudSlider);
settingsPanel.add(smallLabel('Max dates per sensor (keep full mosaic per date)')); settingsPanel.add(maxImagesSlider);
settingsPanel.add(autoQueryCheckbox);

settingsPanel.add(smallLabel('\nProducts / filters'));
settingsPanel.add(smallLabel('Sentinel-2 product')); settingsPanel.add(s2LevelSelect);
settingsPanel.add(smallLabel('Landsat product')); settingsPanel.add(landsatLevelSelect);
settingsPanel.add(smallLabel('Sentinel-1 mode filter')); settingsPanel.add(s1ModeSelect);

// Fill results panel once
resultsPanel.add(ui.Label('Display controls (no re-query)', {fontWeight:'bold', margin:'0 0 4px 0'}));
resultsPanel.add(smallLabel('Panel width (px)'));
resultsPanel.add(panelWidthSlider);
resultsPanel.add(cloudRemovalCheckbox);
resultsPanel.add(smallLabel('Sentinel-2 composite')); resultsPanel.add(s2CompositeSelect);
resultsPanel.add(smallLabel('Landsat composite')); resultsPanel.add(lsCompositeSelect);
resultsPanel.add(smallLabel('Sentinel-1 visualization')); resultsPanel.add(s1VizSelect);
resultsPanel.add(keepPreviousVizCheckbox);

resultsPanel.add(ui.Label('Sentinel-2 (grouped by date; mosaics)', {fontWeight:'bold', margin:'10px 0 2px 0'}));
resultsPanel.add(s2CountLabel);
resultsPanel.add(s2Pager.container);
resultsPanel.add(s2ResultsPanel);

resultsPanel.add(ui.Label('Landsat (grouped by date; mosaics)', {fontWeight:'bold', margin:'10px 0 2px 0'}));
resultsPanel.add(lsCountLabel);
resultsPanel.add(lsPager.container);
resultsPanel.add(lsResultsPanel);

resultsPanel.add(ui.Label('Sentinel-1 (grouped by date; mosaics)', {fontWeight:'bold', margin:'10px 0 2px 0'}));
resultsPanel.add(s1CountLabel);
resultsPanel.add(s1Pager.container);
resultsPanel.add(s1ResultsPanel);

resultsPanel.add(smallLabel('Sentinel-1 reducer over filtered images'));
resultsPanel.add(s1ReducerSelect);
resultsPanel.add(runS1ReducerBtn);
resultsPanel.add(clearS1ReducerBtn);

waterPanel.add(ui.Label('Water Detection', {fontWeight:'bold', margin:'0 0 4px 0'}));
waterPanel.add(smallLabel('Select one queried image/date'));
waterPanel.add(waterSourceSelect);
waterPanel.add(smallLabel('Method'));
waterPanel.add(waterMethodSelect);
waterPanel.add(smallLabel('Threshold'));
waterPanel.add(waterThresholdBox);
waterPanel.add(runWaterBtn);
waterPanel.add(clearWaterBtn);
waterPanel.add(smallLabel('Defaults: optical=0.0; SAR co-pol=-17 dB; SAR cross-pol=-24 dB.'));
waterPanel.add(smallLabel('Output: blue water mask over selected source image.'));
waterPanel.add(waterStatusLabel);

exportPanel.add(ui.Label('Export', {fontWeight:'bold', margin:'0 0 4px 0'}));
exportPanel.add(smallLabel('Extent: current map view bounds'));
exportPanel.add(smallLabel('Source image selection'));
exportPanel.add(exportSourceSelect);
exportPanel.add(smallLabel('Target'));
exportPanel.add(exportTargetSelect);
exportPanel.add(smallLabel('Format'));
exportPanel.add(exportFormatSelect);
exportPanel.add(smallLabel('Scale (meters; empty = native highest nominal)'));
exportPanel.add(exportScaleBox);
exportPanel.add(smallLabel('Max pixels'));
exportPanel.add(exportMaxPixelsBox);
exportPanel.add(exportLargeCheckbox);
exportPanel.add(smallLabel('Export name'));
exportPanel.add(exportDescriptionBox);
exportPanel.add(runExportBtn);
exportPanel.add(smallLabel('Tip: If multiple layers are visible, choose Top visible layer to avoid conflicts.'));
exportPanel.add(smallLabel('Drive exports can be canceled from GEE Tasks tab.'));
exportPanel.add(exportStatusLabel);
exportPanel.add(exportLinkLabel);

// Start view
setView('Settings');

// -------------------------
// Side panel (added ONCE to uiContainer, never re-added elsewhere)
// -------------------------
var sidePanel = ui.Panel({
  style: {
    width: panelWidthSlider.getValue() + 'px',
    height: '740px',
    padding: '10px',
    backgroundColor: 'rgba(255,255,255,0.95)'
  }
});
sidePanel.add(title);
sidePanel.add(subtitle);
sidePanel.add(viewBar);
sidePanel.add(settingsPanel);
sidePanel.add(resultsPanel);
sidePanel.add(waterPanel);
sidePanel.add(exportPanel);

panelWidthSlider.onChange(function(v) {
  sidePanel.style().set('width', Number(v).toFixed(0) + 'px');
});

// -------------------------
// uiContainer: ONLY widget added to map.widgets() (never moved)
// -------------------------
var uiContainer = ui.Panel({
  layout: ui.Panel.Layout.flow('vertical'),
  style: {position: 'top-left', padding: '8px'}
});

// header row with toggle button
var toggleRow = ui.Panel({layout: ui.Panel.Layout.flow('horizontal')});
toggleRow.add(panelToggleBtn);

uiContainer.add(toggleRow);
uiContainer.add(sidePanel);

// initial show state
sidePanel.style().set('shown', uiState.panelOpen);

// Attach to map.widgets ONCE (no reset later)
map.widgets().reset([uiContainer]);

// -------------------------
// POI behavior
// -------------------------
map.onClick(function(coords) {
  if (state.aoiMode !== 'Point') return;
  if (!state.poi) {
    setPOI(coords.lon, coords.lat);
    statusLabel.setValue('POI set. Click "Query imagery".');
    if (autoQueryCheckbox.getValue()) runQuery();
    return;
  }
  if (state.poiPicking) {
    setPOI(coords.lon, coords.lat);
    state.poiPicking = false;
    statusLabel.setValue('POI updated. Click "Query imagery" (or auto-query if enabled).');
    if (autoQueryCheckbox.getValue()) runQuery();
  }
});

function setPOI(lon, lat) {
  if (state.poiLayer) map.layers().remove(state.poiLayer);
  if (state.bufferLayer) map.layers().remove(state.bufferLayer);

  state.poi = ee.Geometry.Point([lon, lat]);
  poiInfo.setValue('POI: ' + lon.toFixed(6) + ', ' + lat.toFixed(6));

  state.poiLayer = ui.Map.Layer(state.poi, {color: 'yellow'}, 'POI', true);
  map.layers().add(state.poiLayer);

  drawBuffer();
  map.centerObject(state.poi, 12);
}

function drawBuffer() {
  if (!state.poi) return;
  if (state.bufferLayer) map.layers().remove(state.bufferLayer);

  var buf = state.poi.buffer(bufferSlider.getValue() * 1000);
  state.bufferLayer = ui.Map.Layer(buf, {color: 'yellow'}, 'AOI buffer', false);
  map.layers().add(state.bufferLayer);
}

// -------------------------
// Live updates (no re-query)
// -------------------------
cloudRemovalCheckbox.onChange(function(){ if(state.queryDone){ updateActiveLayersByGroup('S2'); updateActiveLayersByGroup('LS'); }});
s2CompositeSelect.onChange(function(){ if(state.queryDone){ updateActiveLayersByGroup('S2'); }});
lsCompositeSelect.onChange(function(){ if(state.queryDone){ updateActiveLayersByGroup('LS'); }});
s1VizSelect.onChange(function(){ if(state.queryDone){ updateActiveLayersByGroup('S1'); }});

function getS1Reducer() {
  var v = s1ReducerSelect.getValue();
  if (v === 'Minimum') return 'min';
  if (v === 'Mean') return 'mean';
  if (v === 'Median') return 'median';
  return 'max';
}

function collectS1IdsAndPols() {
  var ids = [];
  var polSet = {};
  state.lists.S1.items.forEach(function(item) {
    if (item.ids) {
      item.ids.forEach(function(id) { ids.push(id); });
    }
    if (item.pols) {
      item.pols.forEach(function(p) { polSet[String(p)] = true; });
    }
  });
  return {ids: ids, pols: Object.keys(polSet)};
}

function runS1ReducerLayer() {
  if (!state.queryDone || !state.lists.S1.items.length) {
    statusLabel.setValue('⚠️ Query Sentinel-1 images first.');
    return;
  }

  var data = collectS1IdsAndPols();
  if (!data.ids.length) {
    statusLabel.setValue('⚠️ No Sentinel-1 scenes available for reducer.');
    return;
  }

  var reducerName = getS1Reducer();
  var col = ee.ImageCollection.fromImages(data.ids.map(function(id) { return ee.Image(id); }));
  var reduced = ee.Image(ee.Algorithms.If(
    reducerName === 'min', col.min(),
    ee.Algorithms.If(reducerName === 'mean', col.mean(),
      ee.Algorithms.If(reducerName === 'median', col.median(), col.max()))
  ));

  var display = makeS1DisplayImage(reduced, {s1: {pols: data.pols}});
  var vis = getVisForSensor('S1');
  var label = 'S1 reducer (' + reducerName + ') | scenes ' + data.ids.length;

  if (!state.s1ReducerLayer) {
    state.s1ReducerLayer = ui.Map.Layer(display, vis, label, true);
    map.layers().add(state.s1ReducerLayer);
  } else if (state.s1ReducerLayer.setEeObject && state.s1ReducerLayer.setVisParams) {
    state.s1ReducerLayer.setEeObject(display);
    state.s1ReducerLayer.setVisParams(vis);
    if (state.s1ReducerLayer.setName) state.s1ReducerLayer.setName(label);
  } else {
    map.layers().remove(state.s1ReducerLayer);
    state.s1ReducerLayer = ui.Map.Layer(display, vis, label, true);
    map.layers().add(state.s1ReducerLayer);
  }
  statusLabel.setValue('✅ Added Sentinel-1 reducer layer (' + reducerName + ').');
}

function clearS1ReducerLayer() {
  if (!state.s1ReducerLayer) return;
  map.layers().remove(state.s1ReducerLayer);
  state.s1ReducerLayer = null;
}

s1ReducerSelect.onChange(function() {
  if (state.s1ReducerLayer && state.queryDone) runS1ReducerLayer();
});

function getWaterSelectionEntries() {
  var entries = [];

  state.lists.S2.items.forEach(function(item) {
    entries.push({
      label: 'S2 | ' + item.date + ' | ' + item.tileCount + ' tiles',
      sensorKey: state.lists.S2.sensorKey,
      ids: item.ids,
      which: 'S2',
      meta: {s1: null}
    });
  });

  state.lists.LS.items.forEach(function(item) {
    entries.push({
      label: 'Landsat | ' + item.date + ' | ' + item.tileCount + ' scenes',
      sensorKey: state.lists.LS.sensorKey,
      ids: item.ids,
      which: 'LS',
      meta: {s1: null}
    });
  });

  state.lists.S1.items.forEach(function(item) {
    entries.push({
      label: 'S1 | ' + item.date + ' | ' + item.tileCount + ' scenes',
      sensorKey: state.lists.S1.sensorKey,
      ids: item.ids,
      which: 'S1',
      meta: {s1: {pols: item.pols, mode: item.mode}}
    });
  });

  return entries;
}

function updateWaterSourceOptions() {
  var entries = getWaterSelectionEntries();
  state.waterEntries = entries;

  if (entries.length === 0) {
    waterSourceSelect.items().reset(['(run query first)']);
    waterSourceSelect.setValue('(run query first)', true);
    waterStatusLabel.setValue('No queried images yet. Run Query imagery first.');
    return;
  }

  var labels = entries.map(function(e){ return e.label; });
  waterSourceSelect.items().reset(labels);
  waterSourceSelect.setValue(labels[0], true);
  refreshWaterMethodChoices();
}

function getSelectedWaterEntry() {
  var label = waterSourceSelect.getValue();
  if (!label || !state.waterEntries) return null;
  for (var i = 0; i < state.waterEntries.length; i++) {
    if (state.waterEntries[i].label === label) return state.waterEntries[i];
  }
  return null;
}

function refreshWaterMethodChoices() {
  var entry = getSelectedWaterEntry();
  var type = (entry && entry.sensorKey === 'S1') ? 'RADAR' : 'OPTICAL';
  var methods = getWaterMethodsForType(type);
  waterMethodSelect.items().reset(methods);
  waterMethodSelect.setValue(methods[0], true);
  if (type === 'RADAR') waterThresholdBox.setValue('-17');
  else waterThresholdBox.setValue('0.0');
}

function clearWaterMask() {
  if (state.waterLayer) {
    map.layers().remove(state.waterLayer);
    state.waterLayer = null;
  }
  waterStatusLabel.setValue('Water mask cleared.');
}

function runWaterDetection() {
  var entry = getSelectedWaterEntry();
  if (!entry) return waterStatusLabel.setValue('Select a queried image/date first.');

  var t = Number(waterThresholdBox.getValue());
  if (isNaN(t)) return waterStatusLabel.setValue('Threshold must be numeric.');

  clearWaterMask();
  var mask = detectWaterMask(entry.sensorKey, entry.ids, entry.meta, waterMethodSelect.getValue(), t).selfMask();
  var layer = ui.Map.Layer(mask, {palette: ['0000FF'], opacity: 0.65}, 'Water mask', true);
  map.layers().add(layer);
  state.waterLayer = layer;
  waterStatusLabel.setValue('Water mask displayed in blue.');
}

function getQueryDateRange() {
  if (dateModeSelect.getValue() === 'Tailored start/end') {
    var startStr = String(startDateBox.getValue() || '').trim();
    var endStr = String(endDateBox.getValue() || '').trim();

    if (!isIsoDate(startStr) || !isIsoDate(endStr)) {
      return {error: 'Use YYYY-MM-DD for start/end in tailored mode.'};
    }

    var startJs = new Date(startStr + 'T00:00:00Z');
    var endJs = new Date(endStr + 'T00:00:00Z');
    if (isNaN(startJs.getTime()) || isNaN(endJs.getTime())) {
      return {error: 'Invalid tailored dates.'};
    }
    if (startJs.getTime() > endJs.getTime()) {
      return {error: 'Tailored start date must be before or equal to end date.'};
    }

    var eeStart = ee.Date(startStr);
    var eeEndExclusive = ee.Date(endStr).advance(1, 'day');
    return {start: eeStart, end: eeEndExclusive, label: 'Reference range: ' + startStr + ' → ' + endStr};
  }

  var nowStr = fmtTodayUTC();
  var now = ee.Date(Date.now());
  var start = now.advance(-lookbackSlider.getValue(), 'day');
  return {start: start, end: now, label: 'Reference date: ' + nowStr + ' (lookback ' + lookbackSlider.getValue() + ' days)'};
}

// -------------------------
// Query
// -------------------------
function runQuery() {
  clearResultsOnly();
  state.queryDone = false;
  setDisplayControlsEnabled(false);

  var dateRange = getQueryDateRange();
  if (dateRange.error) {
    statusLabel.setValue('⚠️ ' + dateRange.error);
    return;
  }

  referenceDateLabel.setValue(dateRange.label);
  statusLabel.setValue('⏳ Querying collections…');

  var buf;
  if (state.aoiMode === 'Polygon') {
    if (!state.aoiPolygon) { statusLabel.setValue('⚠️ Draw an AOI polygon first.'); return; }
    buf = state.aoiPolygon;
  } else {
    if (!state.poi) { statusLabel.setValue('⚠️ Please set a POI first (click map).'); return; }
    buf = state.poi.buffer(bufferSlider.getValue() * 1000);
  }
  var start = dateRange.start;
  var end = dateRange.end;
  var cloudMax = cloudSlider.getValue();
  var limitN = maxImagesSlider.getValue();

  // Sentinel-2
  var s2Mode = getS2Level();
  var s2ColId = (s2Mode === 'L2A (SR)') ? 'COPERNICUS/S2_SR_HARMONIZED' : 'COPERNICUS/S2_HARMONIZED';
  state.lists.S2.sensorKey = (s2Mode === 'L2A (SR)') ? 'S2_L2A' : 'S2_L1C';

  var s2 = ee.ImageCollection(s2ColId)
    .filterBounds(buf)
    .filterDate(start, end)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudMax))
    .sort('system:time_start', false);

  // Landsat
  var lsMode = getLSLevel();
  state.lists.LS.sensorKey = (lsMode === 'L2 (SR)') ? 'Landsat_L2SR' : 'Landsat_TOA';

  var ls = (lsMode === 'L2 (SR)')
    ? ee.ImageCollection('LANDSAT/LT04/C02/T1_L2')
        .merge(ee.ImageCollection('LANDSAT/LT05/C02/T1_L2'))
        .merge(ee.ImageCollection('LANDSAT/LE07/C02/T1_L2'))
        .merge(ee.ImageCollection('LANDSAT/LC08/C02/T1_L2'))
        .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
    : ee.ImageCollection('LANDSAT/LT04/C02/T1_TOA')
        .merge(ee.ImageCollection('LANDSAT/LT05/C02/T1_TOA'))
        .merge(ee.ImageCollection('LANDSAT/LE07/C02/T1_TOA'))
        .merge(ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA'))
        .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_TOA'));

  ls = ls.filterBounds(buf)
    .filterDate(start, end)
    .filter(ee.Filter.lte('CLOUD_COVER', cloudMax))
    .sort('system:time_start', false);

  // Sentinel-1
  var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(buf)
    .filterDate(start, end)
    .sort('system:time_start', false);

  var modeFilter = getS1ModeFilter();
  if (modeFilter !== 'ANY') s1 = s1.filter(ee.Filter.eq('instrumentMode', modeFilter));

  var pending = 3;
  function doneOne() {
    pending--;
    if (pending === 0) {
      state.queryDone = true;
      setDisplayControlsEnabled(true);

      statusLabel.setValue('✅ Query complete. Go to Results and tick dates/scenes.');
      setView('Results');

      renderResults('S2');
      renderResults('LS');
      renderResults('S1');
      updateWaterSourceOptions();
    }
  }

  fetchS2GroupedByDate(s2, limitN, function(payload) {
    state.lists.S2.items = payload.items;
    state.lists.S2.totalTiles = payload.totalTiles;
    state.lists.S2.page = 0;
    s2CountLabel.setValue('S2 dates: ' + payload.items.length + ' (tiles: ' + payload.totalTiles + ')');
    doneOne();
  });

  fetchLSGroupedByDate(ls, limitN, function(payload) {
    state.lists.LS.items = payload.items;
    state.lists.LS.totalTiles = payload.totalTiles;
    state.lists.LS.page = 0;
    lsCountLabel.setValue('Landsat dates: ' + payload.items.length + ' (scenes: ' + payload.totalTiles + ')');
    doneOne();
  });

  fetchS1GroupedByDate(s1, limitN, function(payload) {
    state.lists.S1.items = payload.items;
    state.lists.S1.page = 0;
    s1CountLabel.setValue('S1 dates: ' + payload.items.length + ' (scenes: ' + payload.totalTiles + ')');
    doneOne();
  });
}

// ---- Grouped fetchers ----
function fetchS2GroupedByDate(col, maxDates, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    c: col.aggregate_array('CLOUDY_PIXEL_PERCENTAGE')
  });

  dict.evaluate(function(d) {
    var byDate = {};
    var totalTiles = 0;

    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        totalTiles++;
        var date = fmtDateUTC(d.t[i]);
        if (!byDate[date]) byDate[date] = {date: date, ids: [], clouds: [], tMin: null, tMax: null};
        byDate[date].ids.push(d.ids[i]);
        var tVal = Number(d.t[i]);
        if (byDate[date].tMin === null || tVal < byDate[date].tMin) byDate[date].tMin = tVal;
        if (byDate[date].tMax === null || tVal > byDate[date].tMax) byDate[date].tMax = tVal;
        if (d.c && d.c[i] != null) byDate[date].clouds.push(Number(d.c[i]));
      }
    }

    var items = Object.keys(byDate).map(function(k) {
      var g = byDate[k];
      var mean = null;
      if (g.clouds.length > 0) {
        var sum = 0;
        for (var j = 0; j < g.clouds.length; j++) sum += g.clouds[j];
        mean = sum / g.clouds.length;
      }
      return {date: g.date, ids: g.ids, cloudMean: mean, tileCount: g.ids.length, timeMin: g.tMin, timeMax: g.tMax};
    });

    items.sort(function(a,b){ return b.date.localeCompare(a.date); });
    if (maxDates != null && maxDates > 0) items = items.slice(0, Number(maxDates));
    cb({items: items, totalTiles: totalTiles});
  });
}

function fetchLSGroupedByDate(col, maxDates, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    c: col.aggregate_array('CLOUD_COVER'),
    spacecraft: col.aggregate_array('SPACECRAFT_ID')
  });

  dict.evaluate(function(d) {
    var byDate = {};
    var totalTiles = 0;

    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        totalTiles++;
        var date = fmtDateUTC(d.t[i]);
        if (!byDate[date]) byDate[date] = {date: date, ids: [], clouds: [], missions: {}, tMin: null, tMax: null};
        byDate[date].ids.push(d.ids[i]);
        var tVal = Number(d.t[i]);
        if (byDate[date].tMin === null || tVal < byDate[date].tMin) byDate[date].tMin = tVal;
        if (byDate[date].tMax === null || tVal > byDate[date].tMax) byDate[date].tMax = tVal;
        if (d.c && d.c[i] != null) byDate[date].clouds.push(Number(d.c[i]));
        var sc = (d.spacecraft && d.spacecraft[i]) ? String(d.spacecraft[i]) : null;
        if (sc) byDate[date].missions[sc] = true;
      }
    }

    var items = Object.keys(byDate).map(function(k) {
      var g = byDate[k];
      var mean = null;
      if (g.clouds.length > 0) {
        var sum = 0;
        for (var j = 0; j < g.clouds.length; j++) sum += g.clouds[j];
        mean = sum / g.clouds.length;
      }
      return {
        date: g.date,
        ids: g.ids,
        cloudMean: mean,
        tileCount: g.ids.length,
        missions: Object.keys(g.missions).sort(),
        timeMin: g.tMin,
        timeMax: g.tMax
      };
    });

    items.sort(function(a,b){ return b.date.localeCompare(a.date); });
    if (maxDates != null && maxDates > 0) items = items.slice(0, Number(maxDates));
    cb({items: items, totalTiles: totalTiles});
  });
}

function fetchS1GroupedByDate(col, maxDates, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    pass: col.aggregate_array('orbitProperties_pass'),
    ro: col.aggregate_array('relativeOrbitNumber_start'),
    mode: col.aggregate_array('instrumentMode'),
    pols: col.aggregate_array('transmitterReceiverPolarisation')
  });

  dict.evaluate(function(d) {
    var byDate = {};
    var totalTiles = 0;

    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        totalTiles++;
        var date = fmtDateUTC(d.t[i]);
        if (!byDate[date]) byDate[date] = {date: date, ids: [], pass: [], ro: [], mode: [], pols: [], tMin: null, tMax: null};
        byDate[date].ids.push(d.ids[i]);
        var tVal = Number(d.t[i]);
        if (byDate[date].tMin === null || tVal < byDate[date].tMin) byDate[date].tMin = tVal;
        if (byDate[date].tMax === null || tVal > byDate[date].tMax) byDate[date].tMax = tVal;
        if (d.pass && d.pass[i] != null) byDate[date].pass.push(String(d.pass[i]));
        if (d.ro && d.ro[i] != null) byDate[date].ro.push(String(d.ro[i]));
        if (d.mode && d.mode[i] != null) byDate[date].mode.push(String(d.mode[i]));
        if (d.pols && d.pols[i]) byDate[date].pols.push(d.pols[i]);
      }
    }

    var items = Object.keys(byDate).map(function(k) {
      var g = byDate[k];
      var pass = (g.pass.length > 0) ? g.pass[0] : null;
      var relOrbit = (g.ro.length > 0) ? g.ro[0] : null;
      var mode = (g.mode.length > 0) ? g.mode[0] : null;
      var pols = (g.pols.length > 0) ? g.pols[0] : null;
      return {
        date: g.date,
        ids: g.ids,
        tileCount: g.ids.length,
        pass: pass,
        relOrbit: relOrbit,
        mode: mode,
        pols: pols,
        timeMin: g.tMin,
        timeMax: g.tMax
      };
    });

    items.sort(function(a,b){ return b.date.localeCompare(a.date); });
    if (maxDates != null && maxDates > 0) items = items.slice(0, Number(maxDates));
    cb({items: items, totalTiles: totalTiles});
  });
}

// -------------------------
// Pagination
// -------------------------
function makePager(which, targetPanel) {
  var prevBtn = ui.Button({
    label: 'Prev',
    onClick: function() {
      state.lists[which].page = Math.max(0, state.lists[which].page - 1);
      renderResults(which);
    }
  });
  var nextBtn = ui.Button({
    label: 'Next',
    onClick: function() {
      var maxPage = Math.max(0, Math.ceil(state.lists[which].items.length / PAGE_SIZE) - 1);
      state.lists[which].page = Math.min(maxPage, state.lists[which].page + 1);
      renderResults(which);
    }
  });
  var pageLbl = ui.Label('Page 1/1', {fontSize: '12px', margin: '6px 8px 0 8px'});

  var container = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '0 0 6px 0'}});
  container.add(prevBtn); container.add(pageLbl); container.add(nextBtn);
  return {container: container, pageLbl: pageLbl};
}

// -------------------------
// Render results
// -------------------------
function renderResults(which) {
  var list = state.lists[which];
  var items = list.items || [];
  var page = list.page || 0;
  var totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  var start = page * PAGE_SIZE;
  var end = Math.min(items.length, start + PAGE_SIZE);

  var sensorKey = list.sensorKey;
  var panel = (which === 'S2') ? s2ResultsPanel : (which === 'LS') ? lsResultsPanel : s1ResultsPanel;
  var pager = (which === 'S2') ? s2Pager : (which === 'LS') ? lsPager : s1Pager;

  panel.clear();
  pager.pageLbl.setValue('Page ' + (page + 1) + '/' + totalPages);

  if (items.length === 0) {
    panel.add(placeholder('No images found. Try bigger buffer, wider date window, or higher cloud threshold.'));
    return;
  }

  for (var i = start; i < end; i++) {
    (function(item) {
      var key, labelBase, idsOrId, s1meta;

      if (which === 'S2' || which === 'LS') {
        key = sensorKey + '::' + item.date;
        idsOrId = item.ids;
        labelBase = buildLabelBaseGrouped(which, item);
        s1meta = null;
      } else {
        key = sensorKey + '::' + item.date;
        idsOrId = item.ids;
        labelBase = buildLabelBaseS1(item);
        s1meta = {pols: item.pols, mode: item.mode};
      }

      var cb = ui.Checkbox({
        label: labelBase,
        value: layerFamilyHasActive(key),
        onChange: function(checked) {
          var info = {key: key, ids: idsOrId, labelBase: labelBase, s1: s1meta};
          if (checked) {
            addOrUpdateLayer(sensorKey, which, info);
          } else {
            removeLayer(key);
          }
        }
      });

      var zBtn = ui.Button({
        label: 'Zoom',
        style: {margin: '0 0 0 6px'},
        onClick: function() {
          var firstId = (Array.isArray(idsOrId)) ? idsOrId[0] : idsOrId;
          map.centerObject(ee.Image(firstId).geometry(), 10);
        }
      });

      var row = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '0 0 4px 0'}});
      row.add(cb); row.add(zBtn);
      panel.add(row);
    })(items[i]);
  }
}

function landsatMissionShortName(sc) {
  var s = String(sc || '');
  if (s === 'LANDSAT_9') return 'L9';
  if (s === 'LANDSAT_8') return 'L8';
  if (s === 'LANDSAT_7') return 'L7';
  if (s === 'LANDSAT_5') return 'L5';
  if (s === 'LANDSAT_4') return 'L4';
  return s;
}

function buildLabelBaseGrouped(which, item) {
  var mean = (item.cloudMean != null) ? item.cloudMean.toFixed(1) + '%' : 'n/a';
  var timeLabel = (item.timeMin != null) ? fmtTimeUTC(item.timeMin) + ((item.timeMax != null && item.timeMax !== item.timeMin) ? '–' + fmtTimeUTC(item.timeMax) : '') + ' UTC' : 'time n/a';
  if (which === 'S2') return item.date + ' | ' + timeLabel + ' | tiles ' + item.tileCount + ' | cloud ' + mean;
  var missions = (item.missions && item.missions.length)
    ? item.missions.map(landsatMissionShortName).join(',')
    : 'L?';
  return item.date + ' | ' + timeLabel + ' | scenes ' + item.tileCount + ' | ' + missions + ' | cloud ' + mean;
}

function buildLabelBaseS1(item) {
  var pass = item.pass ? String(item.pass) : 'n/a';
  var ro = (item.relOrbit != null) ? String(item.relOrbit) : 'n/a';
  var mode = item.mode ? String(item.mode) : 'n/a';
  var pols = item.pols ? item.pols.join(',') : 'n/a';
  var timeLabel = (item.timeMin != null) ? fmtTimeUTC(item.timeMin) + ((item.timeMax != null && item.timeMax !== item.timeMin) ? '–' + fmtTimeUTC(item.timeMax) : '') + ' UTC' : 'time n/a';
  return item.date + ' | ' + timeLabel + ' | scenes ' + item.tileCount + ' | mode ' + mode + ' | pols ' + pols + ' | ' + pass + ' | relOrb ' + ro;
}

// -------------------------
// Layer management
// -------------------------
function groupFromWhich(which) { return (which === 'S2') ? 'S2' : (which === 'LS') ? 'LS' : 'S1'; }

function getCurrentVizNameForGroup(group) {
  if (group === 'S2') return getS2Composite().name;
  if (group === 'LS') return getLSComposite().name;
  return getS1VizPreset().name;
}

function buildLayerName(labelBase, group, vizKey) {
  if (!vizKey) return labelBase;
  if (group === 'S1') return labelBase + ' | Viz: ' + vizKey;
  return labelBase + ' | Composite: ' + vizKey;
}

function ensureLayerFamily(baseKey) {
  if (!state.layerFamilies[baseKey]) state.layerFamilies[baseKey] = [];
  return state.layerFamilies[baseKey];
}

function layerFamilyHasActive(baseKey) {
  var family = state.layerFamilies[baseKey] || [];
  for (var i = 0; i < family.length; i++) if (state.resultsLayers[family[i]]) return true;
  return false;
}

function addVariantKeyToFamily(baseKey, variantKey) {
  var family = ensureLayerFamily(baseKey);
  if (family.indexOf(variantKey) === -1) family.push(variantKey);
}

function addOrUpdateLayer(sensorKey, which, info) {
  var baseKey = info.key;
  var group = groupFromWhich(which);
  var vizKey = getCurrentVizNameForGroup(group);
  var variantKey = baseKey;

  if (keepPreviousVizCheckbox.getValue() && state.resultsLayers[baseKey]) {
    variantKey = baseKey + '::' + vizKey;
  }

  addVariantKeyToFamily(baseKey, variantKey);

  state.layerMeta[variantKey] = {
    group: group,
    sensorKey: sensorKey,
    ids: info.ids,
    labelBase: info.labelBase,
    s1: info.s1 || null,
    baseKey: baseKey,
    vizKey: vizKey,
    layerName: buildLayerName(info.labelBase, group, variantKey === baseKey ? null : vizKey)
  };

  var img = makeDisplayImage(sensorKey, info.ids, state.layerMeta[variantKey]);
  var vis = getVisForSensor(sensorKey);

  if (!state.resultsLayers[variantKey]) {
    var layer = ui.Map.Layer(img, vis, state.layerMeta[variantKey].layerName, true);
    map.layers().add(layer);
    state.resultsLayers[variantKey] = layer;
  } else {
    updateLayerObject(variantKey);
  }
}

function updateLayerObject(key) {
  var meta = state.layerMeta[key];
  var layer = state.resultsLayers[key];
  if (!meta || !layer) return;

  var img = makeDisplayImage(meta.sensorKey, meta.ids, meta);
  var vis = getVisForSensor(meta.sensorKey);

  if (layer.setEeObject && layer.setVisParams) {
    layer.setEeObject(img);
    layer.setVisParams(vis);
    if (layer.setName) layer.setName(meta.layerName || meta.labelBase);
    return;
  }

  var layers = map.layers();
  var idx = -1;
  for (var i = 0; i < layers.length(); i++) {
    if (layers.get(i) === layer) { idx = i; break; }
  }
  if (idx >= 0) {
    var newLayer = ui.Map.Layer(img, vis, meta.layerName || meta.labelBase, true);
    layers.set(idx, newLayer);
    state.resultsLayers[key] = newLayer;
  }
}

function updateActiveLayersByGroup(group) {
  var preserve = keepPreviousVizCheckbox.getValue();
  var baseKeys = {};

  Object.keys(state.resultsLayers).forEach(function(key) {
    var meta = state.layerMeta[key];
    if (meta && meta.group === group) {
      baseKeys[meta.baseKey || key] = meta;
    }
  });

  Object.keys(baseKeys).forEach(function(baseKey) {
    var meta = baseKeys[baseKey];
    if (!preserve) {
      var family = state.layerFamilies[baseKey] || [baseKey];
      for (var i = 0; i < family.length; i++) {
        if (family[i] !== baseKey) removeVariantLayer(family[i]);
      }
      ensureLayerFamily(baseKey);
      state.layerFamilies[baseKey] = [baseKey];
      if (state.layerMeta[baseKey]) {
        state.layerMeta[baseKey].vizKey = getCurrentVizNameForGroup(group);
        state.layerMeta[baseKey].layerName = state.layerMeta[baseKey].labelBase;
      }
      updateLayerObject(baseKey);
      return;
    }

    addOrUpdateLayer(meta.sensorKey, meta.group, {
      key: baseKey,
      ids: meta.ids,
      labelBase: meta.labelBase,
      s1: meta.s1
    });
  });
}

function removeVariantLayer(key) {
  if (!state.resultsLayers[key]) return;
  var meta = state.layerMeta[key];
  map.layers().remove(state.resultsLayers[key]);
  delete state.resultsLayers[key];
  delete state.layerMeta[key];

  if (meta && meta.baseKey && state.layerFamilies[meta.baseKey]) {
    state.layerFamilies[meta.baseKey] = state.layerFamilies[meta.baseKey].filter(function(k) { return k !== key; });
    if (state.layerFamilies[meta.baseKey].length === 0) delete state.layerFamilies[meta.baseKey];
  }
}

function removeLayer(key) {
  var family = state.layerFamilies[key] || [key];
  family.slice().forEach(function(variantKey) { removeVariantLayer(variantKey); });
  delete state.layerFamilies[key];
}

// -------------------------
// Clear
// -------------------------
function clearResultsOnly() {
  Object.keys(state.resultsLayers).forEach(function(k) { map.layers().remove(state.resultsLayers[k]); });
  state.resultsLayers = {};
  state.layerMeta = {};
  state.layerFamilies = {};
  state.waterEntries = [];
  clearS1ReducerLayer();

  state.lists.S2.items = []; state.lists.S2.page = 0; state.lists.S2.totalTiles = 0;
  state.lists.LS.items = []; state.lists.LS.page = 0; state.lists.LS.totalTiles = 0;
  state.lists.S1.items = []; state.lists.S1.page = 0;

  s2CountLabel.setValue('S2: 0');
  lsCountLabel.setValue('Landsat: 0');
  s1CountLabel.setValue('S1: 0');

  s2ResultsPanel.clear(); lsResultsPanel.clear(); s1ResultsPanel.clear();
  s2ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
  lsResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
  s1ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));

  clearWaterMask();
  updateWaterSourceOptions();
  exportLinkLabel.setValue('');
  exportLinkLabel.style().set('shown', false);
  exportStatusLabel.setValue('Select a visible image layer and run export.');
  state.exportDownloadUrl = null;
}

function clearAll() {
  clearResultsOnly();
  if (state.poiLayer) map.layers().remove(state.poiLayer);
  if (state.bufferLayer) map.layers().remove(state.bufferLayer);

  state.poi = null;
  state.poiLayer = null;
  state.bufferLayer = null;
  state.aoiPolygon = null;
  clearDrawingLayerGeometry();
  poiInfo.setValue('POI: (none)');

  state.queryDone = false;
  setDisplayControlsEnabled(false);
  aoiModeSelect.setValue('Point', true);
}

// -------------------------
// POI
// -------------------------
map.onClick(function(coords) {
  if (state.aoiMode !== 'Point') return;
  if (!state.poi) {
    setPOI(coords.lon, coords.lat);
    statusLabel.setValue('POI set. Click "Query imagery".');
    if (autoQueryCheckbox.getValue()) runQuery();
    return;
  }
  if (state.poiPicking) {
    setPOI(coords.lon, coords.lat);
    state.poiPicking = false;
    statusLabel.setValue('POI updated. Click "Query imagery" (or auto-query if enabled).');
    if (autoQueryCheckbox.getValue()) runQuery();
  }
});

function setPOI(lon, lat) {
  if (state.poiLayer) map.layers().remove(state.poiLayer);
  if (state.bufferLayer) map.layers().remove(state.bufferLayer);

  state.poi = ee.Geometry.Point([lon, lat]);
  poiInfo.setValue('POI: ' + lon.toFixed(6) + ', ' + lat.toFixed(6));

  state.poiLayer = ui.Map.Layer(state.poi, {color: 'yellow'}, 'POI', true);
  map.layers().add(state.poiLayer);

  drawBuffer();
  map.centerObject(state.poi, 12);
}

function drawBuffer() {
  if (!state.poi) return;
  if (state.bufferLayer) map.layers().remove(state.bufferLayer);

  var buf = state.poi.buffer(bufferSlider.getValue() * 1000);
  state.bufferLayer = ui.Map.Layer(buf, {color: 'yellow'}, 'AOI buffer', false);
  map.layers().add(state.bufferLayer);
}

// -------------------------
// Live updates (no re-query)
// -------------------------
cloudRemovalCheckbox.onChange(function(){ if(state.queryDone){ updateActiveLayersByGroup('S2'); updateActiveLayersByGroup('LS'); }});
s2CompositeSelect.onChange(function(){ if(state.queryDone){ updateActiveLayersByGroup('S2'); }});
lsCompositeSelect.onChange(function(){ if(state.queryDone){ updateActiveLayersByGroup('LS'); }});
s1VizSelect.onChange(function(){ if(state.queryDone){ updateActiveLayersByGroup('S1'); }});

// -------------------------
// Init map
// -------------------------
map.setCenter(0, 0, 2);
statusLabel.setValue('Click the map to set the POI (first time).');
