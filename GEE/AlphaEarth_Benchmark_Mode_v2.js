/*******************************************************
 * AlphaEarth / Satellite Embeddings + Supervised LC
 * SINGLE MODE  OR  BENCHMARK MODE (AOIs x Algorithms)
 *
 * AOIs: caatinga, cerrado, chaco, tanzania
 * YEAR default: 2020
 *
 * CLASS NOTES (handled):
 *  - Chaco has NO Mangroves (orig class 4) -> 9 output classes (0..8)
 *  - Other AOIs have Mangroves -> 10 output classes (0..9)
 *  - There is NO original class 8 anywhere (fine; output index 8 is used after remap in some AOIs)
 *
 * BENCHMARK MODE:
 *  - Runs ALL AOIs x ALL methods and exports ONE comparison table.
 *  - Default export: CSV to Google Drive.
 *  - No prints / no map layers in benchmark mode.
 *
 * CSV STRUCTURE:
 *  - One row per (AOI, method)
 *  - Scalar metrics in their own columns (OA, Kappa, macroF1, etc.)
 *  - Per-class arrays + confusion matrix stored as JSON strings inside cells (Excel opens fine).
 *******************************************************/


// ======================================================
// 0) MASTER MODE SWITCH
// ======================================================

var BENCHMARK_MODE = true; // true -> export benchmark CSV only (no prints/layers)


// ======================================================
// 1) USER SETTINGS (Single mode)
// ======================================================

var AOI_NAME = 'cerrado';        // 'caatinga' | 'cerrado' | 'chaco' | 'tanzania'
var CLASSIFIER_METHOD = 'RF';    // 'RF'|'CART'|'GTB'|'KNN'|'NB'|'SVM'|'MIN_DIST'
var YEAR = 2020;

var landcover = "visulcrec"; // or "visu_lc"
var SCALE = 10;

// tileScale optional (does NOT change math; helps avoid memory/timeouts)
var USE_TILE_SCALE   = false;
var TRAIN_TILE_SCALE = 8;
var TEST_TILE_SCALE  = 16;

// Training geometry mode
var TRAIN_GEOM_MODE = 'POINTS'; // 'POINTS' | 'POLYGONS'
var BUFFER_METERS   = 20;

// NaiveBayes preprocessing (optional)
var NB_ENABLE_PREPROCESS = false;
var NB_SCALE  = 1000;
var NB_OFFSET = 1000;

// Global seed for stochastic methods (RF, GTB)
var GLOBAL_SEED = 6769;

// Single-mode debug toggles (ignored in benchmark mode)
var SHOW_DEBUG_PRINTS = true;
var SHOW_MAP_LAYERS   = true;


// ======================================================
// 2) EXPORT SETTINGS
// ======================================================

// Single-mode exports (Assets)
var DO_EXPORT_CLASSIFIED_ASSET = true;
var DO_EXPORT_MODEL_ASSET      = true;   // only RF/CART
var DO_EXPORT_RUN_METADATA     = true;

var EXPORT_CLASS_FOLDER = "projects/hardy-tenure-383607/assets/DryForm_Project/Classification/";
var EXPORT_MODEL_FOLDER = "projects/hardy-tenure-383607/assets/DryForm_Project/ClassifierModels/";
var EXPORT_META_FOLDER  = "projects/hardy-tenure-383607/assets/DryForm_Project/ClassifierModels/RunMetadata/";
var EXPORT_CRS = "EPSG:4326";

// Benchmark exports (DEFAULT: Drive CSV)
var DO_EXPORT_BENCHMARK = true;

// Export targets: 'DRIVE' (default), 'ASSET', 'BOTH'
var BENCHMARK_EXPORT_TARGET = 'DRIVE';

// Drive export settings
var BENCHMARK_DRIVE_FOLDER = "GEE_Benchmarks";  // Drive folder name (will be created if not existing)
var BENCHMARK_RUN_ID = "bench_v3_driveCSV";     // version label (avoid spaces)
var BENCHMARK_FILE_PREFIX = null;               // optional, if null uses benchTag

// Asset export settings (optional)
var EXPORT_BENCH_FOLDER = "projects/hardy-tenure-383607/assets/DryForm_Project/ClassifierModels/BenchmarkTables/";

