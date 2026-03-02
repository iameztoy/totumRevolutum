/***************************************
 * POI Imagery Explorer (S2 + Landsat + S1)
 *
 * Fixes:
 * - Sentinel-1 GRD is already in dB in GEE -> NO extra dB conversion (fixes white/blank)
 * - Adds Sentinel-2 composite list from Sentinel Hub composites page
 * - Adds Landsat composites with band matching (closest spectral equivalents)
 * - No ui.TabPanel, no 'overflow' style
 * - Results are paginated to avoid global page scroll
 *
 * Defaults:
 * - Optical default: non-atmos corrected (S2 L1C TOA + Landsat TOA)
 * - Lookback default: 30 days
 ****************************************/

// -------------------------
// Defaults
// -------------------------
var DEFAULTS = {
  bufferKm: 5,
  lookbackDays: 30,
  cloudMax: 30,
  maxImages: 40,
  applyCloudMask: false,    // optional; default OFF
  autoQueryAfterPOI: true,
  s1Pol: 'VH',              // default VH
  s2Level: 'L1C (TOA)',     // default non-atmos corrected
  landsatLevel: 'TOA',      // default non-atmos corrected
  composite: 'True Color (4,3,2)' // default composite
};

var PAGE_SIZE = 10;

// -------------------------
// Composite definitions (Sentinel-2 list)
// Source: Sentinel Hub "Simple RGB Composites (Sentinel-2)"
// -------------------------
var COMPOSITES = [
  {name: 'True Color (4,3,2)',   s2: ['B4','B3','B2'],  s2_nums: [4,3,2]},
  {name: 'False Color (8,4,3)',  s2: ['B8','B4','B3'],  s2_nums: [8,4,3]},
  {name: 'SWIR (12,8,4)',        s2: ['B12','B8','B4'], s2_nums: [12,8,4]},
  {name: 'Agriculture (11,8,2)', s2: ['B11','B8','B2'], s2_nums: [11,8,2]},
  {name: 'Geology (12,11,2)',    s2: ['B12','B11','B2'],s2_nums: [12,11,2]},
  {name: 'Bathymetric (4,3,1)',  s2: ['B4','B3','B1'],  s2_nums: [4,3,1]},
  {name: 'RGB (8,6,4)',          s2: ['B8','B6','B4'],  s2_nums: [8,6,4]},
  {name: 'RGB (8,5,4)',          s2: ['B8','B5','B4'],  s2_nums: [8,5,4]},
  {name: 'RGB (8,11,4)',         s2: ['B8','B11','B4'], s2_nums: [8,11,4]},
  {name: 'RGB (8,11,12)',        s2: ['B8','B11','B12'],s2_nums: [8,11,12]},
  {name: 'RGB (11,8,3)',         s2: ['B11','B8','B3'], s2_nums: [11,8,3]},
  // Extra (not from the composites page)
  {name: 'NDVI (extra)',         s2: null,              s2_nums: null, isNdvi: true}
];

// Map Sentinel-2 band number to closest Landsat 8/9 reflective band number
// Notes:
// - S2 B1 coastal -> L8 B1
// - S2 B2 blue -> L8 B2
// - S2 B3 green -> L8 B3
// - S2 B4 red -> L8 B4
// - S2 B5/B6 red-edge -> no direct Landsat match -> approximate with NIR (L8 B5)
// - S2 B8 NIR -> L8 B5
// - S2 B11 SWIR1 -> L8 B6
// - S2 B12 SWIR2 -> L8 B7
function mapS2NumToLandsatNum(s2n) {
  if (s2n === 1) return 1;
  if (s2n === 2) return 2;
  if (s2n === 3) return 3;
  if (s2n === 4) return 4;
  if (s2n === 5) return 5; // red-edge -> approx NIR
  if (s2n === 6) return 5; // red-edge -> approx NIR
  if (s2n === 8) return 5; // NIR
  if (s2n === 11) return 6; // SWIR1
  if (s2n === 12) return 7; // SWIR2
  // fallback
  return 5;
}

function getCompositeByName(name) {
  for (var i = 0; i < COMPOSITES.length; i++) {
    if (COMPOSITES[i].name === name) return COMPOSITES[i];
  }
  return COMPOSITES[0];
}

// -------------------------
// State
// -------------------------
var state = {
  poi: null,
  poiLayer: null,
  bufferLayer: null,
  poiPicking: true,

  resultsLayers: {},   // key -> ui.Map.Layer
  activeKey: null,

  lists: {
    S2: { items: [], page: 0, sensorKey: 'S2_L1C', countLabel: null },
    LS: { items: [], page: 0, sensorKey: 'Landsat_TOA', countLabel: null },
    S1: { items: [], page: 0, sensorKey: 'S1', countLabel: null }
  },

  referenceDateStr: null
};

var uiState = { panelOpen: true, view: 'Settings' };

// -------------------------
// Map
// -------------------------
var map = ui.Map();
map.setOptions('SATELLITE');
map.style().set({cursor: 'crosshair'});
ui.root.widgets().reset([map]);

