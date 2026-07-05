
// =====================================================================
// Google Earth Engine — Burned Area & Fire Severity (Sentinel‑2)
// Methodology following Sobrino et al. (2024) — v1.9n
// ✦ Water masks: choose S2 SCL water, NDWI/mNDWI, or BOTH with union/AND.
// ✦ Robust combiner: safe combination of (pre/post) masks without null errors.
// ✦ Simple default run mode, full same-date AOI mosaic, datatake-aware single pass, or median composites.
// ✦ Patch filter, multi‑threshold explorer, GAUL AOI, severity classes.
// ✦ Area calc fix: NEVER reproject pixelArea(); pass stable UTM CRS to reducers.
// ✦ SI (Separability Index) from the paper is **not** implemented (diagnostic only).
// =====================================================================

// =============================
// 0) USER SETTINGS — READ THIS FIRST
// =============================
// The script now has TWO ways to run:
//
//   A) SIMPLE APPROACH  [DEFAULT]
//      Use this when you want to quickly analyse one fire/current date against
//      a previous Sentinel-2 image. In most cases you only edit:
//        1. AOI settings below, or draw a polygon on the map.
//        2. SIMPLE_TARGET_DATE.
//        3. SIMPLE_PRE_MODE and, if manual, SIMPLE_MANUAL_PRE_DATE.
//
//   B) ADVANCED / LEGACY APPROACH
//      Use this when you want the older, more configurable workflow:
//      median pre/post windows, explicit pre/post dates, admin statistics,
//      threshold tuning, water/shoreline/land-cover corrections, etc.
//      To use it, set RUN_SIMPLE_MODE = false and then edit Section 0G.
//
// The processing method after image selection remains the same:
// Sentinel-2 pre/post -> spectral indices -> dNBR2 burned mask -> optional
// corrections -> severity grading -> statistics/exports.

// ---------------------------------------------------------------------
// 0A) SIMPLE APPROACH — DEFAULT QUICK RUN
// ---------------------------------------------------------------------
var RUN_SIMPLE_MODE = true;          // true = use the simple approach below. false = use Section 0G advanced dates.

// Target/current image date. For an active fire this is the current impact date,
// not necessarily the final post-fire severity date.
var SIMPLE_TARGET_DATE = '2026-07-05';

// Pre-image selection mode:
//   'manual'        -> use SIMPLE_MANUAL_PRE_DATE.
//   'auto_previous' -> automatically select the closest previous Sentinel-2 pass
//                      before the selected target/post image.
var SIMPLE_PRE_MODE = 'manual';      // 'manual' | 'auto_previous'
var SIMPLE_MANUAL_PRE_DATE = '2026-06-27';
var SIMPLE_AUTO_PRE_LOOKBACK_DAYS = 30;

// Full same-date AOI mosaics:
//   true  -> mosaic ALL Sentinel-2 images intersecting the AOI on the selected date.
//            Recommended for large AOIs or AOIs crossing Sentinel-2 tile/datatake boundaries.
//   false -> use the original datatake/pass-aware mosaic around the nearest image.
var SIMPLE_PRE_FULL_DATE_MOSAIC  = true;
var SIMPLE_POST_FULL_DATE_MOSAIC = true;

// Backward-compatible aliases used internally by the processing code.
// Normally you do not need to edit these.
var QUICK_PREVIOUS_MODE = RUN_SIMPLE_MODE;
var QUICK_ANALYSIS_DATE = SIMPLE_TARGET_DATE;
var QUICK_USE_MANUAL_PRE_DATE = (SIMPLE_PRE_MODE === 'manual');
var QUICK_MANUAL_PRE_DATE = SIMPLE_MANUAL_PRE_DATE;
var QUICK_MANUAL_PRE_FULL_DATE_MOSAIC = SIMPLE_PRE_FULL_DATE_MOSAIC;
var QUICK_POST_FULL_DATE_MOSAIC = SIMPLE_POST_FULL_DATE_MOSAIC;
var QUICK_PREVIOUS_LOOKBACK_DAYS = SIMPLE_AUTO_PRE_LOOKBACK_DAYS;

