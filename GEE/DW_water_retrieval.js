/**** Dynamic World Water / Inundated Vegetation + SWOT-window Export App ****/
/**** Google Earth Engine JavaScript ****/

/*
Paste this script into the Google Earth Engine Code Editor.

Main features:
1. Visualize Dynamic World water and/or inundated vegetation for a selected AOI and date/date range/month.
2. Export the displayed result to Google Drive or to an Earth Engine Asset ImageCollection.
3. Batch export all available Dynamic World images or monthly aggregated images for a selected time range.
4. Paste SWOT filenames, extract their acquisition dates automatically, and export Dynamic World images around each SWOT date using a configurable before/after window, e.g. +/-10 days.

Dynamic World label classes used here:
0 = water
3 = flooded vegetation / inundated vegetation

Output class values used in this script:
1 = water
2 = inundated / flooded vegetation

For binary masks:
1 = selected class/classes present
masked = absent / not selected
*/

// ------------------------------------------------------
// Collections and constants
// ------------------------------------------------------

var DW = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1');

var WATER_ID = 0;
var FLOODED_VEG_ID = 3;

var WATER_OUT = 1;
var FLOODED_VEG_OUT = 2;

var DEFAULT_AOI = ee.Geometry.Point([29.25, -3.35]).buffer(10000);

var VIS_SELECTED_CLASSES = {
  min: 1,
  max: 2,
  palette: [
    '419BDF', // water
    '7A87C6'  // inundated / flooded vegetation
  ]
};

var VIS_BINARY_MASK = {
  min: 1,
  max: 1,
  palette: ['00FFFF']
};

var clickedAoi = null;
var lastDisplayedImage = null;
var lastDisplayedImageName = null;

// ------------------------------------------------------
// Optional default SWOT filename list.
// Replace or extend this list with your own filenames.
// The script extracts dates from patterns like:
// SWOT_L2_HR_PIXC_037_249_150L_20250819T054027_...
// ------------------------------------------------------

var SWOT_FILENAME_TEXT = [
  'SWOT_L2_HR_PIXC_007_249_150L_20231202T070803_20231202T070814_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_037_249_150L_20250819T054027_20250819T054038_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_024_249_150L_20241120T235425_20241120T235436_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_028_249_150L_20250212T105442_20250212T105453_PGD0_02.nc.parquet',
  'SWOT_L2_HR_PIXC_016_249_150L_20240607T015348_20240607T015359_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_005_249_150L_20231021T133752_20231021T133804_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_004_249_150L_20230930T165248_20230930T165259_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_026_249_150L_20250101T172434_20250101T172445_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_023_249_150L_20241031T030920_20241031T030931_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_003_249_150L_20230909T200745_20230909T200757_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_029_249_150L_20250305T073947_20250305T073958_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_048_249_150L_20260405T175617_20260405T175628_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_025_249_150L_20241211T203929_20241211T203940_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_027_249_150L_20250122T140939_20250122T140950_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_011_249_150L_20240223T180824_20240223T180835_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_020_249_150L_20240829T125404_20240829T125415_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_006_249_150L_20231111T102258_20231111T102309_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_022_249_150L_20241010T062416_20241010T062427_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_015_249_150L_20240517T050841_20240517T050852_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_021_249_150L_20240919T093911_20240919T093922_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_001_249_150L_20230730T023734_20230730T023745_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_042_249_150L_20251201T132548_20251201T132559_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_014_249_150L_20240426T082337_20240426T082348_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_031_249_150L_20250416T010957_20250416T011008_PGD0_02.nc.parquet',
  'SWOT_L2_HR_PIXC_012_249_150L_20240315T145326_20240315T145337_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_051_249_150L_20260607T081131_20260607T081142_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_009_249_150L_20240113T003812_20240113T003823_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_017_249_150L_20240627T223850_20240627T223901_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_019_249_150L_20240808T160859_20240808T160911_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_035_249_150L_20250708T121018_20250708T121029_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_036_249_150L_20250729T085522_20250729T085533_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_050_249_150L_20260517T112627_20260517T112638_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_030_249_150L_20250326T042452_20250326T042503_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_008_249_150L_20231223T035308_20231223T035319_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_033_249_150L_20250527T184007_20250527T184018_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_041_249_150L_20251110T164044_20251110T164055_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_032_249_150L_20250506T215500_20250506T215511_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_052_249_150L_20260628T045637_20260628T045648_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_039_249_150L_20250929T231034_20250929T231045_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_013_249_150L_20240405T113831_20240405T113842_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_018_249_150L_20240718T192355_20240718T192406_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_034_249_150L_20250617T152510_20250617T152521_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_045_249_150L_20260202T034102_20260202T034113_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_043_249_150L_20251222T101052_20251222T101103_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_010_249_150L_20240202T212319_20240202T212330_PGD0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_049_249_150L_20260426T144124_20260426T144135_PID0_01.nc.parquet',
  'SWOT_L2_HR_PIXC_047_249_150L_20260315T211114_20260315T211125_PID0_01.nc.parquet'
].join('\n');

// ------------------------------------------------------
// Map setup
// ------------------------------------------------------

Map.setOptions('SATELLITE');
Map.centerObject(DEFAULT_AOI, 9);

var drawingTools = Map.drawingTools();
drawingTools.setShown(true);
drawingTools.setDrawModes(['polygon', 'rectangle']);

while (drawingTools.layers().length() > 0) {
  var oldLayer = drawingTools.layers().get(0);
  drawingTools.layers().remove(oldLayer);
}

var aoiLayer = ui.Map.GeometryLayer({
  geometries: null,
  name: 'AOI',
  color: 'red'
});

drawingTools.layers().add(aoiLayer);

// ------------------------------------------------------
// Main UI
// ------------------------------------------------------

var mainPanel = ui.Panel({
  style: {
    width: '410px',
    padding: '10px'
  }
});

ui.root.insert(0, mainPanel);

mainPanel.add(ui.Label({
  value: 'Dynamic World Water / Inundated Vegetation App',
  style: {
    fontWeight: 'bold',
    fontSize: '16px',
    margin: '0 0 8px 0'
  }
}));

mainPanel.add(ui.Label(
  'Draw an AOI or click on the map. Then choose a visualization or export mode.'
));

// ------------------------------------------------------
// Shared AOI controls
// ------------------------------------------------------

mainPanel.add(ui.Label({
  value: 'AOI selection',
  style: {
    fontWeight: 'bold',
    margin: '12px 0 4px 0'
  }
}));

