import axios from 'axios';
import fs from 'fs';
import path from 'path';

interface Destination {
  'Destination English Name': string;
  Country: string;
  'State/Provence': string;
  'Nearest City': string;
  'Destination Official Name': string;
}

interface DestinationSeed {
  name: string;
  state: string;
  city: string;
  officialName?: string;
}

interface Country {
  name: string;
  officialName: string;
  iso2: string;
  iso3: string;
  capital: string[];
  areaKm2: number;
  population: number;
}

interface RestCountry {
  name?: {
    common?: string;
    official?: string;
  };
  cca2?: string;
  cca3?: string;
  capital?: string[];
  area?: number;
  population?: number;
}

interface CountryNowPopulationCount {
  year?: string;
  value?: string;
  sex?: string;
  reliabilty?: string;
}

interface CountryNowCityRecord {
  city?: string;
  country?: string;
  populationCounts?: CountryNowPopulationCount[];
}

interface CountryNowFilterResponse {
  error?: boolean;
  msg?: string;
  data?: CountryNowCityRecord[];
}

interface CountryNowCitiesResponse {
  error?: boolean;
  msg?: string;
  data?: string[];
}

const DESTINATIONS_BY_COUNTRY: Record<string, DestinationSeed[]> = {
  france: [
    { name: 'Paris', state: 'Ile-de-France', city: 'Paris' },
    { name: 'Versailles', state: 'Ile-de-France', city: 'Versailles', officialName: 'Chateau de Versailles' },
    { name: 'Lyon', state: 'Auvergne-Rhone-Alpes', city: 'Lyon' },
    { name: 'Marseille', state: 'Provence-Alpes-Cote dAzur', city: 'Marseille' },
    { name: 'Nice', state: 'Provence-Alpes-Cote dAzur', city: 'Nice' },
    { name: 'French Riviera', state: 'Provence-Alpes-Cote dAzur', city: 'Nice', officialName: 'Cote dAzur' },
    { name: 'Bordeaux', state: 'Nouvelle-Aquitaine', city: 'Bordeaux' },
    { name: 'Mont Saint-Michel', state: 'Normandy', city: 'Pontorson', officialName: 'Mont-Saint-Michel' },
    { name: 'Loire Valley', state: 'Centre-Val de Loire', city: 'Tours', officialName: 'Vallee de la Loire' },
    { name: 'Strasbourg', state: 'Grand Est', city: 'Strasbourg' },
    { name: 'Chamonix', state: 'Auvergne-Rhone-Alpes', city: 'Chamonix-Mont-Blanc' },
    { name: 'Avignon', state: 'Provence-Alpes-Cote dAzur', city: 'Avignon' },
    { name: 'Annecy', state: 'Auvergne-Rhone-Alpes', city: 'Annecy' },
    { name: 'Carcassonne', state: 'Occitanie', city: 'Carcassonne' },
    { name: 'Saint-Malo', state: 'Brittany', city: 'Saint-Malo' },
    { name: 'Reims', state: 'Grand Est', city: 'Reims' },
    { name: 'Dune of Pilat', state: 'Nouvelle-Aquitaine', city: 'Arcachon', officialName: 'Grande Dune du Pilat' },
    { name: 'Calanques National Park', state: 'Provence-Alpes-Cote dAzur', city: 'Marseille' },
    { name: 'Corsica', state: 'Corsica', city: 'Ajaccio' },
    { name: 'Nimes', state: 'Occitanie', city: 'Nimes' },
    { name: 'Lille', state: 'Hauts-de-France', city: 'Lille' },
    { name: 'Toulouse', state: 'Occitanie', city: 'Toulouse' },
    { name: 'Colmar', state: 'Grand Est', city: 'Colmar' },
    { name: 'Biarritz', state: 'Nouvelle-Aquitaine', city: 'Biarritz' },
    { name: 'Aix-en-Provence', state: 'Provence-Alpes-Cote dAzur', city: 'Aix-en-Provence' },
  ],
  italy: [
    { name: 'Rome', state: 'Lazio', city: 'Rome', officialName: 'Roma' },
    { name: 'Florence', state: 'Tuscany', city: 'Florence', officialName: 'Firenze' },
    { name: 'Venice', state: 'Veneto', city: 'Venice', officialName: 'Venezia' },
    { name: 'Milan', state: 'Lombardy', city: 'Milan', officialName: 'Milano' },
    { name: 'Naples', state: 'Campania', city: 'Naples', officialName: 'Napoli' },
    { name: 'Cinque Terre', state: 'Liguria', city: 'La Spezia' },
    { name: 'Amalfi Coast', state: 'Campania', city: 'Sorrento', officialName: 'Costiera Amalfitana' },
    { name: 'Lake Como', state: 'Lombardy', city: 'Como', officialName: 'Lago di Como' },
    { name: 'Sicily', state: 'Sicily', city: 'Palermo', officialName: 'Sicilia' },
    { name: 'Sardinia', state: 'Sardinia', city: 'Cagliari', officialName: 'Sardegna' },
    { name: 'Bologna', state: 'Emilia-Romagna', city: 'Bologna' },
    { name: 'Turin', state: 'Piedmont', city: 'Turin', officialName: 'Torino' },
    { name: 'Verona', state: 'Veneto', city: 'Verona' },
    { name: 'Pisa', state: 'Tuscany', city: 'Pisa' },
    { name: 'Siena', state: 'Tuscany', city: 'Siena' },
    { name: 'Pompeii', state: 'Campania', city: 'Pompei', officialName: 'Pompei Archaeological Park' },
    { name: 'Dolomites', state: 'Trentino-Alto Adige', city: 'Bolzano' },
    { name: 'Vatican City', state: 'Lazio', city: 'Rome', officialName: 'Citta del Vaticano' },
    { name: 'Capri', state: 'Campania', city: 'Capri' },
    { name: 'Puglia', state: 'Apulia', city: 'Bari' },
    { name: 'Matera', state: 'Basilicata', city: 'Matera' },
    { name: 'Taormina', state: 'Sicily', city: 'Taormina' },
    { name: 'Assisi', state: 'Umbria', city: 'Assisi' },
    { name: 'Genoa', state: 'Liguria', city: 'Genoa', officialName: 'Genova' },
    { name: 'Ravenna', state: 'Emilia-Romagna', city: 'Ravenna' },
  ],
  'united states': [
    { name: 'New York City', state: 'New York', city: 'New York City' },
    { name: 'Los Angeles', state: 'California', city: 'Los Angeles' },
    { name: 'San Francisco', state: 'California', city: 'San Francisco' },
    { name: 'Las Vegas', state: 'Nevada', city: 'Las Vegas' },
    { name: 'Washington, DC', state: 'District of Columbia', city: 'Washington' },
    { name: 'Chicago', state: 'Illinois', city: 'Chicago' },
    { name: 'Miami', state: 'Florida', city: 'Miami' },
    { name: 'Orlando', state: 'Florida', city: 'Orlando' },
    { name: 'Boston', state: 'Massachusetts', city: 'Boston' },
    { name: 'Seattle', state: 'Washington', city: 'Seattle' },
    { name: 'Honolulu', state: 'Hawaii', city: 'Honolulu' },
    { name: 'Grand Canyon National Park', state: 'Arizona', city: 'Flagstaff' },
    { name: 'Yellowstone National Park', state: 'Wyoming', city: 'West Yellowstone' },
    { name: 'Yosemite National Park', state: 'California', city: 'Fresno' },
    { name: 'Zion National Park', state: 'Utah', city: 'Springdale' },
    { name: 'Bryce Canyon National Park', state: 'Utah', city: 'Bryce' },
    { name: 'Rocky Mountain National Park', state: 'Colorado', city: 'Estes Park' },
    { name: 'Great Smoky Mountains National Park', state: 'Tennessee', city: 'Gatlinburg' },
    { name: 'Glacier National Park', state: 'Montana', city: 'Kalispell' },
    { name: 'Acadia National Park', state: 'Maine', city: 'Bar Harbor' },
    { name: 'New Orleans', state: 'Louisiana', city: 'New Orleans' },
    { name: 'Austin', state: 'Texas', city: 'Austin' },
    { name: 'Nashville', state: 'Tennessee', city: 'Nashville' },
    { name: 'San Diego', state: 'California', city: 'San Diego' },
    { name: 'Philadelphia', state: 'Pennsylvania', city: 'Philadelphia' },
    { name: 'Charleston', state: 'South Carolina', city: 'Charleston' },
    { name: 'Maui', state: 'Hawaii', city: 'Kahului' },
    { name: 'Monument Valley', state: 'Arizona', city: 'Kayenta' },
  ],
  china: [
    { name: 'Beijing', state: 'Beijing Municipality', city: 'Beijing' },
    { name: 'Shanghai', state: 'Shanghai Municipality', city: 'Shanghai' },
    { name: 'Great Wall of China', state: 'Beijing Municipality', city: 'Beijing' },
    { name: 'Xi an', state: 'Shaanxi', city: 'Xi an', officialName: "Xi'an" },
    { name: 'Terracotta Army', state: 'Shaanxi', city: 'Xi an' },
    { name: 'Guangzhou', state: 'Guangdong', city: 'Guangzhou' },
    { name: 'Shenzhen', state: 'Guangdong', city: 'Shenzhen' },
    { name: 'Chengdu', state: 'Sichuan', city: 'Chengdu' },
    { name: 'Guilin', state: 'Guangxi', city: 'Guilin' },
    { name: 'Li River', state: 'Guangxi', city: 'Guilin' },
    { name: 'Hangzhou', state: 'Zhejiang', city: 'Hangzhou' },
    { name: 'West Lake', state: 'Zhejiang', city: 'Hangzhou' },
    { name: 'Suzhou', state: 'Jiangsu', city: 'Suzhou' },
    { name: 'Zhangjiajie National Forest Park', state: 'Hunan', city: 'Zhangjiajie' },
    { name: 'Jiuzhaigou National Park', state: 'Sichuan', city: 'Jiuzhaigou' },
    { name: 'Harbin', state: 'Heilongjiang', city: 'Harbin' },
    { name: 'Lhasa', state: 'Tibet Autonomous Region', city: 'Lhasa' },
    { name: 'Chongqing', state: 'Chongqing Municipality', city: 'Chongqing' },
    { name: 'Nanjing', state: 'Jiangsu', city: 'Nanjing' },
    { name: 'Xiamen', state: 'Fujian', city: 'Xiamen' },
    { name: 'Qingdao', state: 'Shandong', city: 'Qingdao' },
    { name: 'Dali', state: 'Yunnan', city: 'Dali' },
    { name: 'Lijiang', state: 'Yunnan', city: 'Lijiang' },
    { name: 'Huangshan', state: 'Anhui', city: 'Huangshan' },
    { name: 'Yangshuo', state: 'Guangxi', city: 'Yangshuo' },
  ],
  spain: [
    { name: 'Barcelona', state: 'Catalonia', city: 'Barcelona' },
    { name: 'Madrid', state: 'Community of Madrid', city: 'Madrid' },
    { name: 'Seville', state: 'Andalusia', city: 'Seville' },
    { name: 'Valencia', state: 'Valencian Community', city: 'Valencia' },
    { name: 'Granada', state: 'Andalusia', city: 'Granada' },
    { name: 'Mallorca', state: 'Balearic Islands', city: 'Palma' },
    { name: 'San Sebastian', state: 'Basque Country', city: 'San Sebastian' },
    { name: 'Cordoba', state: 'Andalusia', city: 'Cordoba' },
    { name: 'Santiago de Compostela', state: 'Galicia', city: 'Santiago de Compostela' },
    { name: 'Ibiza', state: 'Balearic Islands', city: 'Ibiza Town' },
    { name: 'Canary Islands', state: 'Canary Islands', city: 'Las Palmas' },
    { name: 'Bilbao', state: 'Basque Country', city: 'Bilbao' },
  ],
  japan: [
    { name: 'Tokyo', state: 'Tokyo Metropolis', city: 'Tokyo' },
    { name: 'Kyoto', state: 'Kyoto Prefecture', city: 'Kyoto' },
    { name: 'Osaka', state: 'Osaka Prefecture', city: 'Osaka' },
    { name: 'Mount Fuji', state: 'Yamanashi', city: 'Fujiyoshida' },
    { name: 'Nara', state: 'Nara Prefecture', city: 'Nara' },
    { name: 'Hiroshima', state: 'Hiroshima Prefecture', city: 'Hiroshima' },
    { name: 'Sapporo', state: 'Hokkaido', city: 'Sapporo' },
    { name: 'Hakone', state: 'Kanagawa', city: 'Hakone' },
    { name: 'Okinawa', state: 'Okinawa Prefecture', city: 'Naha' },
    { name: 'Kanazawa', state: 'Ishikawa Prefecture', city: 'Kanazawa' },
    { name: 'Kamakura', state: 'Kanagawa', city: 'Kamakura' },
    { name: 'Takayama', state: 'Gifu Prefecture', city: 'Takayama' },
  ],
  thailand: [
    { name: 'Bangkok', state: 'Bangkok', city: 'Bangkok' },
    { name: 'Chiang Mai', state: 'Chiang Mai', city: 'Chiang Mai' },
    { name: 'Phuket', state: 'Phuket', city: 'Phuket City' },
    { name: 'Krabi', state: 'Krabi', city: 'Krabi' },
    { name: 'Koh Samui', state: 'Surat Thani', city: 'Chaweng' },
    { name: 'Ayutthaya', state: 'Phra Nakhon Si Ayutthaya', city: 'Ayutthaya' },
    { name: 'Pattaya', state: 'Chonburi', city: 'Pattaya' },
    { name: 'Khao Sok National Park', state: 'Surat Thani', city: 'Khao Sok' },
    { name: 'Pai', state: 'Mae Hong Son', city: 'Pai' },
    { name: 'Koh Phi Phi', state: 'Krabi', city: 'Phi Phi Don' },
  ],
  germany: [
    { name: 'Berlin', state: 'Berlin', city: 'Berlin' },
    { name: 'Munich', state: 'Bavaria', city: 'Munich' },
    { name: 'Hamburg', state: 'Hamburg', city: 'Hamburg' },
    { name: 'Cologne', state: 'North Rhine-Westphalia', city: 'Cologne' },
    { name: 'Frankfurt', state: 'Hesse', city: 'Frankfurt' },
    { name: 'Black Forest', state: 'Baden-Wurttemberg', city: 'Freiburg' },
    { name: 'Neuschwanstein Castle', state: 'Bavaria', city: 'Fussen' },
    { name: 'Dresden', state: 'Saxony', city: 'Dresden' },
    { name: 'Heidelberg', state: 'Baden-Wurttemberg', city: 'Heidelberg' },
    { name: 'Nuremberg', state: 'Bavaria', city: 'Nuremberg' },
  ],
  'united kingdom': [
    { name: 'London', state: 'England', city: 'London' },
    { name: 'Edinburgh', state: 'Scotland', city: 'Edinburgh' },
    { name: 'Manchester', state: 'England', city: 'Manchester' },
    { name: 'Liverpool', state: 'England', city: 'Liverpool' },
    { name: 'Bath', state: 'England', city: 'Bath' },
    { name: 'Oxford', state: 'England', city: 'Oxford' },
    { name: 'Cambridge', state: 'England', city: 'Cambridge' },
    { name: 'Scottish Highlands', state: 'Scotland', city: 'Inverness' },
    { name: 'Belfast', state: 'Northern Ireland', city: 'Belfast' },
    { name: 'Cardiff', state: 'Wales', city: 'Cardiff' },
  ],
  mexico: [
    { name: 'Mexico City', state: 'Mexico City', city: 'Mexico City' },
    { name: 'Cancun', state: 'Quintana Roo', city: 'Cancun' },
    { name: 'Playa del Carmen', state: 'Quintana Roo', city: 'Playa del Carmen' },
    { name: 'Tulum', state: 'Quintana Roo', city: 'Tulum' },
    { name: 'Chichen Itza', state: 'Yucatan', city: 'Valladolid' },
    { name: 'Oaxaca', state: 'Oaxaca', city: 'Oaxaca' },
    { name: 'Puerto Vallarta', state: 'Jalisco', city: 'Puerto Vallarta' },
    { name: 'Guadalajara', state: 'Jalisco', city: 'Guadalajara' },
    { name: 'Los Cabos', state: 'Baja California Sur', city: 'Cabo San Lucas' },
    { name: 'San Miguel de Allende', state: 'Guanajuato', city: 'San Miguel de Allende' },
  ],
  turkey: [
    { name: 'Istanbul', state: 'Istanbul', city: 'Istanbul' },
    { name: 'Cappadocia', state: 'Nevsehir', city: 'Goreme' },
    { name: 'Antalya', state: 'Antalya', city: 'Antalya' },
    { name: 'Pamukkale', state: 'Denizli', city: 'Denizli' },
    { name: 'Ephesus', state: 'Izmir', city: 'Selcuk' },
    { name: 'Bodrum', state: 'Mugla', city: 'Bodrum' },
    { name: 'Ankara', state: 'Ankara', city: 'Ankara' },
    { name: 'Izmir', state: 'Izmir', city: 'Izmir' },
  ],
  greece: [
    { name: 'Athens', state: 'Attica', city: 'Athens' },
    { name: 'Santorini', state: 'South Aegean', city: 'Fira' },
    { name: 'Mykonos', state: 'South Aegean', city: 'Mykonos Town' },
    { name: 'Crete', state: 'Crete', city: 'Heraklion' },
    { name: 'Rhodes', state: 'South Aegean', city: 'Rhodes' },
    { name: 'Meteora', state: 'Thessaly', city: 'Kalabaka' },
    { name: 'Corfu', state: 'Ionian Islands', city: 'Corfu Town' },
    { name: 'Thessaloniki', state: 'Central Macedonia', city: 'Thessaloniki' },
  ],
  portugal: [
    { name: 'Lisbon', state: 'Lisbon', city: 'Lisbon' },
    { name: 'Porto', state: 'Porto', city: 'Porto' },
    { name: 'Algarve', state: 'Faro', city: 'Faro' },
    { name: 'Sintra', state: 'Lisbon', city: 'Sintra' },
    { name: 'Madeira', state: 'Madeira', city: 'Funchal' },
    { name: 'Azores', state: 'Azores', city: 'Ponta Delgada' },
    { name: 'Coimbra', state: 'Coimbra', city: 'Coimbra' },
  ],
  india: [
    { name: 'Delhi', state: 'Delhi', city: 'New Delhi' },
    { name: 'Agra', state: 'Uttar Pradesh', city: 'Agra' },
    { name: 'Jaipur', state: 'Rajasthan', city: 'Jaipur' },
    { name: 'Mumbai', state: 'Maharashtra', city: 'Mumbai' },
    { name: 'Goa', state: 'Goa', city: 'Panaji' },
    { name: 'Varanasi', state: 'Uttar Pradesh', city: 'Varanasi' },
    { name: 'Kerala Backwaters', state: 'Kerala', city: 'Alappuzha' },
    { name: 'Udaipur', state: 'Rajasthan', city: 'Udaipur' },
    { name: 'Rishikesh', state: 'Uttarakhand', city: 'Rishikesh' },
  ],
  australia: [
    { name: 'Sydney', state: 'New South Wales', city: 'Sydney' },
    { name: 'Melbourne', state: 'Victoria', city: 'Melbourne' },
    { name: 'Great Barrier Reef', state: 'Queensland', city: 'Cairns' },
    { name: 'Uluru', state: 'Northern Territory', city: 'Yulara' },
    { name: 'Brisbane', state: 'Queensland', city: 'Brisbane' },
    { name: 'Perth', state: 'Western Australia', city: 'Perth' },
    { name: 'Tasmania', state: 'Tasmania', city: 'Hobart' },
    { name: 'Gold Coast', state: 'Queensland', city: 'Gold Coast' },
  ],
  canada: [
    { name: 'Toronto', state: 'Ontario', city: 'Toronto' },
    { name: 'Vancouver', state: 'British Columbia', city: 'Vancouver' },
    { name: 'Montreal', state: 'Quebec', city: 'Montreal' },
    { name: 'Banff National Park', state: 'Alberta', city: 'Banff' },
    { name: 'Quebec City', state: 'Quebec', city: 'Quebec City' },
    { name: 'Niagara Falls', state: 'Ontario', city: 'Niagara Falls' },
    { name: 'Whistler', state: 'British Columbia', city: 'Whistler' },
  ],
  brazil: [
    { name: 'Rio de Janeiro', state: 'Rio de Janeiro', city: 'Rio de Janeiro' },
    { name: 'Sao Paulo', state: 'Sao Paulo', city: 'Sao Paulo' },
    { name: 'Iguazu Falls', state: 'Parana', city: 'Foz do Iguacu' },
    { name: 'Salvador', state: 'Bahia', city: 'Salvador' },
    { name: 'Amazon Rainforest', state: 'Amazonas', city: 'Manaus' },
    { name: 'Florianopolis', state: 'Santa Catarina', city: 'Florianopolis' },
    { name: 'Brasilia', state: 'Federal District', city: 'Brasilia' },
  ],
  vietnam: [
    { name: 'Hanoi', state: 'Hanoi', city: 'Hanoi' },
    { name: 'Ho Chi Minh City', state: 'Ho Chi Minh', city: 'Ho Chi Minh City' },
    { name: 'Ha Long Bay', state: 'Quang Ninh', city: 'Ha Long' },
    { name: 'Hoi An', state: 'Quang Nam', city: 'Hoi An' },
    { name: 'Da Nang', state: 'Da Nang', city: 'Da Nang' },
    { name: 'Hue', state: 'Thua Thien Hue', city: 'Hue' },
    { name: 'Sapa', state: 'Lao Cai', city: 'Sapa' },
    { name: 'Nha Trang', state: 'Khanh Hoa', city: 'Nha Trang' },
    { name: 'Phu Quoc', state: 'Kien Giang', city: 'Duong Dong' },
    { name: 'Can Tho', state: 'Can Tho', city: 'Can Tho' },
    { name: 'Phong Nha-Ke Bang National Park', state: 'Quang Binh', city: 'Phong Nha' },
    { name: 'Mekong Delta', state: 'An Giang', city: 'Can Tho' },
  ],
};

