// Main panel
var gotoPanel = ui.Panel({
  style: {
    position: 'top-right',
    padding: '8px',
    width: '260px'
  }
});

gotoPanel.add(ui.Label({
  value: 'Go to coordinates',
  style: {
    fontWeight: 'bold',
    fontSize: '14px',
    margin: '0 0 4px 0'
  }
}));

// Text box
var coordInput = ui.Textbox({
  placeholder: 'lon, lat (e.g. -1.621681, 43.147862)',
  style: {stretch: 'horizontal'}
});

gotoPanel.add(coordInput);

// Label
var statusLabel = ui.Label({
  value: '',
  style: {fontSize: '11px', color: 'gray'}
});
gotoPanel.add(statusLabel);

// Point
var pointLayerName = 'GoTo Point';

// Parse and move
var goToCoords = function() {
  var text = coordInput.getValue();
  if (!text) {
    statusLabel.setValue('Enter lon, lat.');
    return;
  }

  // separate
  var parts = text.split(/[,\s]+/).filter(function(p) { return p !== ''; });
  if (parts.length < 2) {
    statusLabel.setValue('Format: lon, lat');
    return;
  }

  var lon = parseFloat(parts[0]);
  var lat = parseFloat(parts[1]);

  if (isNaN(lon) || isNaN(lat)) {
    statusLabel.setValue('Could not read numbers. Use: lon, lat');
    return;
  }
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    statusLabel.setValue('Out of bounds. Check lon/lat order.');
    return;
  }

  // create and center
  var pt = ee.Geometry.Point([lon, lat]);
  Map.setCenter(lon, lat, 14);  // Ajusta zoom si quieres

  // remove previous
  var layers = Map.layers();
  for (var i = layers.length - 1; i >= 0; i--) {
    if (layers.get(i).getName() === pointLayerName) {
      Map.layers().remove(layers.get(i));
    }
  }

  // add new
  var ptVis = ee.FeatureCollection([ee.Feature(pt)]);
  Map.addLayer(ptVis, {color: 'red', pointRadius: 6}, pointLayerName);

  statusLabel.setValue('Centered at: ' + lon.toFixed(6) + ', ' + lat.toFixed(6));
};

// button
var goButton = ui.Button({
  label: 'Go',
  onClick: goToCoords,
  style: {stretch: 'horizontal', margin: '4px 0 0 0'}
});

gotoPanel.add(goButton);

// add
Map.add(gotoPanel);
