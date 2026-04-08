var geometry = 
    /* color: #98ff00 */
    /* shown: false */
    ee.Geometry.Polygon(
        [[[-6.744304020765339, 44.094319124293364],
          [-9.68863995826534, 43.754061813417806],
          [-9.13932355201534, 40.39553781728634],
          [-4.656901677015339, 40.26991491246308],
          [-2.7562669113903393, 41.19397800381167],
          [-2.9869798020153393, 43.73818853099909],
          [-4.711833317640339, 44.236174491068056]]]);

// =====================================================================
// Google Earth Engine — Burned Area & Fire Severity (Sentinel‑2)
// Methodology following Sobrino et al. (2024) — v1.9j
// ✦ Water masks: choose S2 SCL water, NDWI/mNDWI, or BOTH with union/AND.
// ✦ Robust combiner: safe combination of (pre/post) masks without null errors.
// ✦ Single‑date pass mosaic (datatake aware) or median composites.
// ✦ Patch filter, multi‑threshold explorer, GAUL AOI, severity classes.
// ✦ Area calc fix: NEVER reproject pixelArea(); pass stable UTM CRS to reducers.
// ✦ SI (Separability Index) from the paper is **not** implemented (diagnostic only).
// =====================================================================

// =============================
// 0) USER SETTINGS
// =============================
// AOI choice (select exactly ONE)
var USE_DRAWN_AOI = false;          // true: use polygon drawn with Map.drawingTools()
var USE_ADMIN_AOI = true;           // true: use GAUL admin boundaries below

// GAUL admin AOI
var ADMIN_LEVEL     = 2;            // 0 = country, 1 = ADM1, 2 = ADM2 (provinces in Spain)
var ADMIN_COUNTRY   = 'Spain';      // GAUL ADM0_NAME
var ADMIN_NAMES     = ['Ourense'];  // names at chosen level
var ADMIN_STATS     = false;        // burned area (+severity) per admin unit
var ADMIN_STATS_ALL = false;        // stats for all admin units at that level in the country
var SHOW_ADMIN_LAYER = true;        // show selected admin boundaries on the map

// Fire window (adjust to the fire event)
var FIRE_DATE = '2025-08-23';       // fire extinction/peak date (approx.)
var PRE_DAYS  = 30;                 // days before fire for pre‑fire composite window
var POST_DAYS = 30;                 // days after fire for post‑fire composite window

// Composite mode: 'median' (window composite) or 'single' (exact/nearest scene)
var COMPOSITE_MODE = 'single';      // 'median' | 'single'
// If COMPOSITE_MODE == 'single', specify target dates (UTC)
var PRE_SINGLE_DATE  = '2025-08-01';
var POST_SINGLE_DATE = '2025-08-23';
var SINGLE_SEARCH_DAYS = 5;         // ± days if not exact
var REQUIRE_EXACT_DATE = false;     // true -> require exact day; false -> nearest within ±window
var PRINT_SELECTED_SCENES = true;   // console print of chosen single scenes (tiles list)

// Sentinel‑2 collection selection
var S2_COLLECTION   = 'SR';         // 'SR' (Surface Reflectance) or 'L1C' (Top‑of‑Atmosphere)
var S2_SR_IC        = 'COPERNICUS/S2_SR_HARMONIZED';
var S2_L1C_IC       = 'COPERNICUS/S2_HARMONIZED';

// S2 filters
var MAX_SCENE_CLOUD = 60;           // collection‑level filter (percent)
var APPLY_SMOOTHING = true;         // 3×3 focal mean before thresholding

// Water veto (SCL + index options)
var APPLY_WATER_VETO   = true;      // remove water pixels before smoothing/thresholding
var WATER_VETO_INDEX   = 'mNDWI';   // 'mNDWI' (Xu 2006, B3/B11) or 'NDWI' (McFeeters 1996, B3/B8)
var WATER_VETO_THRESHOLD = 0;       // water if index > threshold (tune e.g. 0.05)
var WATER_VETO_WHEN    = 'pre'; // 'pre_only' | 'post_only' | 'pre_or_post'
var WATER_VETO_SOURCE  = 'both';    // 'index' | 's2' | 'both'
var WATER_VETO_COMBINE = 'union';   // when source='both': 'union' (OR) | 'intersection' (AND)
var SHOW_WATER_MASK    = true;      // show final water mask
var SHOW_WATER_COMPONENTS = false;  // show SCL and index components separately

// Shoreline edge‑protection (optional)
var APPLY_EDGE_PROTECT = true;     // if true, remove a N‑pixel ring around water to stop bleed‑over
var EDGE_PROTECT_PIXELS = 1;        // ring width in pixels

// Land‑cover mask (forest + shrub)
var USE_LC_MASK = false;            // mask to woody & shrub classes
var USE_WORLDCOVER = true;          // true: WorldCover; false: your own LC asset
var WORLDCOVER_ASSET = 'ESA/WorldCover/v200/2021';
var YOUR_OWN_LC_ASSET  = 'YOUR_OWN_ASSET'; // e.g., 'users/you/your_lc_raster'

