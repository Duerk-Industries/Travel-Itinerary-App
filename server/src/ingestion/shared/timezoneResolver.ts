import { logInfo } from '../../logger';

export type TimezoneStatus = 'RESOLVED' | 'INFERRED' | 'UNKNOWN';

export interface TimezoneResolution {
  timezone: string | null;
  timezoneStatus: TimezoneStatus;
  displayHint: string;
}

/**
 * Bundled IATA airport code to IANA timezone lookup.
 * Covers major international airports. Extend as needed.
 * Data source: public IATA/ICAO timezone mappings.
 */
const IATA_TO_TIMEZONE: Record<string, string> = {
  // North America
  ATL: 'America/New_York',
  BOS: 'America/New_York',
  JFK: 'America/New_York',
  LGA: 'America/New_York',
  EWR: 'America/New_York',
  PHL: 'America/New_York',
  IAD: 'America/New_York',
  DCA: 'America/New_York',
  CLT: 'America/New_York',
  MIA: 'America/New_York',
  FLL: 'America/New_York',
  MCO: 'America/New_York',
  TPA: 'America/New_York',
  DTW: 'America/New_York',
  CLE: 'America/New_York',
  PIT: 'America/New_York',
  BUF: 'America/New_York',
  RDU: 'America/New_York',
  ORD: 'America/Chicago',
  MDW: 'America/Chicago',
  MSP: 'America/Chicago',
  STL: 'America/Chicago',
  MCI: 'America/Chicago',
  DFW: 'America/Chicago',
  IAH: 'America/Chicago',
  HOU: 'America/Chicago',
  AUS: 'America/Chicago',
  SAT: 'America/Chicago',
  MSY: 'America/Chicago',
  MEM: 'America/Chicago',
  BNA: 'America/Chicago',
  IND: 'America/New_York',
  MKE: 'America/Chicago',
  OMA: 'America/Chicago',
  DEN: 'America/Denver',
  SLC: 'America/Denver',
  PHX: 'America/Phoenix',
  ABQ: 'America/Denver',
  BOI: 'America/Boise',
  LAX: 'America/Los_Angeles',
  SFO: 'America/Los_Angeles',
  SJC: 'America/Los_Angeles',
  OAK: 'America/Los_Angeles',
  SEA: 'America/Los_Angeles',
  PDX: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles',
  LAS: 'America/Los_Angeles',
  SMF: 'America/Los_Angeles',
  HNL: 'Pacific/Honolulu',
  ANC: 'America/Anchorage',
  YYZ: 'America/Toronto',
  YUL: 'America/Montreal',
  YVR: 'America/Vancouver',
  YYC: 'America/Edmonton',
  YOW: 'America/Toronto',
  MEX: 'America/Mexico_City',
  CUN: 'America/Cancun',
  GDL: 'America/Mexico_City',

  // Europe
  LHR: 'Europe/London',
  LGW: 'Europe/London',
  STN: 'Europe/London',
  LTN: 'Europe/London',
  CDG: 'Europe/Paris',
  ORY: 'Europe/Paris',
  AMS: 'Europe/Amsterdam',
  FRA: 'Europe/Berlin',
  MUC: 'Europe/Berlin',
  TXL: 'Europe/Berlin',
  BER: 'Europe/Berlin',
  ZRH: 'Europe/Zurich',
  VIE: 'Europe/Vienna',
  MAD: 'Europe/Madrid',
  BCN: 'Europe/Madrid',
  FCO: 'Europe/Rome',
  MXP: 'Europe/Rome',
  LIN: 'Europe/Rome',
  NAP: 'Europe/Rome',
  CPH: 'Europe/Copenhagen',
  OSL: 'Europe/Oslo',
  ARN: 'Europe/Stockholm',
  HEL: 'Europe/Helsinki',
  DUB: 'Europe/Dublin',
  BRU: 'Europe/Brussels',
  LIS: 'Europe/Lisbon',
  ATH: 'Europe/Athens',
  IST: 'Europe/Istanbul',
  WAW: 'Europe/Warsaw',
  PRG: 'Europe/Prague',
  BUD: 'Europe/Budapest',
  OTP: 'Europe/Bucharest',
  SOF: 'Europe/Sofia',
  ZAG: 'Europe/Zagreb',
  EDI: 'Europe/London',
  MAN: 'Europe/London',
  GVA: 'Europe/Zurich',

  // Asia & Oceania
  NRT: 'Asia/Tokyo',
  HND: 'Asia/Tokyo',
  KIX: 'Asia/Tokyo',
  ICN: 'Asia/Seoul',
  GMP: 'Asia/Seoul',
  PEK: 'Asia/Shanghai',
  PVG: 'Asia/Shanghai',
  HKG: 'Asia/Hong_Kong',
  TPE: 'Asia/Taipei',
  SIN: 'Asia/Singapore',
  KUL: 'Asia/Kuala_Lumpur',
  BKK: 'Asia/Bangkok',
  DEL: 'Asia/Kolkata',
  BOM: 'Asia/Kolkata',
  CCU: 'Asia/Kolkata',
  DXB: 'Asia/Dubai',
  AUH: 'Asia/Dubai',
  DOH: 'Asia/Qatar',
  SYD: 'Australia/Sydney',
  MEL: 'Australia/Melbourne',
  BNE: 'Australia/Brisbane',
  PER: 'Australia/Perth',
  AKL: 'Pacific/Auckland',
  MNL: 'Asia/Manila',
  CGK: 'Asia/Jakarta',
  SGN: 'Asia/Ho_Chi_Minh',
  HAN: 'Asia/Ho_Chi_Minh',

  // South America
  GRU: 'America/Sao_Paulo',
  GIG: 'America/Sao_Paulo',
  EZE: 'America/Argentina/Buenos_Aires',
  SCL: 'America/Santiago',
  BOG: 'America/Bogota',
  LIM: 'America/Lima',
  PTY: 'America/Panama',
  SJO: 'America/Costa_Rica',

  // Africa & Middle East
  JNB: 'Africa/Johannesburg',
  CPT: 'Africa/Johannesburg',
  CAI: 'Africa/Cairo',
  NBO: 'Africa/Nairobi',
  ADD: 'Africa/Addis_Ababa',
  CMN: 'Africa/Casablanca',
  LOS: 'Africa/Lagos',
  ACC: 'Africa/Accra',
  TLV: 'Asia/Jerusalem',
  AMM: 'Asia/Amman',
  RUH: 'Asia/Riyadh',
  JED: 'Asia/Riyadh',
};