var bufferBox = ui.Textbox({
  placeholder: 'Buffer in meters',
  value: '5000',
  style: {width: '110px'}
});

mainPanel.add(ui.Panel([
  ui.Label('Click buffer:'),
  bufferBox
], ui.Panel.Layout.flow('horizontal')));

var drawRectangleButton = ui.Button({
  label: 'Draw rectangle',
  onClick: function() {
    clearDrawnGeometries();
    clickedAoi = null;
    drawingTools.setShape('rectangle');
    drawingTools.draw();
    statusLabel.setValue('Draw a rectangle on the map, then run the app.');
  }
});

var drawPolygonButton = ui.Button({
  label: 'Draw polygon',
  onClick: function() {
    clearDrawnGeometries();
    clickedAoi = null;
    drawingTools.setShape('polygon');
    drawingTools.draw();
    statusLabel.setValue('Draw a polygon on the map, then run the app.');
  }
});

var clearAoiButton = ui.Button({
  label: 'Clear AOI',
  onClick: function() {
    clearDrawnGeometries();
    clickedAoi = null;
    Map.layers().reset();
    Map.centerObject(DEFAULT_AOI, 9);
    statusLabel.setValue('AOI cleared. Default AOI will be used unless you draw or click.');
  }
});

mainPanel.add(ui.Panel([
  drawRectangleButton,
  drawPolygonButton
], ui.Panel.Layout.flow('horizontal')));

mainPanel.add(clearAoiButton);

Map.onClick(function(coords) {
  var bufferMeters = Number(bufferBox.getValue());

  if (!bufferMeters || bufferMeters <= 0) {
    bufferMeters = 5000;
  }

  clickedAoi = ee.Geometry.Point([coords.lon, coords.lat]).buffer(bufferMeters);

  clearDrawnGeometries();

  Map.layers().reset();
  Map.addLayer(clickedAoi, {color: 'red'}, 'Clicked AOI');
  Map.centerObject(clickedAoi, 11);

  statusLabel.setValue(
    'Clicked AOI created at lon: ' +
    coords.lon.toFixed(4) +
    ', lat: ' +
    coords.lat.toFixed(4)
  );
});

// ------------------------------------------------------
// Tab selector
// ------------------------------------------------------

mainPanel.add(ui.Label({
  value: 'App section',
  style: {
    fontWeight: 'bold',
    margin: '12px 0 4px 0'
  }
}));

var tabSelect = ui.Select({
  items: [
    'Visualize and export one result',
    'Batch export',
    'SWOT-date export'
  ],
  value: 'Visualize and export one result',
  style: {stretch: 'horizontal'},
  onChange: updateVisibleTab
});

mainPanel.add(tabSelect);

var tabPanel = ui.Panel();
mainPanel.add(tabPanel);

// ------------------------------------------------------
// Status label
// ------------------------------------------------------

var statusLabel = ui.Label({
  value: 'Ready.',
  style: {
    margin: '12px 0 0 0',
    color: '555555'
  }
});

mainPanel.add(statusLabel);

// ------------------------------------------------------
// Tab 1: visualization and single export
// ------------------------------------------------------

var visPanel = ui.Panel();

visPanel.add(ui.Label({
  value: '1. Visualization settings',
  style: {
    fontWeight: 'bold',
    margin: '8px 0 4px 0'
  }
}));

var visClassSelect = ui.Select({
  items: [
    'Water only',
    'Inundated vegetation only',
    'Water + inundated vegetation'
  ],
  value: 'Water + inundated vegetation',
  style: {stretch: 'horizontal'}
});

visPanel.add(ui.Panel([
  ui.Label('Classes:'),
  visClassSelect
], ui.Panel.Layout.flow('horizontal')));

var visDateModeSelect = ui.Select({
  items: [
    'Single date',
    'Date range',
    'Month'
  ],
  value: 'Month',
  style: {width: '180px'}
});

visPanel.add(ui.Panel([
  ui.Label('Date mode:'),
  visDateModeSelect
], ui.Panel.Layout.flow('horizontal')));

var singleDateBox = ui.Textbox({
  placeholder: 'YYYY-MM-DD',
  value: '2025-08-15',
  style: {width: '120px'}
});

visPanel.add(ui.Panel([
  ui.Label('Single date:'),
  singleDateBox
], ui.Panel.Layout.flow('horizontal')));

var visStartDateBox = ui.Textbox({
  placeholder: 'YYYY-MM-DD',
  value: '2025-08-01',
  style: {width: '120px'}
});

var visEndDateBox = ui.Textbox({
  placeholder: 'YYYY-MM-DD',
  value: '2025-08-31',
  style: {width: '120px'}
});

visPanel.add(ui.Panel([
  ui.Label('Start:'),
  visStartDateBox,
  ui.Label('End:'),
  visEndDateBox
], ui.Panel.Layout.flow('horizontal')));

var visYearBox = ui.Textbox({
  placeholder: 'Year',
  value: '2025',
  style: {width: '75px'}
});

var visMonthSelect = ui.Select({
  items: [
    {label: 'January', value: '1'},
    {label: 'February', value: '2'},
    {label: 'March', value: '3'},
    {label: 'April', value: '4'},
    {label: 'May', value: '5'},
    {label: 'June', value: '6'},
    {label: 'July', value: '7'},
    {label: 'August', value: '8'},
    {label: 'September', value: '9'},
    {label: 'October', value: '10'},
    {label: 'November', value: '11'},
    {label: 'December', value: '12'}
  ],
  value: '8',
  style: {width: '140px'}
});

visPanel.add(ui.Panel([
  ui.Label('Year:'),
  visYearBox,
  ui.Label('Month:'),
  visMonthSelect
], ui.Panel.Layout.flow('horizontal')));

var showDominantClassification = ui.Checkbox({
  label: 'Show dominant selected class during period',
  value: true
});

var showAnyMask = ui.Checkbox({
  label: 'Show binary mask: selected class present at least once',
  value: true
});

visPanel.add(showDominantClassification);
visPanel.add(showAnyMask);

var runVisButton = ui.Button({
  label: 'Run visualization',
  style: {stretch: 'horizontal', margin: '10px 0 4px 0'},
  onClick: runVisualization
});

visPanel.add(runVisButton);

// ------------------------------------------------------
// Single export controls
// ------------------------------------------------------