// -------------------------
// Helpers: date formatting
// -------------------------
function fmtDateUTC(ms) {
  var d = new Date(Number(ms));
  return d.toISOString().slice(0, 10);
}
function fmtTodayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// -------------------------
// Helpers: masks & scaling
// -------------------------
function maskS2_L2A_SCL(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3)
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));
  return img.updateMask(mask);
}

function maskS2_L1C_QA60(img) {
  var qa = img.select('QA60');
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
    .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
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

// -------------------------
// UI getters
// -------------------------
function useCloudRemoval() { return applyMaskCheckbox.getValue() === true; }
function getS2Level() { return s2LevelSelect.getValue(); }              // L1C/L2A
function getLSLevel() { return landsatLevelSelect.getValue(); }         // TOA/L2
function getS1Pol() { return s1PolSelect.getValue(); }                  // VH/VV/VV+VH
function getCompositeName() { return compositeSelect.getValue(); }
function getComposite() { return getCompositeByName(getCompositeName()); }

// -------------------------
// Visualization params
// -------------------------
function getOpticalVisParams() {
  // Keep a stable stretch; works reasonably across composites
  // (user can still tweak later if you want to add sliders)
  return {min: 0.02, max: 0.35, gamma: 1.1};
}

function getNdviVisParams() {
  return {min: 0, max: 1, palette: ['#8c510a','#d8b365','#f6e8c3','#c7eae5','#5ab4ac','#01665e']};
}

function getS1VisParams() {
  // Sentinel-1 GRD in GEE is already in dB
  // Typical stretch
  var pol = getS1Pol();
  if (pol === 'VV+VH') return {min: -25, max: 0};
  return {min: -25, max: 0};
}

// -------------------------
// Build display image per sensor
// -------------------------
function makeDisplayImage(sensorKey, systemId) {
  var maskOn = useCloudRemoval();
  var comp = getComposite();

  // --- Sentinel-2 ---
  if (sensorKey === 'S2_L1C' || sensorKey === 'S2_L2A') {
    var s2 = ee.Image(systemId);

    if (maskOn) {
      s2 = (sensorKey === 'S2_L2A') ? maskS2_L2A_SCL(s2) : maskS2_L1C_QA60(s2);
    }

    // NDVI (extra)
    if (comp.isNdvi) {
      // For S2 both L1C/L2A have B8 and B4
      return s2.normalizedDifference(['B8','B4']).rename('NDVI');
    }

    // RGB composites
    // Scale S2 reflectance to 0..1
    return s2.select(comp.s2).multiply(0.0001);
  }

  // --- Landsat 8/9 ---
  if (sensorKey === 'Landsat_TOA' || sensorKey === 'Landsat_L2SR') {
    var l = ee.Image(systemId);

    // Optional cloud removal if QA_PIXEL exists
    if (maskOn) {
      l = ee.Image(ee.Algorithms.If(l.bandNames().contains('QA_PIXEL'), maskLandsatClouds_QA_PIXEL(l), l));
    }

    // NDVI (extra)
    if (comp.isNdvi) {
      // Landsat: NIR = 5, Red = 4 (both TOA and SR)
      if (sensorKey === 'Landsat_L2SR') {
        l = scaleLandsatSR(l);
        return l.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI');
      } else {
        return l.normalizedDifference(['B5','B4']).rename('NDVI');
      }
    }

    // Build Landsat band names by mapping S2 band numbers -> Landsat band numbers
    var s2nums = comp.s2_nums; // [..]
    var lnums = s2nums.map(mapS2NumToLandsatNum);

    function lBandName(n) {
      return (sensorKey === 'Landsat_L2SR') ? ('SR_B' + n) : ('B' + n);
    }

    var bands = [lBandName(lnums[0]), lBandName(lnums[1]), lBandName(lnums[2])];

    if (sensorKey === 'Landsat_L2SR') {
      l = scaleLandsatSR(l);
      return l.select(bands);
    } else {
      return l.select(bands);
    }
  }

  // --- Sentinel-1 ---
  if (sensorKey === 'S1') {
    var s1 = ee.Image(systemId);
    var pol = getS1Pol();

    // IMPORTANT: S1 in GEE is already dB. Do not convert.
    if (pol === 'VH') return s1.select('VH');
    if (pol === 'VV') return s1.select('VV');

    // VV+VH composite: [VV, VH, VV-VH] (all in dB)
    var vv = s1.select('VV');
    var vh = s1.select('VH');
    var vvMinusVh = vv.subtract(vh);
    return ee.Image.cat([vv.rename('R'), vh.rename('G'), vvMinusVh.rename('B')]);
  }

  return null;
}

// -------------------------
// Panel toggle button (always accessible)
// -------------------------
var panelToggleBtn = ui.Button({
  label: '✕',
  style: {fontWeight: 'bold', width: '42px', height: '34px', margin: '0', padding: '0'},
  onClick: function() {
    uiState.panelOpen = !uiState.panelOpen;
    panelToggleBtn.setLabel(uiState.panelOpen ? '✕' : '☰');
    renderWidgets();
  }
});

var toggleContainer = ui.Panel({
  style: {position: 'top-left', padding: '8px', width: '60px'}
});
toggleContainer.add(panelToggleBtn);

// -------------------------
// UI building blocks
// -------------------------
function smallLabel(txt) {
  return ui.Label(txt, {fontSize: '12px', color: '#555', whiteSpace: 'pre', margin: '0 0 6px 0'});
}
function placeholder(txt) {
  return ui.Label(txt, {fontSize: '12px', color: '#777', whiteSpace: 'pre', margin: '6px 0 0 0'});
}

var title = ui.Label('POI Imagery Explorer', {fontWeight: 'bold', fontSize: '18px', margin: '0 0 4px 0'});
var subtitle = ui.Label('S2 (L1C/L2A) + Landsat 8/9 (TOA/SR) + Sentinel-1', {fontSize: '12px', color: '#555', margin: '0 0 8px 0'});

var referenceDateLabel = ui.Label('Reference date: (not queried yet)', {fontSize: '12px', color: '#555', margin: '0 0 6px 0'});
var statusLabel = ui.Label('Click the map to set the POI (first time).', {fontSize: '12px', margin: '0 0 8px 0'});
var poiInfo = ui.Label('POI: (none)', {fontSize: '12px', margin: '0 0 8px 0'});

// View switch buttons
function viewBtn(label, viewName) {
  return ui.Button({
    label: label,
    style: {stretch: 'horizontal', margin: '0 4px 0 0'},
    onClick: function() {
      uiState.view = viewName;
      renderView();
    }
  });
}
var settingsBtn = viewBtn('Settings', 'Settings');
var resultsBtn  = viewBtn('Results', 'Results');
var previewBtn  = viewBtn('Preview', 'Preview');

var viewBar = ui.Panel({
  layout: ui.Panel.Layout.flow('horizontal'),
  style: {margin: '0 0 8px 0'}
});
viewBar.add(settingsBtn);
viewBar.add(resultsBtn);
viewBar.add(previewBtn);

// Controls
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
    if (!state.poi) return statusLabel.setValue('⚠️ Please set a POI first (click map).');
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
    uiState.view = 'Settings';
    renderView();
  }
});

