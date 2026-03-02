/***************************************
 * POI Imagery Explorer (S2 + Landsat + S1) — robust Code Editor UI
 *
 * Fixes:
 * - No ui.TabPanel (some environments don't support it)
 * - No unsupported style 'overflow'
 * - No ee.String(...).startsWith usage
 * - Faster list building via aggregate_array()
 *
 * UX:
 * - First click on map sets POI immediately
 * - "Change POI" enables re-pick mode
 * - Side panel can ALWAYS be restored (☰ / ✕ button on map)
 * - Results are paginated (no giant lists -> no page scroll)
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
  lookbackDays: 30,         // default 30 days
  cloudMax: 30,
  maxImages: 40,
  applyCloudMask: false,    // default OFF
  autoQueryAfterPOI: true,
  s1Pol: 'VH',              // default VH
  s2Level: 'L1C (TOA)',     // default non-atmos corrected
  landsatLevel: 'TOA'       // default non-atmos corrected
};

var PAGE_SIZE = 10;

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
  // ms can be number or string; return YYYY-MM-DD in UTC
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
  // For collections that include QA_PIXEL
  var qa = img.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(1 << 1).eq(0)
    .and(qa.bitwiseAnd(1 << 2).eq(0))
    .and(qa.bitwiseAnd(1 << 3).eq(0))
    .and(qa.bitwiseAnd(1 << 4).eq(0))
    .and(qa.bitwiseAnd(1 << 5).eq(0));
  return img.updateMask(mask);
}

function scaleLandsatSR(img) {
  // Landsat C2 L2 SR scale: reflectance = SR * 0.0000275 - 0.2
  var optical = img.select(['SR_B.']).multiply(0.0000275).add(-0.2);
  return img.addBands(optical, null, true);
}

function toDb(x) {
  return ee.Image(10).multiply(x.log10());
}

// -------------------------
// UI getters
// -------------------------
function useCloudRemoval() { return applyMaskCheckbox.getValue() === true; }
function getS2Level() { return s2LevelSelect.getValue(); }          // L1C/L2A
function getLSLevel() { return landsatLevelSelect.getValue(); }     // TOA/L2
function getS1Pol() { return s1PolSelect.getValue(); }              // VH/VV/VV+VH
function getOptPreset() { return visPresetSelect.getValue(); }      // True/False/NDVI

// -------------------------
// Visualization
// -------------------------
function getVisParams(sensorKey) {
  // optical
  if (sensorKey !== 'S1') {
    var preset = getOptPreset();
    if (preset === 'NDVI') {
      return {min: 0, max: 1, palette: ['#8c510a','#d8b365','#f6e8c3','#c7eae5','#5ab4ac','#01665e']};
    }
    return {min: 0.02, max: 0.35, gamma: 1.1};
  }

  // S1 dB
  var pol = getS1Pol();
  if (pol === 'VV+VH') return {min: -25, max: 0};
  return {min: -25, max: 0};
}

function makeDisplayImage(sensorKey, systemId) {
  var maskOn = useCloudRemoval();
  var preset = getOptPreset();

  // Sentinel-2
  if (sensorKey === 'S2_L1C') {
    var s2 = ee.Image(systemId);
    if (maskOn) s2 = maskS2_L1C_QA60(s2);

    if (preset === 'True color') return s2.select(['B4','B3','B2']).multiply(0.0001);
    if (preset === 'False color (NIR)') return s2.select(['B8','B4','B3']).multiply(0.0001);
    return s2.normalizedDifference(['B8','B4']).rename('NDVI');
  }

  if (sensorKey === 'S2_L2A') {
    var s2sr = ee.Image(systemId);
    if (maskOn) s2sr = maskS2_L2A_SCL(s2sr);

    if (preset === 'True color') return s2sr.select(['B4','B3','B2']).multiply(0.0001);
    if (preset === 'False color (NIR)') return s2sr.select(['B8','B4','B3']).multiply(0.0001);
    return s2sr.normalizedDifference(['B8','B4']).rename('NDVI');
  }

  // Landsat
  if (sensorKey === 'Landsat_TOA') {
    var ltoa = ee.Image(systemId);
    if (maskOn) {
      // guard in case QA_PIXEL absent
      ltoa = ee.Image(ee.Algorithms.If(ltoa.bandNames().contains('QA_PIXEL'), maskLandsatClouds_QA_PIXEL(ltoa), ltoa));
    }
    if (preset === 'True color') return ltoa.select(['B4','B3','B2']);
    if (preset === 'False color (NIR)') return ltoa.select(['B5','B4','B3']);
    return ltoa.normalizedDifference(['B5','B4']).rename('NDVI');
  }

  if (sensorKey === 'Landsat_L2SR') {
    var lsr = ee.Image(systemId);
    lsr = scaleLandsatSR(lsr);
    if (maskOn) lsr = maskLandsatClouds_QA_PIXEL(lsr);

    if (preset === 'True color') return lsr.select(['SR_B4','SR_B3','SR_B2']);
    if (preset === 'False color (NIR)') return lsr.select(['SR_B5','SR_B4','SR_B3']);
    return lsr.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI');
  }

  // Sentinel-1
  if (sensorKey === 'S1') {
    var s1 = ee.Image(systemId);
    var pol = getS1Pol();

    if (pol === 'VH') return toDb(s1.select('VH')).rename('VH_dB');
    if (pol === 'VV') return toDb(s1.select('VV')).rename('VV_dB');

    var vv = toDb(s1.select('VV'));
    var vh = toDb(s1.select('VH'));
    var vvMinusVh = vv.subtract(vh).rename('VVminusVH_dB');
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

var visPresetSelect = ui.Select({
  items: ['True color', 'False color (NIR)', 'NDVI'],
  value: 'True color',
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

// Content view panel (swaps Settings/Results/Preview)
var contentPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});

// Side panel: FIXED HEIGHT so it never grows (prevents page scrolling)
var sidePanel = ui.Panel({
  style: {
    position: 'top-left',
    width: '390px',
    height: '640px',
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

    contentPanel.add(smallLabel('\nSentinel-2 product')); contentPanel.add(s2LevelSelect);
    contentPanel.add(smallLabel('Landsat product')); contentPanel.add(landsatLevelSelect);
    contentPanel.add(smallLabel('Optical visualization')); contentPanel.add(visPresetSelect);
    contentPanel.add(smallLabel('Sentinel-1 polarization')); contentPanel.add(s1PolSelect);

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

    // Ensure something is shown if empty
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
// Map click behavior (clear & obvious)
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
// Query (double-checked + status updates)
// -------------------------
function runQuery() {
  clearResultsOnly();
  uiState.view = 'Settings';
  renderView();

  // reference date (client-side immediate)
  state.referenceDateStr = fmtTodayUTC();
  referenceDateLabel.setValue('Reference date: ' + state.referenceDateStr);

  statusLabel.setValue('⏳ Building collections…');
  var buf = state.poi.buffer(bufferSlider.getValue() * 1000);

  var now = ee.Date(Date.now());
  var start = now.advance(-lookbackSlider.getValue(), 'day');
  var cloudMax = cloudSlider.getValue();
  var limitN = maxImagesSlider.getValue();

  // Sentinel-2
  var s2Mode = getS2Level(); // 'L1C (TOA)' or 'L2A (SR)'
  var s2ColId = (s2Mode === 'L2A (SR)') ? 'COPERNICUS/S2_SR_HARMONIZED' : 'COPERNICUS/S2_HARMONIZED';
  state.lists.S2.sensorKey = (s2Mode === 'L2A (SR)') ? 'S2_L2A' : 'S2_L1C';

  var s2 = ee.ImageCollection(s2ColId)
    .filterBounds(buf)
    .filterDate(start, now)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudMax))
    .sort('system:time_start', false)
    .limit(limitN);

  // Landsat 8/9
  var lsMode = getLSLevel(); // 'TOA' or 'L2 (SR)'
  state.lists.LS.sensorKey = (lsMode === 'L2 (SR)') ? 'Landsat_L2SR' : 'Landsat_TOA';

  var ls = (lsMode === 'L2 (SR)')
    ? ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
    : ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_TOA'));

  // CLOUD_COVER exists in both TOA & L2 collections (C2), generally. Filter on it.
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

  // Fetch lists in parallel (faster UX)
  var pending = 3;
  function doneOne() {
    pending--;
    if (pending === 0) {
      statusLabel.setValue('✅ Query complete. Open "Results" and tick images to display.');
      uiState.view = 'Results';
      renderView();
      // render pages
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
// Render results for one sensor
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
  var parts = [item.date];

  if (which === 'S2') {
    parts.push(sensorKey === 'S2_L2A' ? 'S2 L2A' : 'S2 L1C');
    var c = (item.cloud !== null && item.cloud !== undefined) ? item.cloud.toFixed(1) : 'n/a';
    parts.push('cloud ' + c + '%');
  }

  if (which === 'LS') {
    parts.push(sensorKey === 'Landsat_L2SR' ? 'L8/9 SR' : 'L8/9 TOA');
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
  var vis = getVisParams(sensorKey === 'S1' ? 'S1' : sensorKey);

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
  var vis = getVisParams(sensorKey === 'S1' ? 'S1' : sensorKey);

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
// Hints when options change
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
visPresetSelect.onChange(function(v) {
  statusLabel.setValue('Optical preset "' + v + '". New layers will use this preset.');
});

// -------------------------
// Init view
// -------------------------
map.setCenter(0, 0, 2);
statusLabel.setValue('Click the map to set the POI (first time).');