/**
 * City/country to timezone lookup for lodging timezone inference.
 */
const CITY_TO_TIMEZONE: Record<string, string> = {
  'new york': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  chicago: 'America/Chicago',
  houston: 'America/Chicago',
  phoenix: 'America/Phoenix',
  philadelphia: 'America/New_York',
  'san antonio': 'America/Chicago',
  'san diego': 'America/Los_Angeles',
  dallas: 'America/Chicago',
  'san jose': 'America/Los_Angeles',
  austin: 'America/Chicago',
  'san francisco': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  denver: 'America/Denver',
  boston: 'America/New_York',
  miami: 'America/New_York',
  atlanta: 'America/New_York',
  orlando: 'America/New_York',
  nashville: 'America/Chicago',
  'las vegas': 'America/Los_Angeles',
  portland: 'America/Los_Angeles',
  honolulu: 'Pacific/Honolulu',
  anchorage: 'America/Anchorage',
  toronto: 'America/Toronto',
  montreal: 'America/Montreal',
  vancouver: 'America/Vancouver',
  london: 'Europe/London',
  paris: 'Europe/Paris',
  amsterdam: 'Europe/Amsterdam',
  berlin: 'Europe/Berlin',
  munich: 'Europe/Berlin',
  frankfurt: 'Europe/Berlin',
  zurich: 'Europe/Zurich',
  geneva: 'Europe/Zurich',
  vienna: 'Europe/Vienna',
  madrid: 'Europe/Madrid',
  barcelona: 'Europe/Madrid',
  rome: 'Europe/Rome',
  milan: 'Europe/Rome',
  naples: 'Europe/Rome',
  florence: 'Europe/Rome',
  venice: 'Europe/Rome',
  copenhagen: 'Europe/Copenhagen',
  oslo: 'Europe/Oslo',
  stockholm: 'Europe/Stockholm',
  helsinki: 'Europe/Helsinki',
  dublin: 'Europe/Dublin',
  brussels: 'Europe/Brussels',
  lisbon: 'Europe/Lisbon',
  athens: 'Europe/Athens',
  istanbul: 'Europe/Istanbul',
  prague: 'Europe/Prague',
  budapest: 'Europe/Budapest',
  edinburgh: 'Europe/London',
  manchester: 'Europe/London',
  tokyo: 'Asia/Tokyo',
  osaka: 'Asia/Tokyo',
  seoul: 'Asia/Seoul',
  beijing: 'Asia/Shanghai',
  shanghai: 'Asia/Shanghai',
  'hong kong': 'Asia/Hong_Kong',
  taipei: 'Asia/Taipei',
  singapore: 'Asia/Singapore',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  bangkok: 'Asia/Bangkok',
  delhi: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  dubai: 'Asia/Dubai',
  'abu dhabi': 'Asia/Dubai',
  doha: 'Asia/Qatar',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  brisbane: 'Australia/Brisbane',
  perth: 'Australia/Perth',
  auckland: 'Pacific/Auckland',
  'mexico city': 'America/Mexico_City',
  cancun: 'America/Cancun',
  'sao paulo': 'America/Sao_Paulo',
  'rio de janeiro': 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  santiago: 'America/Santiago',
  bogota: 'America/Bogota',
  lima: 'America/Lima',
  cairo: 'Africa/Cairo',
  johannesburg: 'Africa/Johannesburg',
  'cape town': 'Africa/Johannesburg',
  nairobi: 'Africa/Nairobi',
  casablanca: 'Africa/Casablanca',
  'tel aviv': 'Asia/Jerusalem',
  jerusalem: 'Asia/Jerusalem',
};