const NATURE_DESTINATIONS_BY_COUNTRY: Record<string, DestinationSeed[]> = {
  'united states': [
    { name: 'Arches National Park', state: 'Utah', city: 'Moab' },
    { name: 'Olympic National Park', state: 'Washington', city: 'Port Angeles' },
    { name: 'Death Valley National Park', state: 'California', city: 'Furnace Creek' },
    { name: 'Sequoia National Park', state: 'California', city: 'Visalia' },
    { name: 'Kings Canyon National Park', state: 'California', city: 'Fresno' },
    { name: 'Joshua Tree National Park', state: 'California', city: 'Palm Springs' },
    { name: 'Everglades National Park', state: 'Florida', city: 'Homestead' },
    { name: 'Denali National Park', state: 'Alaska', city: 'Healy' },
    { name: 'Mount Rainier National Park', state: 'Washington', city: 'Tacoma' },
    { name: 'Shenandoah National Park', state: 'Virginia', city: 'Luray' },
    { name: 'Grand Teton National Park', state: 'Wyoming', city: 'Jackson' },
    { name: 'Crater Lake National Park', state: 'Oregon', city: 'Klamath Falls' },
    { name: 'Badlands National Park', state: 'South Dakota', city: 'Wall' },
    { name: 'Canyonlands National Park', state: 'Utah', city: 'Moab' },
    { name: 'Capitol Reef National Park', state: 'Utah', city: 'Torrey' },
    { name: 'Big Bend National Park', state: 'Texas', city: 'Terlingua' },
    { name: 'Redwood National Park', state: 'California', city: 'Crescent City' },
    { name: 'Haleakala National Park', state: 'Hawaii', city: 'Kahului' },
    { name: 'Lake Tahoe', state: 'California', city: 'South Lake Tahoe' },
    { name: 'Antelope Canyon', state: 'Arizona', city: 'Page' },
  ],
  china: [
    { name: 'Huanglong Scenic and Historic Interest Area', state: 'Sichuan', city: 'Songpan' },
    { name: 'Wulingyuan Scenic Area', state: 'Hunan', city: 'Zhangjiajie' },
    { name: 'Mount Huangshan', state: 'Anhui', city: 'Huangshan' },
    { name: 'Mount Emei', state: 'Sichuan', city: 'Emeishan' },
    { name: 'Three Gorges', state: 'Chongqing', city: 'Yichang' },
    { name: 'Yarlung Tsangpo Grand Canyon', state: 'Tibet Autonomous Region', city: 'Nyingchi' },
    { name: 'Kanas Lake', state: 'Xinjiang', city: 'Altay' },
    { name: 'Tiger Leaping Gorge', state: 'Yunnan', city: 'Lijiang' },
    { name: 'Mount Tai', state: 'Shandong', city: 'Tai an' },
    { name: 'Shilin Stone Forest', state: 'Yunnan', city: 'Kunming' },
    { name: 'Changbai Mountain', state: 'Jilin', city: 'Baishan' },
    { name: 'Mount Wuyi', state: 'Fujian', city: 'Nanping' },
    { name: 'Potatso National Park', state: 'Yunnan', city: 'Shangri-La' },
    { name: 'Kekexili Nature Reserve', state: 'Qinghai', city: 'Golmud' },
    { name: 'Moon Hill', state: 'Guangxi', city: 'Yangshuo' },
  ],
  canada: [
    { name: 'Jasper National Park', state: 'Alberta', city: 'Jasper' },
    { name: 'Yoho National Park', state: 'British Columbia', city: 'Field' },
    { name: 'Pacific Rim National Park Reserve', state: 'British Columbia', city: 'Tofino' },
    { name: 'Gros Morne National Park', state: 'Newfoundland and Labrador', city: 'Rocky Harbour' },
    { name: 'Fundy National Park', state: 'New Brunswick', city: 'Alma' },
    { name: 'Cape Breton Highlands National Park', state: 'Nova Scotia', city: 'Cheticamp' },
    { name: 'Waterton Lakes National Park', state: 'Alberta', city: 'Waterton Park' },
    { name: 'Kluane National Park', state: 'Yukon', city: 'Haines Junction' },
  ],
  australia: [
    { name: 'Kakadu National Park', state: 'Northern Territory', city: 'Jabiru' },
    { name: 'Daintree Rainforest', state: 'Queensland', city: 'Cairns' },
    { name: 'Blue Mountains National Park', state: 'New South Wales', city: 'Katoomba' },
    { name: 'Grampians National Park', state: 'Victoria', city: 'Halls Gap' },
    { name: 'Freycinet National Park', state: 'Tasmania', city: 'Coles Bay' },
    { name: 'Kosciuszko National Park', state: 'New South Wales', city: 'Jindabyne' },
    { name: 'Ningaloo Reef', state: 'Western Australia', city: 'Exmouth' },
  ],
  india: [
    { name: 'Ranthambore National Park', state: 'Rajasthan', city: 'Sawai Madhopur' },
    { name: 'Jim Corbett National Park', state: 'Uttarakhand', city: 'Ramnagar' },
    { name: 'Kaziranga National Park', state: 'Assam', city: 'Bokakhat' },
    { name: 'Sundarbans National Park', state: 'West Bengal', city: 'Canning' },
    { name: 'Valley of Flowers National Park', state: 'Uttarakhand', city: 'Joshimath' },
    { name: 'Periyar National Park', state: 'Kerala', city: 'Thekkady' },
    { name: 'Bandhavgarh National Park', state: 'Madhya Pradesh', city: 'Umaria' },
    { name: 'Great Rann of Kutch', state: 'Gujarat', city: 'Bhuj' },
  ],
  brazil: [
    { name: 'Pantanal', state: 'Mato Grosso do Sul', city: 'Corumba' },
    { name: 'Lençóis Maranhenses National Park', state: 'Maranhao', city: 'Barreirinhas' },
    { name: 'Chapada Diamantina National Park', state: 'Bahia', city: 'Lencois' },
    { name: 'Fernando de Noronha', state: 'Pernambuco', city: 'Fernando de Noronha' },
    { name: 'Chapada dos Veadeiros National Park', state: 'Goias', city: 'Alto Paraiso de Goias' },
    { name: 'Ibitipoca State Park', state: 'Minas Gerais', city: 'Lima Duarte' },
    { name: 'Jericoacoara National Park', state: 'Ceara', city: 'Jijoca de Jericoacoara' },
  ],
  france: [
    { name: 'Vanoise National Park', state: 'Auvergne-Rhone-Alpes', city: 'Pralognan-la-Vanoise' },
    { name: 'Ecrins National Park', state: 'Provence-Alpes-Cote dAzur', city: 'Briancon' },
    { name: 'Mercantour National Park', state: 'Provence-Alpes-Cote dAzur', city: 'Saint-Martin-Vesubie' },
    { name: 'Pyrenees National Park', state: 'Occitanie', city: 'Cauterets' },
    { name: 'Cevennes National Park', state: 'Occitanie', city: 'Florac' },
    { name: 'Camargue Regional Nature Park', state: 'Provence-Alpes-Cote dAzur', city: 'Arles' },
    { name: 'Verdon Gorge', state: 'Provence-Alpes-Cote dAzur', city: 'Moustiers-Sainte-Marie' },
  ],
  italy: [
    { name: 'Gran Paradiso National Park', state: 'Aosta Valley', city: 'Cogne' },
    { name: 'Abruzzo National Park', state: 'Abruzzo', city: 'Pescasseroli' },
    { name: 'Cinque Terre National Park', state: 'Liguria', city: 'Monterosso al Mare' },
    { name: 'Parco Nazionale del Vesuvio', state: 'Campania', city: 'Ercolano' },
    { name: 'Stelvio National Park', state: 'Lombardy', city: 'Bormio' },
    { name: 'Maddalena Archipelago National Park', state: 'Sardinia', city: 'La Maddalena' },
  ],
};

