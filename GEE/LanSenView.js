/***************************************
 * POI Imagery Explorer (S2 + Landsat + S1)
 *
 * Key UX changes:
 * - Query is independent of band combinations (composites)
 * - Composites are applied AFTER query and can be changed WITHOUT re-query
 * - Separate composite selectors for Sentinel-2 and Landsat (native combos)
 * - Changing composites updates ACTIVE layers + preview immediately
 *
 * Sentinel-1 fix:
 * - COPERNICUS/S1_GRD in GEE is already in dB -> DO NOT log10 again
 *
 * No ui.TabPanel, no unsupported overflow styles
 ****************************************/

// -------------------------
// Defaults
// -------------------------
var DEFAULTS = {
  bufferKm: 5,
  lookbackDays: 30,
  cloudMax: 30,
  maxImages: 40,
  applyCloudMask: false,   // optional, default OFF
  autoQueryAfterPOI: true,
  s1Pol: 'VH',             // default VH
  s2Level: 'L1C (TOA)',    // default non-atmos corrected
  landsatLevel: 'TOA'      // default non-atmos corrected
};

var PAGE_SIZE = 10;

// -------------------------
// Composites
// -------------------------
// Sentinel-2 composites (from Sentinel Hub "Simple RGB Composites (Sentinel-2)")
var S2_COMPOSITES = [
  {name: 'True Color (4,3,2)',   type: 'rgb', bands: ['B4','B3','B2']},
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

// Landsat 8/9 composites (native Landsat combos; common references like ESRI)
var LS_COMPOSITES = [
  {name: 'Natural Color (4,3,2)',         type: 'rgb', nums: [4,3,2]},
  {name: 'Color Infrared (5,4,3)',        type: 'rgb', nums: [5,4,3]},
  {name: 'False Color (Urban) (7,6,4)',   type: 'rgb', nums: [7,6,4]},
  {name: 'Agriculture (6,5,2)',           type: 'rgb', nums: [6,5,2]},
  {name: 'Geology (7,6,2)',               type: 'rgb', nums: [7,6,2]},
  {name: 'Atmospheric Penetration (7,6,5)', type: 'rgb', nums: [7,6,5]},
  {name: 'Healthy Vegetation (5,6,2)',    type: 'rgb', nums: [5,6,2]},
  {name: 'Land/Water (5,6,4)',            type: 'rgb', nums: [5,6,4]},
  {name: 'Shortwave Infrared (7,5,4)',    type: 'rgb', nums: [7,5,4]},
  {name: 'Vegetation Analysis (6,5,4)',   type: 'rgb', nums: [6,5,4]},
  {name: 'Bathymetric (4,3,1)',           type: 'rgb', nums: [4,3,1]},
  {name: 'NDVI',                          type: 'ndvi'}
];

function getS2CompByName(name) {
  for (var i = 0; i < S2_COMPOSITES.length; i++) if (S2_COMPOSITES[i].name === name) return S2_COMPOSITES[i];
  return S2_COMPOSITES[0];
}
function getLSCompByName(name) {
  for (var i = 0; i < LS_COMPOSITES.length; i++) if (LS_COMPOSITES[i].name === name) return LS_COMPOSITES[i];
  return LS_COMPOSITES[0];
}

// -------------------------
// State
// -------------------------
var state = {
  poi: null,
  poiLayer: null,
  bufferLayer: null,
  poiPicking: true,

  // active map layers and their metadata for live updates
  resultsLayers: {},     // key -> ui.Map.Layer
  layerMeta: {},         // key -> {group:'S2'|'LS'|'S1', sensorKey, systemId, labelBase}
  activeKey: null,

  // query results (client-side lists)
  lists: {
    S2: { items: [], page: 0, sensorKey: 'S2_L1C' },
    LS: { items: [], page: 0, sensorKey: 'Landsat_TOA' },
    S1: { items: [], page: 0, sensorKey: 'S1' }
  },

  queryDone: false
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
// Helpers
// -------------------------
function fmtDateUTC(ms) {
  var d = new Date(Number(ms));
  return d.toISOString().slice(0, 10);
}
function fmtTodayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function useCloudRemoval() { return applyMaskCheckbox.getValue() === true; }
function getS2Level() { return s2LevelSelect.getValue(); }          // L1C/L2A
function getLSLevel() { return landsatLevelSelect.getValue(); }     // TOA/L2
function getS1Pol() { return s1PolSelect.getValue(); }              // VH/VV/VV+VH

function getS2Composite() { return getS2CompByName(s2CompositeSelect.getValue()); }
function getLSComposite() { return getLSCompByName(lsCompositeSelect.getValue()); }

// -------------------------
// Masks & scaling
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
// Visualization params
// -------------------------
function opticalVisParams() { return {min: 0.02, max: 0.35, gamma: 1.1}; }
function ndviVisParams() { return {min: 0, max: 1, palette: ['#8c510a','#d8b365','#f6e8c3','#c7eae5','#5ab4ac','#01665e']}; }
function s1VisParams() {
  // S1 GRD is in dB already in GEE
  var pol = getS1Pol();
  return (pol === 'VV+VH') ? {min: -25, max: 0} : {min: -25, max: 0};
}

// -------------------------
// Build display images (uses CURRENT composites; no re-query needed)
// -------------------------
function makeDisplayImage(sensorKey, systemId) {
  var maskOn = useCloudRemoval();

  // Sentinel-2
  if (sensorKey === 'S2_L1C' || sensorKey === 'S2_L2A') {
    var s2 = ee.Image(systemId);
    if (maskOn) s2 = (sensorKey === 'S2_L2A') ? maskS2_L2A_SCL(s2) : maskS2_L1C_QA60(s2);

    var comp = getS2Composite();
    if (comp.type === 'ndvi') return s2.normalizedDifference(['B8','B4']).rename('NDVI');
    return s2.select(comp.bands).multiply(0.0001);
  }

  // Landsat
  if (sensorKey === 'Landsat_TOA' || sensorKey === 'Landsat_L2SR') {
    var l = ee.Image(systemId);

    if (maskOn) {
      l = ee.Image(ee.Algorithms.If(l.bandNames().contains('QA_PIXEL'), maskLandsatClouds_QA_PIXEL(l), l));
    }

    var compL = getLSComposite();
    if (compL.type === 'ndvi') {
      if (sensorKey === 'Landsat_L2SR') {
        l = scaleLandsatSR(l);
        return l.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI');
      }
      return l.normalizedDifference(['B5','B4']).rename('NDVI');
    }

    function bandName(n) {
      return (sensorKey === 'Landsat_L2SR') ? ('SR_B' + n) : ('B' + n);
    }
    var b = compL.nums;
    var bands = [bandName(b[0]), bandName(b[1]), bandName(b[2])];

    if (sensorKey === 'Landsat_L2SR') l = scaleLandsatSR(l);
    return l.select(bands);
  }

  // Sentinel-1
  if (sensorKey === 'S1') {
    var s1 = ee.Image(systemId);
    var pol = getS1Pol();

    if (pol === 'VH') return s1.select('VH');
    if (pol === 'VV') return s1.select('VV');

    var vv = s1.select('VV');
    var vh = s1.select('VH');
    var vvMinusVh = vv.subtract(vh);
    return ee.Image.cat([vv.rename('R'), vh.rename('G'), vvMinusVh.rename('B')]);
  }

  return null;
}

function getVisForSensor(sensorKey) {
  if (sensorKey === 'S1') return s1VisParams();
  if (sensorKey.indexOf('S2_') === 0) {
    return (getS2Composite().type === 'ndvi') ? ndviVisParams() : opticalVisParams();
  }
  if (sensorKey.indexOf('Landsat_') === 0) {
    return (getLSComposite().type === 'ndvi') ? ndviVisParams() : opticalVisParams();
  }
  return opticalVisParams();
}

// -------------------------
// UI blocks
// -------------------------
function smallLabel(txt) {
  return ui.Label(txt, {fontSize: '12px', color: '#555', whiteSpace: 'pre', margin: '0 0 6px 0'});
}
function placeholder(txt) {
  return ui.Label(txt, {fontSize: '12px', color: '#777', whiteSpace: 'pre', margin: '6px 0 0 0'});
}

// Toggle panel button
var panelToggleBtn = ui.Button({
  label: '✕',
  style: {fontWeight: 'bold', width: '42px', height: '34px', margin: '0', padding: '0'},
  onClick: function() {
    uiState.panelOpen = !uiState.panelOpen;
    panelToggleBtn.setLabel(uiState.panelOpen ? '✕' : '☰');
    renderWidgets();
  }
});
var toggleContainer = ui.Panel({style: {position: 'top-left', padding: '8px', width: '60px'}});
toggleContainer.add(panelToggleBtn);

// Title/status
var title = ui.Label('POI Imagery Explorer', {fontWeight: 'bold', fontSize: '18px', margin: '0 0 4px 0'});
var subtitle = ui.Label('S2 + Landsat 8/9 + Sentinel-1', {fontSize: '12px', color: '#555', margin: '0 0 8px 0'});

var referenceDateLabel = ui.Label('Reference date: (not queried yet)', {fontSize: '12px', color: '#555', margin: '0 0 6px 0'});
var statusLabel = ui.Label('Click the map to set the POI (first time).', {fontSize: '12px', margin: '0 0 8px 0'});
var poiInfo = ui.Label('POI: (none)', {fontSize: '12px', margin: '0 0 8px 0'});

// View buttons
function viewBtn(label, viewName) {
  return ui.Button({
    label: label,
    style: {stretch: 'horizontal', margin: '0 4px 0 0'},
    onClick: function() { uiState.view = viewName; renderView(); }
  });
}
var viewBar = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '0 0 8px 0'}});
viewBar.add(viewBtn('Settings', 'Settings'));
viewBar.add(viewBtn('Results', 'Results'));
viewBar.add(viewBtn('Preview', 'Preview'));

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

