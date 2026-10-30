# Template authoring progress

Live state of the bundle-authoring campaign over the destination list in `DESTINATIONS.md`.
**Update this file after every completed destination** so work can resume cleanly.

Last updated: 2026-10-29

---

## How to resume

Paste this to a fresh session:

> Read `server/data/trip-template-authoring/INSTRUCTIONS.md`, `example-bundle.json`,
> `DESTINATIONS.md` and `PROGRESS.md`. Continue the campaign from the next destination in
> the queue. Research with web search across several published itinerary sources, write the
> bundle, validate it with `node validate-bundle.mjs <file>` until it reports no errors,
> save it as `<country-slug>-bundle.json` in that same folder, and update `PROGRESS.md`.

### Per-destination recipe

1. Web-search 3+ independent published itineraries (guidebook publisher, official tourism
   board, major travel publication). Note length, bases, route, pace for each.
2. Pick 4–8 templates covering the most common lengths and routes. No two templates may
   share **both** length and the same set of bases.
3. Write the bundle. Geography per instructions 4.1: sovereign `countries`, state/province
   `regions`, base `cities`, and a `media.destinations` entry for every one of them.
4. `node validate-bundle.mjs <file>` → fix every ERROR. Warnings are optional but read them.
5. Save as `<country-slug>-bundle.json` here, tick it off below, commit nothing unless asked.

---

## Done (89 bundle files; every queued destination)