// Include heavy fields in benchmark table?
// Keep these TRUE if you want full detail; set explain false if table gets too big.
var BENCH_INCLUDE_CONFUSION_AND_PERCLASS = true; // confusion matrix + per-class arrays
var BENCH_INCLUDE_CLASSIFIER_EXPLAIN     = false; // explain() can be large; CSV still works but can be huge


// ======================================================
// 3) BENCHMARK SETTINGS (AOIs x Methods)
// ======================================================

var BENCHMARK_AOIS = ['caatinga', 'cerrado', 'chaco', 'tanzania'];
var BENCHMARK_METHODS = ['RF', 'CART', 'GTB', 'KNN', 'NB', 'SVM', 'MIN_DIST'];


// ======================================================
// 4) AOIs (ALL)
// ======================================================

var caatinga = ee.FeatureCollection("users/iameztoy/dryform/AOIs/eco_zone_Caatinga");
var cerrado  = ee.FeatureCollection("users/iameztoy/dryform/AOIs/eco_zone_Cerrado");
var chaco    = ee.FeatureCollection("users/iameztoy/dryform/AOIs/eco_zone_Chaco");
var tanzania = ee.FeatureCollection("users/iameztoy/dryform/AOIs/zone_Tanzania");

var AOIS = { caatinga: caatinga, cerrado: cerrado, chaco: chaco, tanzania: tanzania };


// ======================================================
// 5) GROUND TRUTH ASSETS
// ======================================================

var GroundTruthPoint_DF = ee.FeatureCollection(
  "projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GroundTruthPoint_DF"
);
var GroundTruthPol_DF = ee.FeatureCollection(
  "projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GroundTruthPol_DF"
);

var GTPoint_DF_Balanced = {
  chaco:    ee.FeatureCollection("projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GTPoint_DF_Balanced_chaco"),
  caatinga: ee.FeatureCollection("projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GTPoint_DF_Balanced_caatinga"),
  cerrado:  ee.FeatureCollection("projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GTPoint_DF_Balanced_cerrado"),
  tanzania: ee.FeatureCollection("projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GTPoint_DF_Balanced_tanzania")
};

// NOTE: your earlier Tanzania polygon path looked like a point asset; kept as-is to avoid breaking.
var GTPol_DF_Balanced = {
  chaco:    ee.FeatureCollection("projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GTPol_DF_Balanced_chaco"),
  caatinga: ee.FeatureCollection("projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GTPol_DF_Balanced_caatinga"),
  cerrado:  ee.FeatureCollection("projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GTPol_DF_Balanced_cerrado"),
  tanzania: ee.FeatureCollection("projects/hardy-tenure-383607/assets/DryForm_Project/GroundTruth/GTPoint_DF_Balanced_tanzania") // verify
};


// ======================================================
// 6) REMAP LOGIC (AOI-dependent)
// ======================================================

// Default (cerrado, caatinga, tanzania) — includes Mangroves (orig 4)
var classValues_default = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10];
var remapValues_default = [6, 0, 1, 2, 3, 4, 5, 7, 8, 9];

// Chaco — excludes Mangroves (orig 4) => 9 classes (0..8)
var classValues_chaco = [0, 1, 2, 3, 5, 6, 7, 9, 10];
var remapValues_chaco = [6, 0, 1, 2, 3, 4, 5, 7, 8];

function getRemapForAOI(aoiName) {
  var isChaco = (aoiName === 'chaco');
  return {
    classValues: isChaco ? classValues_chaco : classValues_default,
    remapValues: isChaco ? remapValues_chaco : remapValues_default
  };
}

var ORIG_NAME = {
  0:  "SWater",
  1:  "TreeCover",
  2:  "Shrub",
  3:  "Grass",
  4:  "Mangroves",
  5:  "FloodedVeg",
  6:  "Built",
  7:  "PWater",
  9:  "Bare",
  10: "Crops"
};