// Sliders/selectors
var bufferSlider = ui.Slider({min: 0.5, max: 50, value: DEFAULTS.bufferKm, step: 0.5, style: {stretch: 'horizontal'}});
bufferSlider.onChange(function(){ if (state.poi) drawBuffer(); });

var lookbackSlider = ui.Slider({min: 7, max: 365, value: DEFAULTS.lookbackDays, step: 1, style: {stretch: 'horizontal'}});
var cloudSlider = ui.Slider({min: 0, max: 100, value: DEFAULTS.cloudMax, step: 1, style: {stretch: 'horizontal'}});
var maxImagesSlider = ui.Slider({min: 5, max: 150, value: DEFAULTS.maxImages, step: 1, style: {stretch: 'horizontal'}});

var applyMaskCheckbox = ui.Checkbox({label: 'Cloud removal (optional, default OFF)', value: DEFAULTS.applyCloudMask});
var autoQueryCheckbox = ui.Checkbox({label: 'Auto-query right after setting POI', value: DEFAULTS.autoQueryAfterPOI});

var s2LevelSelect = ui.Select({
  items: ['L1C (TOA)', 'L2A (SR)'],
  value: DEFAULTS.s2Level,
  style: {stretch: 'horizontal'}
});

var landsatLevelSelect = ui.Select({
  items: ['TOA', 'L2 (SR)'],
  value: DEFAULTS.landsatLevel,
  style: {stretch: 'horizontal'}
});

var compositeSelect = ui.Select({
  items: COMPOSITES.map(function(c){ return c.name; }),
  value: DEFAULTS.composite,
  style: {stretch: 'horizontal'}
});

var s1PolSelect = ui.Select({
  items: ['VH', 'VV', 'VV+VH'],
  value: DEFAULTS.s1Pol,
  style: {stretch: 'horizontal'}
});

// Results panels + pagers
var s2CountLabel = ui.Label('S2: 0', {fontSize: '12px', color: '#555'});
var lsCountLabel = ui.Label('Landsat: 0', {fontSize: '12px', color: '#555'});
var s1CountLabel = ui.Label('S1: 0', {fontSize: '12px', color: '#555'});
state.lists.S2.countLabel = s2CountLabel;
state.lists.LS.countLabel = lsCountLabel;
state.lists.S1.countLabel = s1CountLabel;

var s2ResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var lsResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var s1ResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});

var s2Pager = makePager('S2', s2ResultsPanel);
var lsPager = makePager('LS', lsResultsPanel);
var s1Pager = makePager('S1', s1ResultsPanel);

// Preview area
var previewMeta = ui.Label('Select an image (Preview or tick) to see a thumbnail.', {fontSize: '12px', color: '#555', whiteSpace: 'pre'});
var previewThumbPanel = ui.Panel();

// Content view panel
var contentPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});

// Side panel (fixed size to prevent global scroll)
var sidePanel = ui.Panel({
  style: {
    position: 'top-left',
    width: '390px',
    height: '660px',
    padding: '10px',
    backgroundColor: 'rgba(255,255,255,0.95)'
  }
});
sidePanel.add(title);
sidePanel.add(subtitle);
sidePanel.add(viewBar);
sidePanel.add(contentPanel);

