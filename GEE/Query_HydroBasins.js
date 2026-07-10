/**** Interactive HydroBASINS Attribute Explorer
 *
 * Google Earth Engine JavaScript
 *
 * Select a HydroBASINS level, click a basin, and inspect
 * all of its attributes.
 *
 * Dataset pattern:
 * WWF/HydroSHEDS/v1/Basins/hybas_1
 * ...
 * WWF/HydroSHEDS/v1/Basins/hybas_12
 ****/


// =========================================================
// Configuration
// =========================================================

var DEFAULT_LEVEL = 4;

var basinStyle = {
  color: '2C7FB8',
  width: 1,
  fillColor: '2C7FB820'
};

var selectedStyle = {
  color: 'FFFF00',
  width: 3,
  fillColor: 'FF000040'
};


// =========================================================
// Application state
// =========================================================

var currentLevel = DEFAULT_LEVEL;
var currentBasins = ee.FeatureCollection([]);

// Use an empty Earth Engine collection instead of null.
// ui.Map.Layer and setEeObject do not accept null.
var emptyCollection = ee.FeatureCollection([]);


// =========================================================
// Map layers
// =========================================================

var basinLayer = ui.Map.Layer(
  emptyCollection,
  {},
  'HydroBASINS'
);

var selectedLayer = ui.Map.Layer(
  emptyCollection,
  {},
  'Selected basin'
);


// =========================================================
// Map setup
// =========================================================

Map.clear();
Map.setOptions('HYBRID');
Map.setCenter(0, 20, 3);
Map.style().set('cursor', 'crosshair');

Map.layers().add(basinLayer);
Map.layers().add(selectedLayer);


// =========================================================
// Attribute panel
// =========================================================

var attributePanel = ui.Panel({
  style: {
    position: 'bottom-right',
    width: '420px',
    maxHeight: '500px',
    padding: '10px'
  }
});


function resetAttributePanel(message) {
  attributePanel.clear();

  attributePanel.add(
    ui.Label('Basin attributes', {
      fontSize: '18px',
      fontWeight: 'bold',
      margin: '0 0 8px 0'
    })
  );

  attributePanel.add(
    ui.Label(message, {
      color: '666666',
      whiteSpace: 'normal'
    })
  );
}


resetAttributePanel(
  'Select a HydroBASINS level, then click inside a basin.'
);


// =========================================================
// Control panel
// =========================================================

var controlPanel = ui.Panel({
  style: {
    position: 'top-left',
    width: '340px',
    padding: '10px'
  }
});

var titleLabel = ui.Label('HydroBASINS Explorer', {
  fontSize: '20px',
  fontWeight: 'bold',
  margin: '0 0 8px 0'
});

var instructionsLabel = ui.Label(
  'Choose a HydroBASINS level and click inside a watershed ' +
  'polygon to view its attributes.',
  {
    whiteSpace: 'normal',
    margin: '0 0 10px 0'
  }
);


// Build selector options for levels 1 through 12.

var levelItems = [];

for (var level = 1; level <= 12; level++) {
  levelItems.push({
    label: 'HydroBASINS level ' + level,
    value: String(level)
  });
}


var levelSelect = ui.Select({
  items: levelItems,
  value: String(DEFAULT_LEVEL),
  placeholder: 'Select a basin level',
  style: {
    stretch: 'horizontal'
  }
});


var datasetLabel = ui.Label('', {
  fontSize: '11px',
  color: '555555',
  whiteSpace: 'normal',
  margin: '8px 0 4px 0'
});


var statusLabel = ui.Label('Loading dataset...', {
  color: '555555',
  whiteSpace: 'normal',
  margin: '5px 0'
});


var clearButton = ui.Button({
  label: 'Clear selected basin',
  style: {
    stretch: 'horizontal',
    margin: '8px 0 0 0'
  },

  onClick: function() {
    selectedLayer.setEeObject(emptyCollection);

    resetAttributePanel(
      'Click inside a basin to display its attributes.'
    );

    statusLabel.setValue('Selection cleared.');
  }
});


var zoomButton = ui.Button({
  label: 'Zoom to current HydroBASINS layer',
  style: {
    stretch: 'horizontal',
    margin: '5px 0 0 0'
  },

  onClick: function() {
    if (currentBasins !== null) {
      Map.centerObject(currentBasins);
    }
  }
});


controlPanel.add(titleLabel);
controlPanel.add(instructionsLabel);

controlPanel.add(
  ui.Label('Basin level:', {
    fontWeight: 'bold'
  })
);

controlPanel.add(levelSelect);
controlPanel.add(datasetLabel);
controlPanel.add(statusLabel);
controlPanel.add(clearButton);
controlPanel.add(zoomButton);

Map.add(controlPanel);
Map.add(attributePanel);


// =========================================================
// Property display helpers
// =========================================================

function formatValue(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}


function addPropertyRow(name, value) {
  var row = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {
      stretch: 'horizontal',
      margin: '1px 0'
    }
  });

  var nameLabel = ui.Label(name, {
    width: '130px',
    fontWeight: 'bold',
    fontSize: '11px'
  });

  var valueLabel = ui.Label(value, {
    stretch: 'horizontal',
    fontSize: '11px',
    whiteSpace: 'normal'
  });

  row.add(nameLabel);
  row.add(valueLabel);

  attributePanel.add(row);
}