function buildLegendJSON(classValues, remapValues) {
  var items = [];
  for (var i = 0; i < classValues.length; i++) {
    var origId = classValues[i];
    var outId  = remapValues[i];
    items.push({orig: origId, out: outId, name: ORIG_NAME[origId]});
  }
  items.sort(function(a,b){ return a.out - b.out; });
  return JSON.stringify(items);
}


// ======================================================
// 7) EMBEDDINGS (AlphaEarth / Satellite Embeddings)
// ======================================================

var EMBED_IC = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');

function getCompositeForAOIYear(aoiFc, year) {
  return EMBED_IC
    .filterDate(year + '-01-01', (year + 1) + '-01-01')
    .filterBounds(aoiFc)
    .mosaic();
}


// ======================================================
// 8) CLASSIFIERS + PARAMS (defaults exposed)
// ======================================================

// RF
var RF_numberOfTrees      = 90;
var RF_variablesPerSplit  = null;
var RF_minLeafPopulation  = 1;
var RF_bagFraction        = 0.5;
var RF_maxNodes           = null;

// CART
var CART_maxNodes          = null;
var CART_minLeafPopulation = 1;

// GTB
var GTB_numberOfTrees = 200;
var GTB_shrinkage     = 0.005;
var GTB_samplingRate  = 0.7;
var GTB_maxNodes      = null;
var GTB_loss          = "LeastAbsoluteDeviation";

// KNN
var KNN_k            = 1;
var KNN_searchMethod = "AUTO";
var KNN_metric       = "EUCLIDEAN";

// NB
var NB_lambda = 0.000001;

// SVM
var SVM_decisionProcedure  = "Voting";
var SVM_svmType            = "C_SVC";
var SVM_kernelType         = "LINEAR";
var SVM_shrinking          = true;
var SVM_degree             = null;
var SVM_gamma              = null;
var SVM_coef0              = null;
var SVM_cost               = null;
var SVM_nu                 = null;
var SVM_terminationEpsilon = null;
var SVM_lossEpsilon        = null;
var SVM_oneClass           = null;

// Minimum Distance
var MIN_metric   = "euclidean";
var MIN_kNearest = 1;

function getClassifier(method) {
  method = (method || 'RF').toUpperCase();

  if (method === 'RF') {
    return ee.Classifier.smileRandomForest(
      RF_numberOfTrees, RF_variablesPerSplit, RF_minLeafPopulation,
      RF_bagFraction, RF_maxNodes, GLOBAL_SEED
    );
  }
  if (method === 'CART') {
    return ee.Classifier.smileCart(CART_maxNodes, CART_minLeafPopulation);
  }
  if (method === 'GTB') {
    return ee.Classifier.smileGradientTreeBoost(
      GTB_numberOfTrees, GTB_shrinkage, GTB_samplingRate,
      GTB_maxNodes, GTB_loss, GLOBAL_SEED
    );
  }
  if (method === 'KNN') {
    return ee.Classifier.smileKNN(KNN_k, KNN_searchMethod, KNN_metric);
  }
  if (method === 'NB') {
    return ee.Classifier.smileNaiveBayes(NB_lambda);
  }
  if (method === 'SVM') {
    return ee.Classifier.libsvm(
      SVM_decisionProcedure, SVM_svmType, SVM_kernelType, SVM_shrinking,
      SVM_degree, SVM_gamma, SVM_coef0, SVM_cost, SVM_nu,
      SVM_terminationEpsilon, SVM_lossEpsilon, SVM_oneClass
    );
  }
  if (method === 'MIN_DIST') {
    return ee.Classifier.minimumDistance(MIN_metric, MIN_kNearest);
  }

  return ee.Classifier.smileRandomForest(RF_numberOfTrees, null, 1, 0.5, null, GLOBAL_SEED);
}


// ======================================================
// 9) HELPERS: naming, exportability, JSON encoding
// ======================================================

function token(x) {
  if (x === null || x === undefined) return 'def';
  var s = String(x);
  s = s.replace(/\./g, 'p');
  s = s.replace(/\s+/g, '');
  return s;
}