// -------------------------
// Render widgets on map
// -------------------------
function renderWidgets() {
  map.widgets().reset([]);
  map.widgets().add(toggleContainer);
  if (uiState.panelOpen) map.widgets().add(sidePanel);
}
renderWidgets();

// -------------------------
// Render current view
// -------------------------
function renderView() {
  contentPanel.clear();

  if (uiState.view === 'Settings') {
    contentPanel.add(smallLabel(
      'How to use:\n' +
      '1) Click map to set POI\n' +
      '2) Click "Query imagery"\n' +
      '3) Go to Results and tick images\n' +
      'Use "Change POI" to move it.'
    ));
    contentPanel.add(referenceDateLabel);
    contentPanel.add(statusLabel);
    contentPanel.add(poiInfo);
    contentPanel.add(changePoiBtn);
    contentPanel.add(zoomPoiBtn);
    contentPanel.add(queryBtn);
    contentPanel.add(clearBtn);

    contentPanel.add(smallLabel('\nSettings'));
    contentPanel.add(smallLabel('Buffer (km)')); contentPanel.add(bufferSlider);
    contentPanel.add(smallLabel('Lookback (days)')); contentPanel.add(lookbackSlider);
    contentPanel.add(smallLabel('Max cloud (%) for optical filtering')); contentPanel.add(cloudSlider);
    contentPanel.add(smallLabel('Max images per sensor')); contentPanel.add(maxImagesSlider);
    contentPanel.add(applyMaskCheckbox);
    contentPanel.add(autoQueryCheckbox);

    contentPanel.add(smallLabel('\nOptical products'));
    contentPanel.add(smallLabel('Sentinel-2 product')); contentPanel.add(s2LevelSelect);
    contentPanel.add(smallLabel('Landsat product')); contentPanel.add(landsatLevelSelect);

    contentPanel.add(smallLabel('\nOptical composite (applied to S2 + Landsat)'));
    contentPanel.add(compositeSelect);

    contentPanel.add(smallLabel('\nSentinel-1 polarization'));
    contentPanel.add(s1PolSelect);

  } else if (uiState.view === 'Results') {
    contentPanel.add(ui.Label('Sentinel-2 results', {fontWeight: 'bold', margin: '0 0 2px 0'}));
    contentPanel.add(s2CountLabel);
    contentPanel.add(s2Pager.container);
    contentPanel.add(s2ResultsPanel);

    contentPanel.add(ui.Label('Landsat 8/9 results', {fontWeight: 'bold', margin: '10px 0 2px 0'}));
    contentPanel.add(lsCountLabel);
    contentPanel.add(lsPager.container);
    contentPanel.add(lsResultsPanel);

    contentPanel.add(ui.Label('Sentinel-1 results', {fontWeight: 'bold', margin: '10px 0 2px 0'}));
    contentPanel.add(s1CountLabel);
    contentPanel.add(s1Pager.container);
    contentPanel.add(s1ResultsPanel);

    if (state.lists.S2.items.length === 0) s2ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
    if (state.lists.LS.items.length === 0) lsResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
    if (state.lists.S1.items.length === 0) s1ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));

  } else { // Preview
    contentPanel.add(previewMeta);
    contentPanel.add(previewThumbPanel);
  }
}
renderView();