visPanel.add(ui.Label({
  value: '2. Export displayed result',
  style: {
    fontWeight: 'bold',
    margin: '14px 0 4px 0'
  }
}));

var singleExportProductSelect = ui.Select({
  items: [
    'Dominant classified image',
    'Binary selected-class mask'
  ],
  value: 'Dominant classified image',
  style: {stretch: 'horizontal'}
});

visPanel.add(ui.Panel([
  ui.Label('Product:'),
  singleExportProductSelect
], ui.Panel.Layout.flow('horizontal')));

var singleExportTargetSelect = ui.Select({
  items: [
    'Google Drive',
    'Earth Engine Asset ImageCollection'
  ],
  value: 'Google Drive',
  style: {stretch: 'horizontal'}
});

visPanel.add(ui.Panel([
  ui.Label('Target:'),
  singleExportTargetSelect
], ui.Panel.Layout.flow('horizontal')));

var singleDriveFolderBox = ui.Textbox({
  placeholder: 'Google Drive folder',
  value: 'GEE_DW_exports',
  style: {stretch: 'horizontal'}
});

visPanel.add(ui.Panel([
  ui.Label('Drive folder:'),
  singleDriveFolderBox
], ui.Panel.Layout.flow('horizontal')));

var singleAssetCollectionBox = ui.Textbox({
  placeholder: 'users/your_user/your_image_collection',
  value: 'users/your_user/DW_selected_classes',
  style: {stretch: 'horizontal'}
});

visPanel.add(ui.Label('Asset ImageCollection path, if exporting to asset:'));
visPanel.add(singleAssetCollectionBox);

var singleExportNameBox = ui.Textbox({
  placeholder: 'Export name',
  value: 'DW_selected_classes_result',
  style: {stretch: 'horizontal'}
});

visPanel.add(ui.Panel([
  ui.Label('Export name:'),
  singleExportNameBox
], ui.Panel.Layout.flow('horizontal')));

var singleScaleBox = ui.Textbox({
  placeholder: 'Scale',
  value: '10',
  style: {width: '80px'}
});

visPanel.add(ui.Panel([
  ui.Label('Scale, meters:'),
  singleScaleBox
], ui.Panel.Layout.flow('horizontal')));

var exportSingleButton = ui.Button({
  label: 'Create export task for displayed result',
  style: {stretch: 'horizontal', margin: '8px 0 4px 0'},
  onClick: exportDisplayedResult
});

visPanel.add(exportSingleButton);

// ------------------------------------------------------
// Legend
// ------------------------------------------------------

visPanel.add(ui.Label({
  value: 'Legend',
  style: {
    fontWeight: 'bold',
    margin: '14px 0 4px 0'
  }
}));

visPanel.add(makeLegendRow('419BDF', 'Water, value 1'));
visPanel.add(makeLegendRow('7A87C6', 'Inundated / flooded vegetation, value 2'));
visPanel.add(makeLegendRow('00FFFF', 'Binary selected-class mask, value 1'));

// ------------------------------------------------------
// Tab 2: batch export
// ------------------------------------------------------

var batchPanel = ui.Panel();

batchPanel.add(ui.Label({
  value: 'Batch export Dynamic World classified images',
  style: {
    fontWeight: 'bold',
    margin: '8px 0 4px 0'
  }
}));

batchPanel.add(ui.Label(
  'This section creates export tasks. After clicking the button, open the Tasks tab and manually run the exports.'
));

var batchStartDateBox = ui.Textbox({
  placeholder: 'YYYY-MM-DD',
  value: '2025-08-01',
  style: {width: '120px'}
});

var batchEndDateBox = ui.Textbox({
  placeholder: 'YYYY-MM-DD',
  value: '2025-08-31',
  style: {width: '120px'}
});

batchPanel.add(ui.Panel([
  ui.Label('Start:'),
  batchStartDateBox,
  ui.Label('End:'),
  batchEndDateBox
], ui.Panel.Layout.flow('horizontal')));

var batchTemporalModeSelect = ui.Select({
  items: [
    'Every available Dynamic World image',
    'Monthly aggregated'
  ],
  value: 'Monthly aggregated',
  style: {stretch: 'horizontal'}
});

batchPanel.add(ui.Panel([
  ui.Label('Export mode:'),
  batchTemporalModeSelect
], ui.Panel.Layout.flow('horizontal')));

var batchClassSelect = ui.Select({
  items: [
    'Water only',
    'Inundated vegetation only',
    'Water + inundated vegetation'
  ],
  value: 'Water + inundated vegetation',
  style: {stretch: 'horizontal'}
});

batchPanel.add(ui.Panel([
  ui.Label('Classes:'),
  batchClassSelect
], ui.Panel.Layout.flow('horizontal')));

var batchProductSelect = ui.Select({
  items: [
    'Classified selected classes',
    'Binary selected-class mask'
  ],
  value: 'Classified selected classes',
  style: {stretch: 'horizontal'}
});

batchPanel.add(ui.Panel([
  ui.Label('Product:'),
  batchProductSelect
], ui.Panel.Layout.flow('horizontal')));

var batchTargetSelect = ui.Select({
  items: [
    'Google Drive',
    'Earth Engine Asset ImageCollection'
  ],
  value: 'Google Drive',
  style: {stretch: 'horizontal'}
});

batchPanel.add(ui.Panel([
  ui.Label('Target:'),
  batchTargetSelect
], ui.Panel.Layout.flow('horizontal')));

var batchDriveFolderBox = ui.Textbox({
  placeholder: 'Google Drive folder',
  value: 'GEE_DW_batch_exports',
  style: {stretch: 'horizontal'}
});

batchPanel.add(ui.Panel([
  ui.Label('Drive folder:'),
  batchDriveFolderBox
], ui.Panel.Layout.flow('horizontal')));

var batchAssetCollectionBox = ui.Textbox({
  placeholder: 'users/your_user/your_image_collection',
  value: 'users/your_user/DW_batch_selected_classes',
  style: {stretch: 'horizontal'}
});

batchPanel.add(ui.Label('Asset ImageCollection path, if exporting to asset:'));
batchPanel.add(batchAssetCollectionBox);

var batchPrefixBox = ui.Textbox({
  placeholder: 'File prefix',
  value: 'DW_selected',
  style: {stretch: 'horizontal'}
});

batchPanel.add(ui.Panel([
  ui.Label('Prefix:'),
  batchPrefixBox
], ui.Panel.Layout.flow('horizontal')));