// Burned‑area threshold (from paper; adjust as needed)
var THRESH_DNBR2 = 0.10;            // dNBR2 ≥ 0.10 → burned

// Minimum connected‑patch filter (optional)
var APPLY_MIN_PATCH    = true;     // remove connected burned patches below a size
var PATCH_FILTER_MODE  = 'pixel';    // 'area' (hectares) or 'pixels'
var MIN_PATCH_HA       = 1;         // used when mode='area'
var MIN_PATCH_PIXELS   = 25;        // used when mode='pixels'
var CONNECTIVITY_EIGHT = true;      // true: 8‑connected, false: 4‑connected
var SHOW_PATCH_DEBUG   = true;      // print computed minPixels/safeMax in Console

// Multi‑threshold exploration (optional; default OFF)
var RUN_MULTI_THRESH = false;       // build/display/export masks for MULTI_THRESH values
var MULTI_THRESH = [0.06, 0.08, 0.10, 0.12, 0.14];
var MULTI_ADD_TO_MAP = true;        // add each candidate mask as a map layer
var MULTI_SHOW_PREPATCH = false;    // also show pre‑patch multi‑threshold masks (blue)
var MULTI_EXPORT = false;           // export each candidate mask to Drive

// Severity thresholds (Table 8)
// NDVI pre‑fire vegetation‑density strata
var NDVI_LOW_MAX       = 0.40;      // NDVI < 0.40 → low density
var NDVI_FULL_MIN      = 0.75;      // NDVI ≥ 0.75 → full density; otherwise mixed
// Low density (BAIS2)
var TH_BAIS2_LOW_MAX   = 0.90;      // < 0.90 → low
var TH_BAIS2_MOD_MAX   = 1.00;      // [0.90, 1.00) → moderate; ≥ 1.00 → high
// Mixed density (NBR)
var TH_NBR_LOW_MIN     = 0.00;      // > 0.00 → low
var TH_NBR_MOD_MIN     = -0.30;     // (≤ 0.00 & > −0.30) → moderate; ≤ −0.30 → high
// Full density (NBR3)
var TH_NBR3_LOW_MIN    = 0.20;      // > 0.20 → low
var TH_NBR3_MOD_MIN    = -0.30;     // (≤ 0.20 & > −0.30) → moderate; ≤ −0.30 → high

// Area & export settings
var AREA_METHOD   = 'utm';          // 'utm' -> set CRS in reducers; 'native' -> no CRS override
var ANALYSIS_SCALE = 10;            // meters (used in reduceRegion)
var EXPORT_SCALE   = 10;            // meters (rasters)
var EXPORT_CRS     = 'EPSG:4326';   // change to a relevant UTM if desired
var EXPORT_FOLDER  = 'GEE_Fire_Sobrino2024';
var PRINT_STATS    = true;          // print totals and per‑severity table in Console
var EXPORT_STATS   = true;          // export per‑severity CSV to Drive
var TILE_SCALE     = 2;             // optional tileScale for reduceRegion; set null to disable

// Visualization
var PALETTE_SEVERITY = ['00FF00','FFF59D','FFA726','EF5350'];

// =============================
// 1) HELPERS
// =============================
function toDate(str) { return ee.Date(str); }
function plusDays(d, n) { return ee.Date(d).advance(n, 'day'); }

// Determine a stable UTM EPSG from AOI centroid (north=326xx, south=327xx)
function utmCrsForGeom(geom) {
  var c = ee.Geometry(geom).centroid(1);
  var lon = ee.Number(c.coordinates().get(0));
  var lat = ee.Number(c.coordinates().get(1));
  var zone = lon.add(180).divide(6).floor().add(1); // 1..60
  var root = ee.String(ee.Algorithms.If(lat.gte(0), 'EPSG:326', 'EPSG:327'));
  var zoneStr = ee.Number(zone).format('%02d');
  return root.cat(zoneStr); // e.g., EPSG:32629
}

// Safe boolean-mask helpers
function asMask(x) { return x ? ee.Image(x).gt(0) : ee.Image(0); }
function maskOr(a, b) { return asMask(a).or(asMask(b)); }
function maskAnd(a, b) { return asMask(a).and(asMask(b)); }

// Scale S2 to reflectance (0–1)
function scaleSR(img) { var refl = img.select('B.*').divide(10000); return img.addBands(refl, null, true); }

// SR cloud/shadow mask via SCL
function maskS2SCL(img) {
  var scl = img.select('SCL');
  var good = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(good);
}

// L1C cloud mask via QA60 (bits 10 = clouds, 11 = cirrus)
function maskS2QA60(img) {
  var qa = img.select('QA60');
  var cloudBitMask  = 1 << 10;
  var cirrusBitMask = 1 << 11;
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  return img.updateMask(mask);
}

