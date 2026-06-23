/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import { parseCsvLine } from '../src/services/destinationsAttractionsCsv';

const EXPECTED_US_NATIONAL_PARKS = [
  'Acadia National Park',
  'American Samoa National Park',
  'Arches National Park',
  'Badlands National Park',
  'Big Bend National Park',
  'Biscayne National Park',
  'Black Canyon of the Gunnison National Park',
  'Bryce Canyon National Park',
  'Canyonlands National Park',
  'Capitol Reef National Park',
  'Carlsbad Caverns National Park',
  'Channel Islands National Park',
  'Congaree National Park',
  'Crater Lake National Park',
  'Cuyahoga Valley National Park',
  'Death Valley National Park',
  'Denali National Park',
  'Dry Tortugas National Park',
  'Everglades National Park',
  'Gates of the Arctic National Park',
  'Gateway Arch National Park',
  'Glacier Bay National Park',
  'Glacier National Park',
  'Grand Canyon National Park',
  'Grand Teton National Park',
  'Great Basin National Park',
  'Great Sand Dunes National Park',
  'Great Smoky Mountains National Park',
  'Guadalupe Mountains National Park',
  'Haleakala National Park',
  'Hawaii Volcanoes National Park',
  'Hot Springs National Park',
  'Indiana Dunes National Park',
  'Isle Royale National Park',
  'Joshua Tree National Park',
  'Katmai National Park',
  'Kenai Fjords National Park',
  'Kings Canyon National Park',
  'Kobuk Valley National Park',
  'Lake Clark National Park',
  'Lassen Volcanic National Park',
  'Mammoth Cave National Park',
  'Mesa Verde National Park',
  'Mount Rainier National Park',
  'New River Gorge National Park',
  'North Cascades National Park',
  'Olympic National Park',
  'Petrified Forest National Park',
  'Pinnacles National Park',
  'Redwood National Park',
  'Rocky Mountain National Park',
  'Saguaro National Park',
  'Sequoia National Park',
  'Shenandoah National Park',
  'Theodore Roosevelt National Park',
  'Virgin Islands National Park',
  'Voyageurs National Park',
  'White Sands National Park',
  'Wind Cave National Park',
  'Wrangell-St. Elias National Park',
  'Yellowstone National Park',
  'Yosemite National Park',
  'Zion National Park',
];

describe('destinations US national parks coverage', () => {
  it('includes all 63 U.S. National Parks in destinations.csv', () => {
    const filePath = path.resolve(__dirname, '../data/destinations.csv');
    const rows = fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const headers = parseCsvLine(rows[0]);
    const destinationIdx = headers.indexOf('Destination English Name');
    const countryIdx = headers.indexOf('Country');
    expect(destinationIdx).toBeGreaterThanOrEqual(0);
    expect(countryIdx).toBeGreaterThanOrEqual(0);

    const usDestinations = new Set<string>();
    for (let i = 1; i < rows.length; i += 1) {
      const cols = parseCsvLine(rows[i]);
      const destination = String(cols[destinationIdx] ?? '').trim();
      const country = String(cols[countryIdx] ?? '').trim();
      if (country === 'United States' && destination) usDestinations.add(destination);
    }

    const missing = EXPECTED_US_NATIONAL_PARKS.filter((name) => !usDestinations.has(name));
    expect(missing).toEqual([]);
  });
});