// ---------------------------------------------------------------------
// 0B) AOI — choose exactly ONE source
// ---------------------------------------------------------------------
var USE_DRAWN_AOI = true;            // true: draw polygon with Map.drawingTools(). Recommended for quick runs.
var USE_ADMIN_AOI = false;           // true: use GAUL administrative boundaries below.

// GAUL admin AOI. Used only when USE_ADMIN_AOI = true.
var ADMIN_LEVEL     = 2;             // 0 = country, 1 = ADM1, 2 = ADM2.
var ADMIN_COUNTRY   = 'Spain';       // GAUL ADM0_NAME.
var ADMIN_NAMES     = ['Ourense'];   // Names at chosen level.
var SHOW_ADMIN_LAYER = true;         // Add selected admin boundaries to the map.

// Admin statistics are optional diagnostics/outputs, not required for the core mask.
var ADMIN_STATS     = false;         // Burned area + severity per selected admin unit.
var ADMIN_STATS_ALL = false;         // Stats for all admin units at that level in the country.

// ---------------------------------------------------------------------
// 0C) SENTINEL-2 INPUTS AND CLOUD FILTERS — usually keep these defaults
// ---------------------------------------------------------------------
var S2_COLLECTION   = 'SR';          // 'SR' = COPERNICUS/S2_SR_HARMONIZED; 'L1C' = COPERNICUS/S2_HARMONIZED.
var S2_SR_IC        = 'COPERNICUS/S2_SR_HARMONIZED';
var S2_L1C_IC       = 'COPERNICUS/S2_HARMONIZED';
var MAX_SCENE_CLOUD = 60;            // Collection-level CLOUDY_PIXEL_PERCENTAGE filter.
var SINGLE_SEARCH_DAYS = 5;          // ± days for nearest-image searches.
var REQUIRE_EXACT_DATE = false;      // true = require exact calendar day; false = nearest within ±SINGLE_SEARCH_DAYS.
var PRINT_SELECTED_SCENES = true;    // Print selected dates, tiles, datatakes and counts in the Console.

// ---------------------------------------------------------------------
// 0D) CORE METHOD PARAMETERS — needed for burned area and severity grading
// ---------------------------------------------------------------------
// Burned-area detection.
var APPLY_SMOOTHING = true;          // 3x3 focal mean before thresholding dNBR2.
var THRESH_DNBR2 = 0.10;             // dNBR2 >= 0.10 -> burned.

// Severity grading thresholds. These are the main parameters used after the
// burned mask is created, with the class depending on pre-fire NDVI density.
var NDVI_LOW_MAX       = 0.40;       // NDVI < 0.40 -> low-density vegetation.
var NDVI_FULL_MIN      = 0.75;       // NDVI >= 0.75 -> full-density vegetation; otherwise mixed.

// Low-density vegetation severity using BAIS2.
var TH_BAIS2_LOW_MAX   = 0.90;       // < 0.90 -> low severity.
var TH_BAIS2_MOD_MAX   = 1.00;       // [0.90, 1.00) -> moderate; >= 1.00 -> high.

// Mixed-density vegetation severity using NBR.
var TH_NBR_LOW_MIN     = 0.00;       // > 0.00 -> low severity.
var TH_NBR_MOD_MIN     = -0.30;      // <= 0.00 and > -0.30 -> moderate; <= -0.30 -> high.

// Full-density vegetation severity using NBR3.
var TH_NBR3_LOW_MIN    = 0.20;       // > 0.20 -> low severity.
var TH_NBR3_MOD_MIN    = -0.30;      // <= 0.20 and > -0.30 -> moderate; <= -0.30 -> high.

