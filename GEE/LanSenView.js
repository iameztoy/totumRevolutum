/***************************************
 * POI Imagery Explorer (S2 + Landsat + S1)
 *
 * UX:
 * - Query is independent of display presets (composites & S1 viz)
 * - All visualization controls are in RESULTS view
 * - Changing presets updates ACTIVE layers + preview without re-query
 * - Sentinel-1 is robust to missing polarizations/modes: query all, adapt display per image
 *
 * S1:
 * - COPERNICUS/S1_GRD in GEE is in dB (do NOT log10 again)
 * - Dual-pol presets adapt to VV/VH or HH/HV, else fallback to single-pol
 ****************************************/

// -------------------------
// Defaults
// -------------------------
var DEFAULTS = {
  bufferKm: 5,
  lookbackDays: 30,
  cloudMax: 30,
  maxImages: 40,
  autoQueryAfterPOI: true,
  s2Level: 'L1C (TOA)',   // non-atmos corrected default
  landsatLevel: 'TOA',    // non-atmos corrected default
  s1ModeFilter: 'ANY'     // allow any mode by default (IW/EW/SM/WV)
};

var PAGE_SIZE = 10;

// -------------------------
// Composites
// -------------------------
// Sentinel-2 composites (from Sentinel Hub S2 composites list)
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

// Landsat 8/9 composites (native Landsat combos)
var LS_COMPOSITES = [
  {name: 'Natural Color (4,3,2)',           type: 'rgb', nums: [4,3,2]},
  {name: 'Color Infrared (5,4,3)',          type: 'rgb', nums: [5,4,3]},
  {name: 'False Color (Urban) (7,6,4)',     type: 'rgb', nums: [7,6,4]},
  {name: 'Agriculture (6,5,2)',             type: 'rgb', nums: [6,5,2]},
  {name: 'Geology (7,6,2)',                 type: 'rgb', nums: [7,6,2]},
  {name: 'Atmospheric Penetration (7,6,5)', type: 'rgb', nums: [7,6,5]},
  {name: 'Healthy Vegetation (5,6,2)',      type: 'rgb', nums: [5,6,2]},
  {name: 'Land/Water (5,6,4)',              type: 'rgb', nums: [5,6,4]},
  {name: 'Shortwave Infrared (7,5,4)',      type: 'rgb', nums: [7,5,4]},
  {name: 'Vegetation Analysis (6,5,4)',     type: 'rgb', nums: [6,5,4]},
  {name: 'Bathymetric (4,3,1)',             type: 'rgb', nums: [4,3,1]},
  {name: 'NDVI',                            type: 'ndvi'}
];

// Sentinel-1 visualization presets (ratios/indices + RGB ratio ideas inspired by common practice)
var S1_VIZ = [
  {name: 'Auto single (prefer VH)', kind: 'auto_single'},
  {name: 'Auto RGB ratio (dual-pol)', kind: 'auto_rgb_ratio'},          // co, cross, cross-co (dB)
  {name: 'Band: VV', kind: 'band', band: 'VV'},
  {name: 'Band: VH', kind: 'band', band: 'VH'},
  {name: 'Band: HH', kind: 'band', band: 'HH'},
  {name: 'Band: HV', kind: 'band', band: 'HV'},
  {name: 'Index: cross - co (dB) (auto)', kind: 'auto_cross_minus_co'}, // VH-VV or HV-HH
  {name: 'NDPI (auto dual-pol)', kind: 'auto_ndpi'},                    // (co-cross)/(co+cross) in linear
  {name: 'RVI4S1 (auto dual-pol)', kind: 'auto_rvi'}                    // q*(q+3)/(q+1)^2, q=cross/co in linear
];

function getByName(list, name, fallbackIdx) {
  for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
  return list[fallbackIdx || 0];
}

