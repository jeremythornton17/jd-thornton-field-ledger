import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

KML_NS = "http://www.opengis.net/kml/2.2"
NS = {"k": KML_NS}
ET.register_namespace("", KML_NS)


def k(tag):
    return f"{{{KML_NS}}}{tag}"


def text(parent, tag, value):
    node = ET.SubElement(parent, k(tag))
    node.text = str(value)
    return node


def name_of(node):
    value = node.find("k:name", NS)
    return (value.text or "").strip() if value is not None else ""


def folder(parent, name, visible=True, open_folder=False):
    node = ET.SubElement(parent, k("Folder"))
    text(node, "name", name)
    text(node, "visibility", "1" if visible else "0")
    text(node, "open", "1" if open_folder else "0")
    return node


def parse_coordinates(value):
    points = []
    for token in (value or "").strip().split():
        parts = token.split(",")
        if len(parts) >= 2:
            points.append((float(parts[0]), float(parts[1]), float(parts[2]) if len(parts) > 2 else 0.0))
    return points


def coordinates_text(points):
    return " ".join(f"{lon:.10f},{lat:.10f},{alt:g}" for lon, lat, alt in points)


def geometry(placemark):
    for kind, xpath in (
        ("polygon", ".//k:Polygon//k:outerBoundaryIs/k:LinearRing/k:coordinates"),
        ("line", ".//k:LineString/k:coordinates"),
        ("point", ".//k:Point/k:coordinates"),
    ):
        node = placemark.find(xpath, NS)
        if node is not None:
            return kind, parse_coordinates(node.text)
    return None, []


def centroid(points):
    usable = points[:-1] if len(points) > 2 and points[0][:2] == points[-1][:2] else points
    return (
        sum(point[0] for point in usable) / len(usable),
        sum(point[1] for point in usable) / len(usable),
        0,
    )


def style(document, style_id, line_color, line_width, poly_color=None, label_scale=None, icon_href=None, icon_scale=None):
    node = ET.SubElement(document, k("Style"), {"id": style_id})
    if line_color:
        line = ET.SubElement(node, k("LineStyle"))
        text(line, "color", line_color)
        text(line, "width", line_width)
    if poly_color is not None:
        poly = ET.SubElement(node, k("PolyStyle"))
        text(poly, "color", poly_color)
        text(poly, "fill", "1" if poly_color != "00000000" else "0")
        text(poly, "outline", "1")
    if label_scale is not None:
        label = ET.SubElement(node, k("LabelStyle"))
        text(label, "color", "ffffffff")
        text(label, "scale", label_scale)
    if icon_href is not None or icon_scale is not None:
        icon = ET.SubElement(node, k("IconStyle"))
        text(icon, "scale", icon_scale if icon_scale is not None else 1)
        icon_node = ET.SubElement(icon, k("Icon"))
        text(icon_node, "href", icon_href or "")
    return node


def add_geometry(parent, display_name, kind, points, style_id, description=None, visible=True):
    placemark = ET.SubElement(parent, k("Placemark"))
    text(placemark, "name", display_name)
    text(placemark, "visibility", "1" if visible else "0")
    text(placemark, "styleUrl", f"#{style_id}")
    if description:
        text(placemark, "description", description)
    if kind == "polygon":
        polygon = ET.SubElement(placemark, k("Polygon"))
        text(polygon, "tessellate", "1")
        outer = ET.SubElement(polygon, k("outerBoundaryIs"))
        ring = ET.SubElement(outer, k("LinearRing"))
        text(ring, "coordinates", coordinates_text(points))
    elif kind == "line":
        line = ET.SubElement(placemark, k("LineString"))
        text(line, "tessellate", "1")
        text(line, "coordinates", coordinates_text(points))
    else:
        point = ET.SubElement(placemark, k("Point"))
        text(point, "coordinates", coordinates_text(points))
    return placemark


def code(value):
    return "".join(character for character in value.upper() if character.isalnum())


def normalized_zone_name(raw_name, pump):
    match = re.fullmatch(r"Zone\s+(\d+)\s*-\s*(East|West)", raw_name, re.I)
    if match:
        return f"{match.group(2).title()} {int(match.group(1))}"
    match = re.fullmatch(r"(Front|North|South|East|West)[\s-]+0*(\d+)", raw_name, re.I)
    if match:
        return f"{match.group(1).title()} {int(match.group(2))}"
    if raw_name.lower() == "coconuts":
        return f"{pump} Coconuts"
    return raw_name