| # | Destination | File | Templates | Lengths | Notes |
|---|---|---|---|---|---|
| 1 | Brazil | `brazil-bundle.json` | 6 | 4, 7, 10, 10, 14, 14 | Rio / Sao Paulo / Iguazu / Salvador / Pantanal+Bonito / Amazon |
| 2 | United Kingdom — Scotland | `united-kingdom-scotland-bundle.json` | 6 | 4, 5, 7, 7, 10, 14 | Migrated from an earlier draft that wrongly used `countries: ["Scotland"]` |
| 3 | Japan | `japan-bundle.json` | 6 | 5, 7, 10, 10, 14, 14 | Tokyo / golden route / +Hakone+Nara / +Hiroshima / full circuit / Japan Alps via Kanazawa+Takayama |
| 4 | Italy | `italy-bundle.json` | 6 | 4, 7, 10, 10, 14, 14 | Rome / big three / southern Amalfi / +Cinque Terre / Milan-to-Rome / grand tour |
| 5 | Peru | `peru-bundle.json` | 6 | 5, 7, 10, 10, 14, 14 | Cusco+MP / classic Lima+MP / +Amazon / Arequipa+Colca / southern circuit w/ Titicaca / 14d Amazon |
| 6 | Egypt | `egypt-bundle.json` | 6 | 4, 7, 8, 10, 12, 14 | Cairo / +Luxor / +Nile cruise / hotel-based Nile valley / cruise+Red Sea (Hurghada) / +Alexandria+Sharm. Sources: Rough Guides, KimKim, TravelStride (no Lonely Planet content found) |
| 7 | Thailand | `thailand-bundle.json` | 6 | 4, 7, 7, 10, 14, 14 | Bangkok / +Chiang Mai / +Phuket / +Chiang Mai+Krabi / north+Andaman (Chiang Rai, Krabi) / north+Koh Samui (Gulf). Sources: Rough Guides, KimKim, TravelStride |
| 8 | Vietnam | `vietnam-bundle.json` | 6 | 4, 7, 7, 10, 14, 14 | Hanoi / north (Ha Long+Ninh Binh) / Hanoi+Hoi An / 10d Hanoi-Hue-Hoi An-Saigon / 14d north+Sapa / 14d end-to-end with Mekong. Regions kept to names safe after the 2025 province mergers (see gotchas) |
| 9 | Morocco | `morocco-bundle.json` | 6 | 4, 7, 7, 10, 14, 14 | Marrakech / +Fes / +Sahara loop / Marrakech-Skoura-Merzouga-Fes / Casablanca-to-Marrakech grand tour (Chefchaouen) / Marrakech+Essaouira+Atlas+Sahara+Fes. Regions are the official 2015 regions |
| 10 | India | `india-bundle.json` | 6 | 4, 7, 7, 10, 14, 14 | Delhi+Taj / Golden Triangle / Rajasthan (Jaipur-Jodhpur-Udaipur) / GT+Varanasi / GT+Rajasthan+Varanasi / GT+Kerala. Sources note: sources say do not combine Rajasthan+Varanasi+Kerala in 14 days |
| 11 | Greece | `greece-bundle.json` | 6 | 4, 7, 7, 10, 14, 14 | Athens(+Delphi) / Athens+Santorini / Athens+Mykonos+Santorini / Naxos-Paros-Santorini hop / mainland (Delphi, Meteora)+islands / Peloponnese+Santorini+Crete. Region "Cyclades" used (traveller-search name) rather than "South Aegean" |
| 12 | Spain | `spain-bundle.json` | 6 | 4, 7, 7, 10, 14, 14 | Madrid(+Toledo) / Madrid-Seville-Granada / Andalusia-only / +Barcelona / Barcelona-Valencia-Madrid-Andalusia / Barcelona-Basque-Madrid-Seville. AVE rail throughout |
| 13 | Iceland | `iceland-bundle.json` | 6 | 4, 5, 7, 7, 10, 14 | Reykjavik+Golden Circle / +South Coast / South Coast to Jokulsarlon / Ring Road 7d / Ring Road+Snaefellsnes 10d / full Ring Road 14d. All self-drive (rental-car legs); places/cities use ASCII names. Hofn left out of regions (unsure whether South or East) |
| 14 | Costa Rica | `costa-rica-bundle.json` | 6 | 5, 7, 7, 10, 10, 14 | San Jose+Arenal / Arenal+Manuel Antonio / Rio Celeste+Arenal+Guanacaste (fly into Liberia) / classic Arenal-Monteverde-Manuel Antonio / Tortuguero-Arenal-Manuel Antonio / coast-to-coast+Osa. Regions are the 5 provinces used |
| 15 | South Africa | `south-africa-bundle.json` | 7 | 5, 7, 7, 10, 10, 14, 14 | Cape Town+Winelands / Cape Town+Hermanus / Cape Town+Route 62+Knysna (depart George) / Johannesburg+Panorama+Kruger / Cape-Winelands-Garden Route / Cape-Garden Route-Addo (depart Gqeberha) / Cape-Garden Route-Kruger (JNB hop, depart Hoedspruit). Regions: Western Cape, Eastern Cape, Gauteng, Mpumalanga |
| 16 | Jordan | `jordan-bundle.json` | 6 | 6, 7, 8, 8, 10, 12 | Amman-Petra-Wadi Rum (depart Aqaba) / Petra-Rum-Dead Sea / Golden Triangle with Jerash / Madaba-Petra-Aqaba / King's Highway with Dana + Dead Sea / complete 12d. Regions: Amman, Jerash, Madaba, Ma'an, Aqaba (key `jordan/ma-an`) |
| 17 | Turkey | `turkey-bundle.json` | 7 | 7, 7, 8, 10, 10, 10, 14 | Istanbul+Cappadocia (depart NAV) / +Ephesus / +Pamukkale / classic 10 / +Antalya / Aegean-only / 14d grand tour. Regions are provinces (Nevsehir, Izmir, Denizli, Antalya); air hops as paired airport legs |
| 18 | New Zealand | `new-zealand-bundle.json` | 6 | 7, 7, 10, 10, 12, 14 | North Island 7d / Queenstown+Milford 7d / Auckland-Rotorua-Queenstown (fly) / South Island road trip / West Coast+Fiordland 12d / both islands 14d. Regions are the regional councils; city destinations also added for Milford Sound and Akaroa |
| 19 | Australia | `australia-bundle.json` | 6 | 7, 7, 10, 10, 12, 14 | Sydney+Blue Mountains / Cairns+Port Douglas / Sydney-Uluru-Cairns / Sydney+Melbourne (Hunter, Great Ocean Road) / Melbourne-Uluru-Cairns-Sydney / grand tour. Air hops as paired airport legs; hero must be a destination key || 20 | Argentina | `argentina-bundle.json` | 6 | 7, 8, 10, 10, 12, 14 | BA+Iguazu / BA+Calafate / classic 3-part / BA-Mendoza-Bariloche / +El Chalten trekking / grand tour || 21 | Albania | `albania-bundle.json` | 6 | 5, 7, 8, 10, 12, 14 | Tirana+Berat / highlights loop / northern Alps+Koman ferry / classic loop / north-to-south / complete || 22 | Austria | `austria-bundle.json` | 6 | 4, 5, 7, 8, 10, 12 | Vienna / Vienna+Salzburg / 4-city 7d / lakes 8d / grand tour 10d / Wachau (Durnstein) 12d || 23 | Bahrain | `bahrain-bundle.json` | 4 | 3, 4, 5, 7 | Small country, 4 templates: Manama 3d / Manama+south 4d / Manama+Muharraq 5d / complete 7d |
| 20 | Argentina | `argentina-bundle.json` | 6 | 7, 8, 10, 10, 12, 14 | BA+Iguazu / BA+Calafate / classic 3-part / BA-Mendoza-Bariloche / +El Chalten trekking / grand tour |
| 21 | Albania | `albania-bundle.json` | 6 | 5, 7, 8, 10, 12, 14 | Tirana+Berat / highlights loop / northern Alps+Koman ferry / classic loop / north-to-south / complete |
| 22 | Austria | `austria-bundle.json` | 6 | 4, 5, 7, 8, 10, 12 | Vienna / Vienna+Salzburg / 4-city 7d / lakes 8d / grand tour 10d / Wachau (Durnstein) 12d |
| 23 | Bahrain | `bahrain-bundle.json` | 4 | 3, 4, 5, 7 | Small country, 4 templates: Manama 3d / Manama+south 4d / Manama+Muharraq 5d / complete 7d |
| 24 | Belgium | `belgium-bundle.json` | 5 | 4, 5, 7, 8, 10 | Brussels+Bruges 4d/5d / four-city loop 7d / Ghent-first 8d with Ostend / complete 10d with Ypres. All by train |
| 25 | Belize | `belize-bundle.json` | 5 | 5, 7, 7, 10, 12 | San Ignacio+Caye Caulker 5d/7d / San Ignacio+Placencia 7d / three-part 10d / complete 12d with Caracol. Water taxi legs use transferType Other |
| 26 | Bhutan | `bhutan-bundle.json` | 5 | 5, 7, 7, 9, 10 | Paro+Thimphu / western circuit / Haa+Punakha+Paro / +Phobjikha 9d / highlights 10d. Always a guide and driver |
| 27 | Bolivia | `bolivia-bundle.json` | 5 | 6, 7, 8, 10, 14 | Titicaca+La Paz / La Paz+Uyuni / Titicaca-La Paz-Uyuni / classic with Sucre and Potosi transit / complete 14d. Altitude notes included |
| 28 | Botswana | `botswana-bundle.json` | 5 | 5, 7, 8, 11, 13 | Delta 5d / Delta+Moremi 7d / Maun-Delta-Moremi-Savute-Kasane 8d/11d/13d. Camp bases; air hops as paired airstrip legs; no Victoria Falls (Zimbabwe) |
| 29 | Bulgaria | `bulgaria-bundle.json` | 5 | 4, 6, 7, 9, 11 | Sofia+Plovdiv / +Veliko Tarnovo / +Rila+Melnik 7d / to Varna 9d / complete 11d with Seven Rila Lakes, Nessebar, Rose Valley |
| 30 | Cambodia | `cambodia-bundle.json` | 5 | 4, 5, 7, 10, 12 | Angkor 4d / +Phnom Penh 5d / +Battambang 7d / +Kampot 10d / complete 12d with Kep. Overland by bus |
| 31 | Canada | `canada-bundle.json` | 5 | 6, 7, 8, 10, 14 | Vancouver+Banff / Toronto-Montreal-Quebec City by train / Rockies to Vancouver / west to Toronto / coast to coast 14d. Moraine Lake shuttle reservation noted |
| 32 | Chile | `chile-bundle.json` | 5 | 6, 7, 8, 10, 14 | Santiago+Valparaiso / Atacama / Torres del Paine / desert to glaciers / complete 14d. Region keys: santiago-metropolitan, antofagasta, magallanes |
| 33 | China | `china-bundle.json` | 5 | 5, 7, 9, 12, 14 | Beijing / +Xi an / +Shanghai / +Chengdu pandas / grand 14d with Li River at Yangshuo. High-speed rail plus paired airport legs |
| 34 | Colombia | `colombia-bundle.json` | 5 | 5, 7, 9, 12, 14 | Bogota+Cartagena / Medellin+Cartagena / big three / +Salento coffee 12d / +Tayrona 14d. Air hops as paired legs |
| 35 | Croatia | `croatia-bundle.json` | 5 | 5, 7, 8, 10, 12 | Dubrovnik / Split-Hvar-Dubrovnik / Zagreb-Plitvice-Split-Dubrovnik / +Hvar / +Rovinj (Istria). Plitvice key is `croatia/plitvice-lakes` |
| 36 | Cyprus | `cyprus-bundle.json` | 4 | 5, 7, 8, 10 | Paphos+Limassol / +Troodos / west to east with Larnaca / complete with Nicosia. Fly into PFO, out of LCA |
| 37 | Czech Republic | `czech-republic-bundle.json` | 5 | 4, 5, 7, 9, 10 | Prague / +Cesky Krumlov / +Karlovy Vary / +Brno with Plzen / complete 10d |
| 38 | Denmark | `denmark-bundle.json` | 5 | 4, 5, 7, 8, 10 | Copenhagen / +Odense / +Aarhus / +Skagen (depart AAL) / complete 10d. All by train |
| 39 | Dominican Republic | `dominican-republic-bundle.json` | 5 | 5, 7, 8, 10, 12 | Santo Domingo+Punta Cana / +Samana / mountains-north-Samana (depart AZS) / complete 12d. Whale season Jan-Mar noted |
| 40 | Ecuador | `ecuador-bundle.json` | 5 | 6, 7, 8, 10, 12 | Andes loop / Quito+Galapagos 7d / +Cuenca / Andes+Galapagos / complete 12d. Galapagos via Baltra, paired legs |
| 41 | El Salvador | `el-salvador-bundle.json` | 4 | 4, 6, 8, 10 | San Salvador+El Tunco / +Santa Ana volcano / +Ruta de las Flores / +Suchitoto |
| 42 | Eswatini | `eswatini-bundle.json` | 4 | 4, 5, 7, 9 | Arrive and depart via Johannesburg by road. Ezulwini key is `eswatini/ezulwini-valley`; Mlilwane, Malolotja, Hlane, Mkhaya |
| 43 | Ethiopia | `ethiopia-bundle.json` | 5 | 5, 7, 10, 11, 13 | Addis+Lalibela / +Axum / northern circuit / +Simien Mountains / complete 13d. Domestic flights as paired legs |
| 44 | Fiji | `fiji-bundle.json` | 5 | 5, 7, 10, 12, 14 | Mamanuca 5d / +Coral Coast / Yasawa-Mamanuca-Taveuni / +Suva (depart SUV) / complete 14d. Boats as Public Transit, flights as paired legs |
| 45 | Finland | `finland-bundle.json` | 5 | 4, 5, 7, 8, 10 | Helsinki / +Turku / +Lapland by air / +Tampere / complete with Savonlinna. Depart RVN for Lapland ones; aurora season noted |
| 46 | France | `france-bundle.json` | 6 | 5, 7, 8, 10, 12, 14 | Paris / +Loire / +Normandy / +Bordeaux (depart BOD) / to Nice 12d / grand 14d. All by TGV |
| 47 | Germany | `germany-bundle.json` | 6 | 4, 5, 7, 8, 10, 12 | Berlin / Munich+Neuschwanstein / Berlin+Munich / +Heidelberg / +Cologne+Rhine / +Rothenburg 12d. Rothenburg key `germany/rothenburg-ob-der-tauber` |
| 48 | Guatemala | `guatemala-bundle.json` | 5 | 5, 7, 8, 10, 12 | Antigua+Atitlan / +Tikal by air / +Chichicastenango / +Semuc Champey / complete 12d with Acatenango. Long shuttle days noted |
| 49 | Honduras | `honduras-bundle.json` | 5 | 5, 7, 8, 10, 12 | Copan+Roatan / +Pico Bonito / Yojoa+Utila (depart LCE) / complete 10d / Utila+Roatan 12d. Ferry legs use transferType Other |
| 50 | Hungary | `hungary-bundle.json` | 5 | 4, 5, 7, 8, 10 | Budapest / +Eger / +Balaton / Balaton+Pecs / complete 10d with Tokaj and Danube Bend |
| 51 | Indonesia | `indonesia-bundle.json` | 5 | 7, 8, 10, 12, 14 | Bali 7d / Java+Bali / Bali+Gili Air / +Komodo 12d / grand 14d. Fast boats as Other, flights as paired legs. Bromo dropped (no logical slot) |
| 52 | Ireland | `ireland-bundle.json` | 5 | 5, 7, 8, 10, 12 | Republic only (Northern Ireland to be covered under United Kingdom). Dublin+Galway / +Killarney / +Dingle / classic 10d / complete 12d |
| 53 | Kazakhstan | `kazakhstan-bundle.json` | 4 | 4, 5, 7, 10 | Almaty / +Charyn+Kolsai (Saty) / +Astana / +Turkestan (depart HSA) |
| 54 | Kenya | `kenya-bundle.json` | 5 | 5, 7, 8, 10, 12 | Mara 5d / Nakuru+Mara / classic Amboseli-Nakuru-Mara / +Diani / grand 12d. Fly Mara-Nairobi; depart Ukunda (UKA) for beach ones |
| 55 | Kosovo | `kosovo-bundle.json` | 5 | 4, 5, 7, 8, 10 | Pristina+Prizren / Golden Triangle with Peja / +Gjakova / complete with Mitrovica and Rugova. By bus |
| 56 | Madagascar | `madagascar-bundle.json` | 5 | 7, 8, 10, 12, 14 | Andasibe+baobabs / RN7 / +Ifaty / +Nosy Be / grand 14d. Very long road days; flights via Antananarivo noted |
| 57 | Malaysia | `malaysia-bundle.json` | 5 | 5, 7, 10, 12, 14 | KL+Melaka / KL+Penang / peninsula loop / +Borneo (Sepilok, Kinabatangan, depart SDK) / grand 14d |
| 58 | Maldives | `maldives-bundle.json` | 5 | 4, 5, 7, 8, 10 | Local-island guesthouse trips (Maafushi, Dhigurah) plus a South Ari resort. Boats as Other |
| 59 | Mauritius | `mauritius-bundle.json` | 5 | 5, 7, 8, 10, 12 | North+Le Morne / east-to-north / classic 10d / complete with Flic en Flac |
| 60 | Mexico | `mexico-bundle.json` | 6 | 5, 7, 8, 10, 12, 14 | CDMX / +Oaxaca / Yucatan / CDMX-Oaxaca-Tulum / colonial+Maya / grand 14d. Depart Cancun for Tulum endings |
| 61 | Montenegro | `montenegro-bundle.json` | 5 | 4, 5, 7, 8, 10 | Kotor / +Budva / +Durmitor / +Ulcinj / complete. Arrive TIV, depart TGD on longer ones |
| 62 | Mozambique | `mozambique-bundle.json` | 5 | 5, 7, 9, 12, 14 | Maputo+Tofo / +Vilanculos / +Ilha de Mocambique / +Ibo (depart POL). Security advice for Cabo Delgado noted |
| 63 | Namibia | `namibia-bundle.json` | 5 | 5, 7, 9, 12, 14 | Self-drive circuits: Sossusvlei / +Swakopmund / +Etosha / +Damaraland / +Fish River Canyon. Kolmanskop dropped |
| 64 | Nepal | `nepal-bundle.json` | 5 | 5, 7, 9, 11, 13 | Kathmandu+Pokhara / +Chitwan / +Poon Hill trek / +Lumbini / complete with Nagarkot. Depart PKR; trailhead legs by jeep |
| 65 | Netherlands | `netherlands-bundle.json` | 5 | 4, 5, 7, 8, 10 | Amsterdam / +Haarlem+Keukenhof (spring only) / +Delft+Utrecht / +Kinderdijk / complete with Giethoorn. By train |
| 66 | North Macedonia | `north-macedonia-bundle.json` | 5 | 4, 5, 7, 8, 10 | Skopje+Ohrid (depart OHD) / +Matka / +Bitola / +Mavrovo / complete with Tikves wine |
| 67 | Norway | `norway-bundle.json` | 6 | 5, 7, 8, 10, 12, 14 | Oslo+Bergen / Norway in a Nutshell / +Alesund / +Tromso / 12d / grand 14d with Lofoten (depart LKN). Preikestolen dropped |
| 68 | Panama | `panama-bundle.json` | 5 | 5, 7, 9, 12, 14 | PC+San Blas / PC+Bocas / highlands+Bocas / 12d / grand 14d. Hotel text must not start with Cabin (use Lodge) |
| 69 | Philippines | `philippines-bundle.json` | 5 | 7, 8, 10, 12, 14 | Coron+El Nido / +Manila / +Bohol / +Banaue+Cebu / grand with Siargao (depart IAO). Ferries as Other |
| 70 | Portugal | `portugal-bundle.json` | 6 | 5, 7, 8, 10, 12, 14 | Lisbon / +Porto / +Coimbra / Porto-Douro-Lisbon-Algarve (depart FAO) / classic 12d / complete 14d |
| 71 | Qatar | `qatar-bundle.json` | 4 | 3, 4, 5, 7 | Doha plus an Inland Sea desert camp night; Al Zubarah and mangroves in the 7d |
| 72 | Romania | `romania-bundle.json` | 5 | 5, 7, 8, 10, 12 | Bucharest+Brasov / +Sibiu / +Sighisoara+Viscri / +Maramures (depart CLJ) / complete 12d |
| 73 | Rwanda | `rwanda-bundle.json` | 5 | 4, 5, 7, 8, 10 | Gorillas short breaks / +Lake Kivu / +Akagera / complete with Nyungwe. Permits flagged as Yes - book ahead |
| 74 | Saudi Arabia | `saudi-arabia-bundle.json` | 4 | 5, 7, 8, 10 | Riyadh+AlUla / +Jeddah / +Edge of the World / complete with balloon. Domestic flights as paired legs; Hegra by timed tour |
| 75 | Serbia | `serbia-bundle.json` | 5 | 4, 5, 7, 9, 11 | Belgrade / +Novi Sad / +Zlatibor+Tara / +Nis / complete 11d. Depart BEG each time |
| 76 | Singapore | `singapore-bundle.json` | 4 | 3, 4, 5, 7 | Single-city trips plus a Sentosa resort stay in the 7d |
| 77 | Slovakia | `slovakia-bundle.json` | 5 | 4, 5, 7, 8, 10 | Bratislava / +Banska Stiavnica / +High Tatras (depart KSC) / +Kosice / complete with Slovak Paradise. Spis Castle closed Dec-Mar |
| 78 | South Korea | `south-korea-bundle.json` | 5 | 5, 7, 9, 10, 12 | Seoul / +Busan (depart PUS) / +Gyeongju / +Jeju (depart CJU) / grand with Jeonju. KTX legs |
| 79 | Sri Lanka | `sri-lanka-bundle.json` | 6 | 5, 7, 8, 10, 12, 14 | Cultural Triangle / +Ella train / +Galle / +Nuwara Eliya / +Yala+Mirissa / complete 14d from Colombo |
| 80 | Sweden | `sweden-bundle.json` | 6 | 4, 5, 7, 8, 10, 12 | Stockholm / +Gothenburg / +Gotland (Visby) / +Abisko aurora / complete. Aurora season Sep-Mar noted |
| 81 | Switzerland | `switzerland-bundle.json` | 5 | 5, 7, 8, 10, 12 | Lucerne+Interlaken / +Zermatt / grand with Montreux (depart GVA) / complete with Bern and Glacier Express route |
| 82 | Tanzania | `tanzania-bundle.json` | 5 | 5, 6, 8, 10, 12 | Northern circuit safaris, +Zanzibar (depart ZNZ). Serengeti flights as airstrip legs |
| 83 | Tunisia | `tunisia-bundle.json` | 5 | 4, 5, 7, 9, 11 | Tunis / +Kairouan / +Sahara at Douz / +Djerba (depart DJE) / complete with Tataouine |
| 84 | Uganda | `uganda-bundle.json` | 5 | 5, 7, 8, 10, 12 | Bwindi gorillas by air / chimps+gorillas / Murchison+primates / classic 10d / complete with Jinja and Lake Bunyonyi. Permits flagged |
| 85 | United Arab Emirates | `united-arab-emirates-bundle.json` | 5 | 4, 5, 7, 8, 10 | Dubai / +Abu Dhabi (depart AUH) / +Al Ain / complete with Hatta |
| 86 | United Kingdom (England, Northern Ireland) | `united-kingdom-england-northern-ireland-bundle.json` | 6 | 5, 7, 8, 10, 12, 14 | London / +Bath / +Cotswolds / +Lake District+York (depart MAN) / +Belfast (depart BHD) / grand 14d. Keys use `united-kingdom/...` like Scotland |
| 87 | United States | `united-states-bundle.json` | 6 | 5, 7, 8, 10, 12, 14 | NYC / +DC / California / +Yosemite+Las Vegas / coast to coast / grand with New Orleans and Grand Canyon. Air hops as paired legs |
| 88 | Uzbekistan | `uzbekistan-bundle.json` | 5 | 5, 7, 8, 10, 12 | Silk Road cities by Afrosiyob train; Khiva endings depart UGC; yurt camp in 12d |
| 89 | Zimbabwe | `zimbabwe-bundle.json` | 5 | 4, 5, 7, 9, 11 | Victoria Falls / +Hwange / +Matobo / +Great Zimbabwe (depart HRE) / +Harare |