function paramSuffix(method) {
  method = method.toUpperCase();
  if (method === 'RF') {
    return 'nT' + token(RF_numberOfTrees) +
           '_vps' + token(RF_variablesPerSplit) +
           '_mlp' + token(RF_minLeafPopulation) +
           '_bf'  + token(RF_bagFraction) +
           '_mN'  + token(RF_maxNodes) +
           '_se'  + token(GLOBAL_SEED);
  }
  if (method === 'CART') {
    return 'mN' + token(CART_maxNodes) +
           '_mlp' + token(CART_minLeafPopulation);
  }
  if (method === 'GTB') {
    return 'nT' + token(GTB_numberOfTrees) +
           '_sh' + token(GTB_shrinkage) +
           '_sr' + token(GTB_samplingRate) +
           '_mN' + token(GTB_maxNodes) +
           '_ls' + token(GTB_loss) +
           '_se' + token(GLOBAL_SEED);
  }
  if (method === 'KNN') {
    return 'k' + token(KNN_k) +
           '_m' + token(KNN_metric) +
           '_sm' + token(KNN_searchMethod);
  }
  if (method === 'NB') {
    return 'lam' + token(NB_lambda) +
           '_pre' + token(NB_ENABLE_PREPROCESS ? 1 : 0) +
           '_sc' + token(NB_SCALE) +
           '_of' + token(NB_OFFSET);
  }
  if (method === 'SVM') {
    return 'svm' + token(SVM_svmType) +
           '_k' + token(SVM_kernelType) +
           '_c' + token(SVM_cost) +
           '_g' + token(SVM_gamma) +
           '_nu' + token(SVM_nu) +
           '_dp' + token(SVM_decisionProcedure);
  }
  if (method === 'MIN_DIST') {
    return 'm' + token(MIN_metric) +
           '_k' + token(MIN_kNearest);
  }
  return 'params';
}

function canExportClassifier(method) {
  method = method.toUpperCase();
  return (method === 'RF' || method === 'CART');
}

function buildRunTag(aoiName, method) {
  var bufTag = (TRAIN_GEOM_MODE === 'POINTS') ? ('buf' + token(BUFFER_METERS)) : 'poly';
  return 'AE' + token(YEAR) +
         '_' + token(aoiName) +
         '_' + bufTag +
         '_' + token(landcover) +
         '_' + token(method) +
         '_' + paramSuffix(method);
}

// JSON helpers
function eeJsonFromList(listObj) {
  return ee.String.encodeJSON(listObj);
}
function eeJsonFromArray(arrObj) {
  return ee.String.encodeJSON(ee.Array(arrObj).toList());
}


// ======================================================
// 10) CORE: run one (AOI, method) and return Feature with metrics
// ======================================================

