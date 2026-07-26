import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"k": "http://www.opengis.net/kml/2.2"}


def folder_name(folder):
    node = folder.find("k:name", NS)
    return (node.text or "").strip() if node is not None else ""


def child_folders(folder):
    return folder.findall("k:Folder", NS)


def coords(text):
    points = []
    for item in (text or "").strip().split():
        values = item.split(",")
        if len(values) >= 2:
            points.append([float(values[0]), float(values[1])])
    return points


def geometry(placemark):
    polygon = placemark.find(".//k:Polygon//k:coordinates", NS)
    if polygon is not None:
        return {"type": "polygon", "coordinates": coords(polygon.text)}
    line = placemark.find(".//k:LineString/k:coordinates", NS)
    if line is not None:
        return {"type": "line", "coordinates": coords(line.text)}
    point = placemark.find(".//k:Point/k:coordinates", NS)
    if point is not None:
        parsed = coords(point.text)
        if parsed:
            return {"type": "point", "coordinates": parsed}
    return None


def placemark_name(placemark):
    node = placemark.find("k:name", NS)
    return (node.text or "").strip() if node is not None else ""


def collect_features(folder):
    output = []
    for placemark in folder.findall(".//k:Placemark", NS):
        shape = geometry(placemark)
        if shape:
            output.append({"name": placemark_name(placemark), **shape})
    return output


def direct_features(folder):
    output = []
    for placemark in folder.findall("k:Placemark", NS):
        shape = geometry(placemark)
        if shape:
            output.append({"name": placemark_name(placemark), **shape})
    return output


def polygon_area(feature):
    points = feature["coordinates"]
    if feature["type"] != "polygon" or len(points) < 3:
        return 0
    return abs(
        sum(
            points[index][0] * points[(index + 1) % len(points)][1]
            - points[(index + 1) % len(points)][0] * points[index][1]
            for index in range(len(points))
        )
    ) / 2


def feature_near_zones(feature, zones, margin_ratio=0.35):
    zone_points = [point for zone in zones for point in zone["coordinates"]]
    if not zone_points:
        return True
    xs = [point[0] for point in zone_points]
    ys = [point[1] for point in zone_points]
    span_x = max(xs) - min(xs)
    span_y = max(ys) - min(ys)
    center_x = sum(point[0] for point in feature["coordinates"]) / len(feature["coordinates"])
    center_y = sum(point[1] for point in feature["coordinates"]) / len(feature["coordinates"])
    return (
        min(xs) - span_x * margin_ratio <= center_x <= max(xs) + span_x * margin_ratio
        and min(ys) - span_y * margin_ratio <= center_y <= max(ys) + span_y * margin_ratio
    )


def code(value):
    return "".join(ch for ch in value.upper() if ch.isalnum())


def main():
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    root = ET.parse(source).getroot()
    farms = []
    farm_nodes = []
    seen_farms = set()
    for node in root.findall(".//k:Folder", NS):
        name = folder_name(node)
        if name.endswith("Acre Farm") and name not in seen_farms:
            farm_nodes.append(node)
            seen_farms.add(name)

    for farm_node in farm_nodes:
        farm_name = folder_name(farm_node)
        acres = farm_name.split()[0]
        farm_code = f"F{acres}"
        farm = {
            "name": farm_name,
            "code": farm_code,
            "zones": [],
            "pumps": [],
            "boundary": [],
            "roads": [],
            "features": [],
            "infrastructure": [],
        }

        irrigation = next(
            (f for f in child_folders(farm_node) if folder_name(f) == "Irrigation Zones"),
            None,
        )
        if irrigation is not None:
            for pump_folder in child_folders(irrigation):
                pump_name = re.sub(r"\s+Pump Zones.*$", "", folder_name(pump_folder)).strip()
                pump_code = code(pump_name)
                for placemark in pump_folder.findall("k:Placemark", NS):
                    name_node = placemark.find("k:name", NS)
                    polygon = placemark.find(".//k:Polygon//k:coordinates", NS)
                    if name_node is None or polygon is None:
                        continue
                    zone_name = (name_node.text or "").strip()
                    numeric_match = re.search(r"\d+", zone_name)
                    numeric_zone = numeric_match.group(0) if numeric_match else ""
                    zone_key = f"{int(numeric_zone):02d}" if numeric_zone else code(
                        zone_name.replace(pump_name, "").strip()
                    )
                    sort_number = int(numeric_zone) if numeric_zone else 100 + len(farm["zones"])
                    farm["zones"].append(
                        {
                            "name": zone_name,
                            "pump": pump_name,
                            "pumpCode": pump_code,
                            "zoneNumber": sort_number,
                            "id": f"{farm_code}-{pump_code}-{zone_key}",
                            "coordinates": coords(polygon.text),
                        }
                    )

        pumps_folder = next(
            (
                f
                for f in child_folders(farm_node)
                if folder_name(f) in {"Pump Stations", "Irrigation Pumps"}
            ),
            None,
        )
        if pumps_folder is not None:
            for placemark in pumps_folder.findall("k:Placemark", NS):
                name_node = placemark.find("k:name", NS)
                point = placemark.find(".//k:Point/k:coordinates", NS)
                if name_node is None or point is None:
                    continue
                parsed = coords(point.text)
                if parsed:
                    farm["pumps"].append(
                        {"name": (name_node.text or "").strip(), "coordinates": parsed[0]}
                    )

        boundary_candidates = []
        for detail_folder in child_folders(farm_node):
            detail_name = folder_name(detail_folder)
            if detail_name in {"Buildings & Operational Areas", "Site Reference & Boundaries"}:
                farm["features"].extend(collect_features(detail_folder))
            elif detail_name == "Irrigation Infrastructure":
                farm["infrastructure"].extend(collect_features(detail_folder))
            elif detail_name in {"Roads & Access Lanes", "Truck Roads & Access Lanes"}:
                farm["roads"].extend(direct_features(detail_folder))
            elif detail_name == "Property & Farm Borders":
                boundary_candidates.extend(
                    feature
                    for feature in direct_features(detail_folder)
                    if feature["type"] == "polygon"
                )

        if boundary_candidates:
            farm["boundary"] = max(boundary_candidates, key=polygon_area)["coordinates"]

        farm["roads"] = [
            feature for feature in farm["roads"] if feature_near_zones(feature, farm["zones"], 0.5)
        ]
        farm["features"] = [
            feature for feature in farm["features"] if feature_near_zones(feature, farm["zones"])
        ]
        farm["infrastructure"] = [
            feature for feature in farm["infrastructure"] if feature_near_zones(feature, farm["zones"])
        ]
        farms.append(farm)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"farms": farms}, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {len(farms)} farms, {sum(len(f['zones']) for f in farms)} zones, "
        f"{sum(len(f['pumps']) for f in farms)} pumps, "
        f"{sum(len(f['roads']) for f in farms)} roads, "
        f"{sum(len(f['features']) for f in farms)} operational features, and "
        f"{sum(len(f['infrastructure']) for f in farms)} infrastructure features to {target}"
    )


if __name__ == "__main__":
    main()