const COUNTRY_ALIASES: Record<string, string> = {
  'united states of america': 'united states',
  usa: 'united states',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  'russian federation': 'russia',
  'czech republic': 'czechia',
  'lao peoples democratic republic': 'laos',
  "lao people's democratic republic": 'laos',
  'korea, republic of': 'south korea',
  'republic of korea': 'south korea',
  'viet nam': 'vietnam',
};

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelySyntheticName(name: string): boolean {
  const value = name.trim();
  if (!value) return true;
  if (/^administrative zone\b/i.test(value)) return true;
  if (/\(\d+\)/.test(value)) return true;
  if (/^[A-Za-z]{1,4}\d{1,4}\b/.test(value)) return true;
  if (/[/\\]/.test(value) && /[A-Za-z]{1,6}\d/.test(value)) return true;
  return false;
}

function csvEscape(value: string): string {
  const safe = value.replace(/"/g, '""');
  return `"${safe}"`;
}

function toWikiSlug(value: string): string {
  return encodeURIComponent(value.trim().replace(/\s+/g, '_'));
}

function buildSources(destinationName: string): string[] {
  const wikiSlug = toWikiSlug(destinationName);
  return [
    `https://en.wikipedia.org/wiki/${wikiSlug}`,
    `https://en.wikivoyage.org/wiki/${wikiSlug}`,
  ];
}

type NameCanonicalizationCache = Record<string, string>;
const WIKIMEDIA_HEADERS = {
  'User-Agent': 'TravelItineraryAppBot/1.0 (contact: local-dev)',
};

function loadNameCanonicalizationCache(cachePath: string): NameCanonicalizationCache {
  if (!fs.existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as NameCanonicalizationCache;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function shouldRefreshCanonicalization(name: string, cached: string | undefined): boolean {
  if (!cached || cached.trim().length === 0) return true;
  if (cached !== name) return false;

  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed === trimmed.toUpperCase() && /[A-Z]{3,}/.test(trimmed)) return true;
  return false;
}

function shouldAttemptEnglishNameCheck(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === trimmed.toUpperCase() && /[A-Z]{3,}/.test(trimmed)) return true;
  if (/[^\x00-\x7F]/.test(trimmed)) return true;
  if (/[()]/.test(trimmed)) return true;
  return false;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ');
}

async function wikiApiGet(params: Record<string, string | number>): Promise<any | null> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        timeout: 15000,
        headers: WIKIMEDIA_HEADERS,
        params,
      });
      return response.data;
    } catch (error: any) {
      const status = Number(error?.response?.status ?? 0);
      const retryable = status === 403 || status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt === maxAttempts) return null;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  return null;
}

