// ===============================
// Interactive Area Calculator
// ===============================

/*
  Interactive Area Calculator for Google Earth Engine
  ---------------------------------------------------
  Author: Iban Ameztoy (2025)
  License: MIT

  Description
  -----------
  This script adds a simple UI panel and uses the built-in Drawing Tools
  to interactively calculate the geodesic area of user-drawn polygons.
  Areas are reported in square meters (m²), hectares (ha), and square
  kilometers (km²).

  How to Use
  ----------
  1. Open this script in the Earth Engine Code Editor.
  2. A control panel will appear in the top-right corner.
  3. Use the drawing toolbar (polygon tool) to draw a geometry on the map.
  4. Click "Calculate area" in the panel:
     - The area of the drawn polygon will be computed and displayed.
     - Any previous result is overwritten.
  5. Click "Clear geometry" to:
     - Remove the current polygon from the map.
     - Reset the area display.
     - Re-enable drawing mode for a new polygon.

  Notes
  -----
  - Area is computed geodesically on the WGS84 ellipsoid 
    using geometry.area({maxError: 1}).
  - The script is designed for one polygon at a time, but it can be
    easily extended for multiple geometries if needed.
*/



// Use the built-in drawing tools
var drawingTools = Map.drawingTools();
drawingTools.setShown(true);          // Show the drawing toolbar
drawingTools.setLinked(false);        // Avoid linking to other maps (if any)
drawingTools.setShape('polygon');     // Default drawing shape
drawingTools.draw();                  // Start in drawing mode

// Helper: clear all drawn geometries
function clearGeometries() {
  var layers = drawingTools.layers();
  var n = layers.length();
  for (var i = 0; i < n; i++) {
    var layer = layers.get(0);        // Always remove index 0
    drawingTools.layers().remove(layer);
  }
}

// ===============================
// UI widgets
// ===============================

var title = ui.Label({
  value: 'Interactive Area Calculator',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}
});

var instructions = ui.Label({
  value: '1) Draw a polygon with the drawing tools.\n' +
         '2) Click "Calculate area".\n' +
         '3) Use "Clear geometry" to remove it and draw a new one.',
  style: {fontSize: '11px', margin: '0 0 6px 0'}
});

var resultLabel = ui.Label({
  value: 'Area: (no geometry yet)',
  style: {fontSize: '12px', whiteSpace: 'pre'}
});

// Button: Calculate area
var calcButton = ui.Button({
  label: 'Calculate area',
  onClick: function() {
    var layers = drawingTools.layers();
    if (layers.length() === 0) {
      resultLabel.setValue('Area: draw a geometry first.');
      return;
    }
    
    // Take the first (and usually only) drawn geometry
    var layer = layers.get(0);
    var geom = ee.Geometry(layer.getEeObject());
    
    // Compute areas (geodesic)
    var area_m2  = geom.area({maxError: 1});
    var area_ha  = area_m2.divide(10000);
    var area_km2 = area_m2.divide(1e6);
    
    // Evaluate on the client and update the label
    var dict = ee.Dictionary({
      'm2': area_m2,
      'ha': area_ha,
      'km2': area_km2
    });
    
    dict.evaluate(function(values) {
      if (!values) {
        resultLabel.setValue('Error computing area.');
        return;
      }
      var text =
        'Area:\n' +
        values.m2.toFixed(0)   + ' m²\n' +
        values.ha.toFixed(2)   + ' ha\n' +
        values.km2.toFixed(4)  + ' km²';
      resultLabel.setValue(text);
    });
  },
  style: {stretch: 'horizontal', margin: '4px 0 2px 0'}
});

// Button: Clear geometry
var clearButton = ui.Button({
  label: 'Clear geometry',
  onClick: function() {
    clearGeometries();
    resultLabel.setValue('Area: (geometry cleared)');
    // Optionally re-enable drawing mode immediately
    drawingTools.setShape('polygon');
    drawingTools.draw();
  },
  style: {stretch: 'horizontal', margin: '2px 0 6px 0'}
});

// Panel arrangement
var panel = ui.Panel({
  widgets: [title, instructions, calcButton, clearButton, resultLabel],
  style: {
    position: 'top-right',
    padding: '8px',
    width: '260px'
  }
});

ui.root.insert(0, panel);

// Optional: initial map view
//Map.setCenter(0, 0, 2);
