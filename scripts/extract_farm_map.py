import json
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


def code(value):
    return "".join(ch for ch in value.upper() if ch.isalnum())


def main():
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    root = ET.parse(source).getroot()
    farms = []
    farm_nodes = [
        node
        for node in root.findall(".//k:Folder", NS)
        if folder_name(node).endswith("Acre Farm")
    ]

    for farm_node in farm_nodes:
        farm_name = folder_name(farm_node)
        acres = farm_name.split()[0]
        farm_code = f"F{acres}"
        farm = {"name": farm_name, "code": farm_code, "zones": [], "pumps": []}

        irrigation = next(
            (f for f in child_folders(farm_node) if folder_name(f) == "Irrigation Zones"),
            None,
        )
        if irrigation is not None:
            for pump_folder in child_folders(irrigation):
                pump_name = (
                    folder_name(pump_folder)
                    .replace(" Pump Zones", "")
                    .replace(" Zones 1-12", "")
                    .replace(" Zones 1-7", "")
                    .strip()
                )
                pump_code = code(pump_name)
                for placemark in pump_folder.findall("k:Placemark", NS):
                    name_node = placemark.find("k:name", NS)
                    polygon = placemark.find(".//k:Polygon//k:coordinates", NS)
                    if name_node is None or polygon is None:
                        continue
                    zone_name = (name_node.text or "").strip()
                    zone_number = "".join(ch for ch in zone_name if ch.isdigit()) or str(
                        len(farm["zones"]) + 1
                    )
                    farm["zones"].append(
                        {
                            "name": zone_name,
                            "pump": pump_name,
                            "pumpCode": pump_code,
                            "zoneNumber": int(zone_number),
                            "id": f"{farm_code}-{pump_code}-{int(zone_number):02d}",
                            "coordinates": coords(polygon.text),
                        }
                    )

        pumps_folder = next(
            (f for f in child_folders(farm_node) if folder_name(f) == "Pump Stations"),
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
        farms.append(farm)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"farms": farms}, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {len(farms)} farms, {sum(len(f['zones']) for f in farms)} zones, "
        f"{sum(len(f['pumps']) for f in farms)} pumps to {target}"
    )


if __name__ == "__main__":
    main()