var batchScaleBox = ui.Textbox({
  placeholder: 'Scale',
  value: '10',
  style: {width: '80px'}
});

var maxExportsBox = ui.Textbox({
  placeholder: 'Max tasks',
  value: '100',
  style: {width: '80px'}
});

batchPanel.add(ui.Panel([
  ui.Label('Scale:'),
  batchScaleBox,
  ui.Label('Max tasks:'),
  maxExportsBox
], ui.Panel.Layout.flow('horizontal')));

var createBatchExportsButton = ui.Button({
  label: 'Create batch export tasks',
  style: {
    stretch: 'horizontal',
    margin: '10px 0 4px 0'
  },
  onClick: createBatchExportTasks
});

batchPanel.add(createBatchExportsButton);

batchPanel.add(ui.Label(
  'Note: for Asset exports, the ImageCollection should already exist in your Earth Engine Assets.'
));

// ------------------------------------------------------
// Tab 3: SWOT-date based Dynamic World export
// ------------------------------------------------------

var swotPanel = ui.Panel();

swotPanel.add(ui.Label({
  value: 'SWOT-date based Dynamic World export',
  style: {
    fontWeight: 'bold',
    margin: '8px 0 4px 0'
  }
}));

swotPanel.add(ui.Label(
  'This section extracts acquisition dates from SWOT filenames and creates Dynamic World export tasks using a before/after window around each SWOT date.'
));

var useDefaultSwotListCheckbox = ui.Checkbox({
  label: 'Use SWOT_FILENAME_TEXT variable from the top of the script',
  value: true
});

swotPanel.add(useDefaultSwotListCheckbox);

var swotFilenameBox = ui.Textbox({
  placeholder: 'Optional short list: paste SWOT filenames here, separated by spaces, commas, semicolons or new lines',
  value: '',
  style: {stretch: 'horizontal'}
});

swotPanel.add(ui.Label('Optional pasted filename text:'));
swotPanel.add(swotFilenameBox);

var swotBeforeDaysBox = ui.Textbox({
  placeholder: 'Days before',
  value: '10',
  style: {width: '80px'}
});

var swotAfterDaysBox = ui.Textbox({
  placeholder: 'Days after',
  value: '10',
  style: {width: '80px'}
});

swotPanel.add(ui.Panel([
  ui.Label('Before days:'),
  swotBeforeDaysBox,
  ui.Label('After days:'),
  swotAfterDaysBox
], ui.Panel.Layout.flow('horizontal')));

var swotClassSelect = ui.Select({
  items: [
    'Water only',
    'Inundated vegetation only',
    'Water + inundated vegetation'
  ],
  value: 'Water + inundated vegetation',
  style: {stretch: 'horizontal'}
});

swotPanel.add(ui.Panel([
  ui.Label('Classes:'),
  swotClassSelect
], ui.Panel.Layout.flow('horizontal')));

var swotExportModeSelect = ui.Select({
  items: [
    'Every available Dynamic World image in each SWOT window',
    'One dominant aggregated image per SWOT date',
    'One binary presence mask per SWOT date'
  ],
  value: 'Every available Dynamic World image in each SWOT window',
  style: {stretch: 'horizontal'}
});

swotPanel.add(ui.Panel([
  ui.Label('Export mode:'),
  swotExportModeSelect
], ui.Panel.Layout.flow('vertical')));

var swotProductSelect = ui.Select({
  items: [
    'Classified selected classes',
    'Binary selected-class mask'
  ],
  value: 'Classified selected classes',
  style: {stretch: 'horizontal'}
});

swotPanel.add(ui.Panel([
  ui.Label('Per-image product:'),
  swotProductSelect
], ui.Panel.Layout.flow('horizontal')));

var swotTargetSelect = ui.Select({
  items: [
    'Google Drive',
    'Earth Engine Asset ImageCollection'
  ],
  value: 'Google Drive',
  style: {stretch: 'horizontal'}
});

swotPanel.add(ui.Panel([
  ui.Label('Target:'),
  swotTargetSelect
], ui.Panel.Layout.flow('horizontal')));

var swotDriveFolderBox = ui.Textbox({
  placeholder: 'Google Drive folder',
  value: 'GEE_DW_SWOT_window_exports',
  style: {stretch: 'horizontal'}
});

swotPanel.add(ui.Panel([
  ui.Label('Drive folder:'),
  swotDriveFolderBox
], ui.Panel.Layout.flow('horizontal')));

var swotAssetCollectionBox = ui.Textbox({
  placeholder: 'users/your_user/your_image_collection',
  value: 'users/your_user/DW_SWOT_window_exports',
  style: {stretch: 'horizontal'}
});

swotPanel.add(ui.Label('Asset ImageCollection path, if exporting to asset:'));
swotPanel.add(swotAssetCollectionBox);

var swotPrefixBox = ui.Textbox({
  placeholder: 'Export prefix',
  value: 'DW_SWOT_window',
  style: {stretch: 'horizontal'}
});

swotPanel.add(ui.Panel([
  ui.Label('Prefix:'),
  swotPrefixBox
], ui.Panel.Layout.flow('horizontal')));

var swotScaleBox = ui.Textbox({
  placeholder: 'Scale',
  value: '10',
  style: {width: '80px'}
});

var swotMaxTasksBox = ui.Textbox({
  placeholder: 'Max tasks',
  value: '300',
  style: {width: '80px'}
});

swotPanel.add(ui.Panel([
  ui.Label('Scale:'),
  swotScaleBox,
  ui.Label('Max tasks:'),
  swotMaxTasksBox
], ui.Panel.Layout.flow('horizontal')));

var swotPreviewButton = ui.Button({
  label: 'Preview extracted SWOT dates',
  style: {stretch: 'horizontal', margin: '10px 0 4px 0'},
  onClick: previewSwotDates
});

var swotExportButton = ui.Button({
  label: 'Create SWOT-window export tasks',
  style: {stretch: 'horizontal', margin: '6px 0 4px 0'},
  onClick: createSwotWindowExportTasks
});

swotPanel.add(swotPreviewButton);
swotPanel.add(swotExportButton);

swotPanel.add(ui.Label(
  'Note: one export task is created per Dynamic World image or per SWOT-date aggregate. You still need to open the Tasks tab and run the tasks manually.'
));

// ------------------------------------------------------
// Initialize tab
// ------------------------------------------------------

updateVisibleTab('Visualize and export one result');

// ------------------------------------------------------
// Core UI functions
// ------------------------------------------------------

