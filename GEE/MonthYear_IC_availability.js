// Replace this with your ImageCollection
var col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');

// Add date properties to each image
var colWithDates = col.map(function(image) {
  var date = image.date();

  return image.set({
    year: date.get('year'),
    month: date.get('month'),
    year_month: date.format('YYYY-MM')
  });
});

// Unique available years
var years = ee.List(colWithDates.aggregate_array('year'))
  .distinct()
  .sort();

// Unique available months across the whole collection
var months = ee.List(colWithDates.aggregate_array('month'))
  .distinct()
  .sort();

// Unique available year-month combinations
var yearMonths = ee.List(colWithDates.aggregate_array('year_month'))
  .distinct()
  .sort();

print('Available years:', years);
print('Available months:', months);
print('Available year-months:', yearMonths);
