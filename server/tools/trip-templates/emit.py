"""Writers for templates: Format C CSVs (for the app's import screens) and app seed JSON."""
from __future__ import annotations

import csv
import io
import json
import os
from dataclasses import asdict
from datetime import date, datetime, time, timedelta

from model import Act, Leg, Template

ACT_HEADERS = ["Date", "Activity Type", "Lodging Location", "Start Time", "Duration",
               "Activity Name", "Activity Notes", "Activity Start Address", "Book Ahead Required", "Status"]
LODGE_HEADERS = ["Check In", "Check Out", "Nights", "Suggested Location", "Hotel",
                 "Booked?", "Breakfast", "Dinner"]


def base_for_night(t: Template, day: int) -> str:
    for s in t.stays:
        if s.start <= day < s.start + s.nights:
            return s.base
    return ""


def write_csv(path, headers, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(headers)
    w.writerows(rows)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("\ufeff" + buf.getvalue())


def sort_key(a: Act):
    return (a.day, a.time or "99:99")


# Stored transfers have no notes, duration or book-ahead field, so those go to day-plan.csv as notes.
TRANSFER_HEADERS = ["Date", "Transfer Type", "From", "To", "Departure Time", "Arrival Date",
                    "Arrival Time", "Carrier", "Status"]
DAYPLAN_HEADERS = ["Date", "Kind", "Time", "Title", "Body", "Order"]
STATUS_NEEDS_BOOKING = "Needs Booking"
# Train, bus and ferry legs are all "Public Transit" in the current schema.
TRANSFER_TYPE = {"Train": "Public Transit", "Bus": "Public Transit", "Ferry": "Public Transit",
                 "Public Transit": "Public Transit", "Private Transfer": "Private Transfer", "Private": "Private Transfer"}


def fmt_mins(m):
    h, r = divmod(m, 60)
    return f"{h}h{r:02d}m" if h else f"{r}m"


def emit(t: Template, start: date, outdir: str):
    d = os.path.join(outdir, f"{t.id}-{slug(t.title)}")
    os.makedirs(d, exist_ok=True)
    acts = sorted((a for a in t.acts if isinstance(a, Act)), key=lambda a: (a.day, a.time or "99:99"))
    legs = sorted((g for g in t.acts if isinstance(g, Leg)), key=lambda g: (g.day, g.time or "00:00"))
    rows = [[(start + timedelta(days=a.day)).isoformat(), a.type, base_for_night(t, a.day), a.time,
             a.dur, a.name, a.notes, a.where, a.book, STATUS_NEEDS_BOOKING if a.book else ""] for a in acts]
    write_csv(os.path.join(d, "activities.csv"), ACT_HEADERS, rows)
    trows = []
    for g in legs:
        dep = datetime.combine(start + timedelta(days=g.day), time.fromisoformat(g.time)) if g.time else None
        arr = dep + timedelta(minutes=g.mins) if dep else None
        trows.append([(start + timedelta(days=g.day)).isoformat(), TRANSFER_TYPE[g.mode], g.frm, g.to, g.time,
                      arr.date().isoformat() if arr else "", arr.strftime("%H:%M") if arr else "",
                      g.carrier, STATUS_NEEDS_BOOKING if g.book else ""])
    write_csv(os.path.join(d, "transfers.csv"), TRANSFER_HEADERS, trows)
    # What a transfer row cannot hold becomes a day note on the same day: travel time, tips, booking advice.
    drows, order = [], {}
    for g in legs:
        parts = [f"{g.frm} to {g.to} by {g.carrier}. Travel time about {fmt_mins(g.mins)}."]
        if g.notes: parts.append(g.notes)
        if g.book: parts.append(f"Book ahead: {g.book.removeprefix('Yes - ')}.")
        if not g.time: parts.append("Times depend on your flight; confirm after booking.")
        if not (g.notes or g.book or not g.time): continue
        day = (start + timedelta(days=g.day)).isoformat()
        order[day] = order.get(day, 0) + 1
        drows.append([day, "Note", g.time, f"Getting there: {g.frm} to {g.to}", " ".join(parts), order[day]])
    write_csv(os.path.join(d, "day-plan.csv"), DAYPLAN_HEADERS, drows)
    lrows = []
    for s in t.stays:
        ci = start + timedelta(days=s.start)
        co = ci + timedelta(days=s.nights)
        lrows.append([ci.isoformat(), co.isoformat(), s.nights, s.area, s.hotel, "No",
                      "Yes" if s.breakfast else "", "Yes" if s.dinner else ""])
    write_csv(os.path.join(d, "lodging.csv"), LODGE_HEADERS, lrows)
    return d

def slug(s):
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-").replace("--", "-").replace("--", "-")


# Activity types that make a good headline, best first.
_HEADLINE_TYPES = ["Day Trip", "Hike", "Ticketed Attraction", "Sights & Landmarks", "Spa/Wellness", "Class"]


def headlines(t: Template, limit: int = 5) -> list[str]:
    """The stops worth naming on a card: day trips and hikes first, then ticketed sights and landmarks."""
    if t.highlights:
        return t.highlights[:limit]
    seen, out = set(), []
    acts = [a for a in t.acts if isinstance(a, Act)]
    for kind in _HEADLINE_TYPES:
        for a in acts:
            key = a.name.lower()
            if a.type == kind and key not in seen and not a.name.lower().startswith(("free ", "optional", "sunset", "open-air", "contemporary")):
                seen.add(key)
                out.append(a.name)
    return out[:limit]


def seed_id(pack: str, t: Template) -> str:
    return f"{pack}-{t.id.lower()}"


def emit_seed(t: Template, pack: str, outdir: str) -> str:
    """One JSON file per template, in day-offset form, as the app's seed data (server/data/trip-templates)."""
    os.makedirs(outdir, exist_ok=True)
    doc = {
        "schemaVersion": 1,
        "id": seed_id(pack, t),
        "title": t.title,
        "summary": t.summary,
        "days": t.days,
        "route": t.route,
        "arrive": t.arrive,
        "depart": t.depart,
        "countries": t.countries,
        "cities": t.cities,
        "imageQuery": t.image_query,
        "highlights": headlines(t),
        "destinationKeys": t.destination_keys,
        "hero": t.hero,
        "sources": t.sources,
        "stays": [
            {"base": s.base, "hotel": s.hotel, "start": s.start, "nights": s.nights, "area": s.area,
             "breakfast": s.breakfast, "dinner": s.dinner}
            for s in t.stays
        ],
        "activities": [
            {"day": a.day, "type": a.type, "time": a.time, "duration": a.dur, "name": a.name, "notes": a.notes,
             "where": a.where, "book": a.book, "place": t.place_keys.get(a.name, "")}
            for a in sorted((x for x in t.acts if isinstance(x, Act)), key=lambda x: (x.day, x.time or "99:99"))
        ],
        "legs": [
            {"day": g.day, "transferType": TRANSFER_TYPE[g.mode], "from": g.frm, "to": g.to, "time": g.time,
             "minutes": g.mins, "carrier": g.carrier, "notes": g.notes, "book": g.book}
            for g in sorted((x for x in t.acts if isinstance(x, Leg)), key=lambda x: (x.day, x.time or "00:00"))
        ],
    }
    path = os.path.join(outdir, f"{seed_id(pack, t)}.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return path
