# Destination catalog for template authoring

Source of the country list: the destination navigation on <https://www.exoticca.com> (read
2026-10-29). Exoticca was used only to decide **which destinations to cover**; the itineraries
themselves are combined from many sources per `INSTRUCTIONS.md` section 2.1.

**91 destinations** in Exoticca's list. This file normalises them to the sovereign-country
naming that `INSTRUCTIONS.md` section 4.1 requires, which changes a few entries:

| Exoticca lists | We author as | Why |
|---|---|---|
| England, Scotland, Northern Ireland | `United Kingdom` + `regions: ["England"]` etc. | Instructions 4.1: the four nations go in `regions`. |
| Hong Kong | `China` + `regions: ["Hong Kong"]` | Not a sovereign state; travelers still search it by name, so it stays a region. |
| Turkey | `Turkey` | Kept as the common English search name. |

`regions` and `cities` below are the planned coverage, filled in during research for each
destination. A destination with no regions/cities listed yet has not been researched.

---

## Africa (16)

| Country | Planned regions | Planned base cities |
|---|---|---|
| Botswana | | |
| Egypt | Cairo, Luxor, Aswan, Red Sea | Cairo, Luxor, Aswan, Hurghada |
| Eswatini | | |
| Ethiopia | | |
| Kenya | | |
| Madagascar | | |
| Mauritius | | |
| Morocco | Marrakesh-Safi, Fes-Meknes, Draa-Tafilalet, Tanger-Tetouan | Marrakesh, Fes, Merzouga, Chefchaouen, Casablanca |
| Mozambique | | |
| Namibia | | |
| Rwanda | | |
| South Africa | Western Cape, Gauteng, Mpumalanga, KwaZulu-Natal | Cape Town, Johannesburg, Kruger area, Stellenbosch |
| Tanzania | | |
| Tunisia | | |
| Uganda | | |
| Zimbabwe | | |

## Americas (17)

| Country | Planned regions | Planned base cities |
|---|---|---|
| Argentina | Buenos Aires, Patagonia, Misiones, Mendoza | Buenos Aires, El Calafate, Bariloche, Mendoza, Puerto Iguazu |
| Belize | | |
| Bolivia | | |
| **Brazil** ✅ | Rio de Janeiro, Sao Paulo, Parana, Bahia, Mato Grosso do Sul, Amazonas | Rio de Janeiro, Sao Paulo, Foz do Iguacu, Salvador, Pantanal, Bonito, Manaus |
| Canada | | |
| Chile | | |
| Colombia | | |
| Costa Rica | Alajuela, Guanacaste, Puntarenas, Limon | San Jose, La Fortuna, Monteverde, Manuel Antonio, Tamarindo |
| Dominican Republic | | |
| Ecuador | | |
| El Salvador | | |
| Guatemala | | |
| Honduras | | |
| Mexico | Yucatan, Quintana Roo, Mexico City, Oaxaca | Mexico City, Oaxaca, Merida, Tulum, Cancun |
| Panama | | |
| Peru | Cusco, Lima, Arequipa, Puno | Lima, Cusco, Aguas Calientes, Arequipa, Puno |
| United States | | |

## Asia (24)

| Country | Planned regions | Planned base cities |
|---|---|---|
| Bahrain | | |
| Bhutan | | |
| Cambodia | Siem Reap, Phnom Penh | Siem Reap, Phnom Penh |
| China | Beijing, Shanghai, Shaanxi, Hong Kong | Beijing, Xi'an, Shanghai, Guilin, Hong Kong |
| India | Delhi, Rajasthan, Uttar Pradesh, Kerala | Delhi, Agra, Jaipur, Udaipur, Varanasi |
| Indonesia | Bali, Java, Yogyakarta | Ubud, Seminyak, Yogyakarta, Jakarta |
| Japan | Kanto, Kansai, Chubu, Hiroshima | Tokyo, Kyoto, Osaka, Hakone, Takayama, Hiroshima |
| Jordan | Amman, Petra, Aqaba, Wadi Rum | Amman, Petra, Wadi Rum, Aqaba |
| Kazakhstan | | |
| Malaysia | | |
| Maldives | | |
| Nepal | | |
| Philippines | | |
| Qatar | | |
| Saudi Arabia | | |
| Singapore | Singapore | Singapore |
| South Korea | Seoul, Gyeongsang, Jeju | Seoul, Busan, Gyeongju, Jeju |
| Sri Lanka | Central Province, Southern Province, Western Province | Colombo, Kandy, Ella, Galle, Sigiriya |
| Thailand | Bangkok, Chiang Mai, Krabi, Phuket | Bangkok, Chiang Mai, Krabi, Phuket, Ayutthaya |
| Turkey | Istanbul, Cappadocia, Aegean, Pamukkale | Istanbul, Cappadocia, Pamukkale, Ephesus area, Antalya |
| United Arab Emirates | Dubai, Abu Dhabi | Dubai, Abu Dhabi |
| Uzbekistan | | |
| Vietnam | Hanoi, Quang Nam, Ho Chi Minh City, Ninh Binh | Hanoi, Ha Long, Hoi An, Hue, Ho Chi Minh City |