function updateVisibleTab(tabName) {
  tabPanel.clear();

  if (tabName === 'Visualize and export one result') {
    tabPanel.add(visPanel);
  }

  if (tabName === 'Batch export') {
    tabPanel.add(batchPanel);
  }

  if (tabName === 'SWOT-date export') {
    tabPanel.add(swotPanel);
  }
}

function clearDrawnGeometries() {
  var layers = drawingTools.layers();

  if (layers.length() === 0) {
    var newLayer = ui.Map.GeometryLayer({
      geometries: null,
      name: 'AOI',
      color: 'red'
    });

    layers.add(newLayer);
    return;
  }

  var geometries = layers.get(0).geometries();

  while (geometries.length() > 0) {
    geometries.remove(geometries.get(0));
  }
}

function getAoi() {
  var layers = drawingTools.layers();

  if (layers.length() > 0) {
    var geometries = layers.get(0).geometries();

    if (geometries.length() > 0) {
      return layers.get(0).getEeObject();
    }
  }

  if (clickedAoi !== null) {
    return clickedAoi;
  }

  return DEFAULT_AOI;
}

// ------------------------------------------------------
// Dynamic World image creation helpers
// ------------------------------------------------------

function getClassIds(classText) {
  if (classText === 'Water only') {
    return [WATER_ID];
  }

  if (classText === 'Inundated vegetation only') {
    return [FLOODED_VEG_ID];
  }

  return [WATER_ID, FLOODED_VEG_ID];
}

function getClassOutputValues(classIds) {
  var outputValues = [];

  classIds.forEach(function(classId) {
    if (classId === WATER_ID) {
      outputValues.push(WATER_OUT);
    }

    if (classId === FLOODED_VEG_ID) {
      outputValues.push(FLOODED_VEG_OUT);
    }
  });

  return outputValues;
}

function makeClassifiedSelectedImage(labelImage, classIds) {
  var outputValues = getClassOutputValues(classIds);

  return labelImage
    .remap(classIds, outputValues, 0)
    .rename('selected_class')
    .selfMask()
    .toByte();
}

function makeBinarySelectedMask(labelImage, classIds) {
  var mask = ee.Image(0);

  classIds.forEach(function(classId) {
    mask = mask.or(labelImage.eq(classId));
  });

  return mask
    .rename('selected_mask')
    .selfMask()
    .toByte();
}

function makeDwSingleImageOutput(dwImage, classIds, productText, aoi) {
  var label = dwImage.select('label');
  var out;

  if (productText === 'Binary selected-class mask') {
    out = makeBinarySelectedMask(label, classIds);
  } else {
    out = makeClassifiedSelectedImage(label, classIds);
  }

  return out
    .clip(aoi)
    .copyProperties(dwImage, ['system:time_start', 'system:index']);
}

function makeCollectionDominantClassOutput(dwCol, classIds, productText, aoi) {
  var labelMode = dwCol
    .select('label')
    .reduce(ee.Reducer.mode())
    .rename('label_mode');

  var out;

  if (productText === 'Binary selected-class mask') {
    out = makeBinarySelectedMask(labelMode, classIds);
  } else {
    out = makeClassifiedSelectedImage(labelMode, classIds);
  }

  return out.clip(aoi);
}

function makeCollectionAnyPresenceMask(dwCol, classIds, aoi) {
  var maskCol = dwCol.map(function(img) {
    var label = img.select('label');
    return makeBinarySelectedMask(label, classIds).unmask(0);
  });

  return maskCol
    .max()
    .rename('selected_present_at_least_once')
    .clip(aoi)
    .selfMask()
    .toByte();
}

// ------------------------------------------------------
// Visualization tab functions
// ------------------------------------------------------

function getVisualizationDateInfo() {
  var mode = visDateModeSelect.getValue();

  if (mode === 'Single date') {
    var d = ee.Date(singleDateBox.getValue());

    return {
      start: d,
      end: d.advance(1, 'day'),
      label: singleDateBox.getValue()
    };
  }

  if (mode === 'Date range') {
    var start = ee.Date(visStartDateBox.getValue());
    var end = ee.Date(visEndDateBox.getValue()).advance(1, 'day');

    return {
      start: start,
      end: end,
      label: visStartDateBox.getValue() + '_to_' + visEndDateBox.getValue()
    };
  }

  var year = Number(visYearBox.getValue());
  var month = Number(visMonthSelect.getValue());

  var monthStart = ee.Date.fromYMD(year, month, 1);
  var monthEnd = monthStart.advance(1, 'month');

  return {
    start: monthStart,
    end: monthEnd,
    label: year + '_' + pad2(month)
  };
}

function runVisualization() {
  statusLabel.setValue('Checking Dynamic World images...');

  var aoi = getAoi();
  var classIds = getClassIds(visClassSelect.getValue());
  var dates = getVisualizationDateInfo();

  var dwCol = DW
    .filterBounds(aoi)
    .filterDate(dates.start, dates.end)
    .sort('system:time_start');

  dwCol.size().evaluate(function(n) {
    Map.layers().reset();
    Map.addLayer(aoi, {color: 'red'}, 'AOI');
    Map.centerObject(aoi, 11);

    lastDisplayedImage = null;
    lastDisplayedImageName = null;

    if (n === 0) {
      statusLabel.setValue(
        'No Dynamic World images found for selected period: ' + dates.label
      );
      return;
    }

    var dominantProduct = makeCollectionDominantClassOutput(
      dwCol,
      classIds,
      'Classified selected classes',
      aoi
    );

    var anyMask = makeCollectionAnyPresenceMask(
      dwCol,
      classIds,
      aoi
    );

    if (showDominantClassification.getValue()) {
      Map.addLayer(
        dominantProduct,
        VIS_SELECTED_CLASSES,
        'Dominant selected DW class'
      );
    }

    if (showAnyMask.getValue()) {
      Map.addLayer(
        anyMask,
        VIS_BINARY_MASK,
        'Selected class present at least once',
        false
      );
    }

    var selectedExportProduct = singleExportProductSelect.getValue();

    if (selectedExportProduct === 'Binary selected-class mask') {
      lastDisplayedImage = anyMask;
      lastDisplayedImageName = 'DW_binary_selected_mask_' + dates.label;
    } else {
      lastDisplayedImage = dominantProduct;
      lastDisplayedImageName = 'DW_dominant_selected_class_' + dates.label;
    }

    statusLabel.setValue(
      'Done. Images used: ' + n + '. Period: ' + dates.label + '.'
    );
  });
}