async function resolveEnglishWikipediaTitle(name: string, country: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  try {
    const direct = await wikiApiGet({
      action: 'query',
      format: 'json',
      redirects: 1,
      titles: trimmed,
      prop: 'pageprops',
    });
    if (!direct) return null;

    const pages = direct?.query?.pages;
    if (!pages || typeof pages !== 'object') return null;
    const firstPage = Object.values(pages)[0] as { title?: string; missing?: string; pageprops?: { disambiguation?: string } } | undefined;
    if (!firstPage || typeof firstPage.title !== 'string' || firstPage.missing !== undefined) return null;
    if (firstPage.pageprops?.disambiguation === undefined && normalizeKey(firstPage.title) !== normalizeKey(trimmed)) {
      return firstPage.title.trim();
    }

    const queryText = `${trimmed} ${country} city`;
    const search = await wikiApiGet({
      action: 'query',
      format: 'json',
      list: 'search',
      srsearch: queryText,
      srlimit: 10,
    });
    if (!search) return firstPage.pageprops?.disambiguation === undefined ? firstPage.title.trim() : null;

    const results = Array.isArray(search?.query?.search) ? search.query.search : [];
    if (results.length === 0) return firstPage.pageprops?.disambiguation === undefined ? firstPage.title.trim() : null;

    const countryKey = normalizeKey(country);
    const placeHintRegex = /(city|capital|town|village|district|state|province|region|park|mount|lake|valley|bay|island)/i;
    const nonPlaceRegex = /(football|club|album|song|film|company|corporation|language|disambiguation)/i;

    let bestTitle: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const result of results) {
      const title = typeof result?.title === 'string' ? result.title.trim() : '';
      if (!title || /^list of /i.test(title)) continue;

      const snippet = stripHtml(String(result?.snippet ?? '')).toLowerCase();
      let score = 0;
      if (snippet.includes(countryKey)) score += 8;
      if (placeHintRegex.test(snippet)) score += 5;
      if (nonPlaceRegex.test(snippet)) score -= 10;
      if (normalizeKey(title) === normalizeKey(trimmed)) score += 2;

      if (score > bestScore) {
        bestScore = score;
        bestTitle = title;
      }
    }

    if (bestTitle && bestScore > 0) {
      return bestTitle;
    }
    return firstPage.pageprops?.disambiguation === undefined ? firstPage.title.trim() : null;
  } catch (_error) {
    return null;
  }
}

