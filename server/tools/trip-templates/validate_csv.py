"""Validate generated CSVs against WanderBunnies Format C rules (schema §5)."""
import csv, glob, os, re, sys
from datetime import date

ACT_ALIASES = {"date": {"date", "activity date"}, "activityType": {"activity type", "type", "category"},
               "lodgingLocation": {"lodging location", "base", "lodging"}, "startTime": {"start time", "time"},
               "duration": {"duration", "length"}, "name": {"activity name", "name", "activity"},
               "notes": {"activity notes", "notes", "description"},
               "startLocation": {"activity start address", "start address", "address", "location"},
               "bookAhead": {"book ahead required", "book ahead", "requires booking"},
               "status": {"status"}}
LODGE_ALIASES = {"checkInDate": {"check in", "check in date"}, "checkOutDate": {"check out", "check out date"},
                 "days": {"days", "nights"}, "suggestedLocation": {"suggested location", "location", "area"},
                 "name": {"hotel", "lodging name", "name"}, "booked": {"booked"}, "breakfast": {"breakfast"},
                 "dinner": {"dinner"}, "laundry": {"laundry"}, "refundBy": {"cancel by", "cancellation date", "refund by"},
                 "totalCost": {"cost", "total cost", "price"}, "bookedOn": {"booked on", "booking source", "provider"},
                 "address": {"address", "hotel address"}}
XFER_ALIASES = {"transferType": {"transfer type", "mode", "type"},
                "departureLocation": {"from", "departure location", "origin"},
                "arrivalLocation": {"to", "arrival location", "destination"},
                "departureDate": {"date", "departure date"}, "departureTime": {"departure time", "depart", "start time"},
                "arrivalDate": {"arrival date"}, "arrivalTime": {"arrival time", "arrive"},
                "carrier": {"carrier", "operator", "line"},
                "flightNumber": {"service number", "train number", "number"}, "cost": {"cost", "price"},
                "reference": {"booking reference", "reference", "confirmation"},
                "status": {"status"}}
DAYPLAN_ALIASES = {"date": {"date", "day"}, "kind": {"kind", "item type", "type"}, "time": {"time", "start time"},
                   "title": {"title", "name"}, "body": {"body", "note", "notes", "description"},
                   "position": {"order", "day order"}}
GROUND_TYPES = {"Public Transit", "Private Transfer", "Other"}  # current schema; Train/Bus/Ferry are legacy
STATUSES = {"", "Proposed", "Needs Booking", "Booked", "Completed", "Cancelled"}
TYPES = {"Class", "Concert/Show", "Day Trip", "Event", "Food & Drink", "Fun & Games", "Hike", "Nightlife",
         "Open Access", "Outdoor Activity", "Reservation", "Shopping", "Sights & Landmarks", "Spa/Wellness",
         "Ticketed Attraction", "Tour", "Other"}
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def norm(h):
    h = h.lstrip("﻿").strip().lower().replace("?", "")
    return re.sub(r"[^a-z0-9]+", " ", h).strip()


def load(path, aliases, errs):
    if os.path.getsize(path) > 2 * 1024 * 1024:
        errs.append(f"{path}: >2MiB")
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    hdr, data = rows[0], [r for r in rows[1:] if any(c.strip() for c in r)]
    n = [norm(h) for h in hdr]
    if len(set(n)) != len(n) or "" in n: errs.append(f"{path}: blank/duplicate headers")
    if len(hdr) > 50: errs.append(f"{path}: >50 columns")
    if len(data) > 150: errs.append(f"{path}: >150 rows")
    mapping, seen = {}, set()
    for i, h in enumerate(n):
        dest = [k for k, v in aliases.items() if h in v]
        if not dest: errs.append(f"{path}: header '{hdr[i]}' would be Ignored")
        elif dest[0] in seen: errs.append(f"{path}: two columns map to {dest[0]}")
        else: seen.add(dest[0]); mapping[dest[0]] = i
    for r in data:
        if len(r) != len(hdr): errs.append(f"{path}: ragged row {r[:3]}")
        for c in r:
            if len(c) > 4000: errs.append(f"{path}: cell >4000")
            if c and c[0] in "=+-@\t\r": errs.append(f"{path}: formula-guard prefix in '{c[:20]}'")
    return [{k: r[i] for k, i in mapping.items()} for r in data]