// Query settings widgets
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

var s1PolSelect = ui.Select({
  items: ['VH', 'VV', 'VV+VH'],
  value: DEFAULTS.s1Pol,
  style: {stretch: 'horizontal'}
});

// Display controls (post-query; update active layers without re-query)
var s2CompositeSelect = ui.Select({
  items: S2_COMPOSITES.map(function(c){ return c.name; }),
  value: S2_COMPOSITES[0].name,
  style: {stretch: 'horizontal'}
});
var lsCompositeSelect = ui.Select({
  items: LS_COMPOSITES.map(function(c){ return c.name; }),
  value: LS_COMPOSITES[0].name,
  style: {stretch: 'horizontal'}
});

// Disabled until query completes
s2CompositeSelect.setDisabled(true);
lsCompositeSelect.setDisabled(true);

s2CompositeSelect.onChange(function() {
  if (!state.queryDone) return;
  updateActiveLayersByGroup('S2');
  refreshPreviewIfActive();
});
lsCompositeSelect.onChange(function() {
  if (!state.queryDone) return;
  updateActiveLayersByGroup('LS');
  refreshPreviewIfActive();
});

// Results panels + counts + pagers
var s2CountLabel = ui.Label('S2: 0', {fontSize: '12px', color: '#555'});
var lsCountLabel = ui.Label('Landsat: 0', {fontSize: '12px', color: '#555'});
var s1CountLabel = ui.Label('S1: 0', {fontSize: '12px', color: '#555'});