function getS2Composite(aoi, startDate, endDate) {
  var isSR = S2_COLLECTION === 'SR';
  var icId = isSR ? S2_SR_IC : S2_L1C_IC;
  var col = ee.ImageCollection(icId)
    .filterBounds(aoi)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', MAX_SCENE_CLOUD))
    .map(scaleSR)
    .map(isSR ? maskS2SCL : maskS2QA60);
  var comp = col.median().clip(aoi);
  return comp.set({ 'is_composite': true, 'composite_start': ee.Date(startDate).millis(), 'composite_end': ee.Date(endDate).millis() });
}

// INTERNAL: given a base collection and a chosen first image, return all tiles of the same pass
function _samePassCollection(base, first) {
  var dt = ee.String(first.get('DATATAKE_IDENTIFIER'));
  var byDatatake = base.filter(ee.Filter.eq('DATATAKE_IDENTIFIER', dt));
  var cntDT = byDatatake.size();
  // Fallback: same orbit number + direction within ±2 hours of the chosen image time
  var t = first.date();
  var t0 = t.advance(-2, 'hour');
  var t1 = t.advance( 2, 'hour');
  var byTimeOrbit = base
    .filterDate(t0, t1)
    .filter(ee.Filter.eq('SENSING_ORBIT_NUMBER', first.get('SENSING_ORBIT_NUMBER')))
    .filter(ee.Filter.eq('SENSING_ORBIT_DIRECTION', first.get('SENSING_ORBIT_DIRECTION')));
  return ee.ImageCollection(ee.Algorithms.If(cntDT.gt(0), byDatatake, byTimeOrbit));
}

// Build a single best "pass" around a target date (exact or nearest within ± window)
// Returns a MOSAIC of **all tiles with the same pass** (full coverage)
function getS2SingleScene(aoi, targetDate) {
  var target = ee.Date(targetDate);
  var isSR = S2_COLLECTION === 'SR';
  var icId = isSR ? S2_SR_IC : S2_L1C_IC;
  var start = REQUIRE_EXACT_DATE ? target : target.advance(-SINGLE_SEARCH_DAYS, 'day');
  var end   = REQUIRE_EXACT_DATE ? target.advance(1, 'day') : target.advance(SINGLE_SEARCH_DAYS + 1, 'day');
  var base = ee.ImageCollection(icId)
    .filterBounds(aoi)
    .filterDate(start, end)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', MAX_SCENE_CLOUD))
    .map(scaleSR)
    .map(isSR ? maskS2SCL : maskS2QA60);

  // Rank images by proximity to the target date, then by cloudiness
  var ranked = base.map(function(im){
    var diffDays = ee.Number(im.date().difference(target, 'day')).abs();
    var cloud    = ee.Number(im.get('CLOUDY_PIXEL_PERCENTAGE'));
    return im.set('rank', diffDays.multiply(10000).add(cloud));
  }).sort('rank');

  var cnt = ranked.size();
  var mosaic = ee.Image(ee.Algorithms.If(cnt.gt(0), (function(){
      var first = ee.Image(ranked.first());
      var samePass = _samePassCollection(base, first);
      var ts = ee.Number(first.get('system:time_start'));
      var ids   = samePass.aggregate_array('system:index');
      var tiles = samePass.aggregate_array('MGRS_TILE');
      var mosa = samePass.mosaic().clip(aoi)
        .set({
          'pass_time': ts,
          'system:time_start': ts,
          'mosaic_tile_ids': ids,
          'mosaic_mgrs_tiles': tiles,
          'mosaic_count': samePass.size(),
          'chosen_index': first.get('system:index'),
          'chosen_cloud': first.get('CLOUDY_PIXEL_PERCENTAGE'),
          'is_composite': false,
          'DATATAKE_IDENTIFIER': first.get('DATATAKE_IDENTIFIER'),
          'SENSING_ORBIT_NUMBER': first.get('SENSING_ORBIT_NUMBER'),
          'SENSING_ORBIT_DIRECTION': first.get('SENSING_ORBIT_DIRECTION')
        });
      if (PRINT_SELECTED_SCENES) {
        print('Single-date pass time:', ee.Date(ts).format('YYYY-MM-dd HH:mm'));
        print('  Tiles (MGRS):', tiles);
        print('  Count:', samePass.size(), '  Datatake:', first.get('DATATAKE_IDENTIFIER'));
        print('  Chosen (rank #1) index:', first.get('system:index'), 'cloud %:', first.get('CLOUDY_PIXEL_PERCENTAGE'));
      }
      return mosa;
    })(), (function(){
      var wideStart = target.advance(-SINGLE_SEARCH_DAYS, 'day');
      var wideEnd   = target.advance(SINGLE_SEARCH_DAYS + 1, 'day');
      if (PRINT_SELECTED_SCENES) print('No image in requested window; falling back to ±', SINGLE_SEARCH_DAYS, 'days.');
      return getS2Composite(aoi, wideStart, wideEnd);
    })()
  ));

  return mosaic;
}

