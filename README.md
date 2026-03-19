# Totum Revolutum

## LanSenView highlights

`GEE/LanSenView.js` provides an Earth Engine imagery explorer with:
- Point or polygon AOI filtering.
- Current-date lookback or tailored start/end date filtering.
- Grouped-by-date mosaics for Sentinel-2, Landsat 4/5/7/8/9, and Sentinel-1.
- Water detection tools for optical and SAR imagery.
- Sentinel-1 reducer layers in the Results tab.
- A highlight-optimized natural color visualization for Sentinel-2 and Landsat natural-color rendering.

## Highlight-optimized natural color

A new visualization option inspired by the Sentinel Hub “Highlight Optimized Natural Color” script is available for:
- Sentinel-2 as `Highlight Optimized Natural Color (4,3,2)`.
- Landsat as `Highlight Optimized Natural Color (L8/9: 4,3,2 | L4-7: 3,2,1)`.

Implementation notes:
- Sentinel-2 / Landsat TOA variants apply the tone-mapping style on top-of-atmosphere reflectance.
- Sentinel-2 SR / Landsat SR variants apply the same transform without the extra offset used for TOA imagery.
- Landsat uses harmonized common-color bands so the option stays visually consistent across Landsat 4/5/7/8/9.