## Queue

Ordered by how many well-documented published itineraries exist, which is what the
combining method in instructions 2.1 depends on.

### Next up
Queue finished. Optional leftovers: Hong Kong (a region under China, not added to the China bundle) and Poland (not in the Exoticca list).

### Remaining (not yet ordered)








Optional only: Poland, Hong Kong (as a China region).

---

## Conventions settled so far

Keep these consistent across bundles so the app's destination matching works.

- **File naming:** `<country-slug>-bundle.json`. When one country is split by region across
  several bundles, append the region: `united-kingdom-scotland-bundle.json`.
- **Template id:** `<country>-<route-shortname>-<days>d`, e.g. `brazil-rio-iguazu-7d`.
- **Place keys** are `<country-slug>/<place-slug>` and are **shared across templates and
  bundles** for the same country. Reuse the exact key when a later bundle revisits a place.
- **Destination keys** are `<country-slug>` and `<country-slug>/<region-or-city-slug>`.
  Where a region and its namesake city are the same name (Rio de Janeiro state and city,
  Sao Paulo state and city), they share one entry — the validator only warns about this.
- **Flights:** `legs` may not contain flights. For destinations where inter-city moves are
  by air, write two ground legs on the travel day (hotel → departure airport, arrival
  airport → hotel) and let the flight itself stay implied, as the `arrive`/`depart` fields
  already do for the international flight.