// ---------------------------------------------------------------------
// 0E) OPTIONAL CORRECTIONS / MASKS — improve realism, but are not strictly
//     required to calculate the raw burned area and severity
// ---------------------------------------------------------------------
// Water veto: removes water pixels before smoothing/thresholding to avoid
// false burned detections over reservoirs, rivers, shorelines, etc.
var APPLY_WATER_VETO   = true;
var WATER_VETO_INDEX   = 'mNDWI';    // 'mNDWI' (B3/B11) or 'NDWI' (B3/B8).
var WATER_VETO_THRESHOLD = 0;        // Water if index > threshold. Try 0.05 if too aggressive.
var WATER_VETO_WHEN    = 'pre_or_post'; // 'pre_only' | 'post_only' | 'pre_or_post'.
var WATER_VETO_SOURCE  = 'both';     // 'index' | 's2' | 'both'. 's2' uses SCL water when SR is selected.
var WATER_VETO_COMBINE = 'union';    // If source='both': 'union' = SCL OR index; 'intersection' = SCL AND index.
var SHOW_WATER_MASK    = true;
var SHOW_WATER_COMPONENTS = false;

// Shoreline edge protection: removes a small ring around water to reduce
// dNBR2 bleed-over near water/land boundaries after smoothing.
var APPLY_EDGE_PROTECT = true;
var EDGE_PROTECT_PIXELS = 1;

// Optional land-cover mask: restricts results to woody/shrub classes.
// Leave false unless you explicitly want to limit the analysis by land cover.
var USE_LC_MASK = false;
var USE_WORLDCOVER = true;
var WORLDCOVER_ASSET = 'ESA/WorldCover/v200/2021';
var YOUR_OWN_LC_ASSET  = 'YOUR_OWN_ASSET'; // e.g. 'users/you/your_lc_raster'.

// Optional patch filter: removes isolated detections below a minimum size.
var APPLY_MIN_PATCH    = true;
var PATCH_FILTER_MODE  = 'pixel';    // 'pixel' or 'area'.
var MIN_PATCH_PIXELS   = 25;         // Used when PATCH_FILTER_MODE='pixel'.
var MIN_PATCH_HA       = 1;          // Used when PATCH_FILTER_MODE='area'.
var CONNECTIVITY_EIGHT = true;       // true = 8-connected; false = 4-connected.
var SHOW_PATCH_DEBUG   = true;

// ---------------------------------------------------------------------
// 0F) OUTPUTS, VISUALIZATION AND OPTIONAL DIAGNOSTICS
// ---------------------------------------------------------------------
var AREA_METHOD   = 'utm';           // 'utm' = stable UTM CRS in reducers; 'native' = no CRS override.
var ANALYSIS_SCALE = 10;             // Meters for reduceRegion.
var EXPORT_SCALE   = 10;             // Meters for raster exports.
var EXPORT_CRS     = 'EPSG:4326';    // Change to a relevant UTM if preferred.
var EXPORT_FOLDER  = 'GEE_Fire_Sobrino2024';
var PRINT_STATS    = true;           // Print totals and severity table in Console.
var EXPORT_STATS   = true;           // Export per-severity CSV to Drive.
var TILE_SCALE     = 2;              // Optional tileScale for reduceRegion; set null to disable.
var PALETTE_SEVERITY = ['00FF00','FFF59D','FFA726','EF5350'];

// Multi-threshold exploration is for tuning/diagnosis only. It is not required
// for the standard burned-area/severity output.
var RUN_MULTI_THRESH = false;
var MULTI_THRESH = [0.06, 0.08, 0.10, 0.12, 0.14];
var MULTI_ADD_TO_MAP = true;
var MULTI_SHOW_PREPATCH = false;
var MULTI_EXPORT = false;

// ---------------------------------------------------------------------
// 0G) ADVANCED / LEGACY DATE AND COMPOSITE SETTINGS
//     Used only when RUN_SIMPLE_MODE = false
// ---------------------------------------------------------------------
// FIRE_DATE controls labels and, in median mode, the pre/post windows.
var FIRE_DATE = '2026-07-05';
var PRE_DAYS  = 10;                  // Median mode: days before FIRE_DATE for pre-fire composite.
var POST_DAYS = 30;                  // Median mode: days after FIRE_DATE for post-fire composite.

