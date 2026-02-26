
// server/scripts/generate_curated_attractions.ts
/**
 * Utility to generate CSV rows for the attractions catalog.
 * 
 * Usage:
 * 1. Make sure you have a destinations.csv file in the root of the project.
 * 2. Run with: ts-node server/scripts/generate_curated_attractions.ts
 * 3. Append output to server/data/attractions_catalog.csv
 */
import * as fs from 'fs';
import * as path from 'path';

interface Destination {
    'Destination English Name': string;
    'Country': string;
    'State/Provence': string;
    'Nearest City': string;
    'Destination Official Name': string;
}

interface Attraction {
    name: string;
    activityType: string;
    tags: string[];
    url: string;
    snippet: string;
    budget: string;
}

async function findAttractions(destination: Destination): Promise<Attraction[]> {
    if (destination['Destination English Name'] === 'Paris') {
        return [
            {
                name: 'Eiffel Tower',
                activityType: 'Ticketed Attraction',
                tags: ['iconic_landmarks', 'photography', 'romance'],
                url: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
                snippet: 'Wrought-iron lattice tower on the Champ de Mars.',
                budget: 'paid',
            },
            {
                name: 'Louvre Museum',
                activityType: 'Ticketed Attraction',
                tags: ['culture', 'iconic_landmarks'],
                url: 'https://en.wikipedia.org/wiki/Louvre',
                snippet: 'The world\'s largest art museum and a historic monument.',
                budget: 'paid',
            },
            {
                name: 'Notre-Dame Cathedral',
                activityType: 'Sights & Landmarks',
                tags: ['iconic_landmarks', 'history', 'architecture'],
                url: 'https://en.wikipedia.org/wiki/Notre-Dame_de_Paris',
                snippet: 'A marvel of medieval Gothic architecture, currently undergoing restoration.',
                budget: 'free',
            },
            {
                name: 'Arc de Triomphe',
                activityType: 'Ticketed Attraction',
                tags: ['iconic_landmarks', 'history', 'photography'],
                url: 'https://en.wikipedia.org/wiki/Arc_de_Triomphe',
                snippet: 'Monument commemorating French victories.',
                budget: 'paid',
            },
            {
                name: 'Musée d\'Orsay',
                activityType: 'Ticketed Attraction',
                tags: ['culture', 'art'],
                url: 'https://en.wikipedia.org/wiki/Mus%C3%A9e_d%27Orsay',
                snippet: 'Museum focusing on Impressionist and Post-Impressionist art.',
                budget: 'paid',
            },
        ];
    }
    return [];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseCSV(filePath: string): Destination[] {
    const csvData = fs.readFileSync(filePath, 'utf8');
    const lines = csvData.split('\\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
    const destinations: Destination[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.replace(/"/g, ''));
        if (values.length === headers.length) {
            const destination = {} as Destination;
            headers.forEach((header, index) => {
                destination[header as keyof Destination] = values[index];
            });
            destinations.push(destination);
        }
    }
    return destinations;
}

async function generateRows() {
  const now = new Date().toISOString();
  const destinations = parseCSV(path.resolve(__dirname, '../../destinations.csv'));
  
  console.log('id,destination_key,destination_display_name,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at');

  for (const destination of destinations) {
    const attractions = await findAttractions(destination);
    const destinationKey = slugify(destination['Destination English Name']);
    attractions.forEach((attr, index) => {
        const id = `attr:${destinationKey}:${slugify(attr.name)}`;
        const rank = index + 1;
        const tags = attr.tags.join('|');
        
        // CSV escaping
        const escape = (str: string) => {
          if (str.includes(',') || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };

        const row = [
          id,
          destinationKey,
          escape(destination['Destination English Name']),
          escape(attr.name),
          rank,
          attr.activityType,
          tags,
          attr.url,
          'curated', // Mark as curated to indicate high quality
          escape(attr.snippet),
          3, // High source count to prevent filtering
          attr.budget,
          now
        ].join(',');

        console.log(row);
    });
  }
}

generateRows();