var s2ResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var lsResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var s1ResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});

var s2Pager = makePager('S2', s2ResultsPanel);
var lsPager = makePager('LS', lsResultsPanel);
var s1Pager = makePager('S1', s1ResultsPanel);

// Preview
var previewMeta = ui.Label('Select an image (Preview or tick) to see a thumbnail.', {fontSize: '12px', color: '#555', whiteSpace: 'pre'});
var previewThumbPanel = ui.Panel();

// Content panel + side panel
var contentPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var sidePanel = ui.Panel({
  style: {
    position: 'top-left',
    width: '390px',
    height: '690px',
    padding: '10px',
    backgroundColor: 'rgba(255,255,255,0.95)'
  }
});
sidePanel.add(title);
sidePanel.add(subtitle);
sidePanel.add(viewBar);
sidePanel.add(contentPanel);

function renderWidgets() {
  map.widgets().reset([]);
  map.widgets().add(toggleContainer);
  if (uiState.panelOpen) map.widgets().add(sidePanel);
}
renderWidgets();

// -------------------------
// Render view
// -------------------------
function renderView() {
  contentPanel.clear();

  if (uiState.view === 'Settings') {
    contentPanel.add(smallLabel(
      'How to use:\n' +
      '1) Click map to set POI\n' +
      '2) Click "Query imagery"\n' +
      '3) Go to Results and tick images\n' +
      'After query, you can change S2/Landsat composites without re-query.'
    ));
    contentPanel.add(referenceDateLabel);
    contentPanel.add(statusLabel);
    contentPanel.add(poiInfo);
    contentPanel.add(changePoiBtn);
    contentPanel.add(zoomPoiBtn);
    contentPanel.add(queryBtn);
    contentPanel.add(clearBtn);

    contentPanel.add(smallLabel('\nQuery settings'));
    contentPanel.add(smallLabel('Buffer (km)')); contentPanel.add(bufferSlider);
    contentPanel.add(smallLabel('Lookback (days)')); contentPanel.add(lookbackSlider);
    contentPanel.add(smallLabel('Max cloud (%) for optical filtering')); contentPanel.add(cloudSlider);
    contentPanel.add(smallLabel('Max images per sensor')); contentPanel.add(maxImagesSlider);
    contentPanel.add(applyMaskCheckbox);
    contentPanel.add(autoQueryCheckbox);

    contentPanel.add(smallLabel('\nProducts'));
    contentPanel.add(smallLabel('Sentinel-2 product')); contentPanel.add(s2LevelSelect);
    contentPanel.add(smallLabel('Landsat product')); contentPanel.add(landsatLevelSelect);
    contentPanel.add(smallLabel('Sentinel-1 polarization')); contentPanel.add(s1PolSelect);

  } else if (uiState.view === 'Results') {
    // Display controls appear here (post-query)
    contentPanel.add(ui.Label('Display controls (no re-query)', {fontWeight: 'bold', margin: '0 0 4px 0'}));
    contentPanel.add(smallLabel('Sentinel-2 composite'));
    contentPanel.add(s2CompositeSelect);
    contentPanel.add(smallLabel('Landsat composite'));
    contentPanel.add(lsCompositeSelect);
    contentPanel.add(smallLabel('Tip: switching composites updates ACTIVE layers + preview instantly.'));

    contentPanel.add(ui.Label('Sentinel-2 results', {fontWeight: 'bold', margin: '10px 0 2px 0'}));
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

    if (!state.queryDone) {
      s2ResultsPanel.clear(); s2ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
      lsResultsPanel.clear(); lsResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
      s1ResultsPanel.clear(); s1ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
    }

  } else { // Preview
    contentPanel.add(previewMeta);
    contentPanel.add(previewThumbPanel);
    if (state.queryDone) {
      contentPanel.add(smallLabel('\nCurrent composites:'));
      contentPanel.add(smallLabel('S2: ' + s2CompositeSelect.getValue()));
      contentPanel.add(smallLabel('Landsat: ' + lsCompositeSelect.getValue()));
    }
  }
}
renderView();