// -------------------------
// State
// -------------------------
var state = {
  poi: null,
  poiLayer: null,
  bufferLayer: null,
  poiPicking: true,

  // active map layers and metadata for live updates
  resultsLayers: {},   // key -> ui.Map.Layer
  layerMeta: {},       // key -> {group, sensorKey, systemId, labelBase, pols, mode}
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
function fmtTodayUTC() { return new Date().toISOString().slice(0, 10); }

function smallLabel(txt) {
  return ui.Label(txt, {fontSize: '12px', color: '#555', whiteSpace: 'pre', margin: '0 0 6px 0'});
}
function placeholder(txt) {
  return ui.Label(txt, {fontSize: '12px', color: '#777', whiteSpace: 'pre', margin: '6px 0 0 0'});
}

function dbToLin(dbImg) {
  // db -> linear: 10^(db/10)
  return ee.Image(10).pow(dbImg.divide(10));
}

function listHas(arr, val) {
  if (!arr) return false;
  for (var i = 0; i < arr.length; i++) if (String(arr[i]) === String(val)) return true;
  return false;
}

// -------------------------
// Query-time settings getters
// -------------------------
function getS2Level() { return s2LevelSelect.getValue(); }
function getLSLevel() { return landsatLevelSelect.getValue(); }
function getS1ModeFilter() { return s1ModeSelect.getValue(); }

// -------------------------
// Display-time settings getters (Results tab)
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

// -------------------------
// Visualization params
// -------------------------
function opticalVisParams() { return {min: 0.02, max: 0.35, gamma: 1.1}; }
function ndviVisParams() { return {min: 0, max: 1, palette: ['#8c510a','#d8b365','#f6e8c3','#c7eae5','#5ab4ac','#01665e']}; }
function s1BandVisParams() { return {min: -25, max: 0}; } // dB
function s1DiffVisParams() { return {min: -12, max: 6, palette: ['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c']}; }
function s1Index01VisParams() { return {min: 0, max: 1, palette: ['#8e0152','#de77ae','#f7f7f7','#7fbc41','#276419']}; }

// Decide vis per sensorKey and current preset
function getVisForSensor(sensorKey) {
  if (sensorKey === 'S1') {
    var p = getS1VizPreset();
    if (p.kind === 'auto_ndpi') return {min: -1, max: 1, palette: ['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c']};
    if (p.kind === 'auto_rvi') return s1Index01VisParams();
    if (p.kind === 'auto_cross_minus_co') return s1DiffVisParams();
    return s1BandVisParams(); // includes RGB ratio as well (values in dB-ish range)
  }
  if (sensorKey.indexOf('S2_') === 0) {
    return (getS2Composite().type === 'ndvi') ? ndviVisParams() : opticalVisParams();
  }
  if (sensorKey.indexOf('Landsat_') === 0) {
    return (getLSComposite().type === 'ndvi') ? ndviVisParams() : opticalVisParams();
  }
  return opticalVisParams();
}

// -------------------------
// Build display images
// -------------------------
function makeDisplayImage(sensorKey, systemId, meta) {
  var maskOn = useCloudRemoval();

  // Sentinel-2
  if (sensorKey === 'S2_L1C' || sensorKey === 'S2_L2A') {
    var s2 = ee.Image(systemId);
    if (maskOn) s2 = (sensorKey === 'S2_L2A') ? maskS2_L2A_SCL(s2) : maskS2_L1C_QA60(s2);

    var c = getS2Composite();
    if (c.type === 'ndvi') return s2.normalizedDifference(['B8','B4']).rename('NDVI');
    return s2.select(c.bands).multiply(0.0001);
  }

  // Landsat
  if (sensorKey === 'Landsat_TOA' || sensorKey === 'Landsat_L2SR') {
    var l = ee.Image(systemId);
    if (maskOn) {
      l = ee.Image(ee.Algorithms.If(l.bandNames().contains('QA_PIXEL'), maskLandsatClouds_QA_PIXEL(l), l));
    }

    var cL = getLSComposite();
    if (cL.type === 'ndvi') {
      if (sensorKey === 'Landsat_L2SR') {
        l = scaleLandsatSR(l);
        return l.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI');
      }
      return l.normalizedDifference(['B5','B4']).rename('NDVI');
    }

    function bandName(n) { return (sensorKey === 'Landsat_L2SR') ? ('SR_B' + n) : ('B' + n); }
    var b = cL.nums;
    var bands = [bandName(b[0]), bandName(b[1]), bandName(b[2])];

    if (sensorKey === 'Landsat_L2SR') l = scaleLandsatSR(l);
    return l.select(bands);
  }

  // Sentinel-1
  if (sensorKey === 'S1') {
    return makeS1DisplayImage(systemId, meta);
  }

  return null;
}

function makeS1DisplayImage(systemId, meta) {
  // GEE S1_GRD is already in dB
  var img = ee.Image(systemId);
  var pols = meta && meta.pols ? meta.pols : null;

  // Determine available family
  var hasVV = listHas(pols, 'VV');
  var hasVH = listHas(pols, 'VH');
  var hasHH = listHas(pols, 'HH');
  var hasHV = listHas(pols, 'HV');

  // helpers
  function pickAutoSingle() {
    // prefer VH, then VV, then HV, then HH
    if (hasVH) return img.select('VH');
    if (hasVV) return img.select('VV');
    if (hasHV) return img.select('HV');
    if (hasHH) return img.select('HH');

    // fallback: if pol list missing, attempt common bands (will error if none exist)
    return ee.Image(ee.Algorithms.If(img.bandNames().contains('VH'), img.select('VH'),
      ee.Algorithms.If(img.bandNames().contains('VV'), img.select('VV'),
        ee.Algorithms.If(img.bandNames().contains('HV'), img.select('HV'), img.select('HH')))));
  }

  function chooseCoCross() {
    // returns {coBand, crossBand} (strings) or null
    if (hasVV && hasVH) return {co: 'VV', cross: 'VH'};
    if (hasHH && hasHV) return {co: 'HH', cross: 'HV'};
    return null;
  }

  var preset = getS1VizPreset();

  if (preset.kind === 'auto_single') {
    return pickAutoSingle();
  }

  if (preset.kind === 'band') {
    var b = preset.band;
    if (listHas(pols, b)) return img.select(b);
    // fallback to auto single if band missing for this image
    return pickAutoSingle();
  }

  if (preset.kind === 'auto_rgb_ratio') {
    var cc = chooseCoCross();
    if (!cc) return pickAutoSingle();
    var co = img.select(cc.co);
    var cross = img.select(cc.cross);
    var diff = cross.subtract(co); // (dB) ratio proxy
    return ee.Image.cat([co.rename('R'), cross.rename('G'), diff.rename('B')]);
  }

  if (preset.kind === 'auto_cross_minus_co') {
    var cc2 = chooseCoCross();
    if (!cc2) return pickAutoSingle();
    return img.select(cc2.cross).subtract(img.select(cc2.co)).rename('cross_minus_co_db');
  }

  if (preset.kind === 'auto_ndpi') {
    // NDPI = (co - cross) / (co + cross) in linear
    var cc3 = chooseCoCross();
    if (!cc3) return pickAutoSingle();

    var coDb = img.select(cc3.co);
    var crossDb = img.select(cc3.cross);
    var coLin = dbToLin(coDb);
    var crossLin = dbToLin(crossDb);

    var ndpi = coLin.subtract(crossLin).divide(coLin.add(crossLin)).rename('NDPI');
    return ndpi;
  }

  if (preset.kind === 'auto_rvi') {
    // RVI4S1-like: q*(q+3)/(q+1)^2, q = cross/co in linear
    var cc4 = chooseCoCross();
    if (!cc4) return pickAutoSingle();

    var coLin2 = dbToLin(img.select(cc4.co));
    var crossLin2 = dbToLin(img.select(cc4.cross));
    var q = crossLin2.divide(coLin2);

    var N = q.multiply(q.add(3));
    var D = (q.add(1)).multiply(q.add(1));
    var rvi = N.divide(D).rename('RVI4S1_like');
    return rvi;
  }

  return pickAutoSingle();
}

// -------------------------
// Panel toggle
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
var toggleContainer = ui.Panel({style: {position: 'top-left', padding: '8px', width: '60px'}});
toggleContainer.add(panelToggleBtn);

// -------------------------
// Header labels
// -------------------------
var title = ui.Label('POI Imagery Explorer', {fontWeight: 'bold', fontSize: '18px', margin: '0 0 4px 0'});
var subtitle = ui.Label('S2 + Landsat 8/9 + Sentinel-1', {fontSize: '12px', color: '#555', margin: '0 0 8px 0'});

var referenceDateLabel = ui.Label('Reference date: (not queried yet)', {fontSize: '12px', color: '#555', margin: '0 0 6px 0'});
var statusLabel = ui.Label('Click the map to set the POI (first time).', {fontSize: '12px', margin: '0 0 8px 0'});
var poiInfo = ui.Label('POI: (none)', {fontSize: '12px', margin: '0 0 8px 0'});

// -------------------------
// View bar (Settings / Results / Preview)
// -------------------------
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

// -------------------------
// Buttons
// -------------------------
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

// -------------------------
// Settings (query-time)
// -------------------------
var bufferSlider = ui.Slider({min: 0.5, max: 50, value: DEFAULTS.bufferKm, step: 0.5, style: {stretch: 'horizontal'}});
bufferSlider.onChange(function(){ if (state.poi) drawBuffer(); });

var lookbackSlider = ui.Slider({min: 7, max: 365, value: DEFAULTS.lookbackDays, step: 1, style: {stretch: 'horizontal'}});
var cloudSlider = ui.Slider({min: 0, max: 100, value: DEFAULTS.cloudMax, step: 1, style: {stretch: 'horizontal'}});
var maxImagesSlider = ui.Slider({min: 5, max: 150, value: DEFAULTS.maxImages, step: 1, style: {stretch: 'horizontal'}});

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
var s1ModeSelect = ui.Select({
  items: ['ANY', 'IW', 'EW', 'SM', 'WV'],
  value: DEFAULTS.s1ModeFilter,
  style: {stretch: 'horizontal'}
});

// -------------------------
// Display controls (Results tab) – post-query
// -------------------------
var cloudRemovalCheckbox = ui.Checkbox({label: 'Cloud removal (display only)', value: false});
var s2CompositeSelect = ui.Select({items: S2_COMPOSITES.map(function(c){return c.name;}), value: S2_COMPOSITES[0].name, style: {stretch: 'horizontal'}});
var lsCompositeSelect = ui.Select({items: LS_COMPOSITES.map(function(c){return c.name;}), value: LS_COMPOSITES[0].name, style: {stretch: 'horizontal'}});
var s1VizSelect = ui.Select({items: S1_VIZ.map(function(v){return v.name;}), value: S1_VIZ[0].name, style: {stretch: 'horizontal'}});

// Disable display controls until query is done (keeps UX clean)
function setDisplayControlsEnabled(isEnabled) {
  cloudRemovalCheckbox.setDisabled(!isEnabled);
  s2CompositeSelect.setDisabled(!isEnabled);
  lsCompositeSelect.setDisabled(!isEnabled);
  s1VizSelect.setDisabled(!isEnabled);
}
setDisplayControlsEnabled(false);

// On-change: update active layers and preview without re-query
cloudRemovalCheckbox.onChange(function() {
  if (!state.queryDone) return;
  updateActiveLayersByGroup('S2');
  updateActiveLayersByGroup('LS');
  refreshPreviewIfActive();
});
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
s1VizSelect.onChange(function() {
  if (!state.queryDone) return;
  updateActiveLayersByGroup('S1');
  refreshPreviewIfActive();
});

// -------------------------
// Results panels + pagers
// -------------------------
var s2CountLabel = ui.Label('S2: 0', {fontSize: '12px', color: '#555'});
var lsCountLabel = ui.Label('Landsat: 0', {fontSize: '12px', color: '#555'});
var s1CountLabel = ui.Label('S1: 0', {fontSize: '12px', color: '#555'});

var s2ResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var lsResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var s1ResultsPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});