// Add indices used by the method
function addIndices(img) {
  var b = { B2: img.select('B2'), B3: img.select('B3'), B4: img.select('B4'), B5: img.select('B5'), B6: img.select('B6'), B7: img.select('B7'), B8: img.select('B8'), B8A: img.select('B8A'), B11: img.select('B11'), B12: img.select('B12') };
  var NDVI = img.normalizedDifference(['B8','B4']).rename('NDVI');
  var NBR  = img.normalizedDifference(['B8','B12']).rename('NBR');
  var NBR2 = b.B11.subtract(b.B12).divide(b.B11.add(b.B12)).rename('NBR2');
  var NBR3 = b.B7.subtract(b.B12).divide(b.B7.add(b.B12)).rename('NBR3');
  var term1 = ee.Image(1).subtract(b.B6.multiply(b.B7).multiply(b.B8A).divide(b.B4).sqrt());
  var diff  = b.B12.subtract(b.B8A);
  var term2 = diff.divide(diff.abs().sqrt().add(1));
  var BAIS2 = term1.multiply(term2).rename('BAIS2');
  var BAI   = ee.Image(1).divide(ee.Image(0.1).subtract(b.B4).pow(2).add(ee.Image(0.06).subtract(b.B8).pow(2))).rename('BAI');
  var MIRBI = b.B11.multiply(10).subtract(b.B12.multiply(9.8)).rename('MIRBI');
  return img.addBands([NDVI, NBR, NBR2, NBR3, BAIS2, BAI, MIRBI]);
}

function smooth3x3(img) { return APPLY_SMOOTHING ? img.focal_mean({radius: 1, units: 'pixels'}) : img; }

// Water indices & masks
function calcNDWI(img)  { return img.normalizedDifference(['B3','B8']).rename('NDWI'); }
function calcMNDWI(img) { return img.normalizedDifference(['B3','B11']).rename('mNDWI'); }
function waterMaskFromIndex(img, method, thr) { var idx = (method === 'mNDWI') ? calcMNDWI(img) : calcNDWI(img); return idx.gt(ee.Number(thr)).rename('WATER_IDX'); }
function waterMaskFromSCL(img) { return img.select('SCL').eq(6).rename('WATER_SCL'); } // L2A only

// Combine pre/post masks according to WATER_VETO_WHEN (always returns an ee.Image)
function combineWhen(preMask, postMask) {
  if (WATER_VETO_WHEN === 'pre_only')  return asMask(preMask);
  if (WATER_VETO_WHEN === 'post_only') return asMask(postMask);
  return maskOr(preMask, postMask); // 'pre_or_post'
}

// ---- Missing helpers restored ----
// Land cover mask: forest + shrub (WorldCover or user asset)
function getWoodyShrubMask(aoi) {
  if (USE_WORLDCOVER) {
    var wc = ee.Image(WORLDCOVER_ASSET).select('Map');
    var forest = wc.eq(10);   // Trees
    var shrub  = wc.eq(20);   // Shrubland
    return forest.or(shrub).selfMask().clip(aoi);
  } else {
    var lc = ee.Image(YOUR_OWN_LC_ASSET).select(0).clip(aoi);
    // Example codes for a generic S2GLC-like legend; adjust to your asset
    var woody = lc.eq(111).or(lc.eq(112)); // broadleaf / coniferous
    var shrub = lc.eq(120).or(lc.eq(121)).or(lc.eq(122));
    return woody.or(shrub).selfMask();
  }
}

// Severity classifiers per NDVI density stratum
function classifySeverityLowDensity(post) {
  var b = post.select('BAIS2');
  var low = b.lt(TH_BAIS2_LOW_MAX);
  var mod = b.gte(TH_BAIS2_LOW_MAX).and(b.lt(TH_BAIS2_MOD_MAX));
  var high= b.gte(TH_BAIS2_MOD_MAX);
  return ee.Image(0).where(low,1).where(mod,2).where(high,3).rename('SEV_LOW');
}
function classifySeverityMixedDensity(post) {
  var b = post.select('NBR');
  var low = b.gt(TH_NBR_LOW_MIN);
  var mod = b.lte(TH_NBR_LOW_MIN).and(b.gt(TH_NBR_MOD_MIN));
  var high= b.lte(TH_NBR_MOD_MIN);
  return ee.Image(0).where(low,1).where(mod,2).where(high,3).rename('SEV_MIX');
}
function classifySeverityFullDensity(post)  {
  var b = post.select('NBR3');
  var low = b.gt(TH_NBR3_LOW_MIN);
  var mod = b.lte(TH_NBR3_LOW_MIN).and(b.gt(TH_NBR3_MOD_MIN));
  var high= b.lte(TH_NBR3_MOD_MIN);
  return ee.Image(0).where(low,1).where(mod,2).where(high,3).rename('SEV_FULL');
}

