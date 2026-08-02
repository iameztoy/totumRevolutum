// Compatibility patch for: makeLegendRow is not defined
// Paste this function BEFORE the first line that calls makeLegendRow(...).
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