function dedupeDestinations(destinations: Destination[]): Destination[] {
  const seen = new Set<string>();
  const deduped: Destination[] = [];

  for (const row of destinations) {
    const key = normalizeKey(`${row.Country}|${row['Destination English Name']}|${row['Nearest City']}`);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function ensureEnglishCapitalCoverage(
  destinations: Destination[],
  capitalByCountry: Map<string, string>
): Destination[] {
  const rows = destinations.map((row) => ({ ...row }));
  const rowsByCountry = new Map<string, Destination[]>();

  for (const row of rows) {
    if (!rowsByCountry.has(row.Country)) rowsByCountry.set(row.Country, []);
    rowsByCountry.get(row.Country)?.push(row);
  }

  for (const [country, countryRows] of rowsByCountry.entries()) {
    const capital = (capitalByCountry.get(country) ?? '').trim();
    if (!capital) continue;

    const hasCapital = countryRows.some((row) => normalizeKey(row['Destination English Name']) === normalizeKey(capital));
    if (hasCapital) continue;

    const replacement = countryRows.find((row) => {
      const name = row['Destination English Name'].trim();
      const nearest = row['Nearest City'].trim();
      const state = row['State/Provence'].trim();
      const allUpper = name === name.toUpperCase() && /[A-Z]{3,}/.test(name);
      return allUpper && nearest === name && (state === '' || state === name);
    });

    if (replacement) {
      const original = replacement['Destination English Name'];
      replacement['Destination English Name'] = capital;
      replacement['Nearest City'] = replacement['Nearest City'] === original ? capital : replacement['Nearest City'];
    }
  }

  return dedupeDestinations(rows);
}

function applyDestinationQualityGates(
  destinations: Destination[],
  countriesByName: Map<string, Country>
): { rows: Destination[]; rejected: Destination[] } {
  const rejected: Destination[] = [];
  const accepted = destinations.filter((row) => {
    const shouldReject =
      isLikelySyntheticName(row['Destination English Name']) ||
      isLikelySyntheticName(row['Nearest City']) ||
      (!row.Country || row.Country.trim().length === 0);
    if (shouldReject) rejected.push(row);
    return !shouldReject;
  });

  const grouped = new Map<string, Destination[]>();
  for (const row of accepted) {
    if (!grouped.has(row.Country)) grouped.set(row.Country, []);
    grouped.get(row.Country)?.push(row);
  }

  for (const [countryName, country] of countriesByName.entries()) {
    const rows = grouped.get(countryName) ?? [];
    if (rows.length > 0) continue;
    const fallback = buildFallbackDestination(country);
    grouped.set(countryName, [
      {
        'Destination English Name': fallback.name,
        Country: countryName,
        'State/Provence': fallback.state,
        'Nearest City': fallback.city,
        'Destination Official Name': fallback.officialName ?? fallback.name,
      },
    ]);
  }

  const flattened = Array.from(grouped.values()).flat();
  return { rows: dedupeDestinations(flattened), rejected };
}

async function canonicalizeDestinationEnglishNames(destinations: Destination[], baseDir: string): Promise<Destination[]> {
  const cachePath = path.resolve(baseDir, 'destination_english_name_cache.json');
  const cache = loadNameCanonicalizationCache(cachePath);
  const uniquePairs = new Map<string, { name: string; country: string }>();
  for (const row of destinations) {
    const name = row['Destination English Name'];
    const country = row.Country;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    const key = `${country}::${name}`;
    if (!uniquePairs.has(key)) {
      uniquePairs.set(key, { name, country });
    }
  }

  const pendingKeys = Array.from(uniquePairs.keys()).filter((key) => {
    const pair = uniquePairs.get(key);
    if (!pair) return false;
    if (shouldRefreshCanonicalization(pair.name, cache[key])) return true;
    return cache[key] === undefined && shouldAttemptEnglishNameCheck(pair.name);
  });
  const concurrency = 3;
  let index = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= pendingKeys.length) return;

      const key = pendingKeys[currentIndex];
      const pair = uniquePairs.get(key);
      if (!pair) continue;
      const resolved = await resolveEnglishWikipediaTitle(pair.name, pair.country);
      cache[key] = resolved ?? pair.name;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');

  const canonicalized = destinations.map((row) => {
    const original = row['Destination English Name'];
    const cacheKey = `${row.Country}::${original}`;
    const canonical = cache[cacheKey] ?? original;
    const nearestCity = row['Nearest City'] === original ? canonical : row['Nearest City'];

    return {
      ...row,
      'Destination English Name': canonical,
      'Nearest City': nearestCity,
    };
  });

  return dedupeDestinations(canonicalized);
}

const citySeedCache = new Map<string, DestinationSeed[]>();

function uniqueSeeds(seeds: DestinationSeed[]): DestinationSeed[] {
  const seen = new Set<string>();
  const deduped: DestinationSeed[] = [];

  for (const seed of seeds) {
    const key = normalizeKey(`${seed.name}|${seed.city}|${seed.state}`);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(seed);
  }

  return deduped;
}

async function fetchTopCitySeeds(countryName: string, targetCount: number): Promise<DestinationSeed[]> {
  const cacheKey = normalizeKey(countryName);
  if (citySeedCache.has(cacheKey)) {
    return citySeedCache.get(cacheKey) ?? [];
  }

  try {
    const requestBody = {
      country: countryName,
      order: 'dsc',
      orderBy: 'value',
      limit: Math.min(Math.max(targetCount * 3, 100), 400),
    };

    let populationRecords: CountryNowCityRecord[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { data } = await axios.post<CountryNowFilterResponse>(
          'https://countriesnow.space/api/v0.1/countries/population/cities/filter',
          requestBody,
          { timeout: 30000 }
        );
        populationRecords = Array.isArray(data?.data) ? data.data : [];
        if (populationRecords.length > 0) break;
      } catch (_error) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }

    const seedsFromPopulation = uniqueSeeds(
      populationRecords
        .filter((record) => {
          const city = (record.city ?? '').trim();
          return city.length > 0 && !isLikelySyntheticName(city);
        })
        .map((record) => {
          const rawName = (record.city ?? '').trim();
          const parenthetical = rawName.match(/\(([^)]+)\)\s*$/);
          const state = parenthetical ? parenthetical[1].trim() : '';
          const cityName = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim();

          return {
            name: cityName,
            city: cityName,
            state,
            officialName: cityName,
          };
        })
    );

    let seeds = [...seedsFromPopulation];
    if (seeds.length < targetCount) {
      const { data } = await axios.post<CountryNowCitiesResponse>(
        'https://countriesnow.space/api/v0.1/countries/cities',
        { country: countryName },
        { timeout: 30000 }
      );
      const cityNames = Array.isArray(data?.data) ? data.data : [];
      const fallbackSeeds = uniqueSeeds(
        cityNames
          .filter((name) => {
            const city = String(name ?? '').trim();
            return city.length > 0 && !isLikelySyntheticName(city);
          })
          .slice(0, Math.min(1200, targetCount * 20))
          .map((name) => {
            const cityName = String(name).trim();
            return {
              name: cityName,
              city: cityName,
              state: '',
              officialName: cityName,
            };
          })
      );
      seeds = uniqueSeeds([...seeds, ...fallbackSeeds]);
    }

    citySeedCache.set(cacheKey, seeds);
    return seeds;
  } catch (error) {
    citySeedCache.set(cacheKey, []);
    return [];
  }
}

