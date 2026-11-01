"""Find public-domain Wikimedia Commons pictures for the places and destinations in authoring bundles.

    python fetch_bundle_media.py search --bundle <file> --cache <dir>   # query Commons, keep PD/CC0 candidates
    python fetch_bundle_media.py sheets --bundle <file> --cache <dir>   # contact sheets to review the matches by eye
    python fetch_bundle_media.py apply  --bundle <file> --cache <dir>   # write the chosen pictures into the bundle

The packs under packs/ describe a destination in Python; the bundles in data/trip-template-authoring/ describe it in
JSON, with `"image": null` on every stop. This does for bundles what fetch_media.py does for packs, reusing its
Commons search and its license filter (public domain or CC0 only, no usage restrictions).

A candidate is only taken when its Commons title or description contains a distinctive word of the stop's name, so a
search that merely returns "some picture of the country" leaves the stop without a picture. `apply` takes the best
match, tags it `"selection": "ai"` so an admin can tell it from one a person chose, never replaces a picture that is
already there, and honours <cache>/choices.json ({"place:portugal/belem-tower": 2}, -1 for no picture; a number picks
among the candidates in order; a person's choice is tagged "curated").
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_media  # noqa: E402  (shares the Commons search, the license filter and the contact sheets)

GENERIC_WORDS = {
    "with", "from", "near", "around", "tour", "tours", "walk", "walking", "visit", "guided", "trip", "day", "days", "tasting",
    "dinner", "lunch", "breakfast", "evening", "morning", "night", "sunset", "sunrise", "views", "view", "best", "local",
    "town", "city", "national", "and", "the", "for", "into", "over", "your", "free", "time", "old", "new", "great", "small",
}


def fold(value: str) -> str:
    stripped = "".join(c for c in unicodedata.normalize("NFD", value) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", stripped.lower()).strip()


def distinctive_words(name: str, country: str) -> list[str]:
    skip = set(fold(country).split()) | GENERIC_WORDS
    return [w for w in dict.fromkeys(fold(name).split()) if len(w) >= 4 and w not in skip]


BAD_TITLE_EXTRA = re.compile(r"\b(hospital|parliament|deputy|minister|portrait|logo|sign|bus station|interior|bottles?|menu|poster|screenshot|stork|cats?|dogs?|circuit|sidewalk|pavement|bread|cake|bakery|crane)\b", re.I)


def match_score(cand: dict, words: list[str]) -> float:
    """The share of the stop's distinctive words found in the picture's *title* (descriptions are too loose)."""
    if not words or BAD_TITLE_EXTRA.search(cand["title"]):
        return 0.0
    text = f" {fold(cand['title'])} "
    hits = sum(1 for w in words if f" {w} " in text)
    return hits / len(words) if hits >= max(1, (len(words) + 1) // 2) else 0.0


def country_of(key: str) -> str:
    return key.split("/")[0].replace("-", " ")


def targets(bundle: dict) -> dict[str, dict]:
    """Candidate key -> {name, query, country, words}, for every place and destination in the bundle's media."""
    media = bundle.get("media", {})
    out: dict[str, dict] = {}
    for key, place in media.get("places", {}).items():
        country = country_of(key)
        out[f"place:{key}"] = {"name": place["name"], "query": f"{place['name']} {country}", "country": country, "has": bool(place.get("image"))}
    for key, dest in media.get("destinations", {}).items():
        country = country_of(key)
        is_country = "/" not in key
        out[f"dest:{key}"] = {"name": dest["name"], "query": dest["name"] if is_country else f"{dest['name']} {country}", "country": "" if is_country else country, "has": bool(dest.get("images"))}
    for target in out.values():
        target["words"] = distinctive_words(target["name"], target["country"])
    return out


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def cmd_search(bundle: dict, cache: str) -> None:
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, "candidates.json")
    found = load(path) if os.path.exists(path) else {}
    for key, target in targets(bundle).items():
        if target["has"] or found.get(key) is not None or not target["words"]:
            continue
        try:
            found[key] = fetch_media.search_all(target["query"])
        except Exception as err:  # a rerun fills the gaps
            print(f"! {key}: {err}")
            continue
        matched = sum(1 for c in found[key] if match_score(c, target["words"]) > 0)
        print(f"{key}: {len(found[key])} candidate(s), {matched} match(es)")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(found, f, indent=1, ensure_ascii=False)
        time.sleep(0.4)


def ranked(cands: list[dict], words: list[str]) -> list[dict]:
    scored = [(match_score(c, words), i, c) for i, c in enumerate(cands)]
    return [c for score, _i, c in sorted((s for s in scored if s[0] > 0), key=lambda s: (-s[0], s[1]))]