// -------------------------
// Map click / POI
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
// Query
// -------------------------
function runQuery() {
  clearResultsOnly();
  state.queryDone = false;
  s2CompositeSelect.setDisabled(true);
  lsCompositeSelect.setDisabled(true);

  uiState.view = 'Settings';
  renderView();

  referenceDateLabel.setValue('Reference date: ' + fmtTodayUTC());
  statusLabel.setValue('⏳ Building collections…');

  var buf = state.poi.buffer(bufferSlider.getValue() * 1000);
  var now = ee.Date(Date.now());
  var start = now.advance(-lookbackSlider.getValue(), 'day');
  var cloudMax = cloudSlider.getValue();
  var limitN = maxImagesSlider.getValue();

  // Sentinel-2 collection
  var s2Mode = getS2Level();
  var s2ColId = (s2Mode === 'L2A (SR)') ? 'COPERNICUS/S2_SR_HARMONIZED' : 'COPERNICUS/S2_HARMONIZED';
  state.lists.S2.sensorKey = (s2Mode === 'L2A (SR)') ? 'S2_L2A' : 'S2_L1C';

  var s2 = ee.ImageCollection(s2ColId)
    .filterBounds(buf)
    .filterDate(start, now)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudMax))
    .sort('system:time_start', false)
    .limit(limitN);

  // Landsat collection
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

  // fetch lists (parallel)
  var pending = 3;
  function doneOne() {
    pending--;
    if (pending === 0) {
      state.queryDone = true;
      s2CompositeSelect.setDisabled(false);
      lsCompositeSelect.setDisabled(false);

      statusLabel.setValue('✅ Query complete. Go to Results and tick images to display.');
      uiState.view = 'Results';
      renderView();

      renderResults('S2');
      renderResults('LS');
      renderResults('S1');
    }
  }

  statusLabel.setValue('⏳ Fetching Sentinel-2 list…');
  fetchS2List(s2, function(items) {
    state.lists.S2.items = items; state.lists.S2.page = 0;
    s2CountLabel.setValue('S2: ' + items.length);
    doneOne();
  });

  statusLabel.setValue('⏳ Fetching Landsat list…');
  fetchLSList(ls, function(items) {
    state.lists.LS.items = items; state.lists.LS.page = 0;
    lsCountLabel.setValue('Landsat: ' + items.length);
    doneOne();
  });

  statusLabel.setValue('⏳ Fetching Sentinel-1 list…');
  fetchS1List(s1, function(items) {
    state.lists.S1.items = items; state.lists.S1.page = 0;
    s1CountLabel.setValue('S1: ' + items.length);
    doneOne();
  });
}

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
        items.push({systemId: d.ids[i], date: fmtDateUTC(d.t[i]), cloud: (d.c && d.c[i] != null) ? Number(d.c[i]) : null});
      }
    }
    cb(items);
  });
}