## Europe (31)

| Country | Planned regions | Planned base cities |
|---|---|---|
| Albania | | |
| Austria | Vienna, Salzburg, Tyrol | Vienna, Salzburg, Innsbruck, Hallstatt |
| Belgium | | |
| Bulgaria | | |
| Croatia | Dalmatia, Istria, Zagreb | Dubrovnik, Split, Hvar, Zagreb, Plitvice area |
| Cyprus | | |
| Czech Republic | Prague, Bohemia, Moravia | Prague, Cesky Krumlov, Brno |
| Denmark | | |
| Finland | Lapland, Uusimaa | Helsinki, Rovaniemi |
| France | Ile-de-France, Provence, Normandy, Nouvelle-Aquitaine | Paris, Nice, Avignon, Bordeaux, Bayeux |
| Germany | Bavaria, Berlin, Rhineland | Berlin, Munich, Rothenburg, Cologne |
| Greece | Attica, Cyclades, Crete, Peloponnese | Athens, Santorini, Mykonos, Naxos, Chania |
| Hungary | Budapest | Budapest |
| Iceland | Capital Region, South Iceland, North Iceland | Reykjavik, Vik, Hofn, Akureyri |
| Ireland | Leinster, Munster, Connacht | Dublin, Galway, Killarney, Dingle |
| Italy | Lazio, Tuscany, Veneto, Campania, Lombardy | Rome, Florence, Venice, Naples, Milan, Sorrento |
| Kosovo | | |
| Montenegro | | |
| Netherlands | North Holland | Amsterdam |
| North Macedonia | | |
| Norway | Western Norway, Oslo, Troms | Oslo, Bergen, Flam, Tromso |
| Poland *(not in Exoticca's list; add if the app wants it)* | | |
| Portugal | Lisbon, Porto, Algarve, Madeira | Lisbon, Porto, Lagos, Funchal, Sintra |
| Romania | Transylvania, Bucharest | Bucharest, Brasov, Sibiu |
| Serbia | | |
| Slovakia | | |
| Spain | Madrid, Catalonia, Andalusia, Basque Country | Madrid, Barcelona, Seville, Granada, San Sebastian |
| Sweden | Stockholm, Lapland | Stockholm, Kiruna |
| Switzerland | Bernese Oberland, Valais, Zurich, Graubunden | Zurich, Interlaken, Zermatt, Lucerne, St Moritz |
| **United Kingdom** ✅ *(Scotland)* | Scotland | Edinburgh, Isle of Skye, Inverness, Glasgow, Oban, Pitlochry, St Andrews |
| United Kingdom *(England, Northern Ireland)* | England, Northern Ireland | London, Bath, York, Belfast |

## Oceania (3)

| Country | Planned regions | Planned base cities |
|---|---|---|
| Australia | New South Wales, Queensland, Northern Territory, Victoria | Sydney, Cairns, Uluru area, Melbourne |
| Fiji | | |
| New Zealand | North Island, South Island | Auckland, Rotorua, Queenstown, Christchurch, Franz Josef |

---

## Authoring order

Worked in rough order of how commonly the destination is searched and how many
well-documented published itineraries exist for it, since that is what the method in
section 2.1 depends on. See `PROGRESS.md` for the live state.