async function getCountries(): Promise<Country[]> {
  const url = 'https://restcountries.com/v3.1/all?fields=name,cca2,cca3,capital,area,population';
  const { data } = await axios.get<RestCountry[]>(url, { timeout: 30000 });

  return data
    .filter((item) => item?.name?.common && item?.cca2 && item?.cca3)
    .map((item) => ({
      name: item.name?.common?.trim() ?? '',
      officialName: item.name?.official?.trim() ?? item.name?.common?.trim() ?? '',
      iso2: (item.cca2 ?? '').toUpperCase(),
      iso3: (item.cca3 ?? '').toUpperCase(),
      capital: Array.isArray(item.capital) ? item.capital.filter(Boolean) : [],
      areaKm2: Number(item.area) > 0 ? Number(item.area) : 0,
      population: Number(item.population) > 0 ? Number(item.population) : 0,
    }))
    .filter((country) => country.name && country.iso2 && country.iso3)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getCountryCatalog(country: Country): DestinationSeed[] {
  const candidates = [country.name, country.officialName]
    .map((value) => normalizeKey(value))
    .map((key) => COUNTRY_ALIASES[key] ?? key);

  for (const key of candidates) {
    if (DESTINATIONS_BY_COUNTRY[key]) {
      return DESTINATIONS_BY_COUNTRY[key];
    }
  }
  return [];
}

function getCountryNatureCatalog(country: Country): DestinationSeed[] {
  const candidates = [country.name, country.officialName]
    .map((value) => normalizeKey(value))
    .map((key) => COUNTRY_ALIASES[key] ?? key);

  for (const key of candidates) {
    if (NATURE_DESTINATIONS_BY_COUNTRY[key]) {
      return NATURE_DESTINATIONS_BY_COUNTRY[key];
    }
  }
  return [];
}

function normalizeByMax(value: number, maxValue: number): number {
  if (value <= 0 || maxValue <= 0) return 0;
  return Math.min(1, Math.sqrt(value / maxValue));
}

async function getTourismDemandByIso3(): Promise<Map<string, number>> {
  const tourismByIso3 = new Map<string, number>();
  const tourismYearByIso3 = new Map<string, number>();
  const url = 'https://api.worldbank.org/v2/country/all/indicator/ST.INT.ARVL?format=json&per_page=20000';

  try {
    const { data } = await axios.get(url, { timeout: 30000 });
    const entries = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];

    for (const row of entries) {
      const iso3 = typeof row?.countryiso3code === 'string' ? row.countryiso3code.toUpperCase() : '';
      const value = typeof row?.value === 'number' ? row.value : null;
      const year = Number.isFinite(Number(row?.date)) ? Number(row?.date) : 0;
      if (!iso3 || value === null || value <= 0) continue;
      const currentYear = tourismYearByIso3.get(iso3) ?? 0;
      if (year >= currentYear) {
        tourismYearByIso3.set(iso3, year);
        tourismByIso3.set(iso3, value);
      }
    }
  } catch (error) {
    console.warn('Unable to load World Bank tourism arrivals data; continuing with size-based scaling only.');
  }

  return tourismByIso3;
}