function fetchLSList(col, cb) {
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    c: col.aggregate_array('CLOUD_COVER')
  });
  dict.evaluate(function(d) {
    var items = [];
    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        items.push({systemId: d.ids[i], date: fmtDateUTC(d.t[i]), cloud: (d.c && d.c[i] != null) ? Number(d.c[i]) : null});
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
          relOrbit: (d.ro && d.ro[i] != null) ? d.ro[i] : null
        });
      }
    }
    cb(items);
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
  container.add(prevBtn);
  container.add(pageLbl);
  container.add(nextBtn);

  return {container: container, pageLbl: pageLbl};
}

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
      var labelBase = buildLabelBase(which, item); // no composite in label (since composites are post-query)
      var key = sensorKey + '::' + item.systemId;

      var cb = ui.Checkbox({
        label: labelBase,
        value: !!state.resultsLayers[key],
        onChange: function(checked) {
          var info = {key: key, systemId: item.systemId, labelBase: labelBase};
          if (checked) {
            addOrUpdateLayer(sensorKey, which, info);
            setPreview(sensorKey, which, info);
            uiState.view = 'Preview'; renderView();
          } else {
            removeLayer(key);
          }
        }
      });

      var pBtn = ui.Button({
        label: 'Preview',
        style: {margin: '0 0 0 6px'},
        onClick: function() {
          var info = {key: key, systemId: item.systemId, labelBase: labelBase};
          setPreview(sensorKey, which, info);
          uiState.view = 'Preview'; renderView();
        }
      });

      var zBtn = ui.Button({
        label: 'Zoom',
        style: {margin: '0 0 0 6px'},
        onClick: function() {
          map.centerObject(ee.Image(item.systemId).geometry(), 10);
          var info = {key: key, systemId: item.systemId, labelBase: labelBase};
          setPreview(sensorKey, which, info);
          uiState.view = 'Preview'; renderView();
        }
      });

      var row = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '0 0 4px 0'}});
      row.add(cb); row.add(pBtn); row.add(zBtn);
      panel.add(row);
    })(items[i]);
  }
}

function buildLabelBase(which, item) {
  if (which === 'S2') {
    var c = (item.cloud != null) ? item.cloud.toFixed(1) : 'n/a';
    return item.date + ' | S2 | cloud ' + c + '%';
  }
  if (which === 'LS') {
    var cl = (item.cloud != null) ? item.cloud.toFixed(1) : 'n/a';
    return item.date + ' | Landsat | cloud ' + cl + '%';
  }
  // S1
  var pass = item.pass ? String(item.pass) : 'n/a';
  var ro = (item.relOrbit != null) ? String(item.relOrbit) : 'n/a';
  return item.date + ' | S1 ' + getS1Pol() + ' | ' + pass + ' | relOrb ' + ro;
}

// -------------------------
// Layer add/update + live composite updates
// -------------------------
function groupFromWhich(which) {
  return (which === 'S2') ? 'S2' : (which === 'LS') ? 'LS' : 'S1';
}

function addOrUpdateLayer(sensorKey, which, info) {
  var key = info.key;

  // store metadata for later composite updates
  state.layerMeta[key] = {
    group: groupFromWhich(which),
    sensorKey: sensorKey,
    systemId: info.systemId,
    labelBase: info.labelBase
  };

  var img = makeDisplayImage(sensorKey, info.systemId);
  var vis = getVisForSensor(sensorKey);

  if (!state.resultsLayers[key]) {
    var layer = ui.Map.Layer(img, vis, info.labelBase, true);
    map.layers().add(layer);
    state.resultsLayers[key] = layer;
  } else {
    // update existing layer in place
    updateLayerObject(key);
  }
}