var s2Pager = makePager('S2', s2ResultsPanel);
var lsPager = makePager('LS', lsResultsPanel);
var s1Pager = makePager('S1', s1ResultsPanel);

// -------------------------
// Preview
// -------------------------
var previewMeta = ui.Label('Select an image (Preview or tick) to see a thumbnail.', {fontSize: '12px', color: '#555', whiteSpace: 'pre'});
var previewThumbPanel = ui.Panel();

// -------------------------
// Content panel + side panel
// -------------------------
var contentPanel = ui.Panel({layout: ui.Panel.Layout.flow('vertical')});
var sidePanel = ui.Panel({
  style: {
    position: 'top-left',
    width: '390px',
    height: '700px',
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
      'All visualization controls are in Results (post-query).'
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
    contentPanel.add(autoQueryCheckbox);

    contentPanel.add(smallLabel('\nProducts / filters'));
    contentPanel.add(smallLabel('Sentinel-2 product')); contentPanel.add(s2LevelSelect);
    contentPanel.add(smallLabel('Landsat product')); contentPanel.add(landsatLevelSelect);
    contentPanel.add(smallLabel('Sentinel-1 mode filter (ANY recommended for polar regions)')); contentPanel.add(s1ModeSelect);

  } else if (uiState.view === 'Results') {
    contentPanel.add(ui.Label('Display controls (no re-query)', {fontWeight: 'bold', margin: '0 0 4px 0'}));

    if (!state.queryDone) {
      contentPanel.add(placeholder('Run Query first to enable display controls.'));
    }

    contentPanel.add(cloudRemovalCheckbox);
    contentPanel.add(smallLabel('Sentinel-2 composite')); contentPanel.add(s2CompositeSelect);
    contentPanel.add(smallLabel('Landsat composite')); contentPanel.add(lsCompositeSelect);
    contentPanel.add(smallLabel('Sentinel-1 visualization')); contentPanel.add(s1VizSelect);

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
      contentPanel.add(smallLabel('\nCurrent display presets:'));
      contentPanel.add(smallLabel('S2: ' + s2CompositeSelect.getValue()));
      contentPanel.add(smallLabel('Landsat: ' + lsCompositeSelect.getValue()));
      contentPanel.add(smallLabel('S1: ' + s1VizSelect.getValue()));
    }
  }
}
renderView();