function getDestinationQuota(
  country: Country,
  tourismByIso3: Map<string, number>,
  maxArea: number,
  maxPopulation: number,
  maxTourism: number
): number {
  const areaScore = normalizeByMax(country.areaKm2, maxArea);
  const populationScore = normalizeByMax(country.population, maxPopulation);
  const tourismScore = normalizeByMax(tourismByIso3.get(country.iso3) ?? 0, maxTourism);

  const combinedScore = 0.4 * tourismScore + 0.35 * areaScore + 0.25 * populationScore;
  let scaled = 1 + Math.round(combinedScore * 199);

  if (tourismScore > 0.75) scaled += 10;
  if (populationScore > 0.6 && areaScore > 0.45) scaled += 8;

  if (country.areaKm2 >= 5_000_000 && country.population >= 100_000_000) {
    scaled = Math.max(scaled, 100);
  }

  if (country.areaKm2 >= 8_000_000 && country.population >= 200_000_000) {
    scaled = Math.max(scaled, 120);
  }

  return Math.max(1, Math.min(200, scaled));
}

function getNatureQuota(country: Country): number {
  const area = country.areaKm2;
  const pop = country.population;

  if (area >= 8_000_000 && pop >= 100_000_000) return 24;
  if (area >= 3_000_000 && pop >= 50_000_000) return 14;
  if (area >= 500_000 || pop >= 30_000_000) return 7;
  if (area >= 100_000 || pop >= 10_000_000) return 3;
  return 1;
}

function buildFallbackDestination(country: Country): DestinationSeed {
  const capital = country.capital[0] ?? country.name;
  return {
    name: capital,
    state: '',
    city: capital,
    officialName: capital,
  };
}