function updateLayerObject(key) {
  var meta = state.layerMeta[key];
  var layer = state.resultsLayers[key];
  if (!meta || !layer) return;

  var img = makeDisplayImage(meta.sensorKey, meta.systemId);
  var vis = getVisForSensor(meta.sensorKey);

  // Try in-place update (preferred)
  if (layer.setEeObject && layer.setVisParams) {
    layer.setEeObject(img);
    layer.setVisParams(vis);
    if (layer.setName) layer.setName(meta.labelBase);
    return;
  }

  // Fallback: replace layer at same index
  var layers = map.layers();
  var idx = -1;
  for (var i = 0; i < layers.length(); i++) {
    if (layers.get(i) === layer) { idx = i; break; }
  }
  if (idx >= 0) {
    var newLayer = ui.Map.Layer(img, vis, meta.labelBase, true);
    layers.set(idx, newLayer);
    state.resultsLayers[key] = newLayer;
  }
}

function updateActiveLayersByGroup(group) {
  Object.keys(state.resultsLayers).forEach(function(key) {
    var meta = state.layerMeta[key];
    if (!meta) return;
    if (meta.group !== group) return;
    updateLayerObject(key);
  });
}

function removeLayer(key) {
  if (!state.resultsLayers[key]) return;
  map.layers().remove(state.resultsLayers[key]);
  delete state.resultsLayers[key];
  delete state.layerMeta[key];

  if (state.activeKey === key) {
    previewThumbPanel.clear();
    previewMeta.setValue('Select an image (Preview or tick) to see a thumbnail.');
    state.activeKey = null;
  }
}

function refreshPreviewIfActive() {
  if (!state.activeKey) return;
  var meta = state.layerMeta[state.activeKey];
  if (!meta) return;
  setPreview(meta.sensorKey, meta.group === 'S2' ? 'S2' : meta.group === 'LS' ? 'LS' : 'S1', {
    key: state.activeKey,
    systemId: meta.systemId,
    labelBase: meta.labelBase
  });
}

// -------------------------
// Preview
// -------------------------
function setPreview(sensorKey, which, info) {
  state.activeKey = info.key;
  previewThumbPanel.clear();
  if (!state.poi) return;

  var roi = state.poi.buffer(bufferSlider.getValue() * 1000).bounds();
  var img = makeDisplayImage(sensorKey, info.systemId);
  var vis = getVisForSensor(sensorKey);

  var thumb = ui.Thumbnail({
    image: img.visualize(vis),
    params: {region: roi, dimensions: 256, format: 'png'},
    style: {margin: '6px 0 0 0', maxWidth: '256px'}
  });

  var extra = '';
  if (sensorKey.indexOf('S2_') === 0) extra = '\nS2 composite: ' + s2CompositeSelect.getValue();
  if (sensorKey.indexOf('Landsat_') === 0) extra = '\nLandsat composite: ' + lsCompositeSelect.getValue();
  if (sensorKey === 'S1') extra = '\nS1 pol: ' + getS1Pol();

  previewMeta.setValue(info.labelBase + '\nSystem ID: ' + info.systemId + extra);
  previewThumbPanel.add(thumb);
}

// -------------------------
// Clear
// -------------------------
function clearResultsOnly() {
  Object.keys(state.resultsLayers).forEach(function(k) { map.layers().remove(state.resultsLayers[k]); });
  state.resultsLayers = {};
  state.layerMeta = {};
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
// Counts & Results view containers
// -------------------------
function ensureResultsContainers() {
  // Count labels already exist; just ensure panels are in consistent state
  if (!state.queryDone) {
    s2ResultsPanel.clear(); s2ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
    lsResultsPanel.clear(); lsResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
    s1ResultsPanel.clear(); s1ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
  }
}
ensureResultsContainers();

// -------------------------
// Events that should NOT require re-query
// -------------------------
applyMaskCheckbox.onChange(function() {
  // cloud removal affects rendering; update active optical layers (S2 + LS)
  if (!state.queryDone) return;
  updateActiveLayersByGroup('S2');
  updateActiveLayersByGroup('LS');
  refreshPreviewIfActive();
});

// S1 pol changes can break if images missing band; keep re-query recommendation
s1PolSelect.onChange(function() {
  statusLabel.setValue('S1 polarization changed. Re-query recommended to ensure selected band exists for results.');
});

// -------------------------
// Render initial
// -------------------------
map.setCenter(0, 0, 2);
statusLabel.setValue('Click the map to set the POI (first time).');
renderView();
renderWidgets();