REVIEW_MODEL = os.environ.get("PICTURE_REVIEW_MODEL", "claude-haiku-5-5")
REVIEW_CANDIDATES = 4
REVIEW_IMAGE_WIDTH = 512
REVIEW_PROMPT = """You are checking pictures for a travel app. A traveler reads a sample itinerary and sees one picture next to the stop below, so the picture must clearly show that place or something unmistakably typical of it.

Stop: {name}
About it: {description}
Country: {country}

The numbered pictures follow, each with its Wikimedia Commons file name. Choose the ONE picture that best represents the stop, or none.
Reject a picture that shows a different place, mainly people or a crowd, an indoor detail, food or objects (unless the stop is about food), a sign, map, logo, document or painting, a vehicle, plain sky or sea with nothing identifiable, or is blurry or dark.
When you cannot tell that the picture is of this stop, choose none. A missing picture is better than a wrong one.

Reply with only a JSON object: {{"pick": <picture number or null>, "confidence": "high" or "low", "reason": "<one short sentence>"}}"""


def anthropic_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")
    if not key and os.path.exists(env_file):
        for line in open(env_file, encoding="utf-8"):
            if line.startswith("ANTHROPIC_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("\"'")
    if not key:
        sys.exit("ANTHROPIC_API_KEY is not set (environment or server/.env)")
    return key


def review_pool(cands: list[dict], words: list[str]) -> list[dict]:
    """The title matches first, then other candidates in Commons order, so the reviewer sees a few options even for a stop whose name has no single landmark word."""
    pool = ranked(cands, words)[:REVIEW_CANDIDATES]
    for cand in cands:
        if len(pool) >= REVIEW_CANDIDATES:
            break
        if cand not in pool and not BAD_TITLE_EXTRA.search(cand["title"]):
            pool.append(cand)
    return pool


def review_image(cache: str, cand: dict) -> str | None:
    """A small base64 JPEG of the candidate (downloaded once into <cache>/review-images)."""
    import base64
    import hashlib
    import io
    from PIL import Image
    folder = os.path.join(cache, "review-images")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, hashlib.sha1(cand["url"].encode()).hexdigest() + ".jpg")
    if not os.path.exists(path):
        try:
            img = Image.open(io.BytesIO(fetch_media.get(cand["url"]))).convert("RGB")
        except Exception:
            return None
        img.thumbnail((REVIEW_IMAGE_WIDTH, REVIEW_IMAGE_WIDTH))
        img.save(path, quality=72)
        time.sleep(0.3)
    return base64.b64encode(open(path, "rb").read()).decode()


def ask_reviewer(content: list[dict]) -> dict:
    import urllib.error
    import urllib.request
    body = json.dumps({"model": REVIEW_MODEL, "max_tokens": 1200, "thinking": {"type": "disabled"}, "messages": [{"role": "user", "content": content}]}).encode()
    for attempt in range(5):
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages", data=body, method="POST",
            headers={"x-api-key": anthropic_key(), "anthropic-version": "2023-06-01", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read())
            text = "".join(block.get("text", "") for block in data.get("content", []))
            found = re.search(r"\{.*\}", text, re.S)
            return {**json.loads(found.group(0)), "usage": data.get("usage", {})} if found else {"pick": None, "confidence": "low", "reason": "no answer: " + text[:150].replace(chr(10), " ")}
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 529) and attempt < 4:
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f"{err.code}: {err.read().decode()[:300]}")
    raise RuntimeError("unreachable")


def cmd_review(bundle: dict, cache: str, include_pictured: bool = False, limit: int | None = None) -> None:
    """A second pass: a vision model looks at each stop's candidate pictures and approves at most one."""
    found = load(os.path.join(cache, "candidates.json"))
    path = os.path.join(cache, "reviews.json")
    reviews = load(path) if os.path.exists(path) else {}
    tgt = targets(bundle)
    done = tokens = 0
    for key, cands in found.items():
        target = tgt.get(key)
        if not target or key in reviews or (target["has"] and not include_pictured):
            continue
        pool = review_pool(cands, target["words"])
        images = [(cand, review_image(cache, cand)) for cand in pool]
        images = [(cand, data) for cand, data in images if data]
        if not images:
            reviews[key] = {"pick": None, "confidence": "low", "reason": "no usable candidate", "candidates": []}
        else:
            media = {}
            if key.startswith("place:"):
                media = bundle["media"]["places"].get(key.split(":", 1)[1], {})
            else:
                media = bundle["media"]["destinations"].get(key.split(":", 1)[1], {})
            content: list[dict] = [{"type": "text", "text": REVIEW_PROMPT.format(name=target["name"], description=media.get("description", ""), country=target["country"] or "(the country itself)")}]
            for number, (cand, data) in enumerate(images, 1):
                content.append({"type": "text", "text": f"Picture {number}: {cand['title']}"})
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}})
            try:
                answer = ask_reviewer(content)
            except Exception as err:
                print(f"! {key}: {err}")
                continue
            usage = answer.pop("usage", {})
            tokens += int(usage.get("input_tokens", 0)) + int(usage.get("output_tokens", 0))
            pick = answer.get("pick")
            reviews[key] = {
                "pick": pick if isinstance(pick, int) and 1 <= pick <= len(images) else None,
                "confidence": answer.get("confidence", "low"), "reason": str(answer.get("reason", ""))[:200],
                "candidates": [cand["title"] for cand, _ in images],
            }
        done += 1
        r = reviews[key]
        print(f"{key}: {'picture ' + str(r['pick']) if r['pick'] else 'none'} ({r['confidence']}) {r['reason']}")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(reviews, f, indent=1, ensure_ascii=False)
        if limit and done >= limit:
            break
    print(f"{done} stop(s) reviewed, about {tokens} tokens")