function runOneAOIMethod(aoiName, method) {

  var aoiFc = AOIS[aoiName];

  // Remap arrays (client)
  var remap = getRemapForAOI(aoiName);
  var classValues = remap.classValues;
  var remapValues = remap.remapValues;

  var hasMangroves = (aoiName !== 'chaco');

  // Fixed label order => stable confusion matrices/arrays per AOI
  var nClasses = remapValues.length;                 // 9 (chaco) or 10 (others)
  var fixedOrder = ee.List.sequence(0, nClasses - 1);

  var legendJSON  = buildLegendJSON(classValues, remapValues);

  // Training and validation collections
  var trainingGcp = (TRAIN_GEOM_MODE === 'POLYGONS')
    ? GTPol_DF_Balanced[aoiName]
    : GTPoint_DF_Balanced[aoiName];

  var validationGcp = GroundTruthPoint_DF
    .filter(ee.Filter.eq('aoiname', aoiName))
    .filter(ee.Filter.eq('purp', "validation"));

  // Apply remap on label property
  trainingGcp   = trainingGcp.remap(classValues, remapValues, landcover);
  validationGcp = validationGcp.remap(classValues, remapValues, landcover);

  // Buffer if POINTS
  if (TRAIN_GEOM_MODE === 'POINTS' && BUFFER_METERS > 0) {
    var applybuffer = function(f) { return f.buffer(BUFFER_METERS); };
    trainingGcp   = trainingGcp.map(applybuffer);
    validationGcp = validationGcp.map(applybuffer);
  }

  // Composite
  var composite = getCompositeForAOIYear(aoiFc, YEAR);
  var compositeForTraining = composite;

  // Optional NB preprocessing
  if (method.toUpperCase() === 'NB' && NB_ENABLE_PREPROCESS) {
    compositeForTraining = composite
      .multiply(NB_SCALE).add(NB_OFFSET).round().toInt();
  }

  // sampleRegions args
  var trainingArgs = { collection: trainingGcp, properties: [landcover], scale: SCALE };
  if (USE_TILE_SCALE) trainingArgs.tileScale = TRAIN_TILE_SCALE;

  var testArgs = { collection: validationGcp, properties: [landcover], scale: SCALE };
  if (USE_TILE_SCALE) testArgs.tileScale = TEST_TILE_SCALE;

  // Train samples
  var training = compositeForTraining.sampleRegions(trainingArgs);

  // Train classifier
  var classifier = getClassifier(method).train({
    features: training,
    classProperty: landcover,
    inputProperties: compositeForTraining.bandNames()
  });

  // Classify
  var classified = compositeForTraining.classify(classifier).toByte();

  // Validate
  var test = classified.sampleRegions(testArgs);

  // Confusion matrix with FIXED ORDER (stable across reruns, provided same inputs)
  var cm = test.errorMatrix(landcover, 'classification', fixedOrder);

  // Scalar metrics
  var oa    = cm.accuracy();
  var kappa = cm.kappa();

  var usersAcc = cm.consumersAccuracy(); // precision per class
  var prodAcc  = cm.producersAccuracy(); // recall per class
  var f1Arr    = cm.fscore();            // f1 per class

  var macroPrecision = ee.Array(usersAcc).reduce(ee.Reducer.mean(), [0]).get([0]);
  var macroRecall    = ee.Array(prodAcc).reduce(ee.Reducer.mean(), [0]).get([0]);
  var macroF1        = ee.Array(f1Arr).reduce(ee.Reducer.mean(), [0]).get([0]);

  // Confusion matrix + support
  var order   = cm.order();   // equals fixedOrder
  var cmArr   = cm.array();
  var support = ee.Array(cmArr).reduce(ee.Reducer.sum(), [1]);

  // Explain (optional; can be large)
  var explainStr = ee.Dictionary(classifier.explain()).serialize();

  var runTag = buildRunTag(aoiName, method);

  // Base properties always included
  var props = ee.Dictionary({
    runTag: runTag,
    benchmarkRunId: BENCHMARK_RUN_ID,
    year: YEAR,
    aoi: aoiName,
    method: method.toUpperCase(),
    landcover: landcover,

    trainGeomMode: TRAIN_GEOM_MODE,
    bufferMeters: (TRAIN_GEOM_MODE === 'POINTS') ? BUFFER_METERS : 0,
    scale: SCALE,

    useTileScale: USE_TILE_SCALE,
    trainTileScale: TRAIN_TILE_SCALE,
    testTileScale: TEST_TILE_SCALE,

    seed: GLOBAL_SEED,

    hasMangroves: hasMangroves,
    nClasses: nClasses,

    // dataset info
    bandsCount: compositeForTraining.bandNames().size(),
    trainCount: trainingGcp.size(),
    validCount: validationGcp.size(),

    // remap / legend
    classValues: JSON.stringify(classValues),
    remapValues: JSON.stringify(remapValues),
    legend: legendJSON,

    // scalar validation metrics
    val_overallAccuracy: oa,
    val_kappa: kappa,
    val_macroPrecision: macroPrecision,
    val_macroRecall: macroRecall,
    val_macroF1: macroF1,

    // handy score for sorting
    score: macroF1
  });

  // Add heavy fields conditionally
  if (BENCH_INCLUDE_CONFUSION_AND_PERCLASS) {
    props = props.combine(ee.Dictionary({
      val_labelOrder: eeJsonFromList(order),
      val_supportByClass: eeJsonFromArray(support),
      val_usersAccuracy: eeJsonFromArray(usersAcc),
      val_producersAccuracy: eeJsonFromArray(prodAcc),
      val_f1ByClass: eeJsonFromArray(f1Arr),
      val_confusionMatrix: eeJsonFromArray(cmArr)
    }), true);
  }

  if (BENCH_INCLUDE_CLASSIFIER_EXPLAIN) {
    props = props.combine(ee.Dictionary({ classifierExplain: explainStr }), true);
  }

  // Null geometry => export as clean table
  return ee.Feature(null, props);
}