// Patch-size filter utilities
function _computeMinPixels(maskImg) {
  if (!APPLY_MIN_PATCH) return ee.Number(0);
  if (PATCH_FILTER_MODE === 'pixels') { return ee.Number(MIN_PATCH_PIXELS).max(0).ceil(); }
  var scale = maskImg.projection().nominalScale(); // meters
  return ee.Number(MIN_PATCH_HA).multiply(10000).divide(scale.multiply(scale)).ceil();
}
function applyMinPatch(maskImg, dbgLabel) {
  if (!APPLY_MIN_PATCH) return maskImg;
  var minPixels = _computeMinPixels(maskImg);
  var safeMax = ee.Number(1024).min(minPixels).max(2); // enforce [2,1024]
  var conn = maskImg.connectedPixelCount({maxSize: safeMax, eightConnected: CONNECTIVITY_EIGHT});
  if (SHOW_PATCH_DEBUG) {
    print('Patch filter [' + (dbgLabel || 'mask') + ']: minPixels =', minPixels, ', safeMax =', safeMax, ', eightConnected =', CONNECTIVITY_EIGHT);
  }
  return maskImg.updateMask(conn.gte(minPixels));
}

// =============================
// 2) AOI & DATE WINDOWS
// =============================
if (USE_DRAWN_AOI && USE_ADMIN_AOI) { throw 'Choose only one AOI source: set either USE_DRAWN_AOI=true or USE_ADMIN_AOI=true (not both).'; }

var drawn = Map.drawingTools();
function getDrawnAOIOrThrow() {
  drawn.setShown(true); drawn.setDrawModes(['polygon']);
  var layers = drawn.layers();
  if (layers.length() === 0) { drawn.draw(); throw 'No drawn AOI found. Draw a polygon or set USE_ADMIN_AOI=true.'; }
  var layer = layers.get(0);
  var geom = (layer.getEeObject) ? layer.getEeObject() : null;
  if (!geom) throw 'Could not read drawn geometry. Please redraw the AOI.';
  return ee.Geometry(geom);
}

var AOI, ADMIN_FC = null;
if (USE_ADMIN_AOI) { var id=(ADMIN_LEVEL===0)?'FAO/GAUL/2015/level0':(ADMIN_LEVEL===1)?'FAO/GAUL/2015/level1':'FAO/GAUL/2015/level2'; ADMIN_FC = ee.FeatureCollection(id).filter(ee.Filter.eq('ADM0_NAME', ADMIN_COUNTRY)); var nameField=(ADMIN_LEVEL===0)?'ADM0_NAME':(ADMIN_LEVEL===1)?'ADM1_NAME':'ADM2_NAME'; if(!ADMIN_STATS_ALL) ADMIN_FC=ADMIN_FC.filter(ee.Filter.inList(nameField, ADMIN_NAMES)); AOI = ADMIN_FC.geometry(); }
else if (USE_DRAWN_AOI) { AOI = getDrawnAOIOrThrow(); }
else { throw 'No AOI source selected. Enable USE_DRAWN_AOI or USE_ADMIN_AOI.'; }

Map.centerObject(AOI, 10);

var d0 = toDate(FIRE_DATE);
var preStart  = plusDays(d0, -PRE_DAYS);
var preEnd    = plusDays(d0, -1);
var postStart = plusDays(d0, 0);
var postEnd   = plusDays(d0, POST_DAYS);

// =============================
// 3) COMPOSITES + INDICES
// =============================
var preRaw  = (COMPOSITE_MODE === 'single') ? getS2SingleScene(AOI, PRE_SINGLE_DATE)  : getS2Composite(AOI, preStart,  preEnd);
var postRaw = (COMPOSITE_MODE === 'single') ? getS2SingleScene(AOI, POST_SINGLE_DATE) : getS2Composite(AOI, postStart, postEnd);
if (PRINT_SELECTED_SCENES) {
  var preMsg  = ee.Algorithms.If(preRaw.get('pass_time'), ee.Date(preRaw.get('pass_time')).format('YYYY-MM-dd HH:mm'), ee.String('Composite ').cat(ee.Date(preStart).format('YYYY-MM-dd')).cat(' → ').cat(ee.Date(preEnd).format('YYYY-MM-dd')));
  var postMsg = ee.Algorithms.If(postRaw.get('pass_time'), ee.Date(postRaw.get('pass_time')).format('YYYY-MM-dd HH:mm'), ee.String('Composite ').cat(ee.Date(postStart).format('YYYY-MM-dd')).cat(' → ').cat(ee.Date(postEnd).format('YYYY-MM-dd')));
  print('Pre time:',  preMsg);
  print('Post time:', postMsg);
}
var pre  = addIndices(preRaw);
var post = addIndices(postRaw);

// =============================
// 4) BURNED AREA by dNBR2 (with optional water veto & edge protection)
// =============================
var dNBR2 = pre.select('NBR2').subtract(post.select('NBR2')).rename('dNBR2');