- **Accents** are fine in display text (`Foz do Iguaçu`) but keys stay ASCII
  (`brazil/foz-do-iguacu`).
- **Pictures** are always `"image": null` / `"images": []` — no Commons files verified yet.

## Gotchas found the hard way

- The **stay/leg boundary** is the easiest thing to get wrong on multi-base trips: a stay
  with `nights: n` starting on day `d` means the traveler leaves on day `d + n`, so the
  move-on leg belongs on `d + n`, not `d + n - 1`. The validator checks this; an ad-hoc
  eyeball check missed it on the Brazil 14-day template.
- **Activities within a day must be sorted by `time`** in array order, not just have valid
  times. Easy to break when inserting a stop into an existing day.
- `countries` must be the **sovereign** state. `["Scotland"]` is rejected; use
  `["United Kingdom"]` with `regions: ["Scotland"]`. The validator flags all four UK nations.
- A **day-trip stop** belongs in `cities` (and needs its own `media.destinations` entry and
  `destinationKeys` entry), not just in an activity's `where`. Otherwise a traveler who
  searches that place is never offered the template. Easy to forget when the same day trip
  is reused across several templates.
- For long bundles, write `<country>-media.json` and `<country>-templates-a/-b.json`
  separately and merge them with a short node script, then delete the parts. Writing one
  85 KB file in a single pass tends to hit the output limit mid-JSON.
