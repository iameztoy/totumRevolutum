# -*- coding: utf-8 -*-
"""
CEMS Rapid Mapping Browser - ArcGIS Pro Python Toolbox v1.3

Purpose
-------
Query any public Copernicus Emergency Management Service (CEMS) Rapid Mapping
activation (e.g. EMSR927), list its available published assets, allow the user
to select one or more of them from ArcGIS Pro, load supported layers, and/or
download the underlying public files.

Supported inventory entries
---------------------------
- COG imagery published in products[].layers[] with format == "cog"
- Vector tile layers published in products[].layers[] with format == "vt"
  * If the API exposes a GeoJSON URL in layer["json"], the vector data can be
    loaded into ArcGIS Pro.
  * If no GeoJSON URL is exposed, the layer is still listed, but this toolbox
    does not guess the undocumented vector-tile URL template.
- Product ZIPs: products[].downloadPath
- AOI baseline ZIPs: aois[].blpPath
- Activation-wide ZIP: productsPath

COG loading
-----------
COGs are streamed from the public S3 bucket using an anonymous ArcGIS Cloud
Storage Connection (.acs) with AWS_NO_SIGN_REQUEST=TRUE. This avoids the
"Possible credentials issue" seen when addDataFromPath() is given the raw
amazonaws.com HTTPS URL.

The direct HTTPS URL is still reconstructed and reported/exported so the COG
can also be downloaded in a browser or by this toolbox.

Vector loading in v1.3
----------------------
CEMS GeoJSON vectors are downloaded to a per-activation cache and converted
with JSONToFeatures into a persistent file geodatabase stored below the ArcGIS
Pro project home folder:

    <project home>/CEMS/<EMSRxxx>/CEMS_<EMSRxxx>.gdb

When the CEMS API exposes an SLD, v1.3 downloads and parses it and translates
the common CEMS/OGC styling rules into ArcGIS Pro symbology.

Unlike v1.2, v1.3 does not require every rule to map directly to an ArcGIS
unique-value field expression. It evaluates the SLD filters against each local
feature, stores the matched SLD rule in a helper field, and symbolizes on that
rule field. This supports substantially more OGC Filter constructs, including:
- PropertyIsEqualTo / PropertyIsNotEqualTo
- PropertyIsLessThan / LessThanOrEqualTo
- PropertyIsGreaterThan / GreaterThanOrEqualTo
- PropertyIsBetween
- PropertyIsLike
- PropertyIsNull / PropertyIsNil
- AND / OR / NOT combinations
- Simple styles and ElseFilter rules
- Polygon fill/stroke colours, opacity and stroke width
- Line colour, opacity and width
- Point fill/stroke colour, size, and best-effort standard marker shape

The persistent feature class receives helper fields CEMS_SLD_R and
CEMS_SLD_L containing the matched rule identifier and rule label. If an SLD
uses an unsupported expression or symbolizer, the toolbox leaves the geometry
loaded and emits a warning instead of inventing a replacement style.

Scene handling in v1.3
----------------------
Vector layers can optionally be forced to ON_THE_GROUND after loading. This is
the recommended setting for CEMS crisis mapping vectors in ArcGIS Pro scenes,
because the GeoJSON geometries are normally 2D thematic features rather than
true Z-aware 3D features.

Installation
------------
1. Save this file as CEMS_Rapid_Mapping_Browser.pyt
2. In ArcGIS Pro > Catalog > Toolboxes > Add Toolbox.
3. Select this .pyt file.
4. Open "Browse CEMS Rapid Mapping Activation".
5. Enter an activation code, for example EMSR927.
6. Choose AOI/category filters and select one or more assets.
7. Choose Load, Download, Load + Download, or Inventory only.
"""

import arcpy
import csv
import json
import os
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

API_ENDPOINTS = [
    "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/",
    "https://mapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/",
]

USER_AGENT = "ArcGISPro-CEMS-Rapid-Mapping-Browser/1.3"

ACTION_LOAD = "Load selected layers"
ACTION_DOWNLOAD = "Download selected files"
ACTION_BOTH = "Load + download selected"
ACTION_INVENTORY = "Inventory only"