// --- WATER VETO --- //
var idxPre  = APPLY_WATER_VETO ? waterMaskFromIndex(pre,  WATER_VETO_INDEX, WATER_VETO_THRESHOLD) : null;
var idxPost = APPLY_WATER_VETO ? waterMaskFromIndex(post, WATER_VETO_INDEX, WATER_VETO_THRESHOLD) : null;
var HAS_SCL = (S2_COLLECTION === 'SR');
var sclPre = null, sclPost = null;
if (APPLY_WATER_VETO && HAS_SCL) { sclPre = waterMaskFromSCL(pre); sclPost = waterMaskFromSCL(post); }
if (APPLY_WATER_VETO && !HAS_SCL && WATER_VETO_SOURCE !== 'index') {
  print('Note: SCL water is only available for L2A (SR). Falling back to index‑based water mask.');
}
var waterIdx = APPLY_WATER_VETO ? combineWhen(idxPre, idxPost) : null;
var waterSCL = (APPLY_WATER_VETO && HAS_SCL) ? combineWhen(sclPre, sclPost) : null;
var waterMask = null;
if (APPLY_WATER_VETO) {
  if (WATER_VETO_SOURCE === 'index') {
    waterMask = waterIdx;
  } else if (WATER_VETO_SOURCE === 's2') {
    waterMask = HAS_SCL ? waterSCL : waterIdx; // fallback to index if SCL not available
  } else { // 'both'
    if (HAS_SCL) {
      waterMask = (WATER_VETO_COMBINE === 'intersection') ? maskAnd(waterSCL, waterIdx) : maskOr(waterSCL, waterIdx);
    } else {
      waterMask = waterIdx; // no SCL available -> use index only
    }
  }
}

// Shoreline edge ring (optional)
var edgeRing = null;
if (APPLY_EDGE_PROTECT) {
  var baseWater = asMask(waterMask);
  if (!APPLY_WATER_VETO) { baseWater = maskOr(waterMaskFromIndex(pre, WATER_VETO_INDEX, WATER_VETO_THRESHOLD), waterMaskFromIndex(post, WATER_VETO_INDEX, WATER_VETO_THRESHOLD)); }
  edgeRing = baseWater.focal_max({radius: EDGE_PROTECT_PIXELS, units: 'pixels'}).and(baseWater.not()).rename('WATER_EDGE');
}

// Build a water mask for visualization (final + optional components)
var waterForViz = asMask(waterMask);

// Mask dNBR2 BEFORE smoothing to avoid shoreline bleed
var dNBR2_forSmooth = dNBR2;
if (APPLY_WATER_VETO) dNBR2_forSmooth = dNBR2_forSmooth.updateMask(waterForViz.not());
if (edgeRing)         dNBR2_forSmooth = dNBR2_forSmooth.updateMask(edgeRing.not());
var dNBR2_sm = smooth3x3(dNBR2_forSmooth);

// Threshold to get burned mask
var burned = dNBR2_sm.gte(THRESH_DNBR2).rename('BURNED');
if (APPLY_WATER_VETO) burned = burned.updateMask(waterForViz.not());
if (edgeRing)         burned = burned.updateMask(edgeRing.not());

// Optional forest/shrub mask
var woodyMask = null; if (USE_LC_MASK) { woodyMask = getWoodyShrubMask(AOI); burned = burned.updateMask(woodyMask); }

// Optional minimum‑patch filter
var burned_prePatch = burned;             // keep a copy for visualization
burned = applyMinPatch(burned, 'burned'); // final burned mask used for stats & severity

// =============================
// 5) OPTIONAL: MULTI‑THRESHOLD BURNED MASKS (tuning)
// =============================
var MULTI_IMAGES_PRE = [], MULTI_LABELS_PRE = [], MULTI_IMAGES = [], MULTI_LABELS = [];
if (RUN_MULTI_THRESH) {
  for (var i = 0; i < MULTI_THRESH.length; i++) {
    var t = MULTI_THRESH[i];
    var tLabel = (Math.round(t * 100) / 100).toFixed(2);
    var tInt   = Math.round(t * 100);
    var tSafe  = ('0' + tInt).slice(-2);
    var bmRaw = dNBR2_sm.gte(ee.Number(t)).rename('BURNED_thr_' + tSafe);
    if (APPLY_WATER_VETO) bmRaw = bmRaw.updateMask(waterForViz.not());
    if (edgeRing)          bmRaw = bmRaw.updateMask(edgeRing.not());
    if (woodyMask)         bmRaw = bmRaw.updateMask(woodyMask);
    var bmPre   = bmRaw.selfMask();
    var bmFinal = applyMinPatch(bmRaw, 'multi_' + tSafe).selfMask();
    if (MULTI_ADD_TO_MAP) {
      if (MULTI_SHOW_PREPATCH) { MULTI_IMAGES_PRE.push(bmPre); MULTI_LABELS_PRE.push('Tuning (pre) dNBR2 ≥ ' + tLabel); }
      MULTI_IMAGES.push(bmFinal); MULTI_LABELS.push('Tuning dNBR2 ≥ ' + tLabel);
    }
    if (MULTI_EXPORT) {
      Export.image.toDrive({ image: bmFinal, description: 'S2_BurnedMask_dNBR2_' + FIRE_DATE + '_thr_' + tLabel, folder: EXPORT_FOLDER, fileNamePrefix: 'burned_' + FIRE_DATE + '_thr_' + tLabel, region: AOI, scale: EXPORT_SCALE, crs: EXPORT_CRS, maxPixels: 1e13 });
    }
  }
}