function exportDisplayedResult() {
  var aoi = getAoi();

  if (lastDisplayedImage === null) {
    statusLabel.setValue(
      'No displayed image available yet. First run the visualization.'
    );
    return;
  }

  var exportName = sanitizeName(singleExportNameBox.getValue());

  if (!exportName || exportName === '') {
    exportName = lastDisplayedImageName;
  }

  var scale = Number(singleScaleBox.getValue());

  if (!scale || scale <= 0) {
    scale = 10;
  }

  exportImage({
    image: lastDisplayedImage,
    region: aoi,
    description: exportName,
    target: singleExportTargetSelect.getValue(),
    driveFolder: singleDriveFolderBox.getValue(),
    assetCollection: singleAssetCollectionBox.getValue(),
    scale: scale
  });

  statusLabel.setValue(
    'Export task created: ' + exportName + '. Open the Tasks tab to run it.'
  );
}

// ------------------------------------------------------
// Batch export functions
// ------------------------------------------------------

function createBatchExportTasks() {
  var aoi = getAoi();

  var startText = batchStartDateBox.getValue();
  var endText = batchEndDateBox.getValue();

  var startDate = ee.Date(startText);
  var endDate = ee.Date(endText).advance(1, 'day');

  var classIds = getClassIds(batchClassSelect.getValue());
  var temporalMode = batchTemporalModeSelect.getValue();
  var productText = batchProductSelect.getValue();

  var scale = Number(batchScaleBox.getValue());

  if (!scale || scale <= 0) {
    scale = 10;
  }

  var maxExports = Number(maxExportsBox.getValue());

  if (!maxExports || maxExports <= 0) {
    maxExports = 100;
  }

  if (temporalMode === 'Every available Dynamic World image') {
    createPerImageExportTasks(
      aoi,
      startDate,
      endDate,
      startText,
      endText,
      classIds,
      productText,
      scale,
      maxExports
    );
  }

  if (temporalMode === 'Monthly aggregated') {
    createMonthlyExportTasks(
      aoi,
      startText,
      endText,
      classIds,
      productText,
      scale,
      maxExports
    );
  }
}

function createPerImageExportTasks(
  aoi,
  startDate,
  endDate,
  startText,
  endText,
  classIds,
  productText,
  scale,
  maxExports
) {
  statusLabel.setValue('Preparing per-image export tasks...');

  var dwCol = DW
    .filterBounds(aoi)
    .filterDate(startDate, endDate)
    .sort('system:time_start');

  dwCol.size().evaluate(function(n) {
    if (n === 0) {
      statusLabel.setValue('No Dynamic World images found for the selected range.');
      return;
    }

    var exportCount = Math.min(n, maxExports);

    if (n > maxExports) {
      statusLabel.setValue(
        'Found ' + n + ' images. Creating only the first ' +
        maxExports + ' export tasks. Increase Max tasks if needed.'
      );
    } else {
      statusLabel.setValue('Creating ' + exportCount + ' export tasks...');
    }

    var limitedCol = dwCol.limit(exportCount);
    var ids = limitedCol.aggregate_array('system:index');

    ids.evaluate(function(idList) {
      idList.forEach(function(imageId) {
        var image = ee.Image(
          dwCol.filter(ee.Filter.eq('system:index', imageId)).first()
        );

        var out = makeDwSingleImageOutput(
          image,
          classIds,
          productText,
          aoi
        );

        var name = sanitizeName(
          batchPrefixBox.getValue() +
          '_DW_' +
          imageId
        );

        exportImage({
          image: out,
          region: aoi,
          description: name,
          target: batchTargetSelect.getValue(),
          driveFolder: batchDriveFolderBox.getValue(),
          assetCollection: batchAssetCollectionBox.getValue(),
          scale: scale
        });
      });

      statusLabel.setValue(
        'Created ' + idList.length +
        ' per-image export tasks. Open the Tasks tab to run them.'
      );
    });
  });
}

function createMonthlyExportTasks(
  aoi,
  startText,
  endText,
  classIds,
  productText,
  scale,
  maxExports
) {
  statusLabel.setValue('Preparing monthly export tasks...');

  var monthInfos = getMonthInfos(startText, endText);

  if (monthInfos.length > maxExports) {
    monthInfos = monthInfos.slice(0, maxExports);
    statusLabel.setValue(
      'More months than Max tasks. Creating only first ' +
      maxExports + ' monthly exports.'
    );
  }

  var createdCounter = 0;
  var checkedCounter = 0;

  monthInfos.forEach(function(info) {
    var monthCol = DW
      .filterBounds(aoi)
      .filterDate(info.filterStart, info.filterEnd)
      .sort('system:time_start');

    monthCol.size().evaluate(function(n) {
      checkedCounter++;

      if (n > 0) {
        var out = makeCollectionDominantClassOutput(
          monthCol,
          classIds,
          productText,
          aoi
        );

        var name = sanitizeName(
          batchPrefixBox.getValue() +
          '_DW_monthly_' +
          info.label
        );

        exportImage({
          image: out,
          region: aoi,
          description: name,
          target: batchTargetSelect.getValue(),
          driveFolder: batchDriveFolderBox.getValue(),
          assetCollection: batchAssetCollectionBox.getValue(),
          scale: scale
        });

        createdCounter++;
      }

      if (checkedCounter === monthInfos.length) {
        statusLabel.setValue(
          'Created ' + createdCounter +
          ' monthly export tasks. Months without DW images were skipped.'
        );
      }
    });
  });
}

// ------------------------------------------------------
// SWOT filename date extraction and export functions
// ------------------------------------------------------

function getSwotFilenameTextFromUi() {
  if (useDefaultSwotListCheckbox.getValue()) {
    return SWOT_FILENAME_TEXT;
  }

  return swotFilenameBox.getValue();
}

function previewSwotDates() {
  var text = getSwotFilenameTextFromUi();
  var entries = parseSwotFilenameText(text);

  if (entries.length === 0) {
    statusLabel.setValue('No valid SWOT dates found. Check the filename format.');
    return;
  }

  var preview = entries
    .slice(0, 12)
    .map(function(e) {
      return e.dateText;
    })
    .join(', ');

  var extra = entries.length > 12 ? ' ...' : '';

  statusLabel.setValue(
    'Found ' + entries.length + ' SWOT acquisition dates. First dates: ' +
    preview + extra
  );
}