function displayProperties(properties, longitude, latitude) {
  attributePanel.clear();

  attributePanel.add(
    ui.Label('Selected basin', {
      fontSize: '18px',
      fontWeight: 'bold',
      margin: '0 0 5px 0'
    })
  );

  attributePanel.add(
    ui.Label(
      'HydroBASINS level ' + currentLevel +
      '\nClicked coordinate: ' +
      longitude.toFixed(5) + ', ' +
      latitude.toFixed(5),
      {
        whiteSpace: 'pre',
        color: '555555',
        margin: '0 0 8px 0'
      }
    )
  );

  // Show the most commonly used HydroBASINS attributes first.

  var preferredOrder = [
    'HYBAS_ID',
    'NEXT_DOWN',
    'NEXT_SINK',
    'MAIN_BAS',
    'DIST_SINK',
    'DIST_MAIN',
    'SUB_AREA',
    'UP_AREA',
    'PFAF_ID',
    'ENDO',
    'COAST',
    'ORDER',
    'SORT'
  ];

  var displayed = {};

  preferredOrder.forEach(function(propertyName) {
    if (
      Object.prototype.hasOwnProperty.call(
        properties,
        propertyName
      )
    ) {
      addPropertyRow(
        propertyName,
        formatValue(properties[propertyName])
      );

      displayed[propertyName] = true;
    }
  });

  // Display any remaining properties alphabetically.

  Object.keys(properties)
    .sort()
    .forEach(function(propertyName) {
      if (!displayed[propertyName]) {
        addPropertyRow(
          propertyName,
          formatValue(properties[propertyName])
        );
      }
    });
}


// =========================================================
// Load HydroBASINS level
// =========================================================

function loadBasinLevel(level) {
  currentLevel = Number(level);

  var assetId =
    'WWF/HydroSHEDS/v1/Basins/hybas_' +
    currentLevel;

  currentBasins = ee.FeatureCollection(assetId);

  datasetLabel.setValue('Dataset: ' + assetId);
  statusLabel.setValue(
    'Loading HydroBASINS level ' + currentLevel + '...'
  );

  // Style the complete basin collection.

  var styledBasins = currentBasins.style(basinStyle);

  basinLayer.setEeObject(styledBasins);
  basinLayer.setName(
    'HydroBASINS level ' + currentLevel
  );

  // Clear the previous selected basin.

  selectedLayer.setEeObject(emptyCollection);

  resetAttributePanel(
    'HydroBASINS level ' + currentLevel +
    ' is active. Click inside a basin.'
  );

  // Report the number of basin polygons.

  currentBasins.size().evaluate(function(count, error) {
    if (error) {
      statusLabel.setValue(
        'Could not load the dataset: ' + error
      );
      return;
    }

    statusLabel.setValue(
      'Level ' + currentLevel +
      ' loaded: ' +
      Number(count).toLocaleString() +
      ' basin polygons.'
    );
  });
}


// Change the collection when the selector changes.

levelSelect.onChange(function(level) {
  loadBasinLevel(level);
});


// =========================================================
// Query basin on map click
// =========================================================

Map.onClick(function(coords) {
  var clickedLongitude = coords.lon;
  var clickedLatitude = coords.lat;

  var clickedPoint = ee.Geometry.Point([
    clickedLongitude,
    clickedLatitude
  ]);

  statusLabel.setValue(
    'Querying ' +
    clickedLongitude.toFixed(5) + ', ' +
    clickedLatitude.toFixed(5) + '...'
  );

  // Find the basin intersecting the clicked coordinate.
  // At each HydroBASINS level, normally only one polygon should
  // contain the point.

  var matchingBasins = currentBasins
    .filterBounds(clickedPoint)
    .limit(1);

  matchingBasins.size().evaluate(function(count, countError) {
    if (countError) {
      statusLabel.setValue(
        'Query failed: ' + countError
      );
      return;
    }

    if (count === 0) {
      selectedLayer.setEeObject(emptyCollection);

      attributePanel.clear();

      attributePanel.add(
        ui.Label('No basin found', {
          fontSize: '18px',
          fontWeight: 'bold',
          margin: '0 0 8px 0'
        })
      );

      attributePanel.add(
        ui.Label(
          'No HydroBASINS polygon was found at:\n' +
          clickedLongitude.toFixed(5) + ', ' +
          clickedLatitude.toFixed(5),
          {
            whiteSpace: 'pre',
            color: '666666'
          }
        )
      );

      statusLabel.setValue(
        'No basin found at the clicked location.'
      );

      return;
    }

    var selectedFeature = ee.Feature(
      matchingBasins.first()
    );

    var selectedCollection = ee.FeatureCollection([
      selectedFeature
    ]);

    // Highlight selected basin.

    selectedLayer.setEeObject(
      selectedCollection.style(selectedStyle)
    );

    // Retrieve all feature attributes for the UI panel.

    selectedFeature
      .toDictionary()
      .evaluate(function(properties, propertyError) {
        if (propertyError) {
          statusLabel.setValue(
            'Could not retrieve attributes: ' +
            propertyError
          );
          return;
        }

        displayProperties(
          properties,
          clickedLongitude,
          clickedLatitude
        );

        var basinId =
          properties.HYBAS_ID !== undefined
            ? properties.HYBAS_ID
            : 'unknown';

        statusLabel.setValue(
          'Selected HYBAS_ID: ' + basinId
        );

        // Print the selected feature in the Console as well.

        print(
          'Selected HydroBASINS level ' +
          currentLevel +
          ' feature',
          selectedFeature
        );

        print(
          'Selected basin properties',
          properties
        );
      });
  });
});


// =========================================================
// Initial load
// =========================================================

loadBasinLevel(DEFAULT_LEVEL);