async function seedsToDestinations(country: Country, quota: number): Promise<Destination[]> {
  const curatedAll = getCountryCatalog(country);
  const curated = curatedAll.slice(0, quota);
  const fallback = buildFallbackDestination(country);
  const seedList: DestinationSeed[] = [...curated];

  if (seedList.length < quota) {
    const countryCandidates = [country.name, country.officialName].filter(Boolean);
    for (const candidate of countryCandidates) {
      const citySeeds = await fetchTopCitySeeds(candidate, quota - seedList.length);
      for (const seed of citySeeds) {
        seedList.push(seed);
        if (seedList.length >= quota) break;
      }
      if (seedList.length >= quota) break;
    }
  }

  if (seedList.length === 0) {
    seedList.push(fallback);
  }

  const natureQuota = getNatureQuota(country);
  const natureSeeds = getCountryNatureCatalog(country).slice(0, natureQuota);
  seedList.push(...natureSeeds);

  const seen = new Set<string>();
  const destinations: Destination[] = [];

  for (const seed of seedList) {
    const key = normalizeKey(`${country.name}|${seed.name}|${seed.city}`);
    if (seen.has(key)) continue;
    seen.add(key);

    destinations.push({
      'Destination English Name': seed.name,
      Country: country.name,
      'State/Provence': seed.state,
      'Nearest City': seed.city,
      'Destination Official Name': seed.officialName ?? seed.name,
    });
  }

  if (destinations.length === 0 || quota <= 0) {
    destinations.push({
      'Destination English Name': fallback.name,
      Country: country.name,
      'State/Provence': fallback.state,
      'Nearest City': fallback.city,
      'Destination Official Name': fallback.officialName ?? fallback.name,
    });
  }

  return destinations;
}

import { fileURLToPath } from 'url';

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const countries = await getCountries();
  const tourismByIso3 = await getTourismDemandByIso3();
  const maxArea = countries.reduce((max, country) => Math.max(max, country.areaKm2), 0);
  const maxPopulation = countries.reduce((max, country) => Math.max(max, country.population), 0);
  const maxTourism = countries.reduce((max, country) => Math.max(max, tourismByIso3.get(country.iso3) ?? 0), 0);

  const allDestinations: Destination[] = [];

  for (const country of countries) {
    const quota = getDestinationQuota(country, tourismByIso3, maxArea, maxPopulation, maxTourism);
    const rows = await seedsToDestinations(country, quota);
    allDestinations.push(...rows);
  }

  const canonicalDestinations = await canonicalizeDestinationEnglishNames(allDestinations, __dirname);
  const capitalByCountry = new Map<string, string>(
    countries.map((country) => [country.name, Array.isArray(country.capital) ? country.capital[0] ?? '' : ''])
  );
  const capitalNormalizedDestinations = ensureEnglishCapitalCoverage(canonicalDestinations, capitalByCountry);
  const countriesByName = new Map(countries.map((country) => [country.name, country]));
  const { rows: finalizedDestinations, rejected } = applyDestinationQualityGates(capitalNormalizedDestinations, countriesByName);
  const destinationSources: Array<{ destination: string; country: string; sources: string[] }> = [];

  for (const row of finalizedDestinations) {
    const sources = buildSources(row['Destination English Name']);
    if (sources.length < 2) {
      throw new Error(`Missing minimum sources for ${row['Destination English Name']}, ${row.Country}`);
    }
    destinationSources.push({
      destination: row['Destination English Name'],
      country: row.Country,
      sources,
    });
  }

  const header = [
    'Destination English Name',
    'Country',
    'State/Provence',
    'Nearest City',
    'Destination Official Name',
  ];

  const lines = [
    header.map(csvEscape).join(','),
    ...finalizedDestinations.map((row) =>
      [
        row['Destination English Name'],
        row.Country,
        row['State/Provence'],
        row['Nearest City'],
        row['Destination Official Name'],
      ]
        .map((value) => csvEscape(value ?? ''))
        .join(',')
    ),
  ];

  const csvContent = `${lines.join('\n')}\n`;
  const serverDataCsvPath = path.resolve(__dirname, '../server/data/destinations.csv');
  const sourcesPath = path.resolve(__dirname, 'destination_sources.json');

  fs.writeFileSync(serverDataCsvPath, csvContent, 'utf8');
  fs.writeFileSync(sourcesPath, JSON.stringify(destinationSources, null, 2), 'utf8');

  console.log(`Generated ${finalizedDestinations.length} destinations for ${countries.length} countries at ${serverDataCsvPath}.`);
  if (rejected.length > 0) {
    console.log(`Rejected ${rejected.length} destinations by quality gates.`);
  }
  await verifyDestinations(serverDataCsvPath);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

async function verifyDestinations(filePath: string) {
  const csvData = fs.readFileSync(filePath, 'utf8');
  const lines = csvData.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    console.log('Destinations file is empty. Nothing to verify.');
    return;
  }

  const headers = parseCsvLine(lines[0]);
  const nameIndex = headers.indexOf('Destination English Name');
  const countryIndex = headers.indexOf('Country');

  if (nameIndex === -1 || countryIndex === -1) {
    console.error('Could not find "Destination English Name" or "Country" column in destinations.csv');
    return;
  }

  let syntheticCount = 0;
  const destinationsByCountry: { [key: string]: string[] } = {};

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length !== headers.length) continue;

    const name = values[nameIndex].replace(/"/g, '');
    const country = values[countryIndex].replace(/"/g, '');

    if (isLikelySyntheticName(name)) {
      console.log(`Found synthetic-looking destination: ${name}`);
      syntheticCount += 1;
    }

    if (!destinationsByCountry[country]) {
      destinationsByCountry[country] = [];
    }
    destinationsByCountry[country].push(name);
  }

  if (syntheticCount > 0) {
    console.warn(`Found ${syntheticCount} synthetic-looking destinations.`);
  } else {
    console.log('All destinations appear to be real places.');
  }

  for (const country in destinationsByCountry) {
    const destinations = destinationsByCountry[country];
    const firstLetters = destinations.map((d) => d[0]).join('');
    const uniqueFirstLetters = new Set(firstLetters);

    if (destinations.length > 5 && uniqueFirstLetters.size <= 2) {
      console.warn(`Destinations in ${country} seem to be alphabetically sorted.`);
    }

    if (country.toLowerCase() === 'vietnam') {
      const hasHanoi = destinations.some((d) => d.toLowerCase().includes('hanoi'));
      const hasHoChiMinh = destinations.some((d) => d.toLowerCase().includes('ho chi minh'));
      if (!hasHanoi || !hasHoChiMinh) {
        console.warn(`Vietnam is missing major cities: Hanoi and/or Ho Chi Minh City.`);
      }
    }
  }
}

main().catch((error) => {
  console.error('Failed to generate destinations.csv:', error);
  process.exit(1);
});
