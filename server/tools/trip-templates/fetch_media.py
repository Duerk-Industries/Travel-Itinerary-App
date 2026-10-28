"""Find public-domain pictures on Wikimedia Commons for a pack's places and destinations.

    python fetch_media.py --pack japan search  --cache <dir>     # query Commons, keep PD/CC0 candidates
    python fetch_media.py --pack japan sheets  --cache <dir>     # contact sheets to review the candidates by eye
    python fetch_media.py --pack japan build   --cache <dir> --out ../../data/trip-templates/media/japan.json

`build` takes candidate 0 for each place unless <cache>/choices.json overrides it
({"place:japan/fushimi-inari": 2}, -1 for "no picture", or {"from": key, "pick": [i]} to borrow another key's candidates). Only files whose own Commons metadata declares
public domain or CC0 are ever accepted, with no usage restrictions, and the license, author and file
page are stored with each picture. Nothing is downloaded into the app: a picture is a thumbnail URL
plus its credit, so the catalogue stays small and shared by every template.
"""
from __future__ import annotations

import argparse
import html
import importlib
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "packs"))

API = "https://commons.wikimedia.org/w/api.php"
AGENT = "WanderBunniesTemplateBuilder/1.0 (bryan.duerk@gmail.com)"
THUMB = 960
PER_QUERY = 8
BAD_TITLE = re.compile(r"\b(map|logo|flag|diagram|plan|route|poster|stamp|coat of arms|emblem|icon|chart|schematic|svg|panorama)\b", re.I)
GOOD_LICENSE = re.compile(r"^(public domain|cc0.*|pd($|[ -].*)|public domain mark.*)$", re.I)


def get(url: str) -> bytes:
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(req, timeout=40) as resp:
                return resp.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def strip_tags(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value or ""))).strip()


def search(query: str) -> list[dict]:
    params = {
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6", "gsrlimit": "40",
        "gsrsearch": f"{query} filetype:bitmap", "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": str(THUMB),
        "iiextmetadatafilter": "LicenseShortName|License|Artist|Credit|Restrictions|ImageDescription",
    }
    data = json.loads(get(f"{API}?{urllib.parse.urlencode(params)}"))
    pages = sorted((data.get("query", {}).get("pages", {})).values(), key=lambda p: p.get("index", 0))
    found = []
    for page in pages:
        info = (page.get("imageinfo") or [None])[0]
        if not info or info.get("mime") not in ("image/jpeg", "image/png"):
            continue
        meta = info.get("extmetadata", {})
        license_name = strip_tags(meta.get("LicenseShortName", {}).get("value", ""))
        license_key = strip_tags(meta.get("License", {}).get("value", ""))
        if not (GOOD_LICENSE.match(license_name) or GOOD_LICENSE.match(license_key)):
            continue
        if strip_tags(meta.get("Restrictions", {}).get("value", "")):
            continue
        width, height = info.get("width", 0), info.get("height", 0)
        if width < 1000 or not (1.2 <= width / max(height, 1) <= 2.2):
            continue
        title = page["title"]
        if BAD_TITLE.search(title):
            continue
        found.append({
            "title": title,
            "url": info.get("thumburl") or info["url"],
            "width": info.get("thumbwidth") or width,
            "height": info.get("thumbheight") or height,
            "pageUrl": info.get("descriptionurl"),
            "license": license_name or license_key,
            "author": strip_tags(meta.get("Artist", {}).get("value", "")) or "Unknown",
            "description": strip_tags(meta.get("ImageDescription", {}).get("value", ""))[:200],
        })
        if len(found) >= PER_QUERY:
            break
    return found


def search_all(query: str) -> list[dict]:
    """The query as written, a shorter one, and each restricted to the CC0 and self-published-PD categories.

    The strict license filter drops most results for a long query, so a short query and the license
    categories find the pictures their authors released into the public domain.
    """
    short = " ".join(query.split()[:2])
    variants = [query, short, f'{short} incategory:"CC-Zero"', f'{query} incategory:"CC-Zero"', f'{short} incategory:"PD-self"']
    seen, out = set(), []
    for variant in dict.fromkeys(variants):
        for cand in search(variant):
            if cand["title"] not in seen:
                seen.add(cand["title"])
                out.append(cand)
        time.sleep(0.4)
    return out[:PER_QUERY * 2]


def queries(pack) -> dict[str, str]:
    """Key -> search query, for places (`<prefix>/<key>`) and destinations (`<prefix>/<key>` too, namespaced apart in the catalogue)."""
    out = {f"place:{pack.PREFIX}/{key}": q for key, (_n, q, _d) in pack.PLACES.items()}
    out.update({f"dest:{pack.PREFIX}/{key}" if key != pack.PREFIX else f"dest:{pack.PREFIX}": spec[1] for key, spec in pack.DESTINATIONS.items()})
    return out