// -------------------------
// Map click behavior
// -------------------------
map.onClick(function(coords) {
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
// Clear helpers
// -------------------------
function clearResultsOnly() {
  Object.keys(state.resultsLayers).forEach(function(k) {
    map.layers().remove(state.resultsLayers[k]);
  });
  state.resultsLayers = {};
  state.activeKey = null;

  state.lists.S2.items = []; state.lists.S2.page = 0;
  state.lists.LS.items = []; state.lists.LS.page = 0;
  state.lists.S1.items = []; state.lists.S1.page = 0;

  s2CountLabel.setValue('S2: 0');
  lsCountLabel.setValue('Landsat: 0');
  s1CountLabel.setValue('S1: 0');

  s2ResultsPanel.clear(); lsResultsPanel.clear(); s1ResultsPanel.clear();

  previewThumbPanel.clear();
  previewMeta.setValue('Select an image (Preview or tick) to see a thumbnail.');
}

function clearAll() {
  clearResultsOnly();
  if (state.poiLayer) map.layers().remove(state.poiLayer);
  if (state.bufferLayer) map.layers().remove(state.bufferLayer);

  state.poi = null;
  state.poiLayer = null;
  state.bufferLayer = null;
  poiInfo.setValue('POI: (none)');
}

// -------------------------
// Query
// -------------------------
function runQuery() {
  clearResultsOnly();
  uiState.view = 'Settings';
  renderView();

  state.referenceDateStr = fmtTodayUTC();
  referenceDateLabel.setValue('Reference date: ' + state.referenceDateStr);

  statusLabel.setValue('⏳ Building collections…');
  var buf = state.poi.buffer(bufferSlider.getValue() * 1000);

  var now = ee.Date(Date.now());
  var start = now.advance(-lookbackSlider.getValue(), 'day');
  var cloudMax = cloudSlider.getValue();
  var limitN = maxImagesSlider.getValue();

  // Sentinel-2
  var s2Mode = getS2Level();
  var s2ColId = (s2Mode === 'L2A (SR)') ? 'COPERNICUS/S2_SR_HARMONIZED' : 'COPERNICUS/S2_HARMONIZED';
  state.lists.S2.sensorKey = (s2Mode === 'L2A (SR)') ? 'S2_L2A' : 'S2_L1C';

  var s2 = ee.ImageCollection(s2ColId)
    .filterBounds(buf)
    .filterDate(start, now)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudMax))
    .sort('system:time_start', false)
    .limit(limitN);

  // Landsat 8/9
  var lsMode = getLSLevel();
  state.lists.LS.sensorKey = (lsMode === 'L2 (SR)') ? 'Landsat_L2SR' : 'Landsat_TOA';

  var ls = (lsMode === 'L2 (SR)')
    ? ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
    : ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_TOA'));

  ls = ls.filterBounds(buf)
    .filterDate(start, now)
    .filter(ee.Filter.lte('CLOUD_COVER', cloudMax))
    .sort('system:time_start', false)
    .limit(limitN);

  // Sentinel-1
  var pol = getS1Pol();
  var polFilter = (pol === 'VH')
    ? ee.Filter.listContains('transmitterReceiverPolarisation', 'VH')
    : (pol === 'VV')
      ? ee.Filter.listContains('transmitterReceiverPolarisation', 'VV')
      : ee.Filter.and(
          ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'),
          ee.Filter.listContains('transmitterReceiverPolarisation', 'VH')
        );

  var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(buf)
    .filterDate(start, now)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(polFilter)
    .sort('system:time_start', false)
    .limit(limitN);

  // Fetch lists in parallel
  var pending = 3;
  function doneOne() {
    pending--;
    if (pending === 0) {
      statusLabel.setValue('✅ Query complete. Open "Results" and tick images to display.');
      uiState.view = 'Results';
      renderView();
      renderResults('S2');
      renderResults('LS');
      renderResults('S1');
    }
  }

  statusLabel.setValue('⏳ Fetching Sentinel-2 list…');
  fetchS2List(s2, function(items) {
    state.lists.S2.items = items;
    state.lists.S2.page = 0;
    s2CountLabel.setValue('S2: ' + items.length);
    doneOne();
  });

  statusLabel.setValue('⏳ Fetching Landsat list…');
  fetchLSList(ls, function(items) {
    state.lists.LS.items = items;
    state.lists.LS.page = 0;
    lsCountLabel.setValue('Landsat: ' + items.length);
    doneOne();
  });

  statusLabel.setValue('⏳ Fetching Sentinel-1 list…');
  fetchS1List(s1, function(items) {
    state.lists.S1.items = items;
    state.lists.S1.page = 0;
    s1CountLabel.setValue('S1: ' + items.length);
    doneOne();
  });
}

// -------------------------
// Faster list fetching via aggregate_array
// -------------------------
function fetchS2List(col, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    c: col.aggregate_array('CLOUDY_PIXEL_PERCENTAGE')
  });
  dict.evaluate(function(d) {
    var items = [];
    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        items.push({
          systemId: d.ids[i],
          date: fmtDateUTC(d.t[i]),
          cloud: (d.c && d.c[i] !== null && d.c[i] !== undefined) ? Number(d.c[i]) : null
        });
      }
    }
    cb(items);
  });
}

function fetchLSList(col, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    c: col.aggregate_array('CLOUD_COVER'),
    sc: col.aggregate_array('SPACECRAFT_ID')
  });
  dict.evaluate(function(d) {
    var items = [];
    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        items.push({
          systemId: d.ids[i],
          date: fmtDateUTC(d.t[i]),
          cloud: (d.c && d.c[i] !== null && d.c[i] !== undefined) ? Number(d.c[i]) : null,
          spacecraft: d.sc ? d.sc[i] : null
        });
      }
    }
    cb(items);
  });
}

function fetchS1List(col, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    pass: col.aggregate_array('orbitProperties_pass'),
    ro: col.aggregate_array('relativeOrbitNumber_start')
  });
  dict.evaluate(function(d) {
    var items = [];
    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        items.push({
          systemId: d.ids[i],
          date: fmtDateUTC(d.t[i]),
          pass: d.pass ? d.pass[i] : null,
          relOrbit: (d.ro && d.ro[i] !== null && d.ro[i] !== undefined) ? d.ro[i] : null
        });
      }
    }
    cb(items);
  });
}