// Advanced image selection:
//   'single' -> explicit pre/post target dates using PRE_SINGLE_DATE and POST_SINGLE_DATE.
//   'median' -> median composites from FIRE_DATE - PRE_DAYS and FIRE_DATE + POST_DAYS.
var COMPOSITE_MODE = 'single';       // 'single' | 'median'.
var PRE_SINGLE_DATE  = '2026-06-25';
var POST_SINGLE_DATE = '2026-07-05';

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


// Build a single-date mosaic using ALL images intersecting the AOI on the selected calendar date.
// This is useful when the AOI is covered by several MGRS tiles or several datatakes on the same day.
// If REQUIRE_EXACT_DATE=false, the nearest available date within ±SINGLE_SEARCH_DAYS is selected first,
// and then all images from that selected UTC calendar date are mosaicked.
function getS2SingleDateAllIntersecting(aoi, targetDate) {
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

  // First find the nearest available acquisition day to the requested target date.
  var ranked = base.map(function(im){
    var diffDays = ee.Number(im.date().difference(target, 'day')).abs();
    var cloud    = ee.Number(im.get('CLOUDY_PIXEL_PERCENTAGE'));
    return im.set('rank', diffDays.multiply(10000).add(cloud));
  }).sort('rank');

  var cnt = ranked.size();
  var mosaic = ee.Image(ee.Algorithms.If(cnt.gt(0), (function(){
      var first = ee.Image(ranked.first());
      var selected = first.date();
      var dayStart = ee.Date.fromYMD(selected.get('year'), selected.get('month'), selected.get('day'));
      var dayEnd = dayStart.advance(1, 'day');

      // Use all S2 granules intersecting the AOI on that date, not only the first image's datatake.
      // Sort cloudier images first so clearer images are placed later in the mosaic where overlaps occur.
      var sameDate = base.filterDate(dayStart, dayEnd).sort('CLOUDY_PIXEL_PERCENTAGE', false);
      var ts = ee.Number(first.get('system:time_start'));
      var ids = sameDate.aggregate_array('system:index');
      var tiles = sameDate.aggregate_array('MGRS_TILE');
      var datatakes = sameDate.aggregate_array('DATATAKE_IDENTIFIER');

      var mosa = sameDate.mosaic().clip(aoi)
        .set({
          'pass_time': ts,
          'system:time_start': ts,
          'mosaic_tile_ids': ids,
          'mosaic_mgrs_tiles': tiles,
          'mosaic_datatakes': datatakes,
          'mosaic_count': sameDate.size(),
          'chosen_index': first.get('system:index'),
          'chosen_cloud': first.get('CLOUDY_PIXEL_PERCENTAGE'),
          'is_composite': false,
          'full_date_mosaic': true,
          'selected_date': dayStart.format('YYYY-MM-dd')
        });

      if (PRINT_SELECTED_SCENES) {
        print('Full same-date AOI mosaic date:', dayStart.format('YYYY-MM-dd'));
        print('  All intersecting tiles (MGRS):', tiles);
        print('  All intersecting image count:', sameDate.size());
        print('  Datatakes included:', datatakes);
        print('  Nearest image used to choose date:', first.get('system:index'), 'cloud %:', first.get('CLOUDY_PIXEL_PERCENTAGE'));
      }
      return mosa;
    })(), (function(){
      var wideStart = target.advance(-SINGLE_SEARCH_DAYS, 'day');
      var wideEnd   = target.advance(SINGLE_SEARCH_DAYS + 1, 'day');
      if (PRINT_SELECTED_SCENES) print('No image in requested full-date mosaic window; falling back to ±', SINGLE_SEARCH_DAYS, 'days median composite.');
      return getS2Composite(aoi, wideStart, wideEnd);
    })()
  ));

  return mosaic;
}