def cmd_sheets(bundle: dict, cache: str) -> None:
    """Contact sheets of each stop's best matches, in the order `apply` would take them."""
    found = load(os.path.join(cache, "candidates.json"))
    tgt = targets(bundle)
    shown = {key: ranked(cands, tgt[key]["words"]) for key, cands in found.items() if key in tgt}
    shown = {key: cands for key, cands in shown.items() if cands}
    with open(os.path.join(cache, "matches.json"), "w", encoding="utf-8") as f:
        json.dump(shown, f, indent=1, ensure_ascii=False)
    sheet_cache = os.path.join(cache, "sheetcache")
    os.makedirs(sheet_cache, exist_ok=True)
    with open(os.path.join(sheet_cache, "candidates.json"), "w", encoding="utf-8") as f:
        json.dump(shown, f, ensure_ascii=False)
    fetch_media.cmd_sheets(None, sheet_cache)
    print(f"{len(shown)} of {len(found)} searched stops have a matching picture")


def approved(key: str, found: dict, reviews: dict, choices: dict, words: list[str]) -> tuple[dict, str] | None:
    """The picture to use for a stop and who chose it: a person's choice, else one the reviewer approved with high confidence."""
    if key in choices:
        choice = choices[key]
        pool = ranked(found.get(key, []), words)
        return (pool[choice], "curated") if isinstance(choice, int) and 0 <= choice < len(pool) else None
    review = reviews.get(key)
    if not review or not review.get("pick") or review.get("confidence") != "high":
        return None
    title = review["candidates"][review["pick"] - 1]
    cand = next((c for c in found.get(key, []) if c["title"] == title), None)
    return (cand, "ai") if cand else None


def cmd_apply(path: str, bundle: dict, cache: str) -> None:
    found = load(os.path.join(cache, "candidates.json"))
    cpath = os.path.join(cache, "choices.json")
    choices = load(cpath) if os.path.exists(cpath) else {}
    rpath = os.path.join(cache, "reviews.json")
    reviews = load(rpath) if os.path.exists(rpath) else {}
    media = bundle["media"]
    placed = skipped = 0
    for key, target in targets(bundle).items():
        if target["has"] or (key not in found and key not in choices):
            continue
        chosen = approved(key, found, reviews, choices, target["words"])
        if not chosen:
            skipped += 1
            continue
        picture = {**fetch_media.credit(chosen[0]), "selection": chosen[1]}
        kind, short = key.split(":", 1)
        if kind == "place":
            media["places"][short]["image"] = picture
        else:
            media["destinations"][short]["images"] = [picture]
        placed += 1
    with open(path, "rb") as f:
        newline = "\r\n" if b"\r\n" in f.read(4096) else "\n"  # keep the file's line endings so the diff is only the pictures
    with open(path, "w", encoding="utf-8", newline=newline) as f:
        json.dump(bundle, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"{os.path.basename(path)}: {placed} picture(s) placed, {skipped} stop(s) left without one")


def cmd_picked(bundle: dict, cache: str) -> None:
    """Contact sheets of just the pictures the reviewer approved, for a spot check by eye (one picture per row)."""
    found = load(os.path.join(cache, "candidates.json"))
    reviews = load(os.path.join(cache, "reviews.json"))
    tgt = targets(bundle)
    shown = {}
    for key in reviews:
        chosen = approved(key, found, reviews, {}, tgt[key]["words"]) if key in tgt else None
        if chosen:
            shown[f"{key} :: {reviews[key]['reason'][:60]}"] = [chosen[0]]
    folder = os.path.join(cache, "pickedcache")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "candidates.json"), "w", encoding="utf-8") as f:
        json.dump(shown, f, ensure_ascii=False)
    fetch_media.cmd_sheets(None, folder)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["search", "review", "sheets", "picked", "apply"])
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--include-pictured", action="store_true", help="review stops that already have a picture (to calibrate the reviewer)")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    bundle = load(args.bundle)
    if args.command == "search":
        cmd_search(bundle, args.cache)
    elif args.command == "review":
        cmd_review(bundle, args.cache, args.include_pictured, args.limit)
    elif args.command == "sheets":
        cmd_sheets(bundle, args.cache)
    elif args.command == "picked":
        cmd_picked(bundle, args.cache)
    else:
        cmd_apply(args.bundle, bundle, args.cache)


if __name__ == "__main__":
    main()