const IATA_DATA_BUNDLE_DATE = '2026-03-01';
const IATA_DATA_MAX_AGE_DAYS = 365;
let startupWarningLogged = false;

const checkBundleAge = (): void => {
  if (startupWarningLogged) return;
  const bundleDate = new Date(IATA_DATA_BUNDLE_DATE).getTime();
  const ageMs = Date.now() - bundleDate;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  if (ageDays > IATA_DATA_MAX_AGE_DAYS) {
    logInfo(`[ingestion] IATA timezone bundle is ${ageDays} days old (bundled ${IATA_DATA_BUNDLE_DATE}). Consider updating.`);
  }
  startupWarningLogged = true;
};

export const resolveTimezoneFromIata = (iataCode: string | null | undefined): string | null => {
  if (!iataCode) return null;
  checkBundleAge();
  return IATA_TO_TIMEZONE[iataCode.toUpperCase().trim()] ?? null;
};

export const resolveTimezoneFromCity = (city: string | null | undefined): string | null => {
  if (!city) return null;
  checkBundleAge();
  const normalized = city.trim().toLowerCase();
  return CITY_TO_TIMEZONE[normalized] ?? null;
};

/**
 * TimezoneResolver: follows the explicit priority order from requirements.
 *
 * 1. Use IANA timezone explicitly present in the source document if parseable.
 * 2. For flights/rail: infer from origin/destination IATA codes or city names.
 * 3. For hotels/lodging: infer from property city or country.
 * 4. If inference fails: store timezone_status = UNKNOWN.
 */
export const resolveTimezone = (params: {
  itemType: string;
  explicitTimezone?: string | null;
  departureCode?: string | null;
  arrivalCode?: string | null;
  departureCity?: string | null;
  arrivalCity?: string | null;
  propertyCity?: string | null;
  locationText?: string | null;
}): {
  departureTimezone: TimezoneResolution;
  arrivalTimezone: TimezoneResolution | null;
} => {
  // Priority 1: explicit IANA timezone from source document
  if (params.explicitTimezone && isValidIanaTimezone(params.explicitTimezone)) {
    const resolved: TimezoneResolution = {
      timezone: params.explicitTimezone,
      timezoneStatus: 'RESOLVED',
      displayHint: 'item-local',
    };
    const isTransfer = ['flight', 'rail', 'ferry_bus_transfer'].includes(params.itemType);
    return { departureTimezone: resolved, arrivalTimezone: isTransfer ? { ...resolved } : null };
  }

  const isTransfer = ['flight', 'rail', 'ferry_bus_transfer'].includes(params.itemType);
  const isLodging = params.itemType === 'hotel';

  if (isTransfer) {
    // Priority 2: infer from IATA codes
    const depTz = resolveTimezoneFromIata(params.departureCode) ?? resolveTimezoneFromCity(params.departureCity);
    const arrTz = resolveTimezoneFromIata(params.arrivalCode) ?? resolveTimezoneFromCity(params.arrivalCity);
    return {
      departureTimezone: depTz
        ? { timezone: depTz, timezoneStatus: 'INFERRED', displayHint: 'item-local' }
        : { timezone: null, timezoneStatus: 'UNKNOWN', displayHint: 'timezone unknown' },
      arrivalTimezone: arrTz
        ? { timezone: arrTz, timezoneStatus: 'INFERRED', displayHint: 'item-local' }
        : { timezone: null, timezoneStatus: 'UNKNOWN', displayHint: 'timezone unknown' },
    };
  }

  if (isLodging) {
    // Priority 3: infer from property city
    const propTz = resolveTimezoneFromCity(params.propertyCity) ?? resolveTimezoneFromCity(params.locationText);
    return {
      departureTimezone: propTz
        ? { timezone: propTz, timezoneStatus: 'INFERRED', displayHint: 'item-local' }
        : { timezone: null, timezoneStatus: 'UNKNOWN', displayHint: 'timezone unknown' },
      arrivalTimezone: null,
    };
  }

  // Other item types: try location-based inference
  const locTz = resolveTimezoneFromCity(params.propertyCity) ?? resolveTimezoneFromCity(params.locationText);
  return {
    departureTimezone: locTz
      ? { timezone: locTz, timezoneStatus: 'INFERRED', displayHint: 'item-local' }
      : { timezone: null, timezoneStatus: 'UNKNOWN', displayHint: 'timezone unknown' },
    arrivalTimezone: null,
  };
};

const isValidIanaTimezone = (tz: string): boolean => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const getIataLookupTable = (): Readonly<Record<string, string>> => IATA_TO_TIMEZONE;
export const getCityLookupTable = (): Readonly<Record<string, string>> => CITY_TO_TIMEZONE;