// -------------------------
// Pagination UI
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

  var container = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {margin: '0 0 6px 0'}
  });
  container.add(prevBtn);
  container.add(pageLbl);
  container.add(nextBtn);

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
    panel.add(placeholder('No images found. Try bigger buffer, more lookback, or higher cloud threshold.'));
    return;
  }

  for (var i = start; i < end; i++) {
    (function(item) {
      var label = buildLabel(which, sensorKey, item);
      var key = sensorKey + '::' + item.systemId;

      var cb = ui.Checkbox({
        label: label,
        value: !!state.resultsLayers[key],
        onChange: function(checked) {
          var info = {key: key, systemId: item.systemId, label: label};
          if (checked) {
            addLayerForImage(sensorKey, info);
            setPreview(sensorKey, info);
            uiState.view = 'Preview';
            renderView();
          } else {
            removeLayerForImage(key);
          }
        }
      });

      var pBtn = ui.Button({
        label: 'Preview',
        style: {margin: '0 0 0 6px'},
        onClick: function() {
          var info = {key: key, systemId: item.systemId, label: label};
          setPreview(sensorKey, info);
          uiState.view = 'Preview';
          renderView();
        }
      });

      var zBtn = ui.Button({
        label: 'Zoom',
        style: {margin: '0 0 0 6px'},
        onClick: function() {
          map.centerObject(ee.Image(item.systemId).geometry(), 10);
          var info = {key: key, systemId: item.systemId, label: label};
          setPreview(sensorKey, info);
          uiState.view = 'Preview';
          renderView();
        }
      });

      var row = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '0 0 4px 0'}});
      row.add(cb);
      row.add(pBtn);
      row.add(zBtn);
      panel.add(row);
    })(items[i]);
  }
}

function buildLabel(which, sensorKey, item) {
  var compName = getCompositeName();
  var parts = [item.date];

  if (which === 'S2') {
    parts.push(sensorKey === 'S2_L2A' ? 'S2 L2A' : 'S2 L1C');
    parts.push(compName);
    var c = (item.cloud !== null && item.cloud !== undefined) ? item.cloud.toFixed(1) : 'n/a';
    parts.push('cloud ' + c + '%');
  }

  if (which === 'LS') {
    parts.push(sensorKey === 'Landsat_L2SR' ? 'L8/9 SR' : 'L8/9 TOA');
    parts.push(compName);
    var cl = (item.cloud !== null && item.cloud !== undefined) ? item.cloud.toFixed(1) : 'n/a';
    parts.push('cloud ' + cl + '%');
  }

  if (which === 'S1') {
    parts.push('S1 ' + getS1Pol());
    parts.push(item.pass ? String(item.pass) : 'n/a');
    parts.push('relOrb ' + (item.relOrbit !== null && item.relOrbit !== undefined ? String(item.relOrbit) : 'n/a'));
  }

  return parts.join(' | ');
}

// -------------------------
// Preview & Layers
// -------------------------
function setPreview(sensorKey, info) {
  state.activeKey = info.key;
  previewThumbPanel.clear();

  if (!state.poi) return;

  var roi = state.poi.buffer(bufferSlider.getValue() * 1000).bounds();

  var img = makeDisplayImage(sensorKey, info.systemId);
  var vis;
  if (sensorKey === 'S1') {
    vis = getS1VisParams();
  } else {
    var comp = getComposite();
    vis = comp.isNdvi ? getNdviVisParams() : getOpticalVisParams();
  }

  var thumb = ui.Thumbnail({
    image: img.visualize(vis),
    params: {region: roi, dimensions: 256, format: 'png'},
    style: {margin: '6px 0 0 0', maxWidth: '256px'}
  });

  previewMeta.setValue(info.label + '\nSystem ID: ' + info.systemId);
  previewThumbPanel.add(thumb);
}

function addLayerForImage(sensorKey, info) {
  if (state.resultsLayers[info.key]) return;

  var img = makeDisplayImage(sensorKey, info.systemId);
  var vis;
  if (sensorKey === 'S1') {
    vis = getS1VisParams();
  } else {
    var comp = getComposite();
    vis = comp.isNdvi ? getNdviVisParams() : getOpticalVisParams();
  }

  var layer = ui.Map.Layer(img, vis, info.label, true);
  map.layers().add(layer);
  state.resultsLayers[info.key] = layer;
}

function removeLayerForImage(key) {
  if (!state.resultsLayers[key]) return;
  map.layers().remove(state.resultsLayers[key]);
  delete state.resultsLayers[key];

  if (state.activeKey === key) {
    previewThumbPanel.clear();
    previewMeta.setValue('Select an image (Preview or tick) to see a thumbnail.');
    state.activeKey = null;
  }
}

// -------------------------
// Small hints when options change
// -------------------------
s1PolSelect.onChange(function(v) {
  statusLabel.setValue('S1 pol set to "' + v + '". Re-run query to refresh the S1 list.');
});
s2LevelSelect.onChange(function(v) {
  statusLabel.setValue('S2 product set to "' + v + '". Re-run query to refresh the S2 list.');
});
landsatLevelSelect.onChange(function(v) {
  statusLabel.setValue('Landsat product set to "' + v + '". Re-run query to refresh the Landsat list.');
});
compositeSelect.onChange(function(v) {
  statusLabel.setValue('Composite set to "' + v + '". New layers will use it (re-query recommended).');
});

// -------------------------
// Init view & widget rendering
// -------------------------
function renderWidgets() {
  map.widgets().reset([]);
  map.widgets().add(toggleContainer);
  if (uiState.panelOpen) map.widgets().add(sidePanel);
}
renderWidgets();
map.setCenter(0, 0, 2);
statusLabel.setValue('Click the map to set the POI (first time).');

