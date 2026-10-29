#!/usr/bin/env node
// Validates a wanderbunnies.trip-templates bundle against the rules in INSTRUCTIONS.md section 6.
// Usage: node validate-bundle.mjs <bundle.json> [more-bundles.json ...]
//
// Exits 1 if any ERROR is found. WARNINGs do not fail the run (they mirror the app's
// non-blocking warnings).

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const ACTIVITY_TYPES = [
  'Class', 'Concert/Show', 'Day Trip', 'Event', 'Food & Drink', 'Fun & Games',
  'Hike', 'Nightlife', 'Other', 'Open Access', 'Outdoor Activity', 'Reservation',
  'Shopping', 'Sights & Landmarks', 'Spa/Wellness', 'Ticketed Attraction', 'Tour',
];
const TRANSFER_TYPES = ['Public Transit', 'Private Transfer', 'Other'];
const INTERESTS = [
  'outdoors', 'adventure', 'culture', 'food', 'nightlife', 'relax',
  'photography', 'authentic_local', 'iconic_landmarks',
];
const PACES = ['R', 'B', 'F'];
const MOBILITY = ['L', 'M', 'H'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[a-z0-9-]+$/;
const PLACE_KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const DEST_KEY_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/;

function slug(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function validate(file) {
  const errors = [];
  const warnings = [];
  let bundle;

  try {
    bundle = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { errors: [`not valid JSON: ${e.message}`], warnings: [], stats: null };
  }

  // 1. envelope
  if (bundle.format !== 'wanderbunnies.trip-templates') {
    errors.push(`format must be "wanderbunnies.trip-templates", got ${JSON.stringify(bundle.format)}`);
  }
  if (bundle.version !== 1) {
    errors.push(`version must be 1, got ${JSON.stringify(bundle.version)}`);
  }
  if (!Array.isArray(bundle.templates)) {
    errors.push('templates must be an array');
    return { errors, warnings, stats: null };
  }

  const places = bundle.media?.places ?? {};
  const destinations = bundle.media?.destinations ?? {};
  const placeKeys = new Set(Object.keys(places));
  const destKeys = new Set(Object.keys(destinations));
  const usedPlaceKeys = new Set();
  const usedDestKeys = new Set();

  // 13 / key format on media
  for (const key of placeKeys) {
    if (!PLACE_KEY_RE.test(key)) errors.push(`media.places key "${key}" must be country/slug, lowercase ASCII`);
  }
  for (const key of destKeys) {
    if (!DEST_KEY_RE.test(key)) errors.push(`media.destinations key "${key}" must be country or country/city, lowercase ASCII`);
  }

  // one spelling per place name across templates
  const nameSpellings = new Map();

  const ids = new Set();
  const lengthBases = new Map();

  for (const [ti, t] of bundle.templates.entries()) {
    const at = `templates[${ti}]${t.id ? ` (${t.id})` : ''}`;

    if (t.schemaVersion !== 1) errors.push(`${at}.schemaVersion must be 1`);

    // 2. ids
    if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
      errors.push(`${at}.id must be lowercase letters/digits/hyphens`);
    } else if (ids.has(t.id)) {
      errors.push(`${at}.id duplicated within this bundle`);
    } else {
      ids.add(t.id);
    }

    if (!Number.isInteger(t.days) || t.days < 1 || t.days > 60) {
      errors.push(`${at}.days must be an integer 1-60, got ${JSON.stringify(t.days)}`);
      continue;
    }
    const lastDay = t.days - 1;

    for (const f of ['title', 'summary', 'route', 'imageQuery', 'hero']) {
      if (typeof t[f] !== 'string' || !t[f].trim()) errors.push(`${at}.${f} is required`);
    }

    // highlights 3-6
    if (!Array.isArray(t.highlights) || t.highlights.length < 3 || t.highlights.length > 6) {
      errors.push(`${at}.highlights must have 3 to 6 entries, got ${t.highlights?.length}`);
    }

    // 10. geography
    if (!Array.isArray(t.countries) || t.countries.length < 1) {
      errors.push(`${at}.countries must list at least one country`);
    }
    if (!Array.isArray(t.cities) || t.cities.length < 1) {
      errors.push(`${at}.cities must list at least one city`);
    }
    if (!Array.isArray(t.regions)) {
      warnings.push(`${at}.regions is missing (recommended)`);
    }
    for (const c of t.countries ?? []) {
      if (/^(scotland|england|wales|northern ireland)$/i.test(c)) {
        errors.push(`${at}.countries has "${c}" — use "United Kingdom" and put "${c}" in regions`);
      }
    }
    for (const list of ['countries', 'regions', 'cities']) {
      for (const n of t[list] ?? []) {
        const k = slug(n);
        if (nameSpellings.has(k) && nameSpellings.get(k) !== n) {
          errors.push(`${at}.${list}: "${n}" is also spelled "${nameSpellings.get(k)}" elsewhere — use one spelling`);
        } else {
          nameSpellings.set(k, n);
        }
      }
    }

    // 9. destinationKeys / hero
    if (!Array.isArray(t.destinationKeys) || t.destinationKeys.length < 1) {
      errors.push(`${at}.destinationKeys must list at least one key`);
    } else {
      for (const dk of t.destinationKeys) {
        usedDestKeys.add(dk);
        if (!destKeys.has(dk)) errors.push(`${at}.destinationKeys: "${dk}" has no media.destinations entry`);
      }
      if (!t.destinationKeys.includes(t.hero)) {
        errors.push(`${at}.hero "${t.hero}" is not one of destinationKeys`);
      }
      const countryKey = slug(t.countries?.[0] ?? '');
      if (countryKey && !t.destinationKeys.includes(countryKey)) {
        warnings.push(`${at}.destinationKeys does not include the country key "${countryKey}"`);
      }
      // every region and city should be represented by some key (may share one, e.g. a
      // state and its namesake city), so check coverage by slug rather than by count.
      for (const list of ['regions', 'cities']) {
        for (const n of t[list] ?? []) {
          const want = `${countryKey}/${slug(n)}`;
          if (!t.destinationKeys.includes(want)) {
            warnings.push(`${at}.${list} "${n}" has no destinationKey "${want}"`);
          }
        }
      }
    }

    // 3. stays tile the trip
    if (!Array.isArray(t.stays) || t.stays.length < 1) {
      errors.push(`${at}.stays must have at least one stay`);
    } else {
      let cursor = 0;
      let nights = 0;
      for (const [si, s] of t.stays.entries()) {
        if (s.start !== cursor) {
          errors.push(`${at}.stays[${si}] (${s.base}): start is ${s.start} but the previous stay ends at ${cursor}`);
        }
        if (!Number.isInteger(s.nights) || s.nights < 1) {
          errors.push(`${at}.stays[${si}] (${s.base}): nights must be a whole number >= 1`);
        }
        cursor = s.start + (s.nights ?? 0);
        nights += s.nights ?? 0;
        if (!t.cities?.includes(s.base)) {
          errors.push(`${at}.stays[${si}]: base "${s.base}" is not listed in cities`);
        }
        if (typeof s.area !== 'string' || !s.area.trim()) {
          warnings.push(`${at}.stays[${si}] (${s.base}): area is empty`);
        }
        if (typeof s.hotel === 'string' && !/^(hotel|lodge|resort|riad|ryokan|camp|guesthouse|stay|accommodation)\b/i.test(s.hotel)) {
          warnings.push(`${at}.stays[${si}]: hotel "${s.hotel}" should be a generic placeholder, never a real hotel`);
        }
      }
      if (nights !== t.days - 1) {
        errors.push(`${at}.stays: nights add up to ${nights} but a ${t.days}-day trip has ${t.days - 1} nights`);
      }
    }

    // 4-8. activities
    const perDay = new Map();
    for (const [ai, a] of (t.activities ?? []).entries()) {
      const aat = `${at}.activities[${ai}] (${a.name})`;
      if (!Number.isInteger(a.day) || a.day < 0 || a.day > lastDay) {
        errors.push(`${aat}.day: ${a.day} is outside 0..${lastDay}`);
      }
      if (!ACTIVITY_TYPES.includes(a.type)) errors.push(`${aat}.type "${a.type}" is not an allowed type`);
      if (a.time !== '' && !TIME_RE.test(a.time ?? '')) errors.push(`${aat}.time "${a.time}" must be HH:MM or ""`);
      if (a.book !== '' && !String(a.book ?? '').startsWith('Yes - ')) {
        errors.push(`${aat}.book must be "" or start with "Yes - "`);
      }
      for (const f of ['name', 'where']) {
        if (typeof a[f] !== 'string' || !a[f].trim()) errors.push(`${aat}.${f} is required`);
      }
      if (typeof a.duration !== 'string' || !a.duration.trim()) warnings.push(`${aat}.duration is empty`);
      if (a.place) {
        usedPlaceKeys.add(a.place);
        if (!PLACE_KEY_RE.test(a.place)) errors.push(`${aat}.place "${a.place}" must be country/slug`);
        else if (!placeKeys.has(a.place)) errors.push(`${aat}.place "${a.place}" has no media.places entry`);
      }
      if (/\$|€|£|USD|EUR|\bprice\b|\bcosts?\b|promo/i.test(a.notes ?? '')) {
        errors.push(`${aat}.notes appears to mention price`);
      }
      if (!perDay.has(a.day)) perDay.set(a.day, []);
      perDay.get(a.day).push(a);
    }
    for (const [day, list] of perDay) {
      if (list.length > 6) errors.push(`${at}: day ${day} has ${list.length} activities (max 6)`);
      const times = list.map((a) => a.time).filter((x) => x !== '');
      const sorted = [...times].sort();
      if (times.join('|') !== sorted.join('|')) {
        errors.push(`${at}: day ${day} activities are not in time order (${times.join(', ')})`);
      }
    }
    if ((perDay.get(0)?.length ?? 0) > 3) warnings.push(`${at}: arrival day has ${perDay.get(0).length} activities — keep it light`);
    if ((perDay.get(lastDay)?.length ?? 0) > 3) warnings.push(`${at}: departure day has ${perDay.get(lastDay).length} activities — keep it short`);

    // 11. legs
    const legDays = new Set();
    for (const [li, l] of (t.legs ?? []).entries()) {
      const lat = `${at}.legs[${li}] (${l.from} -> ${l.to})`;
      if (!Number.isInteger(l.day) || l.day < 0 || l.day > lastDay) {
        errors.push(`${lat}.day: ${l.day} is outside 0..${lastDay}`);
      }
      if (!TRANSFER_TYPES.includes(l.transferType)) errors.push(`${lat}.transferType "${l.transferType}" is not allowed`);
      if (l.time !== '' && !TIME_RE.test(l.time ?? '')) errors.push(`${lat}.time "${l.time}" must be HH:MM or ""`);
      if (l.book !== '' && !String(l.book ?? '').startsWith('Yes - ')) {
        errors.push(`${lat}.book must be "" or start with "Yes - "`);
      }
      if (!Number.isInteger(l.minutes) || l.minutes < 1) errors.push(`${lat}.minutes must be a whole number of minutes`);
      for (const f of ['from', 'to', 'carrier']) {
        if (typeof l[f] !== 'string' || !l[f].trim()) warnings.push(`${lat}.${f} is empty`);
      }
      if (/\bflight\b|\bfly\b|\bairline\b/i.test(l.carrier ?? '')) {
        errors.push(`${lat}.carrier looks like a flight — legs are ground transfers only`);
      }
      legDays.add(l.day);
    }
    if (!legDays.has(0)) errors.push(`${at}.legs: no arrival leg on day 0`);
    if (!legDays.has(lastDay)) errors.push(`${at}.legs: no departure leg on day ${lastDay}`);
    // a leg for every move between bases
    for (const [si, s] of (t.stays ?? []).entries()) {
      if (si === 0) continue;
      if (!legDays.has(s.start)) {
        errors.push(`${at}.legs: no leg on day ${s.start} for the move into ${s.base}`);
      }
    }

    // 12a. tags
    if (t.pace !== undefined && !PACES.includes(t.pace)) errors.push(`${at}.pace "${t.pace}" must be R, B or F`);
    for (const i of t.interests ?? []) {
      if (!INTERESTS.includes(i)) errors.push(`${at}.interests "${i}" is not in the allowed vocabulary`);
    }
    if (!t.pace) warnings.push(`${at}.pace is missing`);
    if (!t.interests?.length) warnings.push(`${at}.interests is missing`);

    // sources
    if (!Array.isArray(t.sources)) warnings.push(`${at}.sources is missing`);

    // 12b. no two templates share both length and bases
    const basesKey = `${t.days}d::${[...new Set((t.stays ?? []).map((s) => s.base))].sort().join('|')}`;
    if (lengthBases.has(basesKey)) {
      errors.push(`${at} has the same length and bases as ${lengthBases.get(basesKey)}`);
    } else {
      lengthBases.set(basesKey, t.id);
    }
  }

  // 12 / 13. media content rules
  for (const [key, p] of Object.entries(places)) {
    const pat = `media.places["${key}"]`;
    if (typeof p.name !== 'string' || !p.name.trim()) errors.push(`${pat}.name is required`);
    if (typeof p.description !== 'string' || !p.description.trim()) {
      errors.push(`${pat}.description is required`);
    } else if (p.description.length >= 300) {
      errors.push(`${pat}.description is ${p.description.length} chars (must be under 300)`);
    }
    if (p.details) {
      if (typeof p.details !== 'string') errors.push(`${pat}.details must be a string`);
      else if (p.details.length >= 1000) errors.push(`${pat}.details is ${p.details.length} chars (must be under 1000)`);
      if (!p.description) errors.push(`${pat}.details requires a description`);
    }
    for (const f of ['description', 'details']) {
      const v = p[f] ?? '';
      if (/https?:\/\//i.test(v)) errors.push(`${pat}.${f} contains a link`);
      if (/\$|€|£|\bUSD\b|\bEUR\b/i.test(v)) errors.push(`${pat}.${f} appears to mention price`);
    }
    for (const i of p.interests ?? []) {
      if (!INTERESTS.includes(i)) errors.push(`${pat}.interests "${i}" is not in the allowed vocabulary`);
    }
    if ((p.interests?.length ?? 0) > 4) warnings.push(`${pat}.interests has ${p.interests.length} tags (use two to four)`);
    if (p.mobility !== undefined && !MOBILITY.includes(p.mobility)) {
      errors.push(`${pat}.mobility "${p.mobility}" must be L, M or H`);
    }
    if (p.image !== null && p.image !== undefined) {
      const img = p.image;
      if (typeof img !== 'object') errors.push(`${pat}.image must be null or a complete image object`);
      else {
        if (!/^https:\/\/upload\.wikimedia\.org\//.test(img.url ?? '')) {
          errors.push(`${pat}.image.url must be on upload.wikimedia.org`);
        }
        if (!['CC0', 'PD', 'Public Domain'].includes(img.license)) {
          errors.push(`${pat}.image.license must be a public-domain or CC0 license`);
        }
        for (const f of ['width', 'height', 'title', 'pageUrl', 'author']) {
          if (img[f] === undefined) errors.push(`${pat}.image.${f} is required`);
        }
      }
    }
    if (!placeUsed(key)) warnings.push(`${pat} is not referenced by any activity`);
  }

  function placeUsed(key) {
    return usedPlaceKeys.has(key);
  }

  for (const [key, d] of Object.entries(destinations)) {
    const dat = `media.destinations["${key}"]`;
    if (typeof d.name !== 'string' || !d.name.trim()) errors.push(`${dat}.name is required`);
    if (typeof d.description !== 'string' || !d.description.trim()) {
      errors.push(`${dat}.description is required`);
    } else if (d.description.length >= 300) {
      errors.push(`${dat}.description is ${d.description.length} chars (must be under 300)`);
    }
    if (/https?:\/\//i.test(d.description ?? '')) errors.push(`${dat}.description contains a link`);
    if (!Array.isArray(d.images)) errors.push(`${dat}.images must be an array`);
    else if (d.images.length) errors.push(`${dat}.images must be [] unless a CC0/public-domain file was verified`);
    if (!usedDestKeys.has(key)) warnings.push(`${dat} is not referenced by any template`);
  }

  return {
    errors,
    warnings,
    stats: {
      templates: bundle.templates.length,
      places: placeKeys.size,
      destinations: destKeys.size,
    },
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node validate-bundle.mjs <bundle.json> [...]');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const { errors, warnings, stats } = validate(file);
  const label = basename(file);
  if (stats) {
    console.log(`\n=== ${label}: ${stats.templates} templates, ${stats.places} places, ${stats.destinations} destinations`);
  } else {
    console.log(`\n=== ${label}`);
  }
  if (warnings.length) {
    console.log(`  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`    ~ ${w}`);
  }
  if (errors.length) {
    failed = true;
    console.log(`  ${errors.length} ERROR(s):`);
    for (const e of errors) console.log(`    x ${e}`);
  } else {
    console.log('  OK - no errors');
  }
}
process.exit(failed ? 1 : 0);