// -------------------------
// POI
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
  setDisplayControlsEnabled(false);

  uiState.view = 'Settings';
  renderView();

  referenceDateLabel.setValue('Reference date: ' + fmtTodayUTC());
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

  // Landsat
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

  // Sentinel-1 (robust: no assumption on VV/VH; mode filter optional)
  var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(buf)
    .filterDate(start, now)
    .sort('system:time_start', false)
    .limit(limitN);

  var modeFilter = getS1ModeFilter();
  if (modeFilter !== 'ANY') {
    s1 = s1.filter(ee.Filter.eq('instrumentMode', modeFilter));
  }

  // Fetch lists in parallel
  var pending = 3;
  function doneOne() {
    pending--;
    if (pending === 0) {
      state.queryDone = true;
      setDisplayControlsEnabled(true);

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
  // Pull mode + polarization list so we can adapt visualization per image
  var dict = ee.Dictionary({
    ids: col.aggregate_array('system:id'),
    t: col.aggregate_array('system:time_start'),
    pass: col.aggregate_array('orbitProperties_pass'),
    ro: col.aggregate_array('relativeOrbitNumber_start'),
    mode: col.aggregate_array('instrumentMode'),
    pols: col.aggregate_array('transmitterReceiverPolarisation')
  });

  dict.evaluate(function(d) {
    var items = [];
    if (d && d.ids) {
      for (var i = 0; i < d.ids.length; i++) {
        items.push({
          systemId: d.ids[i],
          date: fmtDateUTC(d.t[i]),
          pass: d.pass ? d.pass[i] : null,
          relOrbit: (d.ro && d.ro[i] != null) ? d.ro[i] : null,
          mode: d.mode ? d.mode[i] : null,
          pols: d.pols ? d.pols[i] : null // array like ["VV","VH"] or ["HH","HV"] or ["VV"]
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
      var labelBase = buildLabelBase(which, item);
      var key = sensorKey + '::' + item.systemId;

      var cb = ui.Checkbox({
        label: labelBase,
        value: !!state.resultsLayers[key],
        onChange: function(checked) {
          var info = {key: key, systemId: item.systemId, labelBase: labelBase, item: item};
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
          var info = {key: key, systemId: item.systemId, labelBase: labelBase, item: item};
          setPreview(sensorKey, which, info);
          uiState.view = 'Preview'; renderView();
        }
      });

      var zBtn = ui.Button({
        label: 'Zoom',
        style: {margin: '0 0 0 6px'},
        onClick: function() {
          map.centerObject(ee.Image(item.systemId).geometry(), 10);
          var info = {key: key, systemId: item.systemId, labelBase: labelBase, item: item};
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
  var mode = item.mode ? String(item.mode) : 'n/a';
  var pols = item.pols ? item.pols.join(',') : 'n/a';
  return item.date + ' | S1 | mode ' + mode + ' | pols ' + pols + ' | ' + pass + ' | relOrb ' + ro;
}

// -------------------------
// Layer add/update (live preset updates)
// -------------------------
function groupFromWhich(which) {
  return (which === 'S2') ? 'S2' : (which === 'LS') ? 'LS' : 'S1';
}

function addOrUpdateLayer(sensorKey, which, info) {
  var key = info.key;

  // store meta (include S1 pols/mode for adaptive viz)
  state.layerMeta[key] = {
    group: groupFromWhich(which),
    sensorKey: sensorKey,
    systemId: info.systemId,
    labelBase: info.labelBase,
    pols: info.item && info.item.pols ? info.item.pols : null,
    mode: info.item && info.item.mode ? info.item.mode : null
  };

  var img = makeDisplayImage(sensorKey, info.systemId, state.layerMeta[key]);
  var vis = getVisForSensor(sensorKey);

  if (!state.resultsLayers[key]) {
    var layer = ui.Map.Layer(img, vis, info.labelBase, true);
    map.layers().add(layer);
    state.resultsLayers[key] = layer;
  } else {
    updateLayerObject(key);
  }
}

function updateLayerObject(key) {
  var meta = state.layerMeta[key];
  var layer = state.resultsLayers[key];
  if (!meta || !layer) return;

  var img = makeDisplayImage(meta.sensorKey, meta.systemId, meta);
  var vis = getVisForSensor(meta.sensorKey);

  if (layer.setEeObject && layer.setVisParams) {
    layer.setEeObject(img);
    layer.setVisParams(vis);
    if (layer.setName) layer.setName(meta.labelBase);
    return;
  }

  // fallback: replace at same index
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
    if (meta && meta.group === group) updateLayerObject(key);
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
    labelBase: meta.labelBase,
    item: {pols: meta.pols, mode: meta.mode}
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
  var meta = state.layerMeta[info.key] || {
    pols: info.item && info.item.pols ? info.item.pols : null,
    mode: info.item && info.item.mode ? info.item.mode : null
  };

  var img = makeDisplayImage(sensorKey, info.systemId, meta);
  var vis = getVisForSensor(sensorKey);

  var thumb = ui.Thumbnail({
    image: img.visualize(vis),
    params: {region: roi, dimensions: 256, format: 'png'},
    style: {margin: '6px 0 0 0', maxWidth: '256px'}
  });

  var extra = '';
  if (sensorKey.indexOf('S2_') === 0) extra = '\nS2 composite: ' + s2CompositeSelect.getValue();
  if (sensorKey.indexOf('Landsat_') === 0) extra = '\nLandsat composite: ' + lsCompositeSelect.getValue();
  if (sensorKey === 'S1') extra = '\nS1 viz: ' + s1VizSelect.getValue();

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

  state.queryDone = false;
  setDisplayControlsEnabled(false);
}

// -------------------------
// Init empty results
// -------------------------
s2ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
lsResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));
s1ResultsPanel.add(placeholder('No results yet. Run "Query imagery" (Settings).'));

// -------------------------
// Init view & map
// -------------------------
map.setCenter(0, 0, 2);
renderView();
renderWidgets();