// -------------------------
// View render (Settings/Results/Preview)
// -------------------------
function renderView() {
  contentPanel.clear();

  if (uiState.view === 'Settings') {
    contentPanel.add(smallLabel(
      'How to use:\n' +
      '1) Click map to set POI\n' +
      '2) Click "Query imagery"\n' +
      '3) Go to Results and tick images\n' +
      'Use "Change POI" to move it.'
    ));
    contentPanel.add(referenceDateLabel);
    contentPanel.add(statusLabel);
    contentPanel.add(poiInfo);
    contentPanel.add(changePoiBtn);
    contentPanel.add(zoomPoiBtn);
    contentPanel.add(queryBtn);
    contentPanel.add(clearBtn);

    contentPanel.add(smallLabel('\nSettings'));
    contentPanel.add(smallLabel('Buffer (km)')); contentPanel.add(bufferSlider);
    contentPanel.add(smallLabel('Lookback (days)')); contentPanel.add(lookbackSlider);
    contentPanel.add(smallLabel('Max cloud (%) for optical filtering')); contentPanel.add(cloudSlider);
    contentPanel.add(smallLabel('Max images per sensor')); contentPanel.add(maxImagesSlider);
    contentPanel.add(applyMaskCheckbox);
    contentPanel.add(autoQueryCheckbox);

    contentPanel.add(smallLabel('\nOptical products'));
    contentPanel.add(smallLabel('Sentinel-2 product')); contentPanel.add(s2LevelSelect);
    contentPanel.add(smallLabel('Landsat product')); contentPanel.add(landsatLevelSelect);

    contentPanel.add(smallLabel('\nOptical composite (applied to S2 + Landsat)'));
    contentPanel.add(compositeSelect);

    contentPanel.add(smallLabel('\nSentinel-1 polarization'));
    contentPanel.add(s1PolSelect);

  } else if (uiState.view === 'Results') {
    contentPanel.add(ui.Label('Sentinel-2 results', {fontWeight: 'bold', margin: '0 0 2px 0'}));
    contentPanel.add(s2CountLabel);
    contentPanel.add(s2Pager.container);
    contentPanel.add(s2ResultsPanel);

    contentPanel.add(ui.Label('Landsat 8/9 results', {fontWeight: 'bold', margin: '10px 0 2px 0'}));
    contentPanel.add(lsCountLabel);
    contentPanel.add(lsPager.container);
    contentPanel.add(lsResultsPanel);

    contentPanel.add(ui.Label('Sentinel-1 results', {fontWeight: 'bold', margin: '10px 0 2px 0'}));
    contentPanel.add(s1CountLabel);
    contentPanel.add(s1Pager.container);
    contentPanel.add(s1ResultsPanel);

    if (state.lists.S2.items.length === 0) s2ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
    if (state.lists.LS.items.length === 0) lsResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
    if (state.lists.S1.items.length === 0) s1ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));

  } else { // Preview
    contentPanel.add(previewMeta);
    contentPanel.add(previewThumbPanel);
  }
}

// -------------------------
// View switch buttons
// -------------------------
function viewBtn(label, viewName) {
  return ui.Button({
    label: label,
    style: {stretch: 'horizontal', margin: '0 4px 0 0'},
    onClick: function() {
      uiState.view = viewName;
      renderView();
    }
  });
}

// (rebuild viewBar with the correct function binding)
viewBar.clear();
viewBar.add(viewBtn('Settings', 'Settings'));
viewBar.add(viewBtn('Results', 'Results'));
viewBar.add(viewBtn('Preview', 'Preview'));

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

  var container = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {margin: '0 0 6px 0'}
  });
  container.add(prevBtn);
  container.add(pageLbl);
  container.add(nextBtn);

  return {container: container, pageLbl: pageLbl};
}

// -------------------------
// Query helper lists
// -------------------------
function fetchS2List(col, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    c: col.aggregate_array('CLOUDY_PIXEL_PERCENTAGE')
  });
  dict.evaluate(function(d) {
    var items = [];
    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        items.push({
          systemId: d.ids[i],
          date: fmtDateUTC(d.t[i]),
          cloud: (d.c && d.c[i] !== null && d.c[i] !== undefined) ? Number(d.c[i]) : null
        });
      }
    }
    cb(items);
  });
}

function fetchLSList(col, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    c: col.aggregate_array('CLOUD_COVER'),
    sc: col.aggregate_array('SPACECRAFT_ID')
  });
  dict.evaluate(function(d) {
    var items = [];
    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        items.push({
          systemId: d.ids[i],
          date: fmtDateUTC(d.t[i]),
          cloud: (d.c && d.c[i] !== null && d.c[i] !== undefined) ? Number(d.c[i]) : null,
          spacecraft: d.sc ? d.sc[i] : null
        });
      }
    }
    cb(items);
  });
}

function fetchS1List(col, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    pass: col.aggregate_array('orbitProperties_pass'),
    ro: col.aggregate_array('relativeOrbitNumber_start')
  });
  dict.evaluate(function(d) {
    var items = [];
    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        items.push({
          systemId: d.ids[i],
          date: fmtDateUTC(d.t[i]),
          pass: d.pass ? d.pass[i] : null,
          relOrbit: (d.ro && d.ro[i] !== null && d.ro[i] !== undefined) ? d.ro[i] : null
        });
      }
    }
    cb(items);
  });
}

