
import axios from 'axios';
import fs from 'fs';

interface Destination {
  'Destination English Name': string;
  'Country': string;
  'State/Provence': string;
  'Nearest City': string;
  'Destination Official Name': string;
}

interface Country {
    name: string;
    iso2: string;
}

async function getCountries(): Promise<Country[]> {
    return [{ name: 'France', iso2: 'FR' }];
}

async function findPopularDestinations(country: Country): Promise<Destination[]> {
    if (country.name === 'France') {
        return [
            {
                'Destination English Name': 'Paris',
                'Country': 'France',
                'State/Provence': 'Île-de-France',
                'Nearest City': 'Paris',
                'Destination Official Name': 'Paris'
            },
            {
                'Destination English Name': 'Versailles',
                'Country': 'France',
                'State/Provence': 'Île-de-France',
                'Nearest City': 'Versailles',
                'Destination Official Name': 'Château de Versailles'
            },
            {
                'Destination English Name': 'Loire Valley',
                'Country': 'France',
                'State/Provence': 'Centre-Val de Loire',
                'Nearest City': 'Tours',
                'Destination Official Name': 'Vallée de la Loire'
            },
            {
                'Destination English Name': 'French Riviera',
                'Country': 'France',
                'State/Provence': 'Provence-Alpes-Côte d\'Azur',
                'Nearest City': 'Nice',
                'Destination Official Name': 'Côte d\'Azur'
            },
            {
                'Destination English Name': 'Mont Saint-Michel',
                'Country': 'France',
                'State/Provence': 'Normandy',
                'Nearest City': 'Pontorson',
                'Destination Official Name': 'Mont-Saint-Michel'
            },
            {
                'Destination English Name': 'Provence',
                'Country': 'France',
                'State/Provence': 'Provence-Alpes-Côte d\'Azur',
                'Nearest City': 'Marseille',
                'Destination Official Name': 'Provence'
            },
            {
                'Destination English Name': 'Bordeaux',
                'Country': 'France',
                'State/Provence': 'Nouvelle-Aquitaine',
                'Nearest City': 'Bordeaux',
                'Destination Official Name': 'Bordeaux, Port of the Moon'
            },
            {
                'Destination English Name': 'Lyon',
                'Country': 'France',
                'State/Provence': 'Auvergne-Rhône-Alpes',
                'Nearest City': 'Lyon',
                'Destination Official Name': 'Lyon'
            },
            {
                'Destination English Name': 'Alsace',
                'Country': 'France',
                'State/Provence': 'Grand Est',
                'Nearest City': 'Strasbourg',
                'Destination Official Name': 'Alsace'
            },
            {
                'Destination English Name': 'Chamonix',
                'Country': 'France',
                'State/Provence': 'Auvergne-Rhône-Alpes',
                'Nearest City': 'Chamonix-Mont-Blanc',
                'Destination Official Name': 'Chamonix-Mont-Blanc'
            }
        ];
    }
    return [];
}

async function main() {
  const countries = await getCountries();
  const allDestinations: Destination[] = [];

  for (const country of countries) {
    const destinations = await findPopularDestinations(country);
    allDestinations.push(...destinations);
  }

  const csvHeader = '"Destination English Name","Country","State/Provence","Nearest City","Destination Official Name"\\n';
  const csvRows = allDestinations.map(d => `"${d['Destination English Name']}","${d.Country}","${d['State/Provence']}","${d['Nearest City']}","${d['Destination Official Name']}"`).join('\\n');
  const csvContent = csvHeader + csvRows;

  fs.writeFileSync('destinations.csv', csvContent);
  console.log('destinations.csv file created successfully.');
}

main();