CATEGORY_ALL = "All assets"
CATEGORY_COG = "COG imagery"
CATEGORY_VECTOR = "Vector layers"
CATEGORY_PACKAGES = "Download packages"


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _http_json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _download_file(url, out_path, timeout=120):
    """Download a public URL to a local file."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        with open(out_path, "wb") as dst:
            shutil.copyfileobj(response, dst)

    return str(out_path)


def _normalize_code(value):
    return (value or "").strip().upper()


def _safe_filename(text, replacement="_"):
    text = str(text or "")
    text = re.sub(r'[<>:"/\\|?*]+', replacement, text)
    text = re.sub(r"\s+", replacement, text)
    text = re.sub(r"_+", "_", text)
    return text.strip("._") or "file"


def _safe_gdb_name(text):
    text = re.sub(r"[^A-Za-z0-9_]+", "_", str(text or "layer"))
    text = re.sub(r"_+", "_", text).strip("_")
    if not text:
        text = "layer"
    if text[0].isdigit():
        text = "L_" + text
    return text[:120]


def _product_tag(product):
    ptype = (product.get("type") or "PRODUCT").upper()
    if product.get("monitoring"):
        try:
            n = int(product.get("monitoringNumber") or 0)
        except Exception:
            n = 0
        return "{} MONIT{:02d}".format(ptype, n)
    return "{} PRODUCT".format(ptype)


def _aoi_tag(aoi):
    try:
        n = int(aoi.get("number"))
        num = "AOI{:02d}".format(n)
    except Exception:
        num = "AOI{}".format(aoi.get("number", "?"))
    name = (aoi.get("name") or "").strip()
    return "{} - {}".format(num, name) if name else num


def _resolve_url(base_url, value):
    """Return an absolute URL for an API-provided path/URL."""
    if not value:
        return ""
    value = str(value).strip()
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme in ("http", "https"):
        return value

    if not base_url:
        return value

    # Treat relative values as object keys under the public cloud base.
    return _object_url(base_url, value)


def _object_url(base_url, object_key):
    """Construct a browser/download URL for an object under aws_bucket."""
    if not base_url or not object_key:
        return ""

    base = str(base_url).rstrip("/")
    key = str(object_key).lstrip("/")

    # Quote object-key characters but preserve slashes.
    key = urllib.parse.quote(key, safe="/._-~")
    return base + "/" + key


def _parse_s3_bucket_region(aws_bucket_url):
    """
    Parse normal S3 virtual-hosted URLs such as:
      https://rapidmapping-viewer.s3.eu-west-1.amazonaws.com

    Also handles:
      https://bucket.s3.amazonaws.com
      https://s3.eu-west-1.amazonaws.com/bucket
    """
    if not aws_bucket_url:
        return None, None

    parsed = urllib.parse.urlparse(aws_bucket_url)
    host = (parsed.hostname or "").lower()
    path_parts = [p for p in parsed.path.split("/") if p]

    # bucket.s3.region.amazonaws.com
    m = re.match(r"^(?P<bucket>.+?)\.s3[.-](?P<region>[^.]+)\.amazonaws\.com$", host)
    if m:
        return m.group("bucket"), m.group("region")

    # bucket.s3.amazonaws.com
    m = re.match(r"^(?P<bucket>.+?)\.s3\.amazonaws\.com$", host)
    if m:
        return m.group("bucket"), ""

    # s3.region.amazonaws.com/bucket
    m = re.match(r"^s3[.-](?P<region>[^.]+)\.amazonaws\.com$", host)
    if m and path_parts:
        return path_parts[0], m.group("region")

    # s3.amazonaws.com/bucket
    if host == "s3.amazonaws.com" and path_parts:
        return path_parts[0], ""

    return None, None


def _get_project_home():
    try:
        aprx = arcpy.mp.ArcGISProject("CURRENT")
        if aprx.homeFolder:
            return aprx.homeFolder
    except Exception:
        pass

    if arcpy.env.scratchFolder:
        return arcpy.env.scratchFolder

    return tempfile.gettempdir()


def _get_active_map():
    aprx = arcpy.mp.ArcGISProject("CURRENT")
    m = aprx.activeMap
    if m is None:
        maps = aprx.listMaps()
        if not maps:
            raise RuntimeError("The current ArcGIS Pro project does not contain a map.")
        m = maps[0]
    return aprx, m


def _get_or_create_group(map_obj, name):
    for lyr in map_obj.listLayers():
        try:
            if lyr.isGroupLayer and lyr.name == name:
                return lyr
        except Exception:
            pass
    return map_obj.createGroupLayer(name)


def _move_layer_into_group(map_obj, group_layer, layer):
    """
    addDataFromPath() first creates a root layer. Copy it into the group and
    then remove the root-level occurrence.
    """
    try:
        map_obj.addLayerToGroup(group_layer, layer, "BOTTOM")
        map_obj.removeLayer(layer)
    except Exception:
        # If grouping fails, leave the layer at map root rather than losing it.
        pass


def _parameter_values(param):
    """Return selected strings from a multivalue GPString parameter."""
    try:
        vals = param.values
        if vals:
            return [str(v) for v in vals]
    except Exception:
        pass

    text = param.valueAsText
    if not text:
        return []

    # ArcGIS uses semicolon-separated text for multiValue parameters.
    vals = []
    for part in text.split(";"):
        part = part.strip().strip("'").strip('"')
        if part:
            vals.append(part)
    return vals


# ---------------------------------------------------------------------------
# CEMS API and inventory
# ---------------------------------------------------------------------------

def fetch_activation(code):
    code = _normalize_code(code)
    if not re.match(r"^EMSR\d+$", code):
        raise ValueError("Activation code must look like EMSR927.")

    last_error = None

    for base in API_ENDPOINTS:
        url = base + "?code=" + urllib.parse.quote(code)
        try:
            data = _http_json(url)
            results = data.get("results") or []
            if not results:
                raise RuntimeError("No public activation found for {}.".format(code))

            # Prefer an exact code match in case the API ever returns >1 result.
            for item in results:
                if _normalize_code(item.get("code")) == code:
                    return item

            return results[0]

        except Exception as exc:
            last_error = exc

    raise RuntimeError(
        "Could not query the CEMS Rapid Mapping API for {}. Last error: {}".format(
            code, last_error
        )
    )


def build_inventory(activation):
    """
    Build one normalized inventory for both the UI and the execution phase.
    """
    code = _normalize_code(activation.get("code"))
    activation_name = activation.get("name") or ""
    aws_bucket = activation.get("aws_bucket") or ""

    rows = []
    counter = 0

    def add_row(**kwargs):
        nonlocal counter
        counter += 1
        kwargs["index"] = counter
        kwargs["code"] = code
        kwargs["activation_name"] = activation_name
        rows.append(kwargs)

    # Activation-wide products ZIP
    if activation.get("productsPath"):
        url = activation.get("productsPath")
        add_row(
            asset_type="ACTIVATION_ZIP",
            category=CATEGORY_PACKAGES,
            format="zip",
            aoi_number="",
            aoi_name="",
            product_type="",
            product_tag="",
            monitoring=False,
            monitoring_number="",
            version="",
            name=os.path.basename(urllib.parse.urlparse(url).path) or "{}_products.zip".format(code),
            key="",
            direct_url=url,
            json_url="",
            sld_url="",
            loadable=False,
            downloadable=True,
            source_images="",
        )

    for aoi in activation.get("aois") or []:
        aoi_number = aoi.get("number")
        aoi_name = aoi.get("name") or ""

        # AOI baseline product ZIP
        if aoi.get("blpPath"):
            url = aoi.get("blpPath")
            add_row(
                asset_type="BASELINE_ZIP",
                category=CATEGORY_PACKAGES,
                format="zip",
                aoi_number=aoi_number,
                aoi_name=aoi_name,
                product_type="BLP",
                product_tag="BASELINE",
                monitoring=False,
                monitoring_number="",
                version="",
                name=os.path.basename(urllib.parse.urlparse(url).path) or "AOI{}_BLP.zip".format(aoi_number),
                key="",
                direct_url=url,
                json_url="",
                sld_url="",
                loadable=False,
                downloadable=True,
                source_images="",
            )

        for product in aoi.get("products") or []:
            ptype = product.get("type") or ""
            ptag = _product_tag(product)
            monitoring = bool(product.get("monitoring"))
            monitoring_number = product.get("monitoringNumber")
            version_obj = product.get("version") or {}
            version = version_obj.get("number", "")

            source_images = []
            for img in product.get("images") or []:
                bits = [
                    str(img.get("sensorName") or "").strip(),
                    str(img.get("acquisitionTime") or "").strip(),
                    str(img.get("fileName") or "").strip(),
                ]
                bits = [b for b in bits if b]
                if bits:
                    source_images.append(" | ".join(bits))
            source_images_text = " || ".join(source_images)

            # Individual map layers
            for layer in product.get("layers") or []:
                fmt = (layer.get("format") or "").lower().strip()
                key = layer.get("name") or ""
                base_name = os.path.basename(str(key).rstrip("/")) or str(key)

                if fmt == "cog":
                    direct_url = _object_url(aws_bucket, key)
                    asset_type = "COG"
                    category = CATEGORY_COG
                    loadable = bool(key and aws_bucket)
                    downloadable = bool(direct_url)
                    json_url = _resolve_url(aws_bucket, layer.get("json"))
                    sld_url = _resolve_url(aws_bucket, layer.get("sld"))

                elif fmt == "vt":
                    json_url = _resolve_url(aws_bucket, layer.get("json"))
                    sld_url = _resolve_url(aws_bucket, layer.get("sld"))
                    asset_type = "VECTOR"
                    category = CATEGORY_VECTOR

                    # The VT "name" is generally a tileset/prefix, not necessarily
                    # a single downloadable file. Use the API-provided GeoJSON when
                    # available rather than inventing a tile template.
                    direct_url = json_url
                    loadable = bool(json_url)
                    downloadable = bool(json_url or sld_url)

                else:
                    # Keep unknown formats visible for future API evolution.
                    direct_url = _object_url(aws_bucket, key) if key else ""
                    json_url = _resolve_url(aws_bucket, layer.get("json"))
                    sld_url = _resolve_url(aws_bucket, layer.get("sld"))
                    asset_type = "LAYER_{}".format(fmt.upper() if fmt else "UNKNOWN")
                    category = CATEGORY_VECTOR
                    loadable = bool(json_url)
                    downloadable = bool(direct_url or json_url or sld_url)

                add_row(
                    asset_type=asset_type,
                    category=category,
                    format=fmt,
                    aoi_number=aoi_number,
                    aoi_name=aoi_name,
                    product_type=ptype,
                    product_tag=ptag,
                    monitoring=monitoring,
                    monitoring_number=monitoring_number,
                    version=version,
                    name=base_name,
                    key=key,
                    direct_url=direct_url,
                    json_url=json_url,
                    sld_url=sld_url,
                    loadable=loadable,
                    downloadable=downloadable,
                    source_images=source_images_text,
                )

            # Per-product ZIP
            if product.get("downloadPath"):
                url = product.get("downloadPath")
                add_row(
                    asset_type="PRODUCT_ZIP",
                    category=CATEGORY_PACKAGES,
                    format="zip",
                    aoi_number=aoi_number,
                    aoi_name=aoi_name,
                    product_type=ptype,
                    product_tag=ptag,
                    monitoring=monitoring,
                    monitoring_number=monitoring_number,
                    version=version,
                    name=os.path.basename(urllib.parse.urlparse(url).path) or "{}.zip".format(ptag.replace(" ", "_")),
                    key="",
                    direct_url=url,
                    json_url="",
                    sld_url="",
                    loadable=False,
                    downloadable=True,
                    source_images=source_images_text,
                )

    # Build unique, human-readable labels for ArcGIS Pro's multivalue dropdown.
    for row in rows:
        try:
            aoi_text = "AOI{:02d}".format(int(row["aoi_number"])) if row["aoi_number"] != "" else "ALL"
        except Exception:
            aoi_text = "AOI{}".format(row["aoi_number"]) if row["aoi_number"] != "" else "ALL"

        aoi_name = row.get("aoi_name") or ""
        if aoi_name:
            aoi_text += " " + aoi_name

        context = row.get("product_tag") or row.get("product_type") or ""
        if context:
            context = " | " + context

        row["label"] = "{:03d} | {} | {}{} | {}".format(
            row["index"],
            row["asset_type"],
            aoi_text,
            context,
            row["name"],
        )

    return rows


def filter_inventory(rows, aoi_filter, category_filter):
    out = []

    for row in rows:
        if aoi_filter and aoi_filter != "ALL":
            try:
                wanted = int(aoi_filter.split("|", 1)[0].replace("AOI", "").strip())
                if row.get("aoi_number") == "":
                    # Activation-wide asset is not an AOI-specific match.
                    continue
                if int(row.get("aoi_number")) != wanted:
                    continue
            except Exception:
                pass

        if category_filter and category_filter != CATEGORY_ALL:
            if row.get("category") != category_filter:
                continue

        out.append(row)

    return out


def inventory_aoi_choices(activation):
    values = ["ALL"]
    for aoi in activation.get("aois") or []:
        try:
            n = int(aoi.get("number"))
            tag = "AOI{:02d}".format(n)
        except Exception:
            tag = "AOI{}".format(aoi.get("number"))
        name = (aoi.get("name") or "").strip()
        values.append("{} | {}".format(tag, name) if name else tag)
    return values



# ---------------------------------------------------------------------------
# Persistent vector workspace, SLD parsing and ArcGIS symbology translation
# ---------------------------------------------------------------------------

def ensure_activation_workspace(activation):
    """
    Create/reuse a persistent workspace for one activation.

    Returns a dict with:
      root        - activation folder
      gdb         - persistent file geodatabase
      geojson_dir - cached source GeoJSON files
      sld_dir     - cached source SLD files
    """
    code = _normalize_code(activation.get("code"))
    if not code:
        raise RuntimeError("Activation has no code.")

    root = os.path.join(_get_project_home(), "CEMS", code)
    geojson_dir = os.path.join(root, "cache", "geojson")
    sld_dir = os.path.join(root, "cache", "sld")

    os.makedirs(geojson_dir, exist_ok=True)
    os.makedirs(sld_dir, exist_ok=True)

    gdb_name = "CEMS_{}.gdb".format(code)
    gdb = os.path.join(root, gdb_name)

    if not arcpy.Exists(gdb):
        arcpy.AddMessage("Creating activation geodatabase: {}".format(gdb))
        arcpy.management.CreateFileGDB(root, gdb_name)

    return {
        "root": root,
        "gdb": gdb,
        "geojson_dir": geojson_dir,
        "sld_dir": sld_dir,
    }


def _xml_local_name(tag):
    """Strip an XML namespace from an ElementTree tag."""
    if not tag:
        return ""
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _first_descendant(element, local_names):
    if isinstance(local_names, str):
        local_names = {local_names}
    else:
        local_names = set(local_names)

    for child in element.iter():
        if _xml_local_name(child.tag) in local_names:
            return child
    return None


def _descendant_text(element, local_names, default=""):
    child = _first_descendant(element, local_names)
    if child is None or child.text is None:
        return default
    return child.text.strip()


def _parameter_dict(element):
    """
    Read SLD 1.0 CssParameter and SE 1.1 SvgParameter entries.
    """
    result = {}
    for child in element.iter():
        lname = _xml_local_name(child.tag)
        if lname not in ("CssParameter", "SvgParameter"):
            continue
        name = (child.attrib.get("name") or "").strip().lower()
        if not name:
            continue
        value = (child.text or "").strip()
        result[name] = value
    return result


def _to_float(value, default=None):
    try:
        return float(str(value).strip())
    except Exception:
        return default


def _opacity_to_alpha(value, default=100):
    """
    ArcGIS arcpy.mp colour dictionaries use alpha in the range 0..100.
    SLD opacity normally uses 0..1.
    """
    if value in (None, ""):
        return int(default)

    val = _to_float(value, None)
    if val is None:
        return int(default)

    if val <= 1:
        val *= 100.0

    return int(max(0, min(100, round(val))))


def _parse_sld_color(value, alpha=100):
    """
    Convert common SLD colours to an ArcGIS RGB dictionary.
    Returns None if the colour cannot be interpreted.
    """
    if not value:
        return None

    value = str(value).strip()

    # #RGB and #RRGGBB
    if value.startswith("#"):
        raw = value[1:]
        if len(raw) == 3:
            raw = "".join(ch * 2 for ch in raw)
        if len(raw) == 6:
            try:
                r = int(raw[0:2], 16)
                g = int(raw[2:4], 16)
                b = int(raw[4:6], 16)
                return {"RGB": [r, g, b, int(alpha)]}
            except Exception:
                return None

    # rgb(r,g,b)
    m = re.match(
        r"^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$",
        value,
        re.IGNORECASE,
    )
    if m:
        return {
            "RGB": [
                max(0, min(255, int(m.group(1)))),
                max(0, min(255, int(m.group(2)))),
                max(0, min(255, int(m.group(3)))),
                int(alpha),
            ]
        }

    # Small defensive set for named colours occasionally found in styles.
    named = {
        "black": (0, 0, 0),
        "white": (255, 255, 255),
        "red": (255, 0, 0),
        "green": (0, 128, 0),
        "blue": (0, 0, 255),
        "yellow": (255, 255, 0),
        "orange": (255, 165, 0),
        "gray": (128, 128, 128),
        "grey": (128, 128, 128),
    }
    rgb = named.get(value.lower())
    if rgb:
        return {"RGB": [rgb[0], rgb[1], rgb[2], int(alpha)]}

    return None


def _parse_filter_operand(node):
    """
    Parse an OGC/SE expression operand used by comparison filters.

    Supported operands:
      PropertyName / ValueReference
      Literal

    More elaborate OGC expressions (Function, arithmetic expressions, etc.)
    are deliberately not guessed.
    """
    lname = _xml_local_name(node.tag)

    if lname in ("PropertyName", "ValueReference"):
        name = (node.text or "").strip()
        if not name:
            return None, False
        return {"type": "property", "name": name}, True

    if lname == "Literal":
        return {"type": "literal", "value": (node.text or "")}, True

    return None, False


def _first_direct_child(element, local_name):
    for child in list(element):
        if _xml_local_name(child.tag) == local_name:
            return child
    return None


def _first_expression_child(element):
    """
    Return the first direct child that can act as a property/literal operand.
    """
    for child in list(element):
        if _xml_local_name(child.tag) in (
            "PropertyName",
            "ValueReference",
            "Literal",
        ):
            return child
    return None


def _parse_binary_comparison(node, operator):
    operands = []
    for child in list(node):
        if _xml_local_name(child.tag) in (
            "PropertyName",
            "ValueReference",
            "Literal",
        ):
            operand, ok = _parse_filter_operand(child)
            if not ok:
                return None, False
            operands.append(operand)

    if len(operands) != 2:
        return None, False

    return {
        "op": operator,
        "left": operands[0],
        "right": operands[1],
        "match_case": str(node.attrib.get("matchCase", "true")).lower() != "false",
    }, True


def _parse_filter_expression(node):
    """
    Parse a practical OGC Filter/SE expression tree used by CEMS SLDs.

    Returns:
      (expression_ast, supported_bool)
    """
    lname = _xml_local_name(node.tag)

    # Logical operators ------------------------------------------------
    if lname in ("And", "Or"):
        args = []
        for child in list(node):
            expr, ok = _parse_filter_expression(child)
            if not ok:
                return None, False
            args.append(expr)
        if not args:
            return None, False
        return {"op": lname.upper(), "args": args}, True

    if lname == "Not":
        children = list(node)
        if len(children) != 1:
            return None, False
        expr, ok = _parse_filter_expression(children[0])
        if not ok:
            return None, False
        return {"op": "NOT", "arg": expr}, True

    # Binary comparisons -----------------------------------------------
    comparison_map = {
        "PropertyIsEqualTo": "EQ",
        "PropertyIsNotEqualTo": "NE",
        "PropertyIsLessThan": "LT",
        "PropertyIsLessThanOrEqualTo": "LE",
        "PropertyIsGreaterThan": "GT",
        "PropertyIsGreaterThanOrEqualTo": "GE",
    }

    if lname in comparison_map:
        return _parse_binary_comparison(node, comparison_map[lname])

    # Between ----------------------------------------------------------
    if lname == "PropertyIsBetween":
        prop_node = None
        for child in list(node):
            if _xml_local_name(child.tag) in ("PropertyName", "ValueReference"):
                prop_node = child
                break

        lower = _first_direct_child(node, "LowerBoundary")
        upper = _first_direct_child(node, "UpperBoundary")

        if prop_node is None or lower is None or upper is None:
            return None, False

        prop, ok = _parse_filter_operand(prop_node)
        if not ok:
            return None, False

        lower_child = _first_expression_child(lower)
        upper_child = _first_expression_child(upper)

        if lower_child is None or upper_child is None:
            return None, False

        low, ok1 = _parse_filter_operand(lower_child)
        high, ok2 = _parse_filter_operand(upper_child)

        if not (ok1 and ok2):
            return None, False

        return {
            "op": "BETWEEN",
            "value": prop,
            "lower": low,
            "upper": high,
        }, True

    # LIKE -------------------------------------------------------------
    if lname == "PropertyIsLike":
        prop_node = None
        literal_node = None

        for child in list(node):
            child_name = _xml_local_name(child.tag)
            if child_name in ("PropertyName", "ValueReference") and prop_node is None:
                prop_node = child
            elif child_name == "Literal" and literal_node is None:
                literal_node = child

        if prop_node is None or literal_node is None:
            return None, False

        prop, ok1 = _parse_filter_operand(prop_node)
        pattern, ok2 = _parse_filter_operand(literal_node)

        if not (ok1 and ok2):
            return None, False

        return {
            "op": "LIKE",
            "value": prop,
            "pattern": pattern,
            "wildcard": node.attrib.get("wildCard", "*"),
            "single_char": node.attrib.get("singleChar", "?"),
            "escape_char": node.attrib.get("escapeChar", "\\"),
            "match_case": str(node.attrib.get("matchCase", "true")).lower() != "false",
        }, True

    # NULL / NIL -------------------------------------------------------
    if lname in ("PropertyIsNull", "PropertyIsNil"):
        operand_node = None
        for child in list(node):
            if _xml_local_name(child.tag) in ("PropertyName", "ValueReference"):
                operand_node = child
                break

        if operand_node is None:
            return None, False

        operand, ok = _parse_filter_operand(operand_node)
        if not ok:
            return None, False

        return {
            "op": "ISNULL",
            "value": operand,
        }, True

    return None, False


def _parse_rule_filter(rule):
    """
    Return:
      filter_expr, is_else, supported
    """
    for child in list(rule):
        lname = _xml_local_name(child.tag)

        if lname == "ElseFilter":
            return None, True, True

        if lname == "Filter":
            children = list(child)
            if not children:
                return None, False, False
            expression, supported = _parse_filter_expression(children[0])
            return expression, False, supported

    # No filter means an unconditional/simple rule.
    return None, False, True


def _collect_filter_properties(expr):
    """
    Return the ordered set of PropertyName/ValueReference names used by an AST.
    """
    found = []

    def add(name):
        if name and name not in found:
            found.append(name)

    def walk(node):
        if not isinstance(node, dict):
            return

        if node.get("type") == "property":
            add(node.get("name"))
            return

        for key, value in node.items():
            if isinstance(value, dict):
                walk(value)
            elif isinstance(value, list):
                for item in value:
                    walk(item)

    walk(expr)
    return found


def _operand_value(operand, attributes):
    if operand is None:
        return None

    if operand.get("type") == "literal":
        return operand.get("value")

    if operand.get("type") == "property":
        return attributes.get(operand.get("name"))

    return None


def _coerce_comparable_pair(a, b):
    """
    Prefer numeric comparison when both sides can be converted to floats;
    otherwise compare as strings.
    """
    if a is None or b is None:
        return a, b, "null"

    try:
        return float(a), float(b), "number"
    except Exception:
        return str(a), str(b), "string"


def _compare_values(a, b, operator, match_case=True):
    if operator in ("EQ", "NE"):
        if a is None or b is None:
            equal = (a is None and b is None)
        else:
            aa, bb, kind = _coerce_comparable_pair(a, b)
            if kind == "string" and not match_case:
                aa = aa.lower()
                bb = bb.lower()
            equal = aa == bb
        return equal if operator == "EQ" else not equal

    if a is None or b is None:
        return False

    aa, bb, kind = _coerce_comparable_pair(a, b)

    if kind == "string" and not match_case:
        aa = aa.lower()
        bb = bb.lower()

    if operator == "LT":
        return aa < bb
    if operator == "LE":
        return aa <= bb
    if operator == "GT":
        return aa > bb
    if operator == "GE":
        return aa >= bb

    return False


def _sld_like_to_regex(pattern, wildcard="*", single_char="?", escape_char="\\"):
    """
    Translate an OGC PropertyIsLike pattern to a Python regular expression.
    """
    pattern = "" if pattern is None else str(pattern)
    wildcard = wildcard or "*"
    single_char = single_char or "?"
    escape_char = escape_char or "\\"

    parts = ["^"]
    i = 0

    while i < len(pattern):
        ch = pattern[i]

        if ch == escape_char and i + 1 < len(pattern):
            i += 1
            parts.append(re.escape(pattern[i]))

        elif ch == wildcard:
            parts.append(".*")

        elif ch == single_char:
            parts.append(".")

        else:
            parts.append(re.escape(ch))

        i += 1

    parts.append("$")
    return "".join(parts)


def _evaluate_filter_expression(expr, attributes):
    """
    Evaluate a supported SLD filter AST against one feature's attributes.
    """
    if expr is None:
        return True

    op = expr.get("op")

    if op == "AND":
        return all(_evaluate_filter_expression(x, attributes) for x in expr["args"])

    if op == "OR":
        return any(_evaluate_filter_expression(x, attributes) for x in expr["args"])

    if op == "NOT":
        return not _evaluate_filter_expression(expr["arg"], attributes)

    if op in ("EQ", "NE", "LT", "LE", "GT", "GE"):
        left = _operand_value(expr["left"], attributes)
        right = _operand_value(expr["right"], attributes)
        return _compare_values(
            left,
            right,
            op,
            match_case=expr.get("match_case", True),
        )

    if op == "BETWEEN":
        value = _operand_value(expr["value"], attributes)
        lower = _operand_value(expr["lower"], attributes)
        upper = _operand_value(expr["upper"], attributes)

        if value is None or lower is None or upper is None:
            return False

        vv, ll, kind1 = _coerce_comparable_pair(value, lower)
        vv2, uu, kind2 = _coerce_comparable_pair(value, upper)

        # If one pair is numeric and the other string, fall back to strings.
        if kind1 != kind2:
            vv = str(value)
            ll = str(lower)
            uu = str(upper)
        else:
            vv = vv2 if kind2 == "number" else vv

        return ll <= vv <= uu

    if op == "LIKE":
        value = _operand_value(expr["value"], attributes)
        pattern = _operand_value(expr["pattern"], attributes)

        if value is None or pattern is None:
            return False

        flags = 0 if expr.get("match_case", True) else re.IGNORECASE
        regex = _sld_like_to_regex(
            pattern,
            expr.get("wildcard", "*"),
            expr.get("single_char", "?"),
            expr.get("escape_char", "\\"),
        )
        return re.match(regex, str(value), flags=flags) is not None

    if op == "ISNULL":
        value = _operand_value(expr["value"], attributes)
        return value is None

    return False




def _parse_symbolizer(rule, geometry_type):
    """
    Translate one SLD/SE symbolizer into a normalized dictionary.
    """
    wanted = {
        "POINT": "PointSymbolizer",
        "MULTIPOINT": "PointSymbolizer",
        "POLYLINE": "LineSymbolizer",
        "POLYGON": "PolygonSymbolizer",
    }.get(geometry_type)

    symbolizer = None

    if wanted:
        for child in rule.iter():
            if _xml_local_name(child.tag) == wanted:
                symbolizer = child
                break

    if symbolizer is None:
        # Fall back to the first supported symbolizer rather than failing the
        # entire SLD. This is useful for a few generic CEMS styles.
        for child in rule.iter():
            if _xml_local_name(child.tag) in (
                "PointSymbolizer",
                "LineSymbolizer",
                "PolygonSymbolizer",
            ):
                symbolizer = child
                break

    if symbolizer is None:
        return None

    kind = _xml_local_name(symbolizer.tag)
    spec = {"kind": kind}

    if kind == "PolygonSymbolizer":
        fill = _first_descendant(symbolizer, "Fill")
        stroke = _first_descendant(symbolizer, "Stroke")

        fill_params = _parameter_dict(fill) if fill is not None else {}
        stroke_params = _parameter_dict(stroke) if stroke is not None else {}

        fill_alpha = _opacity_to_alpha(
            fill_params.get("fill-opacity"),
            100,
        )
        stroke_alpha = _opacity_to_alpha(
            stroke_params.get("stroke-opacity"),
            100,
        )

        spec["fill_color"] = _parse_sld_color(
            fill_params.get("fill"),
            fill_alpha,
        )
        spec["outline_color"] = _parse_sld_color(
            stroke_params.get("stroke"),
            stroke_alpha,
        )
        spec["outline_width"] = _to_float(
            stroke_params.get("stroke-width"),
            None,
        )

    elif kind == "LineSymbolizer":
        stroke = _first_descendant(symbolizer, "Stroke")
        params = _parameter_dict(stroke) if stroke is not None else {}

        alpha = _opacity_to_alpha(
            params.get("stroke-opacity"),
            100,
        )

        spec["line_color"] = _parse_sld_color(
            params.get("stroke"),
            alpha,
        )
        spec["line_width"] = _to_float(
            params.get("stroke-width"),
            None,
        )

    elif kind == "PointSymbolizer":
        graphic = _first_descendant(symbolizer, "Graphic")
        mark = _first_descendant(symbolizer, "Mark")
        external_graphic = _first_descendant(symbolizer, "ExternalGraphic")
        fill = _first_descendant(mark, "Fill") if mark is not None else None
        stroke = _first_descendant(mark, "Stroke") if mark is not None else None

        fill_params = _parameter_dict(fill) if fill is not None else {}
        stroke_params = _parameter_dict(stroke) if stroke is not None else {}

        spec["well_known_name"] = _descendant_text(
            mark if mark is not None else symbolizer,
            "WellKnownName",
            "",
        )
        spec["external_graphic"] = external_graphic is not None

        size_text = _descendant_text(
            graphic if graphic is not None else symbolizer,
            "Size",
            "",
        )
        spec["size"] = _to_float(size_text, None)

        fill_alpha = _opacity_to_alpha(
            fill_params.get("fill-opacity"),
            100,
        )
        stroke_alpha = _opacity_to_alpha(
            stroke_params.get("stroke-opacity"),
            100,
        )

        spec["fill_color"] = _parse_sld_color(
            fill_params.get("fill"),
            fill_alpha,
        )
        spec["outline_color"] = _parse_sld_color(
            stroke_params.get("stroke"),
            stroke_alpha,
        )
        spec["outline_width"] = _to_float(
            stroke_params.get("stroke-width"),
            None,
        )

    return spec


def parse_sld_style(sld_path, geometry_type):
    """
    Parse the common SLD/SE styling pattern used by CEMS Rapid Mapping.
    """
    root = ET.parse(sld_path).getroot()
    rules = []

    rule_index = 0

    for rule in root.iter():
        if _xml_local_name(rule.tag) != "Rule":
            continue

        symbol = _parse_symbolizer(rule, geometry_type)
        if symbol is None:
            continue

        rule_index += 1

        title = _descendant_text(rule, "Title", "")
        name = _descendant_text(rule, "Name", "")
        label = title or name or "Rule {}".format(rule_index)

        filter_expr, is_else, supported_filter = _parse_rule_filter(rule)

        rules.append(
            {
                "rule_id": "R{:03d}".format(rule_index),
                "label": label,
                "filter_expr": filter_expr,
                "is_else": is_else,
                "supported_filter": supported_filter,
                "symbol": symbol,
            }
        )

    if not rules:
        raise RuntimeError("The SLD contains no supported Rule/Symbolizer entries.")

    return rules


def _resolve_field_name(feature_class, requested):
    """
    Resolve an SLD PropertyName against ArcGIS field names/aliases.
    """
    if not requested:
        return None

    requested = str(requested).strip()
    wanted = re.sub(r"[^a-z0-9]", "", requested.lower())

    for fld in arcpy.ListFields(feature_class):
        candidates = [
            fld.name,
            getattr(fld, "aliasName", "") or "",
        ]
        for candidate in candidates:
            if candidate.lower() == requested.lower():
                return fld.name
            if re.sub(r"[^a-z0-9]", "", candidate.lower()) == wanted:
                return fld.name

    return None


def _values_equal(actual, literal):
    """
    Compare ArcGIS renderer values with SLD literals while tolerating numeric
    text formatting differences such as 1 vs 1.0.
    """
    if actual is None:
        return literal in (None, "", "null", "NULL")

    a = str(actual).strip()
    b = str(literal).strip()

    if a == b:
        return True

    try:
        return float(a) == float(b)
    except Exception:
        return False


def _ensure_text_field(feature_class, field_name, length=255):
    existing = {f.name.upper(): f for f in arcpy.ListFields(feature_class)}
    if field_name.upper() not in existing:
        arcpy.management.AddField(
            feature_class,
            field_name,
            "TEXT",
            field_length=length,
        )
    return field_name


def _classify_features_by_sld_rules(feature_class, rules):
    """
    Evaluate CEMS SLD filters feature-by-feature and persist the matched rule.

    Two helper fields are created/reused:
      CEMS_SLD_R  -> compact rule id (R001, R002, ...)
      CEMS_SLD_L  -> human-readable SLD rule label

    Rule order follows the SLD document. ElseFilter is used only when no
    non-else rule matches.
    """
    rule_field = _ensure_text_field(feature_class, "CEMS_SLD_R", 32)
    label_field = _ensure_text_field(feature_class, "CEMS_SLD_L", 255)

    normal_rules = [r for r in rules if not r["is_else"]]
    else_rules = [r for r in rules if r["is_else"]]
    else_rule = else_rules[0] if else_rules else None

    requested_fields = []
    for rule in normal_rules:
        for requested in _collect_filter_properties(rule.get("filter_expr")):
            if requested not in requested_fields:
                requested_fields.append(requested)

    field_pairs = []
    for requested in requested_fields:
        resolved = _resolve_field_name(feature_class, requested)
        if not resolved:
            raise RuntimeError(
                "SLD field {!r} was not found in the converted feature class.".format(
                    requested
                )
            )
        field_pairs.append((requested, resolved))

    cursor_fields = [resolved for _, resolved in field_pairs]
    cursor_fields += [rule_field, label_field]

    counts = {r["rule_id"]: 0 for r in rules}
    unmatched = 0

    with arcpy.da.UpdateCursor(feature_class, cursor_fields) as cursor:
        for row in cursor:
            attributes = {}
            for i, (requested, _resolved) in enumerate(field_pairs):
                attributes[requested] = row[i]

            matched_rule = None

            for rule in normal_rules:
                expr = rule.get("filter_expr")

                # No filter = unconditional rule.
                if expr is None:
                    matched_rule = rule
                    break

                if _evaluate_filter_expression(expr, attributes):
                    matched_rule = rule
                    break

            if matched_rule is None:
                matched_rule = else_rule

            rule_idx = len(cursor_fields) - 2
            label_idx = len(cursor_fields) - 1

            if matched_rule is not None:
                row[rule_idx] = matched_rule["rule_id"]
                row[label_idx] = matched_rule.get("label") or matched_rule["rule_id"]
                counts[matched_rule["rule_id"]] += 1
            else:
                row[rule_idx] = None
                row[label_idx] = None
                unmatched += 1

            cursor.updateRow(row)

    return rule_field, label_field, counts, unmatched


def _renderer_item_value(item):
    """
    Extract the first value from an ArcGIS UniqueValueRenderer item.
    """
    try:
        values = item.values
        if not values:
            return None
        first_row = values[0]
        if isinstance(first_row, (list, tuple)):
            return first_row[0] if first_row else None
        return first_row
    except Exception:
        return None


def _try_apply_point_shape(symbol, well_known_name):
    """
    Best-effort mapping of standard SLD marker names to symbols in the ArcGIS
    project/system gallery. Colour/size are applied afterwards, so a gallery
    symbol is used only to approximate the marker geometry.
    """
    name = (well_known_name or "").strip().lower()
    if not name:
        return

    gallery_candidates = {
        "circle": ["Circle", "Circle 1"],
        "square": ["Square", "Square 1"],
        "triangle": ["Triangle", "Triangle 1"],
        "star": ["Star", "Star 1"],
        "cross": ["Cross", "Cross 1"],
        "x": ["X", "X 1"],
    }.get(name, [well_known_name])

    for candidate in gallery_candidates:
        try:
            matches = symbol.listSymbolsFromGallery(candidate)
            if matches:
                symbol.applySymbolFromGallery(candidate, 0)
                return
        except Exception:
            continue


def _apply_symbol_spec(symbol, spec, geometry_type):
    """
    Apply the normalized SLD symbol specification to an ArcGIS symbol.
    """
    if symbol is None or not spec:
        return

    if geometry_type in ("POINT", "MULTIPOINT"):
        _try_apply_point_shape(symbol, spec.get("well_known_name"))

        if spec.get("fill_color"):
            try:
                symbol.color = spec["fill_color"]
            except Exception:
                pass

        if spec.get("outline_color"):
            try:
                symbol.outlineColor = spec["outline_color"]
            except Exception:
                pass

        if spec.get("outline_width") is not None:
            try:
                symbol.outlineWidth = float(spec["outline_width"])
            except Exception:
                pass

        if spec.get("size") is not None:
            try:
                symbol.size = float(spec["size"])
            except Exception:
                pass

    elif geometry_type == "POLYLINE":
        if spec.get("line_color"):
            try:
                symbol.color = spec["line_color"]
            except Exception:
                pass

        if spec.get("line_width") is not None:
            try:
                symbol.size = float(spec["line_width"])
            except Exception:
                pass

    elif geometry_type == "POLYGON":
        if spec.get("fill_color"):
            try:
                symbol.color = spec["fill_color"]
            except Exception:
                pass

        if spec.get("outline_color"):
            try:
                symbol.outlineColor = spec["outline_color"]
            except Exception:
                pass

        if spec.get("outline_width") is not None:
            try:
                symbol.outlineWidth = float(spec["outline_width"])
            except Exception:
                pass


def _candidate_sld_urls(row):
    """
    Prefer the API-provided SLD URL. As a compatibility fallback for CEMS
    activations where the API exposes the GeoJSON but omits sld, try the
    parallel .sld object name.
    """
    urls = []

    explicit = row.get("sld_url")
    if explicit:
        urls.append(explicit)

    json_url = row.get("json_url")
    if json_url:
        parsed = urllib.parse.urlparse(json_url)
        if parsed.path.lower().endswith(".json"):
            candidate_path = parsed.path[:-5] + ".sld"
            candidate = urllib.parse.urlunparse(
                (
                    parsed.scheme,
                    parsed.netloc,
                    candidate_path,
                    parsed.params,
                    parsed.query,
                    parsed.fragment,
                )
            )
            if candidate not in urls:
                urls.append(candidate)

    return urls


def download_sld_for_row(row, workspace):
    """
    Download the official CEMS SLD, returning (local_path, source_url).
    Returns (None, None) if no candidate can be obtained.
    """
    urls = _candidate_sld_urls(row)
    if not urls:
        return None, None

    stem = _safe_filename(_vector_local_name(row))
    idx = int(row.get("index") or 0)
    local_path = os.path.join(
        workspace["sld_dir"],
        "{:03d}_{}.sld".format(idx, stem),
    )

    last_error = None
    for url in urls:
        try:
            arcpy.AddMessage("Downloading CEMS SLD: {}".format(url))
            _download_file(url, local_path)
            return local_path, url
        except Exception as exc:
            last_error = exc

    if last_error:
        arcpy.AddWarning(
            "Could not retrieve an SLD for {}: {}".format(
                row.get("name"),
                last_error,
            )
        )

    return None, None


def apply_cems_sld_symbology(layer, feature_class, sld_path, geometry_type):
    """
    Translate CEMS SLD rules into ArcGIS Pro symbology.

    v1.3 evaluates supported SLD filters feature-by-feature, stores the matched
    rule id/label in helper fields, and uses that helper rule id as the ArcGIS
    UniqueValueRenderer field. This avoids forcing complex OGC filters into a
    renderer model that only understands direct field values.
    """
    rules = parse_sld_style(sld_path, geometry_type)

    # ExternalGraphic point icons remain intentionally conservative.
    if geometry_type in ("POINT", "MULTIPOINT"):
        if any(r["symbol"].get("external_graphic") for r in rules):
            raise RuntimeError(
                "The CEMS SLD uses ExternalGraphic point icons. v1.3 does not "
                "replace those with an arbitrary ArcGIS symbol; geometry is "
                "loaded correctly but the exact picture-marker icon requires "
                "a CIM picture-marker translation."
            )

    unsupported = [r for r in rules if not r["supported_filter"]]
    if unsupported:
        labels = ", ".join(
            r.get("label") or r.get("rule_id")
            for r in unsupported[:8]
        )
        raise RuntimeError(
            "The SLD contains one or more OGC filter expressions that v1.3 "
            "still cannot evaluate safely. Affected rule(s): {}.".format(labels)
        )

    sym = layer.symbology
    if not hasattr(sym, "renderer"):
        raise RuntimeError("The ArcGIS layer does not expose a supported renderer.")

    conditional = [
        r for r in rules
        if r.get("filter_expr") is not None and not r["is_else"]
    ]
    simple_rules = [
        r for r in rules
        if r.get("filter_expr") is None and not r["is_else"]
    ]

    # A genuinely simple one-rule SLD does not need helper fields.
    if not conditional and len(simple_rules) == 1 and not any(r["is_else"] for r in rules):
        rule = simple_rules[0]
        sym.updateRenderer("SimpleRenderer")
        _apply_symbol_spec(
            sym.renderer.symbol,
            rule["symbol"],
            geometry_type,
        )
        layer.symbology = sym
        return "SLD simple renderer applied"

    rule_field, label_field, counts, unmatched = _classify_features_by_sld_rules(
        feature_class,
        rules,
    )

    # Refresh the symbology object after the feature class schema/data changed.
    sym = layer.symbology
    sym.updateRenderer("UniqueValueRenderer")
    sym.renderer.fields = [rule_field]

    rule_lookup = {r["rule_id"]: r for r in rules}
    styled = 0
    total_items = 0

    for group in sym.renderer.groups:
        for item in group.items:
            total_items += 1
            rule_id = _renderer_item_value(item)
            rule_id = str(rule_id) if rule_id is not None else ""

            rule = rule_lookup.get(rule_id)
            if rule is None:
                continue

            _apply_symbol_spec(
                item.symbol,
                rule["symbol"],
                geometry_type,
            )

            try:
                item.label = rule.get("label") or rule_id
            except Exception:
                pass

            styled += 1

    # Keep unmatched features visible with the ArcGIS default symbol rather
    # than silently dropping them. In a correct CEMS SLD this should normally
    # be zero or handled by ElseFilter.
    try:
        sym.renderer.useDefaultSymbol = True
        sym.renderer.defaultLabel = "No matching CEMS SLD rule"
    except Exception:
        pass

    layer.symbology = sym

    matched_features = sum(counts.values())

    arcpy.AddMessage(
        "CEMS SLD rule classification: {} matched feature(s), {} unmatched.".format(
            matched_features,
            unmatched,
        )
    )

    for rule in rules:
        n = counts.get(rule["rule_id"], 0)
        if n:
            arcpy.AddMessage(
                "  {} | {} | {} feature(s)".format(
                    rule["rule_id"],
                    rule.get("label") or "",
                    n,
                )
            )

    return (
        "SLD rule-based renderer applied "
        "({}/{} renderer classes; {} unmatched feature(s))"
    ).format(
        styled,
        total_items,
        unmatched,
    )




def set_layer_on_ground(layer):
    """
    Best-effort scene handling using ArcGIS Pro's LayerElevation API.
    """
    try:
        elevation = layer.elevation
        elevation.setElevationMode("ON_THE_GROUND")
        return True
    except Exception as exc:
        arcpy.AddMessage(
            "Layer elevation was left unchanged (not a scene/unsupported): {}".format(
                exc
            )
        )
        return False


# ---------------------------------------------------------------------------
# ArcGIS cloud connection and loaders
# ---------------------------------------------------------------------------

def ensure_anonymous_s3_connection(activation):
    aws_bucket_url = activation.get("aws_bucket") or ""
    bucket, region = _parse_s3_bucket_region(aws_bucket_url)

    if not bucket:
        raise RuntimeError(
            "Could not derive an Amazon S3 bucket name from activation['aws_bucket']: {}".format(
                aws_bucket_url
            )
        )

    home = _get_project_home()
    connection_dir = os.path.join(home, "CEMS_cloud_connections")
    os.makedirs(connection_dir, exist_ok=True)

    acs_name = "CEMS_{}_{}.acs".format(
        _safe_filename(bucket),
        _safe_filename(region or "default"),
    )
    acs_path = os.path.join(connection_dir, acs_name)

    if not os.path.exists(acs_path):
        arcpy.AddMessage("Creating anonymous S3 connection: {}".format(acs_path))

        kwargs = dict(
            out_folder_path=connection_dir,
            out_name=acs_name,
            service_provider="AMAZON",
            bucket_name=bucket,
            access_key_id="",
            secret_access_key="",
            region=region or "",
            end_point="",
            config_options="AWS_NO_SIGN_REQUEST TRUE;GDAL_DISABLE_READDIR_ON_OPEN YES",
        )

        arcpy.management.CreateCloudStorageConnectionFile(**kwargs)

    return acs_path


def load_cog(row, activation, map_obj, group_layer):
    acs_path = ensure_anonymous_s3_connection(activation)
    key = row.get("key") or ""
    if not key:
        raise RuntimeError("COG row has no object key.")

    cloud_path = acs_path.replace("\\", "/") + "/" + key.lstrip("/")
    arcpy.AddMessage("Loading COG from S3: {}".format(cloud_path))

    lyr = map_obj.addDataFromPath(cloud_path)

    # Shorter map legend name.
    try:
        lyr.name = "{} | {} | {}".format(
            row.get("asset_type", "COG"),
            row.get("product_tag", ""),
            os.path.basename(row.get("key") or row.get("name") or "COG"),
        )
    except Exception:
        pass

    if group_layer:
        _move_layer_into_group(map_obj, group_layer, lyr)

    return lyr


def _vector_local_name(row):
    stem = os.path.splitext(row.get("name") or "vector")[0]
    stem = re.sub(r"_VT$", "", stem, flags=re.IGNORECASE)
    return _safe_gdb_name(stem)


def _detect_geojson_geometry_type(geojson_path):
    """
    Detect the ArcGIS geometry type required by JSONToFeatures from the first
    non-null geometry in a GeoJSON FeatureCollection.

    CEMS crisis layers are normally homogeneous, but the function also checks
    all features and reports mixed geometry types instead of silently choosing
    an incompatible type.
    """
    with open(geojson_path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise RuntimeError("Downloaded JSON is not a GeoJSON object.")

    top_type = data.get("type")

    if top_type == "FeatureCollection":
        features = data.get("features") or []
        geometry_types = []

        for feature in features:
            if not isinstance(feature, dict):
                continue
            geometry = feature.get("geometry")
            if not geometry:
                continue
            gtype = geometry.get("type")
            if gtype:
                geometry_types.append(gtype)

        if not geometry_types:
            raise RuntimeError(
                "GeoJSON FeatureCollection contains no non-null geometries."
            )

    elif top_type == "Feature":
        geometry = data.get("geometry")
        if not geometry or not geometry.get("type"):
            raise RuntimeError("GeoJSON Feature contains no valid geometry.")
        geometry_types = [geometry.get("type")]

    else:
        # A bare GeoJSON geometry is valid GeoJSON, although CEMS normally
        # publishes FeatureCollections.
        geometry_types = [top_type] if top_type else []

    if not geometry_types:
        raise RuntimeError(
            "Could not determine a geometry type from the downloaded GeoJSON."
        )

    arcgis_map = {
        "Point": "POINT",
        "MultiPoint": "MULTIPOINT",
        "LineString": "POLYLINE",
        "MultiLineString": "POLYLINE",
        "Polygon": "POLYGON",
        "MultiPolygon": "POLYGON",
    }

    mapped = []
    unsupported = []

    for gtype in geometry_types:
        if gtype in arcgis_map:
            mapped.append(arcgis_map[gtype])
        else:
            unsupported.append(gtype)

    if unsupported:
        raise RuntimeError(
            "Unsupported GeoJSON geometry type(s): {}.".format(
                ", ".join(sorted(set(unsupported)))
            )
        )

    unique = sorted(set(mapped))

    # LineString/MultiLineString and Polygon/MultiPolygon intentionally map to
    # the same ArcGIS feature-class geometry type.
    if len(unique) > 1:
        raise RuntimeError(
            "GeoJSON contains mixed ArcGIS geometry types ({}). "
            "A single ArcGIS feature class cannot contain them together.".format(
                ", ".join(unique)
            )
        )

    return unique[0]


def load_vector_geojson(
    row,
    activation,
    map_obj,
    group_layer,
    apply_official_symbology=True,
    drape_on_ground=True,
):
    """
    Download a CEMS GeoJSON layer, convert it into a persistent activation GDB,
    optionally translate/apply its official CEMS SLD, and add it to ArcGIS Pro.
    """
    url = row.get("json_url") or row.get("direct_url")
    if not url:
        raise RuntimeError(
            "This vector layer has no GeoJSON URL in the API, so it cannot be "
            "loaded safely without guessing the vector-tile URL template."
        )

    workspace = ensure_activation_workspace(activation)
    idx = int(row.get("index") or 0)

    # ---------------------------------------------------------------
    # Cache the original CEMS GeoJSON
    # ---------------------------------------------------------------
    local_geojson = os.path.join(
        workspace["geojson_dir"],
        "{:03d}_{}.geojson".format(
            idx,
            _safe_filename(_vector_local_name(row)),
        ),
    )

    arcpy.AddMessage("Downloading CEMS GeoJSON: {}".format(url))
    _download_file(url, local_geojson)

    try:
        with open(local_geojson, "r", encoding="utf-8-sig") as f:
            preview = json.load(f)
    except Exception as exc:
        raise RuntimeError(
            "The downloaded CEMS file is not valid JSON/GeoJSON: {}".format(exc)
        )

    if not isinstance(preview, dict):
        raise RuntimeError("The downloaded CEMS JSON is not a GeoJSON object.")

    geojson_type = preview.get("type")
    if geojson_type not in ("FeatureCollection", "Feature"):
        raise RuntimeError(
            "The downloaded JSON does not look like a CEMS GeoJSON feature "
            "dataset. Top-level type is {!r}.".format(geojson_type)
        )

    geometry_type = _detect_geojson_geometry_type(local_geojson)
    arcpy.AddMessage("Detected GeoJSON geometry type: {}".format(geometry_type))

    # ---------------------------------------------------------------
    # Persistent feature class
    # ---------------------------------------------------------------
    try:
        aoi_num = int(row.get("aoi_number"))
        aoi_token = "AOI{:02d}".format(aoi_num)
    except Exception:
        aoi_token = "AOI{}".format(row.get("aoi_number") or "X")

    product_token = re.sub(
        r"[^A-Za-z0-9]+",
        "_",
        row.get("product_tag") or row.get("product_type") or "PRODUCT",
    ).strip("_")

    fc_name = _safe_gdb_name(
        "{}_{}_{}_{}".format(
            _normalize_code(activation.get("code")),
            aoi_token,
            product_token,
            _vector_local_name(row),
        )
    )
    out_fc = os.path.join(workspace["gdb"], fc_name)

    if arcpy.Exists(out_fc):
        arcpy.AddMessage("Replacing existing feature class: {}".format(out_fc))
        arcpy.management.Delete(out_fc)

    arcpy.AddMessage(
        "Converting GeoJSON to persistent feature class: {}".format(out_fc)
    )

    arcpy.conversion.JSONToFeatures(
        local_geojson,
        out_fc,
        geometry_type,
    )

    if not arcpy.Exists(out_fc):
        raise RuntimeError(
            "JSONToFeatures completed but the output feature class was not created."
        )

    count = int(arcpy.management.GetCount(out_fc)[0])
    arcpy.AddMessage("Features converted: {}".format(count))

    # Record local persistence locations for the inventory CSV.
    row["local_geojson"] = local_geojson
    row["local_dataset"] = out_fc
    row["local_sld"] = ""
    row["symbology_status"] = "not requested"

    # ---------------------------------------------------------------
    # Add to ArcGIS Pro
    # ---------------------------------------------------------------
    lyr = map_obj.addDataFromPath(out_fc)

    try:
        lyr.name = "{} | {} | {}".format(
            row.get("asset_type", "VECTOR"),
            row.get("product_tag", ""),
            _vector_local_name(row),
        )
    except Exception:
        pass

    # ---------------------------------------------------------------
    # Official CEMS SLD -> ArcGIS renderer
    # ---------------------------------------------------------------
    if apply_official_symbology:
        row["symbology_status"] = "SLD not found"

        sld_path, sld_source_url = download_sld_for_row(row, workspace)

        if sld_path:
            row["local_sld"] = sld_path
            if sld_source_url and not row.get("sld_url"):
                row["sld_url"] = sld_source_url

            try:
                status = apply_cems_sld_symbology(
                    lyr,
                    out_fc,
                    sld_path,
                    geometry_type,
                )
                row["symbology_status"] = status
                arcpy.AddMessage("Official CEMS symbology: {}".format(status))
            except Exception as exc:
                row["symbology_status"] = "SLD translation failed: {}".format(exc)
                arcpy.AddWarning(
                    "Layer loaded, but official CEMS SLD could not be fully "
                    "translated: {}".format(exc)
                )

    # ---------------------------------------------------------------
    # Scene elevation
    # ---------------------------------------------------------------
    if drape_on_ground:
        if set_layer_on_ground(lyr):
            arcpy.AddMessage("Scene elevation mode: ON_THE_GROUND")

    if group_layer:
        _move_layer_into_group(map_obj, group_layer, lyr)

    return lyr


# ---------------------------------------------------------------------------
# Download and CSV reporting
# ---------------------------------------------------------------------------

def write_inventory_csv(rows, output_csv):
    fieldnames = [
        "index",
        "code",
        "activation_name",
        "asset_type",
        "category",
        "format",
        "aoi_number",
        "aoi_name",
        "product_type",
        "product_tag",
        "monitoring",
        "monitoring_number",
        "version",
        "name",
        "loadable",
        "downloadable",
        "key",
        "direct_url",
        "json_url",
        "sld_url",
        "source_images",
        "local_geojson",
        "local_sld",
        "local_dataset",
        "symbology_status",
        "label",
    ]

    output_csv = str(output_csv)
    os.makedirs(os.path.dirname(output_csv), exist_ok=True)

    with open(output_csv, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    return output_csv


def download_asset(row, download_folder):
    urls = []

    if row.get("asset_type") == "VECTOR":
        # GeoJSON is the useful downloadable vector representation.
        if row.get("json_url"):
            urls.append(("geojson", row["json_url"]))

        # Preserve style definition separately when the API exposes one.
        if row.get("sld_url"):
            urls.append(("sld", row["sld_url"]))

    else:
        if row.get("direct_url"):
            urls.append(("main", row["direct_url"]))

        # Rarely, a COG or unknown layer may also expose style/JSON sidecars.
        if row.get("json_url") and row.get("json_url") != row.get("direct_url"):
            urls.append(("json", row["json_url"]))
        if row.get("sld_url"):
            urls.append(("sld", row["sld_url"]))

    if not urls:
        raise RuntimeError("No downloadable URL is exposed for this asset.")

    downloaded = []

    for role, url in urls:
        parsed = urllib.parse.urlparse(url)
        name = os.path.basename(parsed.path)

        if not name:
            name = "{}_{}".format(_safe_filename(row.get("name")), role)

        # If a vector endpoint has no useful extension, preserve a sensible one.
        if role == "geojson" and not os.path.splitext(name)[1]:
            name += ".geojson"
        elif role == "sld" and not os.path.splitext(name)[1]:
            name += ".sld"

        # Avoid collisions when GeoJSON/SLD URLs use generic filenames.
        prefix = "{:03d}_".format(int(row.get("index") or 0))
        out_path = os.path.join(download_folder, prefix + _safe_filename(name))

        arcpy.AddMessage("Downloading: {}".format(url))
        _download_file(url, out_path)
        downloaded.append(out_path)

    return downloaded


# ---------------------------------------------------------------------------
# Python Toolbox
# ---------------------------------------------------------------------------

class Toolbox(object):
    def __init__(self):
        self.label = "CEMS Rapid Mapping Browser"
        self.alias = "cemsrapid"
        self.tools = [CEMSActivationBrowser]


class CEMSActivationBrowser(object):
    # Cache API responses while the tool dialog is open, so changing AOI or
    # category does not hit the service again.
    _activation_cache = {}
    _inventory_cache = {}

    def __init__(self):
        self.label = "Browse CEMS Rapid Mapping Activation"
        self.description = (
            "Query a public CEMS Rapid Mapping activation, select published "
            "COGs/vector layers/download packages, load supported layers into "
            "ArcGIS Pro, translate available CEMS SLD symbology, persist vectors "
            "in an activation geodatabase, and export direct download URLs."
        )
        self.canRunInBackground = False

    def getParameterInfo(self):
        p_code = arcpy.Parameter(
            displayName="Activation code",
            name="activation_code",
            datatype="GPString",
            parameterType="Required",
            direction="Input",
        )
        p_code.value = "EMSR927"

        p_aoi = arcpy.Parameter(
            displayName="AOI filter",
            name="aoi_filter",
            datatype="GPString",
            parameterType="Optional",
            direction="Input",
        )
        p_aoi.filter.type = "ValueList"
        p_aoi.filter.list = ["ALL"]
        p_aoi.value = "ALL"

        p_category = arcpy.Parameter(
            displayName="Asset category",
            name="asset_category",
            datatype="GPString",
            parameterType="Optional",
            direction="Input",
        )
        p_category.filter.type = "ValueList"
        p_category.filter.list = [
            CATEGORY_ALL,
            CATEGORY_COG,
            CATEGORY_VECTOR,
            CATEGORY_PACKAGES,
        ]
        p_category.value = CATEGORY_ALL

        p_assets = arcpy.Parameter(
            displayName="Available assets (select one or more)",
            name="assets",
            datatype="GPString",
            parameterType="Optional",
            direction="Input",
            multiValue=True,
        )
        p_assets.filter.type = "ValueList"
        p_assets.filter.list = []

        p_action = arcpy.Parameter(
            displayName="Action",
            name="action",
            datatype="GPString",
            parameterType="Required",
            direction="Input",
        )
        p_action.filter.type = "ValueList"
        p_action.filter.list = [
            ACTION_LOAD,
            ACTION_DOWNLOAD,
            ACTION_BOTH,
            ACTION_INVENTORY,
        ]
        p_action.value = ACTION_LOAD

        p_download = arcpy.Parameter(
            displayName="Download folder",
            name="download_folder",
            datatype="DEFolder",
            parameterType="Optional",
            direction="Input",
        )
        p_download.enabled = False

        p_csv = arcpy.Parameter(
            displayName="Inventory CSV",
            name="inventory_csv",
            datatype="DEFile",
            parameterType="Optional",
            direction="Output",
        )
        p_csv.filter.list = ["csv"]

        p_group = arcpy.Parameter(
            displayName="Place loaded layers in a CEMS group layer",
            name="use_group_layer",
            datatype="GPBoolean",
            parameterType="Optional",
            direction="Input",
        )
        p_group.value = True

        p_symbology = arcpy.Parameter(
            displayName="Apply official CEMS SLD symbology to vectors",
            name="apply_cems_symbology",
            datatype="GPBoolean",
            parameterType="Optional",
            direction="Input",
        )
        p_symbology.value = True

        p_ground = arcpy.Parameter(
            displayName="Drape vector layers on ground in scenes",
            name="drape_vectors_on_ground",
            datatype="GPBoolean",
            parameterType="Optional",
            direction="Input",
        )
        p_ground.value = True

        return [
            p_code,
            p_aoi,
            p_category,
            p_assets,
            p_action,
            p_download,
            p_csv,
            p_group,
            p_symbology,
            p_ground,
        ]

    def _get_cached(self, code):
        code = _normalize_code(code)

        if code not in self._activation_cache:
            activation = fetch_activation(code)
            self._activation_cache[code] = activation
            self._inventory_cache[code] = build_inventory(activation)

        return self._activation_cache[code], self._inventory_cache[code]

    def updateParameters(self, parameters):
        code = _normalize_code(parameters[0].valueAsText)

        # Enable/disable download folder depending on action.
        action = parameters[4].valueAsText or ACTION_LOAD
        parameters[5].enabled = action in (ACTION_DOWNLOAD, ACTION_BOTH)

        # Layer display options only matter for loading.
        parameters[7].enabled = action in (ACTION_LOAD, ACTION_BOTH)
        parameters[8].enabled = action in (ACTION_LOAD, ACTION_BOTH)
        parameters[9].enabled = action in (ACTION_LOAD, ACTION_BOTH)

        if not re.match(r"^EMSR\d+$", code):
            parameters[1].filter.list = ["ALL"]
            parameters[3].filter.list = []
            return

        try:
            activation, inventory = self._get_cached(code)
        except Exception:
            # Avoid throwing network errors repeatedly while the user is still
            # editing parameters. execute() will emit a full error if necessary.
            parameters[1].filter.list = ["ALL"]
            parameters[3].filter.list = []
            return

        # AOI dropdown
        aoi_choices = inventory_aoi_choices(activation)
        parameters[1].filter.list = aoi_choices

        current_aoi = parameters[1].valueAsText or "ALL"
        if current_aoi not in aoi_choices:
            parameters[1].value = "ALL"
            current_aoi = "ALL"

        category = parameters[2].valueAsText or CATEGORY_ALL

        # Dynamic asset list
        visible = filter_inventory(inventory, current_aoi, category)
        labels = [r["label"] for r in visible]
        parameters[3].filter.list = labels

        # Preserve valid user selections if possible.
        current = _parameter_values(parameters[3])
        current_valid = [v for v in current if v in labels]

        if current_valid:
            parameters[3].values = current_valid
        elif labels:
            # Useful default: automatically select all COGs in the current view.
            cog_labels = [r["label"] for r in visible if r["asset_type"] == "COG"]
            parameters[3].values = cog_labels if cog_labels else [labels[0]]

        # Default CSV path per activation.
        if not parameters[6].altered:
            parameters[6].value = os.path.join(
                _get_project_home(),
                "{}_CEMS_asset_inventory.csv".format(code),
            )

    def updateMessages(self, parameters):
        code = _normalize_code(parameters[0].valueAsText)

        if code and not re.match(r"^EMSR\d+$", code):
            parameters[0].setErrorMessage(
                "Use a CEMS Rapid Mapping activation code such as EMSR927."
            )
            return

        action = parameters[4].valueAsText or ACTION_LOAD

        if action in (ACTION_DOWNLOAD, ACTION_BOTH) and not parameters[5].valueAsText:
            parameters[5].setErrorMessage(
                "Choose a download folder for a download action."
            )

        if action != ACTION_INVENTORY and not _parameter_values(parameters[3]):
            parameters[3].setWarningMessage(
                "No assets are currently selected."
            )

    def execute(self, parameters, messages):
        arcpy.env.overwriteOutput = True

        code = _normalize_code(parameters[0].valueAsText)
        aoi_filter = parameters[1].valueAsText or "ALL"
        category = parameters[2].valueAsText or CATEGORY_ALL
        selected_labels = _parameter_values(parameters[3])
        action = parameters[4].valueAsText or ACTION_LOAD
        download_folder = parameters[5].valueAsText
        output_csv = parameters[6].valueAsText
        use_group = bool(parameters[7].value)
        apply_official_symbology = bool(parameters[8].value)
        drape_on_ground = bool(parameters[9].value)

        activation, inventory = self._get_cached(code)
        visible = filter_inventory(inventory, aoi_filter, category)

        # Write a complete activation inventory, not merely the filtered subset.
        if not output_csv:
            output_csv = os.path.join(
                _get_project_home(),
                "{}_CEMS_asset_inventory.csv".format(code),
            )
            parameters[6].value = output_csv

        write_inventory_csv(inventory, output_csv)

        arcpy.AddMessage("")
        arcpy.AddMessage("=" * 72)
        arcpy.AddMessage("{} - {}".format(code, activation.get("name") or ""))
        arcpy.AddMessage("Category: {}".format(activation.get("category") or ""))
        arcpy.AddMessage("AOIs: {}".format(len(activation.get("aois") or [])))
        arcpy.AddMessage("Assets in complete inventory: {}".format(len(inventory)))
        arcpy.AddMessage("Inventory CSV: {}".format(output_csv))
        arcpy.AddMessage("=" * 72)

        # Print the visible list and direct URLs even in Inventory-only mode.
        arcpy.AddMessage("")
        arcpy.AddMessage("AVAILABLE ASSETS / LINKS")
        for row in visible:
            arcpy.AddMessage(row["label"])

            if row.get("direct_url"):
                arcpy.AddMessage("  URL: {}".format(row["direct_url"]))
            elif row.get("asset_type") == "VECTOR":
                arcpy.AddMessage("  URL: no GeoJSON URL exposed by API")

            if row.get("json_url") and row.get("json_url") != row.get("direct_url"):
                arcpy.AddMessage("  GeoJSON: {}".format(row["json_url"]))
            if row.get("sld_url"):
                arcpy.AddMessage("  SLD: {}".format(row["sld_url"]))

        if action == ACTION_INVENTORY:
            arcpy.AddMessage("")
            arcpy.AddMessage("Inventory only: no layers were loaded or downloaded.")
            return

        # Match selected labels back to normalized inventory rows.
        by_label = {r["label"]: r for r in inventory}
        selected_rows = [by_label[v] for v in selected_labels if v in by_label]

        if not selected_rows:
            arcpy.AddWarning("No valid assets were selected.")
            return

        load_requested = action in (ACTION_LOAD, ACTION_BOTH)
        download_requested = action in (ACTION_DOWNLOAD, ACTION_BOTH)

        aprx = None
        map_obj = None
        group = None

        if load_requested:
            aprx, map_obj = _get_active_map()
            if use_group:
                group = _get_or_create_group(map_obj, "CEMS {} - {}".format(
                    code, activation.get("name") or "Activation"
                ))

        if download_requested:
            if not download_folder:
                raise RuntimeError("A download folder is required.")
            os.makedirs(download_folder, exist_ok=True)

        loaded_count = 0
        downloaded_count = 0
        failed = []

        for row in selected_rows:
            arcpy.AddMessage("")
            arcpy.AddMessage("Selected: {}".format(row["label"]))

            # ---------------------------------------------------------------
            # Load
            # ---------------------------------------------------------------
            if load_requested:
                try:
                    if row["asset_type"] == "COG":
                        load_cog(row, activation, map_obj, group)
                        loaded_count += 1

                    elif row["asset_type"] == "VECTOR":
                        if row.get("json_url"):
                            load_vector_geojson(
                                row,
                                activation,
                                map_obj,
                                group,
                                apply_official_symbology=apply_official_symbology,
                                drape_on_ground=drape_on_ground,
                            )
                            loaded_count += 1
                        else:
                            arcpy.AddWarning(
                                "Vector layer not loaded because the API does not "
                                "expose a GeoJSON URL for it: {}".format(row["name"])
                            )

                    else:
                        arcpy.AddMessage(
                            "{} is a download package/non-map asset; nothing to load.".format(
                                row["asset_type"]
                            )
                        )

                except Exception as exc:
                    failed.append(("LOAD", row["label"], str(exc)))
                    arcpy.AddWarning("Load failed: {}".format(exc))

            # ---------------------------------------------------------------
            # Download
            # ---------------------------------------------------------------
            if download_requested:
                try:
                    paths = download_asset(row, download_folder)
                    downloaded_count += len(paths)
                    for p in paths:
                        arcpy.AddMessage("Saved: {}".format(p))
                except Exception as exc:
                    failed.append(("DOWNLOAD", row["label"], str(exc)))
                    arcpy.AddWarning("Download failed: {}".format(exc))

        arcpy.AddMessage("")
        arcpy.AddMessage("=" * 72)
        arcpy.AddMessage("Finished")
        arcpy.AddMessage("Selected assets: {}".format(len(selected_rows)))
        arcpy.AddMessage("Layers loaded: {}".format(loaded_count))
        arcpy.AddMessage("Files downloaded: {}".format(downloaded_count))
        arcpy.AddMessage("Failures/warnings: {}".format(len(failed)))
        arcpy.AddMessage("Inventory CSV: {}".format(output_csv))
        # Re-write after processing so persistent local paths and SLD status are
        # included in the CSV for vectors that were loaded.
        write_inventory_csv(inventory, output_csv)

        arcpy.AddMessage("=" * 72)

        if failed:
            arcpy.AddWarning("")
            arcpy.AddWarning("FAILED OPERATIONS")
            for op, label, error in failed:
                arcpy.AddWarning("{} | {}".format(op, label))
                arcpy.AddWarning("  {}".format(error))