// =============================
// 6) FIRE SEVERITY inside burned area
// =============================
var ndviPre = pre.select('NDVI');
var maskLow  = ndviPre.lt(NDVI_LOW_MAX);
var maskFull = ndviPre.gte(NDVI_FULL_MIN);
var maskMix  = ndviPre.gte(NDVI_LOW_MAX).and(ndviPre.lt(NDVI_FULL_MIN));

var sevLow  = classifySeverityLowDensity(post).updateMask(maskLow);
var sevMix  = classifySeverityMixedDensity(post).updateMask(maskMix);
var sevFull = classifySeverityFullDensity(post).updateMask(maskFull);

var severityInside = ee.Image(0).where(sevLow.gt(0),sevLow).where(sevMix.gt(0),sevMix).where(sevFull.gt(0),sevFull).rename('SEVERITY');
var severity = ee.Image(0).where(burned.eq(1), severityInside).rename('SEVERITY');

// =============================
// 7) DISPLAY (ordered)
// =============================
var falseColor = {bands: ['B12','B8','B4'], min: 0.02, max: 0.4};
var ndviViz    = {min: -0.2, max: 0.9, palette: ['7F0000','CE7E45','FCD163','66A000','207A00','056201','004C00','023B01','012E01','011D01']};
Map.addLayer(pre,  falseColor, 'Pre‑fire S2 (SWIR/NIR/Red)');
Map.addLayer(post, falseColor, 'Post‑fire S2 (SWIR/NIR/Red)');
Map.addLayer(pre.select('NDVI'), ndviViz, 'NDVI pre‑fire');
if (USE_ADMIN_AOI && SHOW_ADMIN_LAYER && ADMIN_FC) {
  var adminStyle = ADMIN_FC.style({color: '#222222', fillColor: '00000000', width: 2});
  Map.addLayer(adminStyle, {}, 'Admin AOI (GAUL L' + ADMIN_LEVEL + ')');
}
if (SHOW_WATER_MASK) {
  Map.addLayer(waterForViz.selfMask(), {palette:['#6baed6'], opacity:0.5}, 'Water mask (final)');
  if (SHOW_WATER_COMPONENTS) {
    if (HAS_SCL) Map.addLayer(combineWhen(sclPre, sclPost).selfMask(), {palette:['#2b8cbe'], opacity:0.5}, 'Water SCL (pre/post)');
    Map.addLayer(combineWhen(idxPre, idxPost).selfMask(), {palette:['#41b6c4'], opacity:0.5}, 'Water Index (pre/post)');
  }
  if (edgeRing) Map.addLayer(edgeRing.selfMask(), {palette:['#08519c'], opacity:0.5}, 'Shoreline edge ring (' + EDGE_PROTECT_PIXELS + ' px)');
}
Map.addLayer(dNBR2_sm, {min:-0.2, max:0.6, palette:['white','black','purple','red']}, 'dNBR2 (smoothed)');
if (RUN_MULTI_THRESH && MULTI_ADD_TO_MAP) {
  if (MULTI_SHOW_PREPATCH) { for (var p = 0; p < MULTI_IMAGES_PRE.length; p++) { Map.addLayer(MULTI_IMAGES_PRE[p], {palette:['#1f78b4']}, MULTI_LABELS_PRE[p]); } }
  for (var j = 0; j < MULTI_IMAGES.length; j++) { Map.addLayer(MULTI_IMAGES[j], {palette:['#e41a1c']}, MULTI_LABELS[j]); }
}
Map.addLayer(burned_prePatch.selfMask(), {palette:['#1f78b4']}, 'Burned mask (pre patch filter)');
Map.addLayer(burned.selfMask(),        {palette:['#d73027']}, 'Burned mask (final, dNBR2 ≥ '+THRESH_DNBR2+')');
Map.addLayer(severity.updateMask(severity.gt(0)), {min:0, max:3, palette: PALETTE_SEVERITY}, 'Fire severity (low/mod/high)');