// ======================================================
// 11) BENCHMARK MODE (AOIs x METHODS -> CSV to Drive by default)
// ======================================================

if (BENCHMARK_MODE) {

  if (DO_EXPORT_BENCHMARK) {

    // Build FeatureCollection (28 rows) with a client loop => ONE export task
    var featuresClient = [];
    for (var i = 0; i < BENCHMARK_AOIS.length; i++) {
      for (var j = 0; j < BENCHMARK_METHODS.length; j++) {
        featuresClient.push(runOneAOIMethod(BENCHMARK_AOIS[i], BENCHMARK_METHODS[j]));
      }
    }
    var benchFc = ee.FeatureCollection(featuresClient);

    // Build a safe tag (letters/numbers/_/- only)
    var benchTag =
      'Bench_' + token(BENCHMARK_RUN_ID) +
      '_AE' + token(YEAR) +
      '_' + token(landcover) +
      '_' + ((TRAIN_GEOM_MODE === 'POINTS') ? ('buf' + token(BUFFER_METERS)) : 'poly') +
      '_se' + token(GLOBAL_SEED) +
      '_ts' + token(USE_TILE_SCALE ? 1 : 0);

    // Selectors => clean CSV columns (no .geo, no system:index)
    var selectors = [
      'benchmarkRunId','runTag','year','aoi','method','landcover',
      'trainGeomMode','bufferMeters','scale',
      'useTileScale','trainTileScale','testTileScale',
      'seed',
      'hasMangroves','nClasses',
      'bandsCount','trainCount','validCount',
      'classValues','remapValues','legend',
      'val_overallAccuracy','val_kappa','val_macroPrecision','val_macroRecall','val_macroF1',
      'score'
    ];

    if (BENCH_INCLUDE_CONFUSION_AND_PERCLASS) {
      selectors = selectors.concat([
        'val_labelOrder',
        'val_supportByClass',
        'val_usersAccuracy',
        'val_producersAccuracy',
        'val_f1ByClass',
        'val_confusionMatrix'
      ]);
    }

    if (BENCH_INCLUDE_CLASSIFIER_EXPLAIN) {
      selectors = selectors.concat(['classifierExplain']);
    }

    // ---- EXPORT TO DRIVE (DEFAULT) ----
    if (BENCHMARK_EXPORT_TARGET === 'DRIVE' || BENCHMARK_EXPORT_TARGET === 'BOTH') {
      Export.table.toDrive({
        collection: benchFc,
        description: benchTag,
        folder: BENCHMARK_DRIVE_FOLDER,
        fileNamePrefix: (BENCHMARK_FILE_PREFIX ? BENCHMARK_FILE_PREFIX : benchTag),
        fileFormat: 'CSV',
        selectors: selectors
      });
    }

    // ---- EXPORT TO ASSET (OPTIONAL) ----
    if (BENCHMARK_EXPORT_TARGET === 'ASSET' || BENCHMARK_EXPORT_TARGET === 'BOTH') {
      Export.table.toAsset({
        collection: benchFc,
        description: benchTag,
        assetId: EXPORT_BENCH_FOLDER + benchTag
      });
    }
  }

} else {

  // ======================================================
  // 12) SINGLE MODE (prints/layers optional + asset exports)
  // ======================================================

  if (!AOIS[AOI_NAME]) {
    throw new Error('AOI_NAME must be one of: caatinga|cerrado|chaco|tanzania. Got: ' + AOI_NAME);
  }

  var aoi = AOIS[AOI_NAME];

  // Run one for metrics
  var outFeat = runOneAOIMethod(AOI_NAME, CLASSIFIER_METHOD);

  if (SHOW_DEBUG_PRINTS) {
    print('Single runTag', outFeat.get('runTag'));
    print('Single validation OA', outFeat.get('val_overallAccuracy'));
    print('Single validation Kappa', outFeat.get('val_kappa'));
    print('Single validation macroF1', outFeat.get('val_macroF1'));
  }

  // Recompute for visualization + exports (deterministic)
  var remap = getRemapForAOI(AOI_NAME);
  var classValues = remap.classValues;
  var remapValues = remap.remapValues;

  var trainingGcp = (TRAIN_GEOM_MODE === 'POLYGONS')
    ? GTPol_DF_Balanced[AOI_NAME]
    : GTPoint_DF_Balanced[AOI_NAME];

  var validationGcp = GroundTruthPoint_DF
    .filter(ee.Filter.eq('aoiname', AOI_NAME))
    .filter(ee.Filter.eq('purp', "validation"));

  trainingGcp   = trainingGcp.remap(classValues, remapValues, landcover);
  validationGcp = validationGcp.remap(classValues, remapValues, landcover);

  if (TRAIN_GEOM_MODE === 'POINTS' && BUFFER_METERS > 0) {
    var applybuffer = function(f) { return f.buffer(BUFFER_METERS); };
    trainingGcp   = trainingGcp.map(applybuffer);
    validationGcp = validationGcp.map(applybuffer);
  }

  var composite = getCompositeForAOIYear(aoi, YEAR);
  var compositeForTraining = composite;

  if (CLASSIFIER_METHOD.toUpperCase() === 'NB' && NB_ENABLE_PREPROCESS) {
    compositeForTraining = composite.multiply(NB_SCALE).add(NB_OFFSET).round().toInt();
  }

  if (SHOW_MAP_LAYERS) {
    var visParams = {min: -0.3, max: 0.3, bands: ['A01', 'A50', 'A20']};
    Map.addLayer(composite.clip(aoi), visParams, YEAR + ' embeddings');
    Map.setOptions('SATELLITE');
    Map.centerObject(aoi, 6);
    Map.addLayer(aoi, {color: "red"}, "AOI Boundary", 0);
    Map.addLayer(trainingGcp, null, "Training GCP", 1);
  }

  var trainingArgs = { collection: trainingGcp, properties: [landcover], scale: SCALE };
  if (USE_TILE_SCALE) trainingArgs.tileScale = TRAIN_TILE_SCALE;
  var training = compositeForTraining.sampleRegions(trainingArgs);

  var classifier = getClassifier(CLASSIFIER_METHOD).train({
    features: training,
    classProperty: landcover,
    inputProperties: compositeForTraining.bandNames()
  });

  var classifiedByte = compositeForTraining.classify(classifier).toByte().clip(aoi);

  if (SHOW_MAP_LAYERS) {
    Map.addLayer(classifiedByte, null, 'LC ' + YEAR + ' (' + CLASSIFIER_METHOD + ')', 0);
  }

  var runTag = buildRunTag(AOI_NAME, CLASSIFIER_METHOD);

  if (DO_EXPORT_CLASSIFIED_ASSET) {
    Export.image.toAsset({
      image: classifiedByte,
      description: 'Class_' + runTag,
      assetId: EXPORT_CLASS_FOLDER + 'Class_' + runTag,
      pyramidingPolicy: {'.default': 'mode'},
      region: aoi.geometry(),
      scale: SCALE,
      crs: EXPORT_CRS,
      maxPixels: 1e13
    });
  }

  if (DO_EXPORT_MODEL_ASSET) {
    if (canExportClassifier(CLASSIFIER_METHOD)) {
      Export.classifier.toAsset({
        classifier: classifier,
        description: 'Model_' + runTag,
        assetId: EXPORT_MODEL_FOLDER + 'Model_' + runTag
      });
    } else if (SHOW_DEBUG_PRINTS) {
      print('INFO: Export.classifier.toAsset not supported for method ' + CLASSIFIER_METHOD + '. (RF/CART supported).');
    }
  }

  if (DO_EXPORT_RUN_METADATA) {
    // Single-run metadata table (asset)
    var meta = ee.Feature(null, ee.Dictionary(outFeat.toDictionary()));
    Export.table.toAsset({
      collection: ee.FeatureCollection([meta]),
      description: 'RunMeta_' + runTag,
      assetId: EXPORT_META_FOLDER + 'RunMeta_' + runTag
    });
  }
}
