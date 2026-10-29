"""Destination-agnostic itinerary template model.

A template is a day-offset plan (day 0 = arrival day): stays, activities and ground-transfer legs,
plus the metadata the app needs to offer it for a destination. Destination content lives in
packs/<name>.py; this module knows nothing about any one country.
"""
from __future__ import annotations

from dataclasses import dataclass, field

@dataclass
class Stay:
    base: str               # city, used for "Lodging Location" on activity rows
    hotel: str              # generic name
    start: int              # day offset of check-in
    nights: int
    area: str               # where to look -> "Suggested Location"
    breakfast: bool = False
    dinner: bool = False


@dataclass
class Act:
    day: int
    type: str               # canonical WanderBunnies activity type
    time: str               # HH:mm or ""
    dur: str
    name: str
    notes: str
    where: str              # area-level start address
    book: str = ""          # Book Ahead Required


@dataclass
class Leg:
    day: int
    mode: str               # Train | Bus | Ferry | Public Transit | Private Transfer
    frm: str
    to: str
    time: str               # HH:mm or "" (flight-dependent)
    mins: int
    carrier: str
    notes: str = ""
    book: str = ""

    @property
    def name(self):         # lets the per-template time tweaks treat legs like acts
        return f"Transfer: {self.frm} to {self.to}"


SEAT = "Yes - reserved seat recommended"


def L(day, mode, frm, to, time, mins, carrier, notes="", book=""):
    return Leg(day, mode, frm, to, time, mins, carrier, notes, book)



@dataclass
class Template:
    id: str
    title: str
    days: int
    route: str
    arrive: str
    depart: str
    sources: list[str]
    stays: list[Stay]
    acts: list = field(default_factory=list)   # Act and Leg, mixed
    # Offered-for-destination metadata (filled by the pack's META, see packs/japan.py).
    summary: str = ""
    countries: list[str] = field(default_factory=list)
    cities: list[str] = field(default_factory=list)
    image_query: str = ""
    highlights: list[str] = field(default_factory=list)
    # Shared media: where each activity's description and picture live, and the card's destination picture.
    place_keys: dict[str, str] = field(default_factory=dict)   # activity name -> place key
    destination_keys: list[str] = field(default_factory=list)  # country, then cities
    hero: str = ""