// =============================
// 8) STATISTICS (total + per severity class)
// =============================
var areaImg = ee.Image.pixelArea().rename('area'); // never reproject pixelArea
var useUtm = AREA_METHOD === 'utm';
var utmCrs = useUtm ? utmCrsForGeom(AOI) : null;
function reduceArgs(obj) {
  var a = obj || {}; a.geometry = a.geometry || AOI; a.scale = a.scale || ANALYSIS_SCALE; a.maxPixels = 1e13; if (useUtm) a.crs = utmCrs; if (TILE_SCALE) a.tileScale = TILE_SCALE; return a;
}
// Total burned
var totalArea_m2 = ee.Number(areaImg.updateMask(burned).reduceRegion(reduceArgs({reducer: ee.Reducer.sum()})).get('area'));
var totalArea_ha = totalArea_m2.divide(10000);
// By severity
var grouped = areaImg.addBands(severity).reduceRegion(reduceArgs({reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'severity'})}));
var groups = ee.List(grouped.get('groups'));
var sevFC = ee.FeatureCollection(groups.map(function(g){ g = ee.Dictionary(g); var sev = ee.Number(g.get('severity')); var area_m2 = ee.Number(g.get('sum')); var area_ha = area_m2.divide(10000); var cls = ee.String(ee.Algorithms.If(sev.eq(1), 'low', ee.Algorithms.If(sev.eq(2), 'moderate', ee.Algorithms.If(sev.eq(3), 'high', 'other')))); return ee.Feature(null, {version: 'v1.9j', fire_date: FIRE_DATE, severity: sev, class: cls, area_m2: area_m2, area_ha: area_ha}); }));
if (PRINT_STATS) { print('UTM CRS used (if method=utm):', utmCrs); print('Total burned area (ha) [method=' + AREA_METHOD + ', scale=' + ANALYSIS_SCALE + 'm]:', totalArea_ha); print('Burned area by severity (ha):', sevFC); }
if (EXPORT_STATS) { Export.table.toDrive({ collection: sevFC, description: 'S2_BurnedArea_BySeverity_' + FIRE_DATE + '_v19j', folder: EXPORT_FOLDER, fileNamePrefix: 'burned_area_by_severity_' + FIRE_DATE + '_v19j', fileFormat: 'CSV' }); }

// =============================
// 8b) OPTIONAL: ADMIN‑LEVEL STATISTICS (per GAUL unit)
// =============================
if (USE_ADMIN_AOI && ADMIN_STATS) {
  var nameField = (ADMIN_LEVEL === 0) ? 'ADM0_NAME' : (ADMIN_LEVEL === 1) ? 'ADM1_NAME' : 'ADM2_NAME';
  var codeField = (ADMIN_LEVEL === 0) ? 'ADM0_CODE' : (ADMIN_LEVEL === 1) ? 'ADM1_CODE' : 'ADM2_CODE';
  var fcToReduce = ADMIN_STATS_ALL ? (function(){ var id=(ADMIN_LEVEL===0)?'FAO/GAUL/2015/level0':(ADMIN_LEVEL===1)?'FAO/GAUL/2015/level1':'FAO/GAUL/2015/level2'; return ee.FeatureCollection(id).filter(ee.Filter.eq('ADM0_NAME', ADMIN_COUNTRY)); })() : ADMIN_FC;
  var adminStats = fcToReduce.map(function(f){
    var geom = f.geometry();
    var base = reduceArgs({geometry: geom});
    var tot_m2 = ee.Number(areaImg.updateMask(burned).reduceRegion(ee.Dictionary(base).set('reducer', ee.Reducer.sum())).get('area'));
    var ha_total = tot_m2.divide(10000);
    var ha_low   = ee.Number(areaImg.updateMask(severity.eq(1)).reduceRegion(ee.Dictionary(base).set('reducer', ee.Reducer.sum())).get('area')).divide(10000);
    var ha_mod   = ee.Number(areaImg.updateMask(severity.eq(2)).reduceRegion(ee.Dictionary(base).set('reducer', ee.Reducer.sum())).get('area')).divide(10000);
    var ha_high  = ee.Number(areaImg.updateMask(severity.eq(3)).reduceRegion(ee.Dictionary(base).set('reducer', ee.Reducer.sum())).get('area')).divide(10000);
    return f.set({ version: 'v1.9j', fire_date: FIRE_DATE, admin_level: ADMIN_LEVEL, admin_name: f.get(nameField), admin_code: f.get(codeField), ha_total: ha_total, ha_low: ha_low, ha_moderate: ha_mod, ha_high: ha_high, area_method: AREA_METHOD, scale_m: ANALYSIS_SCALE, utm_crs: utmCrs });
  });
  print('Burned area by admin (GAUL L' + ADMIN_LEVEL + '):', adminStats);
  if (EXPORT_STATS) { Export.table.toDrive({ collection: adminStats, description: 'S2_BurnedArea_ByAdmin_L' + ADMIN_LEVEL + '_' + FIRE_DATE + '_v19j', folder: EXPORT_FOLDER, fileNamePrefix: 'burned_area_by_admin_L' + ADMIN_LEVEL + '_' + FIRE_DATE + '_v19j', fileFormat: 'CSV' }); }
}

// =============================
// 9) EXPORT RASTERS
// =============================
Export.image.toDrive({ image: burned.rename('burned'), description: 'S2_BurnedMask_dNBR2_'+FIRE_DATE+'_v19j', folder: EXPORT_FOLDER, fileNamePrefix: 'burned_'+FIRE_DATE+'_v19j', region: AOI, scale: EXPORT_SCALE, crs: EXPORT_CRS, maxPixels: 1e13 });
Export.image.toDrive({ image: severity.rename('severity'), description: 'S2_FireSeverity_'+FIRE_DATE+'_v19j', folder: EXPORT_FOLDER, fileNamePrefix: 'severity_'+FIRE_DATE+'_v19j', region: AOI, scale: EXPORT_SCALE, crs: EXPORT_CRS, maxPixels: 1e13 });