def cmd_search(pack, cache: str) -> None:
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, "candidates.json")
    existing = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    for key, query in queries(pack).items():
        if existing.get(key):
            continue
        try:
            existing[key] = search_all(query)
        except Exception as err:  # keep going; a rerun fills the gaps
            print(f"! {key}: {err}")
            existing[key] = []
        print(f"{key}: {len(existing[key])} candidate(s)")
        json.dump(existing, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        time.sleep(0.6)


def cmd_sheets(pack, cache: str) -> None:
    from PIL import Image, ImageDraw
    cands = json.load(open(os.path.join(cache, "candidates.json"), encoding="utf-8"))
    thumbs = os.path.join(cache, "thumbs")
    os.makedirs(thumbs, exist_ok=True)
    cell_w, cell_h, cols, label_h = 300, 200, 4, 38
    keys = list(cands.keys())
    per_sheet = 6
    for sheet_no, start in enumerate(range(0, len(keys), per_sheet)):
        group = keys[start:start + per_sheet]
        sheet = Image.new("RGB", (cell_w * cols, (cell_h + label_h) * len(group)), "white")
        draw = ImageDraw.Draw(sheet)
        for row, key in enumerate(group):
            y = row * (cell_h + label_h)
            draw.text((4, y + 2), f"{key}", fill="black")
            draw.text((4, y + 14), (cands[key][0]["title"][:60] if cands[key] else "NO CANDIDATES"), fill="gray")
            for col, cand in enumerate(cands[key][:cols]):
                name = re.sub(r"[^a-z0-9]+", "_", f"{key}_{col}".lower()) + ".jpg"
                fp = os.path.join(thumbs, name)
                if not os.path.exists(fp):
                    try:
                        open(fp, "wb").write(get(cand["url"]))
                        time.sleep(0.3)
                    except Exception:
                        continue
                try:
                    img = Image.open(fp).convert("RGB")
                except Exception:
                    continue
                img.thumbnail((cell_w - 4, cell_h - 4))
                sheet.paste(img, (col * cell_w + 2, y + label_h))
                draw.text((col * cell_w + 6, y + label_h + 4), str(col), fill="red")
        out = os.path.join(cache, f"sheet_{sheet_no:02d}.jpg")
        sheet.save(out, quality=82)
        print(out)


def credit(cand: dict) -> dict:
    return {
        "url": cand["url"].split("?")[0], "width": cand["width"], "height": cand["height"], "title": cand["title"],
        "pageUrl": cand["pageUrl"].split("?")[0], "license": cand["license"], "author": cand["author"],
    }


def cmd_build(pack, cache: str, out: str) -> None:
    cands = json.load(open(os.path.join(cache, "candidates.json"), encoding="utf-8"))
    cpath = os.path.join(cache, "choices.json")
    choices = json.load(open(cpath, encoding="utf-8")) if os.path.exists(cpath) else {}

    def pick(key: str, count: int = 1) -> list[dict]:
        chosen = choices.get(key, 0)
        if isinstance(chosen, dict):  # {"from": "place:japan/kenroku-en", "pick": [2]}: borrow another key's candidates
            pool = cands.get(chosen["from"], [])
            chosen = chosen["pick"]
        else:
            pool = cands.get(key, [])
        if chosen == -1 or not pool:
            return []
        picks = chosen if isinstance(chosen, list) else [chosen] + [i for i in range(len(pool)) if i != chosen]
        result = []
        for i in picks:
            if 0 <= i < len(pool) and pool[i]["title"] not in {r["title"] for r in result}:
                result.append(credit(pool[i]))
            if len(result) >= count:
                break
        return result

    places, destinations = {}, {}
    for key, (name, _q, desc) in pack.PLACES.items():
        image = pick(f"place:{pack.PREFIX}/{key}")
        places[f"{pack.PREFIX}/{key}"] = {"name": name, "description": desc, "image": image[0] if image else None}
    for key, (name, _q, desc, count) in pack.DESTINATIONS.items():
        ckey = f"dest:{pack.PREFIX}/{key}" if key != pack.PREFIX else f"dest:{pack.PREFIX}"
        destinations[key if key == pack.PREFIX else f"{pack.PREFIX}/{key}"] = {"name": name, "description": desc, "images": pick(ckey, count)}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"schemaVersion": 1, "places": places, "destinations": destinations}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    pictured = sum(1 for p in places.values() if p["image"])
    print(f"{out}: {pictured}/{len(places)} places pictured, {sum(1 for d in destinations.values() if d['images'])}/{len(destinations)} destinations pictured")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("command", choices=["search", "sheets", "build"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out")
    args = ap.parse_args()
    pack = importlib.import_module(f"{args.pack}_media")
    if args.command == "search":
        cmd_search(pack, args.cache)
    elif args.command == "sheets":
        cmd_sheets(pack, args.cache)
    else:
        if not args.out:
            ap.error("build needs --out")
        cmd_build(pack, args.cache, args.out)


if __name__ == "__main__":
    main()
