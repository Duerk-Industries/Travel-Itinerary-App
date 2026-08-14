#!/usr/bin/env python3
"""
corpus_tools.py — authoring-side tooling for the cached itinerary corpus.

Four commands:

  audit    Run all CI checks over a corpus. Exit 1 on failure. Wire into CI.
  coverage Report which interest signatures a location can actually serve.
  plan     Emit prioritised authoring jobs to close coverage gaps.
  promote  Read-only preflight for an llm_draft promotion.

The LLM authoring call is behind the Author protocol. A NullAuthor is provided
so the whole pipeline runs offline; swap in a real implementation at the
marked seam. A real author belongs in the metered server worker, not this
credential-free utility. Everything here is deterministic and testable.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
from dataclasses import dataclass, field, replace
from datetime import date
from itertools import combinations
from pathlib import Path
from typing import Any, Iterable, Protocol

# --------------------------------------------------------------------------
# Constants — keep in sync with the spec
# --------------------------------------------------------------------------

DIMENSIONS = [
    "outdoors",
    "adventure",
    "culture",
    "food",
    "nightlife",
    "relaxing",
    "photography",
    "authentic_local",
    "iconic_landmarks",
]

SCORE_MIN, SCORE_MAX = 1, 10

# At most this many blocks per location may score >= 9 on a given dimension.
TOP_SCORE_CAP = 3
TOP_SCORE_THRESHOLD = 9

# Substitution group span constraints
GROUP_MIN_MEMBERS = 3
GROUP_MAX_MEMBERS = 4
# Span check uses MEAN-CENTERED cosine. Raw cosine on all-positive 1-10 vectors
# compresses into roughly [0.6, 1.0] because every vector sits in the positive
# orthant and shares a baseline; centering restores the full [-1, 1] range and
# roughly quadruples discrimination. Calibrated against known-good and
# known-duplicate groups.
GROUP_MAX_PAIRWISE_COSINE = 0.75
GROUP_DURATION_TOLERANCE = 0.40  # +/- 40% of group median
GROUP_ENERGY_TOLERANCE = 1

# Corpus health: if mean score on a dimension exceeds this, authors are inflating.
INFLATION_MEAN_CEILING = 6.0
INFLATION_MIN_STDEV = 1.5

# A location is "servable" for a signature if it has >= this many dominant
# blocks for each of the two dimensions.
MIN_DOMINANT_PER_DIM = 1

# Location-type interest floors: blocks scoring below the floor on ALL listed
# dimensions are dropped for that location type regardless of cosine.
TYPE_FLOORS = {
    "hiking_region": (["outdoors", "adventure"], 4),
    "national_park": (["outdoors", "adventure"], 4),
    "coastal": (["outdoors", "relaxing"], 3),
}

# Dimension tensions flagged for human review (see spec 3.1)
TENSIONS = [
    ("iconic_landmarks", 8, "authentic_local", 7),
    ("adventure", 7, "relaxing", 7),
]

# Parser/resource caps. These protect CI and author workstations from an
# accidental or hostile JSON bomb. Runtime limits are separately enforced by
# the server's standard usage/capacity architecture (spec section 17).
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_LOCATIONS = 5_000
MAX_BLOCKS = 100_000
MAX_GROUPS = 50_000
MAX_DEMAND_ENTRIES = 5_000
MAX_PLAN_JOBS = 1_000
MAX_ID_CHARS = 128
MAX_TITLE_CHARS = 300
MAX_VERIFICATION_SOURCE_CHARS = 2_048
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
ALLOWED_ROLES = {"anchor", "supporting", "filler", "meal", "rest", "contingency"}
ALLOWED_SOURCES = {"curated", "partner", "llm_draft"}

# Conservative manifest estimates only. The server recalculates and reserves
# worst-case units; it never trusts these client-authored values.
JOB_ESTIMATES = {
    "new_block": {"provider_requests": 1, "input_tokens": 8_000, "output_tokens": 3_000,
                  "verification_requests": 1, "storage_write_bytes": 65_536},
    "extend_group": {"provider_requests": 1, "input_tokens": 8_000, "output_tokens": 3_000,
                     "verification_requests": 1, "storage_write_bytes": 65_536},
    "cold_start": {"provider_requests": 9, "input_tokens": 72_000, "output_tokens": 27_000,
                   "verification_requests": 9, "storage_write_bytes": 589_824},
}


class CorpusLoadError(ValueError):
    """Expected, user-actionable corpus input failure (no traceback needed)."""


# --------------------------------------------------------------------------
# Vector math
# --------------------------------------------------------------------------


def vec(weights: dict[str, int]) -> list[float]:
    return [float(weights[d]) for d in DIMENSIONS]


def has_valid_vector(block: "Block") -> bool:
    return isinstance(block.interest_weights, dict) and all(
        isinstance(block.interest_weights.get(d), int)
        and not isinstance(block.interest_weights.get(d), bool)
        and SCORE_MIN <= block.interest_weights[d] <= SCORE_MAX
        for d in DIMENSIONS
    )


def corpus_mean(blocks: Iterable["Block"]) -> dict[str, float]:
    """
    Per-dimension mean over the corpus. Use a GLOBAL mean (recomputed on a
    schedule and pinned as a constant), not a per-location one: per-location
    means make fit scores incomparable across destinations and shift every
    time a block is authored.
    """
    bs = [b for b in blocks if has_valid_vector(b)]
    if not bs:
        return {d: 5.5 for d in DIMENSIONS}
    return {
        d: sum(b.interest_weights.get(d, 0) for b in bs) / len(bs) for d in DIMENSIONS
    }


def centered(weights: dict[str, int], mean: dict[str, float]) -> list[float]:
    return [float(weights.get(d, 0)) - mean[d] for d in DIMENSIONS]


def cosine(a: Iterable[float], b: Iterable[float]) -> float:
    a, b = list(a), list(b)
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def dominant(weights: dict[str, int]) -> str:
    """Top-scoring dimension, ties broken by fixed DIMENSIONS order."""
    return max(DIMENSIONS, key=lambda d: (weights[d], -DIMENSIONS.index(d)))


def signature(weights: dict[str, int]) -> str:
    """Top-2 dimensions, alphabetically sorted. 36 possible values."""
    ranked = sorted(DIMENSIONS, key=lambda d: (-weights[d], DIMENSIONS.index(d)))
    return "+".join(sorted(ranked[:2]))


def is_flat(weights: dict[str, int], threshold: float = 2.0) -> bool:
    """Flat profiles carry no preference signal — fall back to default_rank."""
    vals = [weights[d] for d in DIMENSIONS]
    return (max(vals) - statistics.mean(vals)) < threshold


def all_signatures() -> list[str]:
    return sorted("+".join(sorted(p)) for p in combinations(DIMENSIONS, 2))


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------


@dataclass
class Block:
    block_id: str
    location_id: str
    zone_id: str
    role: str
    title: str
    interest_weights: dict[str, int]
    duration_typical: int
    energy_cost: int
    time_fit: dict[str, float] = field(default_factory=dict)
    source: str = "curated"  # curated | partner | llm_draft
    verified_venue: bool = True
    last_verified: str | None = None
    verification_source: str | None = None
    verified_at: str | None = None
    reviewed_by: str | None = None

    @property
    def dominant(self) -> str:
        return dominant(self.interest_weights)

    @property
    def vector(self) -> list[float]:
        return vec(self.interest_weights)

    @property
    def live(self) -> bool:
        """llm_draft blocks are excluded from the candidate set until promoted."""
        return self.source != "llm_draft"


@dataclass
class Group:
    group_id: str
    location_id: str
    zone_id: str
    role: str
    member_ids: list[str]


@dataclass
class Location:
    location_id: str
    name: str
    location_type: str
    priority: int = 50  # demand rank; drives authoring order


@dataclass
class Finding:
    severity: str  # error | warn
    scope: str
    message: str

    def __str__(self) -> str:
        tag = "ERROR" if self.severity == "error" else "warn "
        return f"  [{tag}] {self.scope}: {self.message}"


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------


def _read_json(
    root: Path,
    name: str,
    expected_type: type,
    max_items: int | None = None,
    *,
    required: bool = True,
) -> Any:
    root = root.resolve()
    path = (root / name).resolve()
    if path.parent != root:
        raise CorpusLoadError(f"{name}: resolved path escapes corpus directory")
    if not path.exists():
        if required:
            raise CorpusLoadError(f"{name}: required file not found")
        return [] if expected_type is list else {}
    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise CorpusLoadError(f"{name}: {size} bytes exceeds {MAX_FILE_BYTES}-byte cap")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CorpusLoadError(f"{name}: cannot read valid UTF-8 JSON ({exc})") from exc
    if not isinstance(value, expected_type):
        raise CorpusLoadError(f"{name}: expected {expected_type.__name__} at top level")
    if max_items is not None and len(value) > max_items:
        raise CorpusLoadError(f"{name}: {len(value)} items exceeds cap {max_items}")
    return value


def _index_rows(rows: list[Any], id_field: str, cls: type, file_name: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise CorpusLoadError(f"{file_name}[{index}]: expected object")
        raw_id = row.get(id_field)
        if not isinstance(raw_id, str) or not raw_id:
            raise CorpusLoadError(f"{file_name}[{index}]: missing string {id_field}")
        if raw_id in out:
            raise CorpusLoadError(f"{file_name}: duplicate {id_field} '{raw_id}'")
        try:
            out[raw_id] = cls(**row)
        except TypeError as exc:
            raise CorpusLoadError(f"{file_name}[{index}] ({raw_id}): schema mismatch ({exc})") from exc
    return out


def load_corpus(root: Path) -> tuple[dict[str, Location], dict[str, Block], dict[str, Group]]:
    locations = _index_rows(
        _read_json(root, "locations.json", list, MAX_LOCATIONS), "location_id", Location, "locations.json"
    )
    blocks = _index_rows(
        _read_json(root, "blocks.json", list, MAX_BLOCKS), "block_id", Block, "blocks.json"
    )
    groups = _index_rows(
        _read_json(root, "groups.json", list, MAX_GROUPS), "group_id", Group, "groups.json"
    )
    return locations, blocks, groups


def load_demand(path: Path) -> dict[str, float]:
    demand = _read_json(path.resolve().parent, path.name, dict, MAX_DEMAND_ENTRIES)
    out: dict[str, float] = {}
    for location_id, raw_weight in demand.items():
        if not isinstance(location_id, str) or not ID_PATTERN.fullmatch(location_id):
            raise CorpusLoadError(f"{path.name}: invalid location ID {location_id!r}")
        if isinstance(raw_weight, bool) or not isinstance(raw_weight, (int, float)):
            raise CorpusLoadError(f"{path.name}: weight for {location_id} must be numeric")
        weight = float(raw_weight)
        if not math.isfinite(weight) or not (0 <= weight <= 1_000_000):
            raise CorpusLoadError(f"{path.name}: weight for {location_id} outside 0..1000000")
        out[location_id] = weight
    return out


# --------------------------------------------------------------------------
# Validation — the CI checks from spec section 8
# --------------------------------------------------------------------------


def validate_block(b: Block) -> list[Finding]:
    out: list[Finding] = []
    scope = f"block/{b.block_id}"

    for label, value in (("block_id", b.block_id), ("location_id", b.location_id), ("zone_id", b.zone_id)):
        if not isinstance(value, str) or len(value) > MAX_ID_CHARS or not ID_PATTERN.fullmatch(value):
            out.append(Finding("error", scope, f"invalid {label}"))
    if not isinstance(b.title, str) or not b.title.strip() or len(b.title) > MAX_TITLE_CHARS:
        out.append(Finding("error", scope, f"title must be 1-{MAX_TITLE_CHARS} characters"))
    if b.role not in ALLOWED_ROLES:
        out.append(Finding("error", scope, f"unknown role '{b.role}'"))
    if b.source not in ALLOWED_SOURCES:
        out.append(Finding("error", scope, f"unknown source '{b.source}'"))
    if isinstance(b.duration_typical, bool) or not isinstance(b.duration_typical, int) or not (1 <= b.duration_typical <= 1_440):
        out.append(Finding("error", scope, "duration_typical outside 1-1440 minutes"))
    if isinstance(b.energy_cost, bool) or not isinstance(b.energy_cost, int) or not (1 <= b.energy_cost <= 5):
        out.append(Finding("error", scope, "energy_cost outside 1-5"))
    if not isinstance(b.interest_weights, dict):
        out.append(Finding("error", scope, "interest_weights must be an object"))
        return out

    missing = [d for d in DIMENSIONS if d not in b.interest_weights]
    if missing:
        out.append(Finding("error", scope, f"missing dimensions: {', '.join(missing)}"))
        return out  # everything downstream assumes a complete vector

    extra = [d for d in b.interest_weights if d not in DIMENSIONS]
    if extra:
        out.append(Finding("error", scope, f"unknown dimensions: {', '.join(extra)}"))

    invalid_scores = False
    for d in DIMENSIONS:
        v = b.interest_weights[d]
        if isinstance(v, bool) or not isinstance(v, int) or not (SCORE_MIN <= v <= SCORE_MAX):
            invalid_scores = True
            out.append(Finding("error", scope, f"{d}={v} outside {SCORE_MIN}-{SCORE_MAX}"))
    if invalid_scores:
        return out

    for dim_a, thr_a, dim_b, thr_b in TENSIONS:
        if b.interest_weights[dim_a] >= thr_a and b.interest_weights[dim_b] >= thr_b:
            out.append(
                Finding(
                    "warn",
                    scope,
                    f"tension: {dim_a}={b.interest_weights[dim_a]} with "
                    f"{dim_b}={b.interest_weights[dim_b]} — needs review",
                )
            )

    if not isinstance(b.time_fit, dict):
        out.append(Finding("error", scope, "time_fit must be an object"))
    elif b.interest_weights["nightlife"] >= 7 and b.time_fit:
        evening = b.time_fit.get("evening", 0.0)
        night = b.time_fit.get("night", 0.0)
        if evening < 0.5 and night < 0.5:
            out.append(
                Finding("error", scope, "nightlife>=7 but no evening/night time_fit")
            )

    if b.source == "llm_draft" and b.verified_venue:
        out.append(
            Finding("warn", scope, "llm_draft marked verified — confirm external source")
        )

    for label, raw_date in (("last_verified", b.last_verified), ("verified_at", b.verified_at)):
        if raw_date is not None:
            try:
                parsed = date.fromisoformat(raw_date)
                if parsed > date.today():
                    out.append(Finding("warn", scope, f"{label} is in the future"))
            except (TypeError, ValueError):
                out.append(Finding("error", scope, f"{label} must be ISO YYYY-MM-DD"))
    if b.verification_source is not None and (
        not isinstance(b.verification_source, str)
        or not b.verification_source.strip()
        or len(b.verification_source) > MAX_VERIFICATION_SOURCE_CHARS
    ):
        out.append(Finding("error", scope, "verification_source is empty or too long"))
    if b.reviewed_by is not None and (
        not isinstance(b.reviewed_by, str)
        or len(b.reviewed_by) > MAX_ID_CHARS
        or not ID_PATTERN.fullmatch(b.reviewed_by)
    ):
        out.append(Finding("error", scope, "reviewed_by must be a bounded opaque reviewer ID"))

    return out


def validate_group(
    g: Group, blocks: dict[str, Block], mean: dict[str, float] | None = None
) -> list[Finding]:
    out: list[Finding] = []
    scope = f"group/{g.group_id}"

    for label, value in (("group_id", g.group_id), ("location_id", g.location_id), ("zone_id", g.zone_id)):
        if not isinstance(value, str) or len(value) > MAX_ID_CHARS or not ID_PATTERN.fullmatch(value):
            out.append(Finding("error", scope, f"invalid {label}"))
    if g.role not in ALLOWED_ROLES:
        out.append(Finding("error", scope, f"unknown role '{g.role}'"))
    if not isinstance(g.member_ids, list):
        out.append(Finding("error", scope, "member_ids must be an array"))
        return out
    if len(g.member_ids) != len(set(g.member_ids)):
        out.append(Finding("error", scope, "duplicate member IDs"))

    missing = [m for m in g.member_ids if m not in blocks]
    if missing:
        out.append(Finding("error", scope, f"unknown member blocks: {', '.join(missing)}"))
        return out

    members = [blocks[m] for m in g.member_ids]
    n = len(members)

    if not (GROUP_MIN_MEMBERS <= n <= GROUP_MAX_MEMBERS):
        sev = "error" if n < GROUP_MIN_MEMBERS else "warn"
        out.append(Finding(sev, scope, f"{n} members, expected {GROUP_MIN_MEMBERS}-{GROUP_MAX_MEMBERS}"))
    if not members:
        return out

    wrong_locations = [m.block_id for m in members if m.location_id != g.location_id]
    if wrong_locations:
        out.append(Finding("error", scope, f"members belong to another location: {', '.join(wrong_locations)}"))
    live_count = sum(1 for m in members if m.live)
    if live_count < GROUP_MIN_MEMBERS:
        out.append(Finding("error", scope, f"only {live_count} live members; drafts cannot satisfy group depth"))
    invalid_members = [
        m.block_id for m in members
        if not isinstance(m.interest_weights, dict)
        or any(not isinstance(m.interest_weights.get(d), int) for d in DIMENSIONS)
        or isinstance(m.duration_typical, bool) or not isinstance(m.duration_typical, int)
        or isinstance(m.energy_cost, bool) or not isinstance(m.energy_cost, int)
    ]
    if invalid_members:
        out.append(Finding("error", scope, f"members have invalid vectors/duration/energy: {', '.join(invalid_members)}"))
        return out

    doms = [m.dominant for m in members]
    dupes = {d for d in doms if doms.count(d) > 1}
    if dupes:
        out.append(
            Finding("error", scope, f"members share dominant dimension(s): {', '.join(sorted(dupes))}")
        )

    mean = mean or corpus_mean(blocks.values())
    worst = -1.0
    worst_pair = None
    for x, y in combinations(members, 2):
        c = cosine(centered(x.interest_weights, mean), centered(y.interest_weights, mean))
        if c > worst:
            worst, worst_pair = c, (x.block_id, y.block_id)
    if worst > GROUP_MAX_PAIRWISE_COSINE:
        out.append(
            Finding(
                "error",
                scope,
                f"max centered pairwise cosine {worst:+.2f} > {GROUP_MAX_PAIRWISE_COSINE} "
                f"({worst_pair[0]} vs {worst_pair[1]}) — members are not real alternatives",
            )
        )

    med = statistics.median(m.duration_typical for m in members)
    lo, hi = med * (1 - GROUP_DURATION_TOLERANCE), med * (1 + GROUP_DURATION_TOLERANCE)
    for m in members:
        if not (lo <= m.duration_typical <= hi):
            out.append(
                Finding(
                    "error",
                    scope,
                    f"{m.block_id} duration {m.duration_typical}min outside "
                    f"{lo:.0f}-{hi:.0f} (median {med:.0f}) — not slot-interchangeable",
                )
            )

    energies = [m.energy_cost for m in members]
    if max(energies) - min(energies) > GROUP_ENERGY_TOLERANCE:
        out.append(
            Finding("error", scope, f"energy spread {min(energies)}-{max(energies)} exceeds +/-{GROUP_ENERGY_TOLERANCE}")
        )

    zones = {m.zone_id for m in members}
    if len(zones) > 1:
        out.append(
            Finding("warn", scope, f"members span zones {sorted(zones)} — verify adjacency <=15min")
        )

    roles = {m.role for m in members}
    if roles != {g.role}:
        out.append(Finding("error", scope, f"member roles {sorted(roles)} != group role '{g.role}'"))

    return out


def validate_location_caps(loc: Location, blocks: list[Block]) -> list[Finding]:
    """Score inflation controls — the slow failure mode."""
    out: list[Finding] = []
    scope = f"location/{loc.location_id}"

    blocks = [b for b in blocks if has_valid_vector(b)]
    for d in DIMENSIONS:
        top = [b for b in blocks if b.interest_weights.get(d, 0) >= TOP_SCORE_THRESHOLD]
        if len(top) > TOP_SCORE_CAP:
            out.append(
                Finding(
                    "error",
                    scope,
                    f"{len(top)} blocks score >={TOP_SCORE_THRESHOLD} on '{d}' "
                    f"(cap {TOP_SCORE_CAP}): {', '.join(b.block_id for b in top)}",
                )
            )

    if len(blocks) >= 8:
        for d in DIMENSIONS:
            vals = [b.interest_weights.get(d, 0) for b in blocks]
            mean = statistics.mean(vals)
            sd = statistics.pstdev(vals)
            if mean > INFLATION_MEAN_CEILING:
                out.append(
                    Finding("warn", scope, f"'{d}' mean {mean:.1f} > {INFLATION_MEAN_CEILING} — inflation")
                )
            if sd < INFLATION_MIN_STDEV:
                out.append(
                    Finding("warn", scope, f"'{d}' stdev {sd:.1f} < {INFLATION_MIN_STDEV} — no discrimination")
                )

    return out


def audit_loaded(
    locations: dict[str, Location], blocks: dict[str, Block], groups: dict[str, Group]
) -> tuple[list[Finding], int]:
    findings: list[Finding] = []

    mean = corpus_mean(blocks.values())
    for b in blocks.values():
        findings += validate_block(b)
    for g in groups.values():
        findings += validate_group(g, blocks, mean)
    for loc in locations.values():
        scope = f"location/{loc.location_id}"
        if len(loc.location_id) > MAX_ID_CHARS or not ID_PATTERN.fullmatch(loc.location_id):
            findings.append(Finding("error", scope, "invalid location_id"))
        if not isinstance(loc.name, str) or not loc.name.strip() or len(loc.name) > MAX_TITLE_CHARS:
            findings.append(Finding("error", scope, f"name must be 1-{MAX_TITLE_CHARS} characters"))
        if not isinstance(loc.location_type, str) or not loc.location_type.strip() or len(loc.location_type) > 64:
            findings.append(Finding("error", scope, "invalid location_type"))
        if isinstance(loc.priority, bool) or not isinstance(loc.priority, int) or not (0 <= loc.priority <= 1_000_000):
            findings.append(Finding("error", scope, "priority outside 0..1000000"))
        loc_blocks = [b for b in blocks.values() if b.location_id == loc.location_id]
        findings += validate_location_caps(loc, loc_blocks)

    for b in blocks.values():
        if b.location_id not in locations:
            findings.append(Finding("error", f"block/{b.block_id}", f"unknown location {b.location_id}"))
    for g in groups.values():
        if g.location_id not in locations:
            findings.append(Finding("error", f"group/{g.group_id}", f"unknown location {g.location_id}"))

    errors = sum(1 for f in findings if f.severity == "error")
    return findings, errors


def audit(root: Path) -> tuple[list[Finding], int]:
    return audit_loaded(*load_corpus(root))


# --------------------------------------------------------------------------
# Coverage — which signatures can this location actually serve?
# --------------------------------------------------------------------------


@dataclass
class Coverage:
    location_id: str
    dominant_counts: dict[str, int]
    servable: list[str]
    unservable: list[str]
    missing_dims: list[str]
    incomplete_groups: list[tuple[str, int]]

    @property
    def rate(self) -> float:
        total = len(self.servable) + len(self.unservable)
        return len(self.servable) / total if total else 0.0


def coverage(loc: Location, blocks: dict[str, Block], groups: dict[str, Group]) -> Coverage:
    live = [b for b in blocks.values() if b.location_id == loc.location_id and b.live and has_valid_vector(b)]

    counts = {d: 0 for d in DIMENSIONS}
    for b in live:
        counts[b.dominant] += 1

    # Dimensions gated out by location type don't count as gaps.
    gated: set[str] = set()
    if loc.location_type in TYPE_FLOORS:
        floor_dims, _ = TYPE_FLOORS[loc.location_type]
        gated = {d for d in DIMENSIONS if d not in floor_dims and counts[d] == 0}

    servable, unservable = [], []
    for sig in all_signatures():
        d1, d2 = sig.split("+")
        ok = counts[d1] >= MIN_DOMINANT_PER_DIM and counts[d2] >= MIN_DOMINANT_PER_DIM
        (servable if ok else unservable).append(sig)

    missing = [d for d, c in counts.items() if c < MIN_DOMINANT_PER_DIM and d not in gated]

    incomplete = [
        (g.group_id, sum(1 for member_id in g.member_ids if blocks.get(member_id) and blocks[member_id].live))
        for g in groups.values()
        if g.location_id == loc.location_id
        and sum(1 for member_id in g.member_ids if blocks.get(member_id) and blocks[member_id].live) < GROUP_MIN_MEMBERS
    ]

    return Coverage(loc.location_id, counts, servable, unservable, missing, incomplete)


# --------------------------------------------------------------------------
# Gap planning — turn coverage holes into prioritised authoring jobs
# --------------------------------------------------------------------------


@dataclass
class Job:
    priority: float
    location_id: str
    kind: str  # new_block | extend_group | cold_start
    target: str
    rationale: str
    signatures_unlocked: int

    def to_dict(self) -> dict:
        return {
            "priority": round(self.priority, 1),
            "location_id": self.location_id,
            "kind": self.kind,
            "target": self.target,
            "rationale": self.rationale,
            "signatures_unlocked": self.signatures_unlocked,
            "estimated_max_usage": JOB_ESTIMATES[self.kind],
        }


def plan_jobs(
    locations: dict[str, Location],
    blocks: dict[str, Block],
    groups: dict[str, Group],
    demand: dict[str, int] | None = None,
) -> list[Job]:
    """
    Priority = demand weight x signatures unlocked.

    A missing dominant dimension unlocks 8 signatures at once (every pairing
    with the other eight dimensions). That is why gaps are closed at the block
    layer, not by generating one itinerary per missed cache key.
    """
    demand = demand or {}
    jobs: list[Job] = []

    for loc in locations.values():
        raw_weight = demand.get(loc.location_id, loc.priority)
        if isinstance(raw_weight, bool) or not isinstance(raw_weight, (int, float)) or not math.isfinite(raw_weight):
            raise CorpusLoadError(f"invalid demand/priority for {loc.location_id}")
        w = float(raw_weight) / 50.0
        cov = coverage(loc, blocks, groups)

        if not any(b.location_id == loc.location_id and b.live for b in blocks.values()):
            jobs.append(
                Job(
                    priority=w * 100,
                    location_id=loc.location_id,
                    kind="cold_start",
                    target=loc.location_id,
                    rationale=f"no blocks authored for {loc.name}",
                    signatures_unlocked=len(all_signatures()),
                )
            )
            continue

        for dim in cov.missing_dims:
            unlocked = sum(1 for s in cov.unservable if dim in s.split("+"))
            jobs.append(
                Job(
                    priority=w * unlocked * 1.0,
                    location_id=loc.location_id,
                    kind="new_block",
                    target=dim,
                    rationale=f"no block in {loc.name} is dominant in '{dim}'",
                    signatures_unlocked=unlocked,
                )
            )

        for gid, n in cov.incomplete_groups:
            jobs.append(
                Job(
                    priority=w * 6.0,
                    location_id=loc.location_id,
                    kind="extend_group",
                    target=gid,
                    rationale=f"group has {n} members, needs {GROUP_MIN_MEMBERS}",
                    signatures_unlocked=0,
                )
            )

    jobs.sort(key=lambda j: -j.priority)
    return jobs


# --------------------------------------------------------------------------
# The authoring seam
# --------------------------------------------------------------------------


class Author(Protocol):
    """Frontier-model authoring. Called offline, never in the request path."""

    def author_block(self, location: Location, dimension: str, context: dict) -> dict: ...


class NullAuthor:
    """Offline stand-in. Emits a job manifest instead of calling a model."""

    def author_block(self, location: Location, dimension: str, context: dict) -> dict:
        return {
            "_stub": True,
            "location_id": location.location_id,
            "requested_dominant": dimension,
            "instructions": (
                f"Author 1 block in {location.name} whose dominant interest dimension "
                f"is '{dimension}'. Score all nine dimensions 1-10. The block must "
                f"score >=8 on '{dimension}' and must not exceed centered cosine "
                f"{GROUP_MAX_PAIRWISE_COSINE} against existing members of its group. "
                f"Mark source=llm_draft and verified_venue=false."
            ),
            "existing_dominants": context.get("existing_dominants", []),
        }


# --------------------------------------------------------------------------
# Promotion gate
# --------------------------------------------------------------------------


def promote(root: Path, block_ids: list[str]) -> tuple[list[str], list[Finding]]:
    """
    Read-only llm_draft promotion preflight. Requires a clean corpus, external
    verification metadata, and reviewer evidence. Production promotion is an
    authenticated, audited immutable-release operation in the server.
    """
    locations, blocks, groups = load_corpus(root)
    promoted: list[str] = []
    blockers: list[Finding] = []

    for bid in block_ids:
        b = blocks.get(bid)
        if b is None:
            blockers.append(Finding("error", f"block/{bid}", "not found"))
            continue
        if b.source != "llm_draft":
            blockers.append(Finding("warn", f"block/{bid}", f"already source={b.source}"))
            continue

        issues = [f for f in validate_block(b) if f.severity == "error"]
        if issues:
            blockers += issues
            continue

        missing_evidence = []
        if not b.verified_venue:
            missing_evidence.append("verified_venue")
        if not b.verification_source:
            missing_evidence.append("verification_source")
        if not b.verified_at:
            missing_evidence.append("verified_at")
        if not b.reviewed_by:
            missing_evidence.append("reviewed_by")
        if missing_evidence:
            blockers.append(
                Finding(
                    "error",
                    f"block/{bid}",
                    "missing independent verification/reviewer evidence: " + ", ".join(missing_evidence),
                )
            )
            continue

        promoted.append(bid)

    if any(f.severity == "error" for f in blockers):
        return [], blockers

    simulated = dict(blocks)
    for bid in promoted:
        simulated[bid] = replace(blocks[bid], source="curated")
    findings, errors = audit_loaded(locations, simulated, groups)
    if errors:
        blockers.append(Finding("error", "corpus", "promotion requires the resulting full corpus to pass audit"))
        blockers.extend(f for f in findings if f.severity == "error")
        return [], blockers

    return promoted, blockers


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def parse_bounded_int(raw: str, minimum: int, maximum: int) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if not (minimum <= value <= maximum):
        raise argparse.ArgumentTypeError(f"must be between {minimum} and {maximum}")
    return value


def cmd_audit(args) -> int:
    findings, errors = audit(Path(args.corpus))
    if not findings:
        print("corpus clean")
        return 0
    for f in findings:
        print(f)
    warns = len(findings) - errors
    print(f"\n{errors} error(s), {warns} warning(s)")
    return 1 if errors else 0


def cmd_coverage(args) -> int:
    root = Path(args.corpus)
    locations, blocks, groups = load_corpus(root)
    for loc in locations.values():
        cov = coverage(loc, blocks, groups)
        print(f"\n{loc.name} ({loc.location_id}, {loc.location_type})")
        print(f"  signatures servable: {len(cov.servable)}/36  ({cov.rate:.0%})")
        present = {d: c for d, c in cov.dominant_counts.items() if c}
        print(f"  dominant blocks: {present or '(none)'}")
        if cov.missing_dims:
            print(f"  MISSING dominants: {', '.join(cov.missing_dims)}")
        if cov.incomplete_groups:
            for gid, n in cov.incomplete_groups:
                print(f"  incomplete group: {gid} ({n} members)")
    return 0


def cmd_plan(args) -> int:
    root = Path(args.corpus)
    locations, blocks, groups = load_corpus(root)
    demand = {}
    if args.demand:
        demand = load_demand(Path(args.demand))
    jobs = plan_jobs(locations, blocks, groups, demand)[: args.limit]

    if args.json:
        print(json.dumps([j.to_dict() for j in jobs], indent=2))
        return 0

    if not jobs:
        print("no authoring gaps")
        return 0

    print(f"{'PRI':>6}  {'KIND':<14} {'LOCATION':<14} {'TARGET':<20} UNLOCKS  RATIONALE")
    for j in jobs:
        print(
            f"{j.priority:>6.1f}  {j.kind:<14} {j.location_id:<14} "
            f"{j.target:<20} {j.signatures_unlocked:>7}  {j.rationale}"
        )
    return 0


def cmd_promote(args) -> int:
    promoted, blockers = promote(Path(args.corpus), args.blocks)
    for f in blockers:
        print(f)
    if promoted:
        print(f"\npreflight passed (no files changed): {', '.join(promoted)}")
    else:
        print("\nnothing promotable")
    return 1 if any(f.severity == "error" for f in blockers) else 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--corpus",
        default=str(Path(__file__).resolve().parent),
        help="corpus directory (defaults to this script's directory)",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("audit").set_defaults(fn=cmd_audit)
    sub.add_parser("coverage").set_defaults(fn=cmd_coverage)

    sp = sub.add_parser("plan")
    sp.add_argument("--demand", help="JSON map location_id -> demand weight")
    sp.add_argument("--limit", type=lambda value: parse_bounded_int(value, 1, MAX_PLAN_JOBS), default=25)
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(fn=cmd_plan)

    sp = sub.add_parser("promote")
    sp.add_argument("blocks", nargs="+")
    sp.set_defaults(fn=cmd_promote)

    args = p.parse_args()
    try:
        return args.fn(args)
    except CorpusLoadError as exc:
        print(f"input error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