- Some destinations have a **hard physical ordering constraint** that overrides the neat
  geographic one. In Peru every good source insists you land in Cusco and go straight down
  to the lower Sacred Valley, returning to Cusco only later, because arriving at 3,400 m and
  staying there wrecks the first days. Check for this kind of constraint (altitude, monsoon,
  tides, ferry seasons) before fixing the route order.
- A **river/boat cruise stay** (Nile) is modelled as its own base: `base`/`cities` entry "Nile cruise", hotel placeholder "Stay aboard a Nile cruise ship" (the validator expects hotel text to start with Hotel/Lodge/Resort/Stay/etc.), plus its own `media.destinations` entry. No "sailing" leg is written (minutes would be days); the airport/dock ground legs cover the move.
- For destinations with lots of repeated day blocks (Egypt), a throwaway generator script in the session scratchpad (helper fns `A()`/`L()` + reusable day blocks) is far less error-prone than hand-copying JSON across 6 templates.
- **Admin boundaries that changed recently** (Vietnam merged many provinces in 2025): for `regions`, use only names that survived and that you are sure of (Hanoi, Quang Ninh, Ninh Binh, Lao Cai, Da Nang, Ho Chi Minh City, Can Tho, Hue). Do not use retired names like Quang Nam or Thua Thien Hue, and leave a region out if unsure. Da Nang is used as the region for Hoi An on the understanding that Quang Nam was merged into it; revisit if that proves wrong.
- A **departure-day activity is optional**. Better to leave the last day with only the
  transfer than to invent a filler stop or repeat an earlier one.
- Place `interests` vocabulary has no `shopping` (use food / authentic_local / culture); activity type `Shopping` is still valid. Region names with diacritics (Nevşehir, İzmir) are slugged to ASCII for the destinationKey (`turkey/nevsehir`); apostrophes become hyphens (`jordan/ma-an`).
- Highlights must be 3-6 entries; template hero must be one of that template's destinationKeys (not a place key).
- Destination key for a city name is its slug, so a city 'Moremi Game Reserve' needs key `botswana/moremi-game-reserve`.