function createSwotWindowExportTasks() {
  var aoi = getAoi();

  var text = getSwotFilenameTextFromUi();
  var entries = parseSwotFilenameText(text);

  if (entries.length === 0) {
    statusLabel.setValue('No valid SWOT dates found. Check the filename format.');
    return;
  }

  var beforeDays = Number(swotBeforeDaysBox.getValue());
  var afterDays = Number(swotAfterDaysBox.getValue());

  if (!beforeDays || beforeDays < 0) {
    beforeDays = 10;
  }

  if (!afterDays || afterDays < 0) {
    afterDays = 10;
  }

  var scale = Number(swotScaleBox.getValue());

  if (!scale || scale <= 0) {
    scale = 10;
  }

  var maxTasks = Number(swotMaxTasksBox.getValue());

  if (!maxTasks || maxTasks <= 0) {
    maxTasks = 300;
  }

  var classIds = getClassIds(swotClassSelect.getValue());
  var exportMode = swotExportModeSelect.getValue();
  var productText = swotProductSelect.getValue();

  var taskCounter = {
    created: 0,
    checked: 0,
    stop: false
  };

  statusLabel.setValue(
    'Preparing SWOT-window exports for ' + entries.length + ' SWOT dates...'
  );

  entries.forEach(function(entry) {
    if (taskCounter.stop) {
      return;
    }

    var windowInfo = makeSwotWindowInfo(
      entry,
      beforeDays,
      afterDays
    );

    var dwCol = DW
      .filterBounds(aoi)
      .filterDate(windowInfo.startText, windowInfo.endExclusiveText)
      .sort('system:time_start');

    dwCol.size().evaluate(function(n) {
      taskCounter.checked++;

      if (taskCounter.stop) {
        return;
      }

      if (n === 0) {
        updateSwotStatusWhenFinished(taskCounter, entries.length);
        return;
      }

      if (exportMode === 'Every available Dynamic World image in each SWOT window') {
        createSwotPerImageTasks(
          dwCol,
          n,
          aoi,
          entry,
          windowInfo,
          classIds,
          productText,
          scale,
          maxTasks,
          taskCounter,
          entries.length
        );
      }

      if (exportMode === 'One dominant aggregated image per SWOT date') {
        if (taskCounter.created >= maxTasks) {
          taskCounter.stop = true;
          statusLabel.setValue(
            'Reached Max tasks limit: ' + maxTasks +
            '. Some SWOT dates were not exported.'
          );
          return;
        }

        var dominant = makeCollectionDominantClassOutput(
          dwCol,
          classIds,
          'Classified selected classes',
          aoi
        )
        .set({
          swot_date: entry.dateText,
          swot_filename: entry.filename,
          window_start: windowInfo.startText,
          window_end_inclusive: windowInfo.endInclusiveText,
          dw_image_count: n
        });

        var dominantName = sanitizeName(
          swotPrefixBox.getValue() +
          '_SWOT_' +
          entry.dateLabel +
          '_dominant_' +
          beforeDays +
          'd_before_' +
          afterDays +
          'd_after'
        );

        exportImage({
          image: dominant,
          region: aoi,
          description: dominantName,
          target: swotTargetSelect.getValue(),
          driveFolder: swotDriveFolderBox.getValue(),
          assetCollection: swotAssetCollectionBox.getValue(),
          scale: scale
        });

        taskCounter.created++;
        updateSwotStatusWhenFinished(taskCounter, entries.length);
      }

      if (exportMode === 'One binary presence mask per SWOT date') {
        if (taskCounter.created >= maxTasks) {
          taskCounter.stop = true;
          statusLabel.setValue(
            'Reached Max tasks limit: ' + maxTasks +
            '. Some SWOT dates were not exported.'
          );
          return;
        }

        var presence = makeCollectionAnyPresenceMask(
          dwCol,
          classIds,
          aoi
        )
        .set({
          swot_date: entry.dateText,
          swot_filename: entry.filename,
          window_start: windowInfo.startText,
          window_end_inclusive: windowInfo.endInclusiveText,
          dw_image_count: n
        });

        var presenceName = sanitizeName(
          swotPrefixBox.getValue() +
          '_SWOT_' +
          entry.dateLabel +
          '_presence_' +
          beforeDays +
          'd_before_' +
          afterDays +
          'd_after'
        );

        exportImage({
          image: presence,
          region: aoi,
          description: presenceName,
          target: swotTargetSelect.getValue(),
          driveFolder: swotDriveFolderBox.getValue(),
          assetCollection: swotAssetCollectionBox.getValue(),
          scale: scale
        });

        taskCounter.created++;
        updateSwotStatusWhenFinished(taskCounter, entries.length);
      }
    });
  });
}

function createSwotPerImageTasks(
  dwCol,
  n,
  aoi,
  entry,
  windowInfo,
  classIds,
  productText,
  scale,
  maxTasks,
  taskCounter,
  totalEntries
) {
  var remainingAllowed = maxTasks - taskCounter.created;

  if (remainingAllowed <= 0) {
    taskCounter.stop = true;
    statusLabel.setValue(
      'Reached Max tasks limit: ' + maxTasks +
      '. Some SWOT windows were not exported.'
    );
    return;
  }

  var exportCount = Math.min(n, remainingAllowed);

  var limitedCol = dwCol.limit(exportCount);
  var ids = limitedCol.aggregate_array('system:index');

  ids.evaluate(function(idList) {
    if (taskCounter.stop) {
      return;
    }

    idList.forEach(function(imageId) {
      if (taskCounter.created >= maxTasks) {
        taskCounter.stop = true;
        return;
      }

      var image = ee.Image(
        dwCol.filter(ee.Filter.eq('system:index', imageId)).first()
      );

      var out = makeDwSingleImageOutput(
        image,
        classIds,
        productText,
        aoi
      )
      .set({
        swot_date: entry.dateText,
        swot_filename: entry.filename,
        window_start: windowInfo.startText,
        window_end_inclusive: windowInfo.endInclusiveText,
        dw_system_index: imageId
      });

      var name = sanitizeName(
        swotPrefixBox.getValue() +
        '_SWOT_' +
        entry.dateLabel +
        '_DW_' +
        imageId
      );

      exportImage({
        image: out,
        region: aoi,
        description: name,
        target: swotTargetSelect.getValue(),
        driveFolder: swotDriveFolderBox.getValue(),
        assetCollection: swotAssetCollectionBox.getValue(),
        scale: scale
      });

      taskCounter.created++;
    });

    updateSwotStatusWhenFinished(taskCounter, totalEntries);
  });
}