// Quick mode helper: previous available single pass before the selected target/post image
// It uses the same S2 collection, cloud filter, scaling, cloud mask and datatake-aware mosaicking.
function getS2PreviousPassBefore(aoi, referenceImage, targetDate) {
  var isSR = S2_COLLECTION === 'SR';
  var icId = isSR ? S2_SR_IC : S2_L1C_IC;

  // Prefer the actual selected post pass time; if unavailable, use QUICK_ANALYSIS_DATE.
  var refMillis = ee.Algorithms.If(
    referenceImage.get('pass_time'),
    referenceImage.get('pass_time'),
    ee.Date(targetDate).millis()
  );
  var refDate = ee.Date(refMillis);
  var start = refDate.advance(-QUICK_PREVIOUS_LOOKBACK_DAYS, 'day');

  var base = ee.ImageCollection(icId)
    .filterBounds(aoi)
    .filterDate(start, refDate)  // end is exclusive: only images before the target/post pass
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', MAX_SCENE_CLOUD))
    .map(scaleSR)
    .map(isSR ? maskS2SCL : maskS2QA60);

  // Choose the closest previous pass; cloud percentage is used as a secondary ranking term.
  var ranked = base.map(function(im){
    var diffDays = ee.Number(refDate.difference(im.date(), 'day')).abs();
    var cloud = ee.Number(im.get('CLOUDY_PIXEL_PERCENTAGE'));
    return im.set('rank', diffDays.multiply(10000).add(cloud));
  }).sort('rank');

  var cnt = ranked.size();
  var mosaic = ee.Image(ee.Algorithms.If(cnt.gt(0), (function(){
      var first = ee.Image(ranked.first());
      var samePass = _samePassCollection(base, first);
      var ts = ee.Number(first.get('system:time_start'));
      var ids = samePass.aggregate_array('system:index');
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
          'quick_previous': true,
          'reference_post_time': refDate.millis(),
          'DATATAKE_IDENTIFIER': first.get('DATATAKE_IDENTIFIER'),
          'SENSING_ORBIT_NUMBER': first.get('SENSING_ORBIT_NUMBER'),
          'SENSING_ORBIT_DIRECTION': first.get('SENSING_ORBIT_DIRECTION')
        });
      if (PRINT_SELECTED_SCENES) {
        print('Quick mode — previous pass time:', ee.Date(ts).format('YYYY-MM-dd HH:mm'));
        print('  Previous tiles (MGRS):', tiles);
        print('  Previous count:', samePass.size(), '  Datatake:', first.get('DATATAKE_IDENTIFIER'));
        print('  Previous chosen index:', first.get('system:index'), 'cloud %:', first.get('CLOUDY_PIXEL_PERCENTAGE'));
      }
      return mosa;
    })(), (function(){
      if (PRINT_SELECTED_SCENES) print('Quick mode — no previous image found in the lookback window; falling back to the lookback median composite.');
      return getS2Composite(aoi, start, refDate);
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

// In quick mode, the analysis date becomes the post/target date used in labels and exports.
// If manual pre-date is enabled, also mirror it into PRE_SINGLE_DATE for clarity in the Console/settings.
if (QUICK_PREVIOUS_MODE) {
  FIRE_DATE = QUICK_ANALYSIS_DATE;
  POST_SINGLE_DATE = QUICK_ANALYSIS_DATE;
  if (QUICK_USE_MANUAL_PRE_DATE) PRE_SINGLE_DATE = QUICK_MANUAL_PRE_DATE;
}

var d0 = toDate(FIRE_DATE);
var preStart  = plusDays(d0, -PRE_DAYS);
var preEnd    = plusDays(d0, -1);
var postStart = plusDays(d0, 0);
var postEnd   = plusDays(d0, POST_DAYS);

// =============================
// 3) COMPOSITES + INDICES
// =============================
var preRaw, postRaw;
if (QUICK_PREVIOUS_MODE) {
  // Quick mode:
  //   POST = nearest pass/date to QUICK_ANALYSIS_DATE.
  //   PRE  = either QUICK_MANUAL_PRE_DATE, or the previous available pass before POST.
  postRaw = QUICK_POST_FULL_DATE_MOSAIC ?
    getS2SingleDateAllIntersecting(AOI, QUICK_ANALYSIS_DATE) :
    getS2SingleScene(AOI, QUICK_ANALYSIS_DATE);

  if (QUICK_USE_MANUAL_PRE_DATE) {
    preRaw = QUICK_MANUAL_PRE_FULL_DATE_MOSAIC ?
      getS2SingleDateAllIntersecting(AOI, QUICK_MANUAL_PRE_DATE) :
      getS2SingleScene(AOI, QUICK_MANUAL_PRE_DATE);
    if (PRINT_SELECTED_SCENES) {
      print('Quick mode — manual pre-date requested:', QUICK_MANUAL_PRE_DATE);
      print('Quick mode — manual pre full same-date AOI mosaic:', QUICK_MANUAL_PRE_FULL_DATE_MOSAIC);
    }
  } else {
    preRaw = getS2PreviousPassBefore(AOI, postRaw, QUICK_ANALYSIS_DATE);
  }
} else {
  preRaw  = (COMPOSITE_MODE === 'single') ? getS2SingleScene(AOI, PRE_SINGLE_DATE)  : getS2Composite(AOI, preStart,  preEnd);
  postRaw = (COMPOSITE_MODE === 'single') ? getS2SingleScene(AOI, POST_SINGLE_DATE) : getS2Composite(AOI, postStart, postEnd);
}
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
var sevFC = ee.FeatureCollection(groups.map(function(g){ g = ee.Dictionary(g); var sev = ee.Number(g.get('severity')); var area_m2 = ee.Number(g.get('sum')); var area_ha = area_m2.divide(10000); var cls = ee.String(ee.Algorithms.If(sev.eq(1), 'low', ee.Algorithms.If(sev.eq(2), 'moderate', ee.Algorithms.If(sev.eq(3), 'high', 'other')))); return ee.Feature(null, {version: 'v1.9l', fire_date: FIRE_DATE, severity: sev, class: cls, area_m2: area_m2, area_ha: area_ha}); }));
if (PRINT_STATS) { print('UTM CRS used (if method=utm):', utmCrs); print('Total burned area (ha) [method=' + AREA_METHOD + ', scale=' + ANALYSIS_SCALE + 'm]:', totalArea_ha); print('Burned area by severity (ha):', sevFC); }
if (EXPORT_STATS) { Export.table.toDrive({ collection: sevFC, description: 'S2_BurnedArea_BySeverity_' + FIRE_DATE + '_v19l', folder: EXPORT_FOLDER, fileNamePrefix: 'burned_area_by_severity_' + FIRE_DATE + '_v19l', fileFormat: 'CSV' }); }

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
    return f.set({ version: 'v1.9l', fire_date: FIRE_DATE, admin_level: ADMIN_LEVEL, admin_name: f.get(nameField), admin_code: f.get(codeField), ha_total: ha_total, ha_low: ha_low, ha_moderate: ha_mod, ha_high: ha_high, area_method: AREA_METHOD, scale_m: ANALYSIS_SCALE, utm_crs: utmCrs });
  });
  print('Burned area by admin (GAUL L' + ADMIN_LEVEL + '):', adminStats);
  if (EXPORT_STATS) { Export.table.toDrive({ collection: adminStats, description: 'S2_BurnedArea_ByAdmin_L' + ADMIN_LEVEL + '_' + FIRE_DATE + '_v19l', folder: EXPORT_FOLDER, fileNamePrefix: 'burned_area_by_admin_L' + ADMIN_LEVEL + '_' + FIRE_DATE + '_v19l', fileFormat: 'CSV' }); }
}

// =============================
// 9) EXPORT RASTERS
// =============================
Export.image.toDrive({ image: burned.rename('burned'), description: 'S2_BurnedMask_dNBR2_'+FIRE_DATE+'_v19l', folder: EXPORT_FOLDER, fileNamePrefix: 'burned_'+FIRE_DATE+'_v19l', region: AOI, scale: EXPORT_SCALE, crs: EXPORT_CRS, maxPixels: 1e13 });
Export.image.toDrive({ image: severity.rename('severity'), description: 'S2_FireSeverity_'+FIRE_DATE+'_v19l', folder: EXPORT_FOLDER, fileNamePrefix: 'severity_'+FIRE_DATE+'_v19l', region: AOI, scale: EXPORT_SCALE, crs: EXPORT_CRS, maxPixels: 1e13 });