// -------------------------
// Query runner
// -------------------------
function runQuery() {
  clearResultsOnly();
  uiState.view = 'Settings';
  renderView();

  state.referenceDateStr = fmtTodayUTC();
  referenceDateLabel.setValue('Reference date: ' + state.referenceDateStr);

  statusLabel.setValue('⏳ Building collections…');
  var buf = state.poi.buffer(bufferSlider.getValue() * 1000);

  var now = ee.Date(Date.now());
  var start = now.advance(-lookbackSlider.getValue(), 'day');
  var cloudMax = cloudSlider.getValue();
  var limitN = maxImagesSlider.getValue();

  // Sentinel-2
  var s2Mode = getS2Level();
  var s2ColId = (s2Mode === 'L2A (SR)') ? 'COPERNICUS/S2_SR_HARMONIZED' : 'COPERNICUS/S2_HARMONIZED';
  state.lists.S2.sensorKey = (s2Mode === 'L2A (SR)') ? 'S2_L2A' : 'S2_L1C';

  var s2 = ee.ImageCollection(s2ColId)
    .filterBounds(buf)
    .filterDate(start, now)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudMax))
    .sort('system:time_start', false)
    .limit(limitN);

  // Landsat 8/9
  var lsMode = getLSLevel();
  state.lists.LS.sensorKey = (lsMode === 'L2 (SR)') ? 'Landsat_L2SR' : 'Landsat_TOA';

  var ls = (lsMode === 'L2 (SR)')
    ? ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
    : ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_TOA'));

  ls = ls.filterBounds(buf)
    .filterDate(start, now)
    .filter(ee.Filter.lte('CLOUD_COVER', cloudMax))
    .sort('system:time_start', false)
    .limit(limitN);

  // Sentinel-1
  var pol = getS1Pol();
  var polFilter = (pol === 'VH')
    ? ee.Filter.listContains('transmitterReceiverPolarisation', 'VH')
    : (pol === 'VV')
      ? ee.Filter.listContains('transmitterReceiverPolarisation', 'VV')
      : ee.Filter.and(
          ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'),
          ee.Filter.listContains('transmitterReceiverPolarisation', 'VH')
        );

  var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(buf)
    .filterDate(start, now)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(polFilter)
    .sort('system:time_start', false)
    .limit(limitN);

  // Fetch lists in parallel
  var pending = 3;
  function doneOne() {
    pending--;
    if (pending === 0) {
      statusLabel.setValue('✅ Query complete. Open "Results" and tick images to display.');
      uiState.view = 'Results';
      renderView();
      renderResults('S2');
      renderResults('LS');
      renderResults('S1');
    }
  }

  statusLabel.setValue('⏳ Fetching Sentinel-2 list…');
  fetchS2List(s2, function(items) {
    state.lists.S2.items = items;
    state.lists.S2.page = 0;
    s2CountLabel.setValue('S2: ' + items.length);
    doneOne();
  });

  statusLabel.setValue('⏳ Fetching Landsat list…');
  fetchLSList(ls, function(items) {
    state.lists.LS.items = items;
    state.lists.LS.page = 0;
    lsCountLabel.setValue('Landsat: ' + items.length);
    doneOne();
  });

  statusLabel.setValue('⏳ Fetching Sentinel-1 list…');
  fetchS1List(s1, function(items) {
    state.lists.S1.items = items;
    state.lists.S1.page = 0;
    s1CountLabel.setValue('S1: ' + items.length);
    doneOne();
  });
}

// -------------------------
// Clear / Results-only clear
// -------------------------
function clearResultsOnly() {
  Object.keys(state.resultsLayers).forEach(function(k) {
    map.layers().remove(state.resultsLayers[k]);
  });
  state.resultsLayers = {};
  state.activeKey = null;

  state.lists.S2.items = []; state.lists.S2.page = 0;
  state.lists.LS.items = []; state.lists.LS.page = 0;
  state.lists.S1.items = []; state.lists.S1.page = 0;

  s2CountLabel.setValue('S2: 0');
  lsCountLabel.setValue('Landsat: 0');
  s1CountLabel.setValue('S1: 0');

  s2ResultsPanel.clear(); lsResultsPanel.clear(); s1ResultsPanel.clear();

  previewThumbPanel.clear();
  previewMeta.setValue('Select an image (Preview or tick) to see a thumbnail.');
}

function clearAll() {
  clearResultsOnly();
  if (state.poiLayer) map.layers().remove(state.poiLayer);
  if (state.bufferLayer) map.layers().remove(state.bufferLayer);

  state.poi = null;
  state.poiLayer = null;
  state.bufferLayer = null;
  poiInfo.setValue('POI: (none)');
}

// -------------------------
// Panel rendering
// -------------------------
function renderWidgets() {
  map.widgets().reset([]);
  map.widgets().add(toggleContainer);
  if (uiState.panelOpen) map.widgets().add(sidePanel);
}
renderWidgets();
renderView();

// -------------------------
// POI actions
// -------------------------
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
// Clear & navigation buttons (already defined above)
// -------------------------

// -------------------------
// Map click
// -------------------------
map.onClick(function(coords) {
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