function updateSwotStatusWhenFinished(taskCounter, totalEntries) {
  if (taskCounter.stop) {
    return;
  }

  if (totalEntries !== null && taskCounter.checked < totalEntries) {
    statusLabel.setValue(
      'Checked ' + taskCounter.checked + ' SWOT dates. ' +
      'Created ' + taskCounter.created + ' export tasks so far...'
    );
    return;
  }

  statusLabel.setValue(
    'Created ' + taskCounter.created +
    ' SWOT-window export tasks. Open the Tasks tab to run them.'
  );
}

function parseSwotFilenameText(text) {
  text = String(text);

  // Finds the first acquisition timestamp in each SWOT filename.
  // Example:
  // SWOT_L2_HR_PIXC_037_249_150L_20250819T054027_20250819T054038_PID0_01.nc.parquet
  var regex = /(SWOT[^\s,;]+?_(\d{8})T\d{6}_[^\s,;]*?\.parquet)/g;

  var entries = [];
  var seen = {};
  var match;

  while ((match = regex.exec(text)) !== null) {
    var filename = match[1];
    var ymd = match[2];

    if (!seen[filename]) {
      seen[filename] = true;

      entries.push({
        filename: filename,
        ymd: ymd,
        dateLabel: ymd,
        dateText: ymd.substring(0, 4) + '-' + ymd.substring(4, 6) + '-' + ymd.substring(6, 8)
      });
    }
  }

  // Fallback: if only raw timestamps were pasted, extract those too.
  if (entries.length === 0) {
    var dateRegex = /(\d{8})T\d{6}/g;
    var dateMatch;

    while ((dateMatch = dateRegex.exec(text)) !== null) {
      var ymdOnly = dateMatch[1];

      if (!seen[ymdOnly]) {
        seen[ymdOnly] = true;

        entries.push({
          filename: 'timestamp_' + ymdOnly,
          ymd: ymdOnly,
          dateLabel: ymdOnly,
          dateText: ymdOnly.substring(0, 4) + '-' + ymdOnly.substring(4, 6) + '-' + ymdOnly.substring(6, 8)
        });
      }
    }
  }

  entries.sort(function(a, b) {
    if (a.ymd < b.ymd) {
      return -1;
    }

    if (a.ymd > b.ymd) {
      return 1;
    }

    return 0;
  });

  return entries;
}

function makeSwotWindowInfo(entry, beforeDays, afterDays) {
  var date = parseYMD(entry.dateText);

  var startDate = addDaysUTC(date, -beforeDays);
  var endInclusiveDate = addDaysUTC(date, afterDays);
  var endExclusiveDate = addDaysUTC(endInclusiveDate, 1);

  return {
    startText: formatYMD(startDate),
    endInclusiveText: formatYMD(endInclusiveDate),
    endExclusiveText: formatYMD(endExclusiveDate)
  };
}

// ------------------------------------------------------
// Export helper
// ------------------------------------------------------

function exportImage(args) {
  // Some calls pass a generic Earth Engine computed object rather than an
  // object exposing image methods directly. Wrap it explicitly as ee.Image
  // before casting/exporting.
  var image = ee.Image(args.image).toByte();
  var region = args.region;
  var description = sanitizeName(args.description);
  var target = args.target;
  var driveFolder = args.driveFolder;
  var assetCollection = args.assetCollection;
  var scale = args.scale;

  if (target === 'Google Drive') {
    Export.image.toDrive({
      image: image,
      description: description,
      folder: driveFolder,
      fileNamePrefix: description,
      region: region,
      scale: scale,
      maxPixels: 1e13
    });
  }

  if (target === 'Earth Engine Asset ImageCollection') {
    var assetRoot = removeTrailingSlash(assetCollection);
    var assetId = assetRoot + '/' + description;

    Export.image.toAsset({
      image: image,
      description: description,
      assetId: assetId,
      region: region,
      scale: scale,
      maxPixels: 1e13
    });
  }
}

// ------------------------------------------------------
// Date helpers
// ------------------------------------------------------

function getMonthInfos(startText, endText) {
  var start = parseYMD(startText);
  var endInclusive = parseYMD(endText);
  var endExclusive = addDaysUTC(endInclusive, 1);

  var cursor = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    1
  ));

  var infos = [];

  while (cursor.getTime() < endExclusive.getTime()) {
    var nextMonth = new Date(Date.UTC(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      1
    ));

    var filterStartDate = maxDateUTC(cursor, start);
    var filterEndDate = minDateUTC(nextMonth, endExclusive);

    if (filterStartDate.getTime() < filterEndDate.getTime()) {
      var y = cursor.getUTCFullYear();
      var m = cursor.getUTCMonth() + 1;

      infos.push({
        label: y + '_' + pad2(m),
        filterStart: formatYMD(filterStartDate),
        filterEnd: formatYMD(filterEndDate)
      });
    }

    cursor = nextMonth;
  }

  return infos;
}

function parseYMD(text) {
  var parts = String(text).split('-');

  return new Date(Date.UTC(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  ));
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function maxDateUTC(a, b) {
  if (a.getTime() >= b.getTime()) {
    return a;
  }

  return b;
}

function minDateUTC(a, b) {
  if (a.getTime() <= b.getTime()) {
    return a;
  }

  return b;
}

function formatYMD(date) {
  return (
    date.getUTCFullYear() +
    '-' +
    pad2(date.getUTCMonth() + 1) +
    '-' +
    pad2(date.getUTCDate())
  );
}

function pad2(number) {
  number = Number(number);
  return number < 10 ? '0' + number : String(number);
}

// ------------------------------------------------------
// Small UI / string helpers
// ------------------------------------------------------

function makeLegendRow(color, name) {
  var colorBox = ui.Label({
    style: {
      backgroundColor: '#' + color,
      padding: '8px',
      margin: '0 6px 4px 0'
    }
  });

  var description = ui.Label({
    value: name,
    style: {margin: '0 0 4px 0'}
  });

  return ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.flow('horizontal')
  });
}

function sanitizeName(name) {
  name = String(name);

  return name
    .replace(/[^\w]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
}

function removeTrailingSlash(text) {
  text = String(text);

  while (text.slice(-1) === '/') {
    text = text.slice(0, -1);
  }

  return text;
}