def compact_zone_label(zone_name):
    match = re.fullmatch(r"(Front|North|South|East|West)\s+(\d+)", zone_name, re.I)
    if match:
        return f"{match.group(1)[0].upper()}-{int(match.group(2)):02d}"
    return zone_name.replace("Front ", "F-").replace("North ", "N-").replace("South ", "S-")


def feature_near_zones(points, zone_points, margin_ratio=0.4):
    if not points or not zone_points:
        return False
    xs = [point[0] for point in zone_points]
    ys = [point[1] for point in zone_points]
    span_x = max(xs) - min(xs)
    span_y = max(ys) - min(ys)
    center = centroid(points)
    return (
        min(xs) - span_x * margin_ratio <= center[0] <= max(xs) + span_x * margin_ratio
        and min(ys) - span_y * margin_ratio <= center[1] <= max(ys) + span_y * margin_ratio
    )


def unique_placemarks(nodes):
    seen = set()
    output = []
    for placemark in nodes:
        kind, points = geometry(placemark)
        if not kind or not points:
            continue
        signature = (name_of(placemark).lower(), kind, tuple((round(p[0], 8), round(p[1], 8)) for p in points))
        if signature in seen:
            continue
        seen.add(signature)
        output.append((placemark, kind, points))
    return output


def main():
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    source_root = ET.parse(source).getroot()

    output_root = ET.Element(k("kml"))
    document = ET.SubElement(output_root, k("Document"))
    text(document, "name", "JD Thornton Maps")
    text(document, "description", "Cleaned and consolidated farm, irrigation, pump, road, and operational mapping.")

    zone_styles = {
        "Front": "zone-front",
        "North": "zone-north",
        "South": "zone-south",
        "West": "zone-west",
        "East": "zone-east",
    }
    style(document, "zone-front", "ff31543f", 2.2, "805f9f70", 0)
    style(document, "zone-north", "ff31543f", 2.2, "807caf91", 0)
    style(document, "zone-south", "ff31543f", 2.2, "804a78d8", 0)
    style(document, "zone-west", "ff31543f", 2.2, "807eaf6a", 0)
    style(document, "zone-east", "ff31543f", 2.2, "809cc3a8", 0)
    style(document, "zone-label", None, 0, None, 0.6, "", 0)
    style(document, "pump", None, 0, None, 0.95, "http://maps.google.com/mapfiles/kml/shapes/water.png", 1.05)
    style(document, "road", "ff4074b3", 4, None, 0)
    style(document, "operation", "ff5b4935", 1.8, "704f7192", 0, "", 0)
    style(document, "boundary", "ff3b74d8", 3, "00000000", 0)
    style(document, "irrigation-main", "ff8b6a2e", 3, None, 0)
    style(document, "irrigation-aux", "aa9b8152", 1.5, None, 0)
    style(document, "irrigation-row", "668b6a2e", 1, None, 0)
    style(document, "valve", None, 0, None, 0.75, "http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png", 0.65)

    farm_nodes = {}
    for node in source_root.findall(".//k:Folder", NS):
        current_name = name_of(node)
        if current_name.endswith("Acre Farm") and current_name not in farm_nodes:
            farm_nodes[current_name] = node

    road_folder = next(
        (node for node in source_root.findall(".//k:Folder", NS) if name_of(node) == "Truck Roads & Access Lanes"),
        None,
    )
    roads = unique_placemarks(road_folder.findall("k:Placemark", NS)) if road_folder is not None else []

    zone_total = pump_total = road_total = operation_total = infrastructure_total = 0
    for farm_name in ("70 Acre Farm", "40 Acre Farm", "25 Acre Farm", "10 Acre Farm"):
        source_farm = farm_nodes[farm_name]
        farm_output = folder(
            document,
            farm_name,
            farm_name == "70 Acre Farm",
            farm_name == "70 Acre Farm",
        )
        zones_output = folder(farm_output, "Irrigation Zones", True, True)
        labels_output = folder(farm_output, "Zone Labels", True)
        pumps_output = folder(farm_output, "Irrigation Pumps", True)
        roads_output = folder(farm_output, "Roads & Access Lanes", True)
        operations_output = folder(farm_output, "Buildings & Operational Areas", True)
        boundaries_output = folder(farm_output, "Property & Farm Borders", True)

        irrigation_source = next(
            (node for node in source_farm.findall("k:Folder", NS) if name_of(node) == "Irrigation Zones"),
            None,
        )
        farm_zone_points = []
        if irrigation_source is not None:
            for pump_folder in irrigation_source.findall("k:Folder", NS):
                pump = re.sub(r"\s+Pump Zones.*$", "", name_of(pump_folder)).strip()
                pump_output = folder(zones_output, f"{pump} Pump Zones", True)
                for placemark, kind, points in unique_placemarks(pump_folder.findall("k:Placemark", NS)):
                    raw_name = name_of(placemark)
                    is_numbered_zone = bool(
                        re.fullmatch(
                            rf"(?:{re.escape(pump)}[\s-]+0*\d+|Zone\s+\d+\s*-\s*{re.escape(pump)})",
                            raw_name,
                            re.I,
                        )
                    )
                    is_special_zone = raw_name.lower() == "coconuts"
                    if kind != "polygon" or not (is_numbered_zone or is_special_zone):
                        if "property line" in raw_name.lower() and kind == "polygon":
                            add_geometry(boundaries_output, raw_name.title(), kind, points, "boundary")
                        elif "loading" in raw_name.lower():
                            add_geometry(operations_output, raw_name, kind, points, "operation")
                        continue
                    zone_name = normalized_zone_name(raw_name, pump)
                    add_geometry(
                        pump_output,
                        zone_name,
                        kind,
                        points,
                        zone_styles.get(pump, "zone-front"),
                        f"{farm_name} · {pump} Irrigation Pump",
                    )
                    add_geometry(
                        labels_output,
                        compact_zone_label(zone_name),
                        "point",
                        [centroid(points)],
                        "zone-label",
                        zone_name,
                    )
                    farm_zone_points.extend(points)
                    zone_total += 1

        pump_source = next(
            (node for node in source_farm.findall("k:Folder", NS) if name_of(node) == "Pump Stations"),
            None,
        )
        if pump_source is not None:
            for placemark, kind, points in unique_placemarks(pump_source.findall("k:Placemark", NS)):
                pump_name = re.sub(r"\bDischarg\b", "Discharge", name_of(placemark), flags=re.I)
                pump_name = re.sub(r"\s+Station$", "", pump_name, flags=re.I)
                if "pump" not in pump_name.lower():
                    pump_name = f"{pump_name} Pump"
                add_geometry(pumps_output, pump_name, "point", points, "pump", f"{farm_name} irrigation pump")
                pump_total += 1

        acres = farm_name.split()[0]
        for placemark, kind, points in roads:
            road_name = name_of(placemark)
            if acres in road_name or (acres == "70" and road_name == "Entry Road"):
                add_geometry(roads_output, road_name, kind, points, "road")
                road_total += 1

        for source_detail in source_farm.findall("k:Folder", NS):
            detail_name = name_of(source_detail)
            if detail_name in {"Buildings & Operational Areas", "Site Reference & Boundaries"}:
                for placemark, kind, points in unique_placemarks(source_detail.findall(".//k:Placemark", NS)):
                    if not feature_near_zones(points, farm_zone_points):
                        continue
                    feature_name = name_of(placemark)
                    if "property line" in feature_name.lower():
                        add_geometry(boundaries_output, "Property Line", kind, points, "boundary")
                    else:
                        add_geometry(operations_output, feature_name, kind, points, "operation")
                        operation_total += 1

        infrastructure_source = next(
            (node for node in source_farm.findall("k:Folder", NS) if name_of(node) == "Irrigation Infrastructure"),
            None,
        )
        if infrastructure_source is not None:
            infrastructure_output = folder(farm_output, "Irrigation Infrastructure", True)
            for source_group in infrastructure_source.findall(".//k:Folder", NS):
                direct = unique_placemarks(source_group.findall("k:Placemark", NS))
                if not direct:
                    continue
                group_name = name_of(source_group)
                lower = group_name.lower()
                visible = "main" in lower or "valve" in lower
                group_output = folder(infrastructure_output, group_name, visible)
                group_style = "valve" if "valve" in lower else "irrigation-row" if "row" in lower or "riser" in lower else "irrigation-main" if "main" in lower else "irrigation-aux"
                for placemark, kind, points in direct:
                    add_geometry(group_output, name_of(placemark), kind, points, group_style, visible=visible)
                    infrastructure_total += 1

    target.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(output_root, space="  ")
    ET.ElementTree(output_root).write(target, encoding="utf-8", xml_declaration=True)
    print(
        f"Wrote {target}: {zone_total} zones, {pump_total} pumps, {road_total} roads, "
        f"{operation_total} operational features, {infrastructure_total} irrigation features"
    )


if __name__ == "__main__":
    main()