def main(root):
    errs, summary = [], []
    for d in sorted(p for p in glob.glob(os.path.join(root, "T*")) if os.path.isdir(p)):
        acts = load(os.path.join(d, "activities.csv"), ACT_ALIASES, errs)
        lodge = load(os.path.join(d, "lodging.csv"), LODGE_ALIASES, errs)
        nights = set()
        for l in lodge:
            if not (l.get("name") and ISO.match(l["checkInDate"]) and ISO.match(l["checkOutDate"])):
                errs.append(f"{d}: lodging missing name/dates {l}")
                continue
            ci, co = date.fromisoformat(l["checkInDate"]), date.fromisoformat(l["checkOutDate"])
            if co <= ci: errs.append(f"{d}: check-out not after check-in")
            if int(l["days"]) != (co - ci).days: errs.append(f"{d}: Nights mismatch")
            span = {date.fromordinal(o) for o in range(ci.toordinal(), co.toordinal())}
            if span & nights: errs.append(f"{d}: overlapping lodging")
            nights |= span
        first, last_night = min(nights), max(nights)
        if len(nights) != (last_night - first).days + 1: errs.append(f"{d}: gap in lodging nights")
        keys = set()
        for a in acts:
            if a["status"] not in STATUSES: errs.append(f"{d}: bad activity status {a['status']}")
            if a["bookAhead"] and a["status"] != "Needs Booking": errs.append(f"{d}: book-ahead activity not Needs Booking: {a['name']}")
            if not a["name"]: errs.append(f"{d}: activity missing name")
            if not ISO.match(a["date"]): errs.append(f"{d}: bad date {a['date']}")
            dt = date.fromisoformat(a["date"])
            if not (first <= dt <= date.fromordinal(last_night.toordinal() + 1)):
                errs.append(f"{d}: activity outside trip {a['date']} {a['name']}")
            if a["activityType"] not in TYPES: errs.append(f"{d}: unknown type {a['activityType']}")
            if a["startTime"] and not HHMM.match(a["startTime"]): errs.append(f"{d}: bad time {a['startTime']}")
            k = (a["name"], a["date"], a["startTime"], a["startLocation"])
            if k in keys: errs.append(f"{d}: duplicate key {k}")
            keys.add(k)
        xp = os.path.join(d, "transfers.csv")
        xfers = load(xp, XFER_ALIASES, errs) if os.path.exists(xp) else []
        xkeys = set()
        for x in xfers:
            for req in ("transferType", "departureLocation", "arrivalLocation", "departureDate"):
                if not x.get(req): errs.append(f"{d}: transfer missing {req}")
            if x["transferType"] not in GROUND_TYPES: errs.append(f"{d}: non-ground transfer type {x['transferType']}")
            if not ISO.match(x["departureDate"]): errs.append(f"{d}: bad transfer date"); continue
            dd = date.fromisoformat(x["departureDate"])
            ad = date.fromisoformat(x["arrivalDate"]) if x.get("arrivalDate") else dd
            if ad < dd: errs.append(f"{d}: arrival before departure")
            for t in ("departureTime", "arrivalTime"):
                if x.get(t) and not HHMM.match(x[t]): errs.append(f"{d}: bad {t} {x[t]}")
            if x.get("departureTime") and x.get("arrivalTime") and (ad, x["arrivalTime"]) <= (dd, x["departureTime"]):
                errs.append(f"{d}: transfer arrival not after departure {x['departureLocation']}")
            if not (first <= dd <= date.fromordinal(last_night.toordinal() + 1)):
                errs.append(f"{d}: transfer outside trip {x['departureDate']}")
            k = (x["transferType"], x["departureDate"], x["departureTime"], x["departureLocation"], x["arrivalLocation"])
            if k in xkeys: errs.append(f"{d}: duplicate transfer key {k}")
            xkeys.add(k)
            if x["departureLocation"].lower().startswith("transfer"): errs.append(f"{d}: leftover transfer naming")
        for a in acts:
            if a["name"].startswith("Transfer:"): errs.append(f"{d}: transfer still an activity: {a['name']}")
        dp = os.path.join(d, "day-plan.csv")
        notes = load(dp, DAYPLAN_ALIASES, errs) if os.path.exists(dp) else []
        nkeys = set()
        for n in notes:
            if n["kind"] != "Note" or not n["title"] or not n["body"]: errs.append(f"{d}: bad day-plan row {n['title']}")
            if not ISO.match(n["date"]) or not (first <= date.fromisoformat(n["date"]) <= date.fromordinal(last_night.toordinal() + 1)):
                errs.append(f"{d}: day-plan date outside trip {n['date']}")
            if n["time"] and not HHMM.match(n["time"]): errs.append(f"{d}: bad day-plan time {n['time']}")
            k = (n["date"], n["kind"], n["title"], n["time"])
            if k in nkeys: errs.append(f"{d}: duplicate day-plan key {k}")
            nkeys.add(k)
        days_with_acts = {a["date"] for a in acts} | {x["departureDate"] for x in xfers}
        trip_days = (last_night - first).days + 2
        if len(days_with_acts) != trip_days: errs.append(f"{d}: {trip_days - len(days_with_acts)} day(s) with no activities")
        summary.append(f"{os.path.basename(d)}: {trip_days} days, {len(lodge)} stays / {len(nights)} nights, {len(acts)} activities, {len(xfers)} transfer legs")
    print("\n".join(summary))
    print("\nERRORS:" if errs else "\nAll checks passed.")
    for e in errs: print(" -", e)
    sys.exit(1 if errs else 0)


main(sys.argv[1] if len(sys.argv) > 1 else "out")
