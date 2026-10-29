"""Japan pack: reusable day blocks and the eight Japan templates (T01-T08)."""
from __future__ import annotations

from model import Act, Leg, L, SEAT, Stay, Template
import japan_media

COUNTRY = "Japan"

# Offered-for-destination metadata, keyed by template id.
META = {
    "T01": dict(summary="The classic first trip: three days in Tokyo, three in Kyoto, with a day trip to Nara.", image_query="Kyoto Japan temple"),
    "T02": dict(summary="Tokyo, a night in a Hakone ryokan with an onsen, then Kyoto, with an evening in Osaka.", image_query="Hakone Japan Mount Fuji"),
    "T03": dict(summary="Slow down in the Kansai region: four days in Kyoto and two in Osaka, flying in and out of Osaka.", image_query="Kyoto Japan Fushimi Inari"),
    "T04": dict(summary="The golden route stretched to ten days, with a Mount Fuji day trip and a night in Hiroshima.", image_query="Hiroshima Japan Miyajima"),
    "T05": dict(summary="Tokyo, the Japan Alps and Kyoto: Kanazawa, thatched Shirakawa-go and a Takayama ryokan.", image_query="Shirakawa-go Japan village", highlights=["Shirakawa-go thatched-roof village", "Kenroku-en Garden", "Takayama old town", "Fushimi Inari torii gate hike", "Meiji Jingu Shrine"]),
    "T06": dict(summary="The grand tour in two weeks: Tokyo and Nikko, Hakone, Kyoto, Hiroshima, Miyajima and Osaka.", image_query="Japan Kyoto Tokyo skyline"),
    "T07": dict(summary="Two weeks combining the golden route with the Japanese Alps, Takayama and Kanazawa.", image_query="Takayama Japan old town", highlights=["Shirakawa-go thatched-roof village", "Kenroku-en Garden", "Takayama old town", "Fushimi Inari torii gate hike", "Nara day trip"]),
    "T08": dict(summary="Kyoto, Osaka and western Japan in ten days: Kurama hike, Hiroshima and Miyajima.", image_query="Miyajima Japan torii"),
}

# ------------------------------------------------- reusable activity blocks
# Each block function returns a list of Act for a given day offset.

def arrive_tokyo(d):
    return [
        L(d, "Train", "Narita (NRT) or Haneda (HND) Airport", "Tokyo hotel area", "", 90,
          "Narita Express, Keikyu, or Tokyo Monorail",
          "Airport limousine bus is the door-to-door alternative. Set up an IC card (Suica/PASMO; Apple Wallet works)."),
        Act(d, "Sights & Landmarks", "17:00", "1h", "Free city-view observation deck",
            "Tokyo Metropolitan Government Building observatory is free; good jet-lag-day orientation.",
            "Shinjuku, Tokyo"),
        Act(d, "Food & Drink", "19:00", "2h", "Izakaya alley dinner",
            "Omoide Yokocho / Golden Gai-style yakitori and small bars.",
            "Shinjuku, Tokyo"),
    ]


def tokyo_west(d):
    return [
        Act(d, "Sights & Landmarks", "09:00", "1.5h", "Meiji Jingu Shrine",
            "Forest shrine; go early.", "Harajuku, Tokyo"),
        Act(d, "Shopping", "11:00", "2h", "Harajuku & Omotesando",
            "Takeshita Street street fashion, then Omotesando boulevard.", "Harajuku, Tokyo"),
        Act(d, "Sights & Landmarks", "15:00", "1h", "Shibuya Crossing",
            "Scramble crossing; view from above at a station-side cafe or deck.", "Shibuya, Tokyo"),
        Act(d, "Ticketed Attraction", "17:00", "1.5h", "Sunset rooftop observation deck",
            "Shibuya Sky or similar; sunset slots sell out.", "Shibuya, Tokyo",
            "Yes - timed tickets, sunset sells out"),
    ]


def tokyo_east(d):
    return [
        Act(d, "Food & Drink", "08:00", "1.5h", "Fish market breakfast",
            "Tsukiji Outer Market stalls: sushi, tamagoyaki, grilled seafood.", "Tsukiji, Tokyo"),
        Act(d, "Sights & Landmarks", "10:30", "2h", "Senso-ji Temple & Nakamise street",
            "Tokyo's oldest temple and its shopping lane.", "Asakusa, Tokyo"),
        Act(d, "Sights & Landmarks", "14:00", "1.5h", "Imperial Palace East Gardens",
            "Free; closed Mondays and Fridays - swap with Ueno Park/museums those days.",
            "Chiyoda, Tokyo"),
        Act(d, "Shopping", "16:30", "2h", "Ginza department stores & depachika",
            "Basement food halls are the highlight.", "Ginza, Tokyo"),
    ]


def tokyo_pop_culture(d):
    return [
        Act(d, "Shopping", "10:00", "2.5h", "Akihabara electronics & anime district",
            "Retro game shops, arcades, figure stores.", "Akihabara, Tokyo"),
        Act(d, "Ticketed Attraction", "14:00", "2.5h", "Immersive digital art museum",
            "teamLab-style installation; timed entry.", "Toyosu or Azabudai, Tokyo",
            "Yes - timed tickets"),
        Act(d, "Nightlife", "19:00", "2h", "Evening in a nightlife district",
            "Shinjuku Kabukicho lights or Shibuya bars.", "Shinjuku, Tokyo"),
    ]


def fuji_day_trip(d):
    return [
        Act(d, "Day Trip", "07:30", "11h", "Mt Fuji Five Lakes day trip",
            "Lake Kawaguchiko viewpoints, pagoda viewpoint, lakeside cruise. Fuji is clouded on many days - check the forecast and keep this day flexible.",
            "Kawaguchiko, Yamanashi", "Yes - highway bus or limited express seats"),
    ]


def nikko_day_trip(d):
    return [
        Act(d, "Day Trip", "08:00", "9h", "Nikko day trip",
            "Toshogu Shrine complex, Shinkyo Bridge, Kanmangafuchi abyss walk. ~2h each way by train.",
            "Nikko, Tochigi"),
    ]


def to_hakone_with_ryokan(d):
    return [
        L(d, "Train", "Shinjuku Station", "Hakone-Yumoto Station", "09:00", 85,
          "Odakyu Romancecar (limited express)", "A Hakone Free Pass covers this and the Hakone loop.", SEAT),
        Act(d, "Ticketed Attraction", "11:00", "1.5h", "Open-air sculpture museum",
            "Worthwhile even when Fuji is hidden.", "Hakone, Kanagawa"),
        Act(d, "Sights & Landmarks", "13:30", "1.5h", "Ropeway over volcanic valley",
            "Owakudani sulfur vents; Fuji views on clear days.", "Owakudani, Hakone"),
        Act(d, "Sights & Landmarks", "15:00", "1h", "Lake Ashi cruise",
            "Pirate-ship ferry toward the lakeside torii.", "Lake Ashi, Hakone"),
        Act(d, "Spa/Wellness", "18:00", "3h", "Ryokan onsen & kaiseki dinner",
            "Check tattoo policy; private baths are an option.", "Hakone, Kanagawa"),
    ]


def _plus(t, mins):
    h, m = map(int, t.split(":"))
    m += h * 60 + mins
    return f"{m // 60:02d}:{m % 60:02d}"


SHINKANSEN_LINES = {
    ("Tokyo", "Kyoto"): "JR Tokaido Shinkansen (Nozomi/Hikari)",
    ("Kyoto", "Hiroshima"): "JR Tokaido/Sanyo Shinkansen (Nozomi/Hikari)",
    ("Shin-Osaka", "Hiroshima"): "JR Sanyo Shinkansen (Nozomi/Hikari/Sakura)",
    ("Tokyo", "Kanazawa"): "JR Hokuriku Shinkansen (Kagayaki)",
}


def shinkansen(d, frm, to, time, dur, where="", extra=""):
    mins = int(round(float(dur.rstrip("h")) * 60))
    return [L(d, "Train", f"{frm} Station", f"{to} Station", time, mins,
              SHINKANSEN_LINES.get((frm, to), "JR Shinkansen"),
              ("Shinkansen. Consider forwarding large luggage (takkyubin). Nozomi is not covered by the standard JR Pass. " + extra).strip(),
              SEAT)]


def hakone_to_kyoto(d):
    return [
        L(d, "Bus", "Hakone (Gora or Lake Ashi)", "Odawara Station", "09:30", 50, "Hakone Tozan Bus",
          "Covered by the Hakone Free Pass."),
        L(d, "Train", "Odawara Station", "Kyoto Station", "10:40", 135, "JR Tokaido Shinkansen (Hikari)",
          "Hikari stops at Odawara; Nozomi does not.", SEAT),
    ]


def miyajima_out(d, time, final_to, final_mins, final_carrier):
    """Island -> mainland -> Hiroshima -> onward shinkansen; returns legs."""
    return [
        L(d, "Ferry", "Miyajima Pier", "Miyajimaguchi Pier", time, 10, "JR Miyajima Ferry",
          "JR Pass covers the JR ferry."),
        L(d, "Train", "Miyajimaguchi Station", "Hiroshima Station", _plus(time, 20), 30, "JR Sanyo Line (local)"),
        L(d, "Train", "Hiroshima Station", final_to, _plus(time, 65), final_mins, final_carrier,
          "Shinkansen.", SEAT),
    ]


def fushimi_inari(d, time="15:00"):
    return [Act(d, "Hike", time, "2.5h", "Fushimi Inari torii gate hike",
                "Open 24h; walk past the crowds toward the summit. Late afternoon light or early morning.",
                "Fushimi, Kyoto")]


def gion_evening(d):
    return [Act(d, "Sights & Landmarks", "19:00", "1.5h", "Gion evening walk",
                "Hanamikoji and Shirakawa lanes; do not photograph or follow geiko/maiko.",
                "Gion, Kyoto")]


def kyoto_higashiyama(d, time="08:00"):
    return [
        Act(d, "Sights & Landmarks", time, "1.5h", "Kiyomizu-dera Temple",
            "Go at opening to beat crowds.", "Higashiyama, Kyoto"),
        Act(d, "Sights & Landmarks", _plus(time, 105), "2h", "Sannenzaka & Ninenzaka lanes to Yasaka Shrine",
            "Preserved slopes, tea shops; ends near Maruyama Park.", "Higashiyama, Kyoto"),
        Act(d, "Class", "14:00", "1.5h", "Tea ceremony experience",
            "Small-group matcha ceremony; kimono rental optional.", "Higashiyama, Kyoto",
            "Yes - book a session"),
    ]


def kyoto_arashiyama_north(d):
    return [
        Act(d, "Sights & Landmarks", "07:30", "1h", "Arashiyama Bamboo Grove",
            "Before 8:00 or it is shoulder to shoulder.", "Arashiyama, Kyoto"),
        Act(d, "Sights & Landmarks", "08:30", "1h", "Tenryu-ji Temple garden",
            "Zen garden next to the grove.", "Arashiyama, Kyoto"),
        Act(d, "Sights & Landmarks", "11:00", "1h", "Kinkaku-ji (Golden Pavilion)",
            "", "Kita, Kyoto"),
        Act(d, "Sights & Landmarks", "12:15", "1h", "Ryoan-ji rock garden",
            "Short bus/walk from Kinkaku-ji.", "Ukyo, Kyoto"),
    ]


def kyoto_market_and_castle(d):
    return [
        Act(d, "Food & Drink", "09:30", "1.5h", "Nishiki Market tasting walk",
            "Covered food market; graze rather than sit.", "Downtown Kyoto"),
        Act(d, "Sights & Landmarks", "11:30", "1.5h", "Nijo Castle",
            "Nightingale floors; closed some Tuesdays in winter.", "Nakagyo, Kyoto"),
    ]


def kyoto_north_hike(d):
    return [
        Act(d, "Hike", "09:00", "5h", "Kurama to Kibune mountain hike",
            "Temple-to-shrine trail over the ridge; lunch in Kibune.", "Kurama, Kyoto"),
        Act(d, "Sights & Landmarks", "15:30", "2h", "Philosopher's Path & Ginkaku-ji",
            "Canal-side walk ending at the Silver Pavilion.", "Northern Higashiyama, Kyoto"),
    ]


def nara_day_trip(d, time="08:30", dur="5h"):
    return [Act(d, "Day Trip", time, dur, "Nara day trip",
                "Todai-ji Great Buddha, Nara Park deer, Kasuga Taisha lanterns. ~45 min by train.",
                "Nara Park, Nara")]


def osaka_evening(d, time="17:00"):
    return [Act(d, "Food & Drink", time, "3h", "Dotonbori street food evening",
                "Takoyaki, okonomiyaki, kushikatsu under the neon signs.", "Namba, Osaka")]


def osaka_day(d):
    return [
        Act(d, "Sights & Landmarks", "09:30", "2h", "Osaka Castle & park", "", "Chuo, Osaka"),
        Act(d, "Food & Drink", "12:00", "1.5h", "Kuromon Market lunch", "Seafood stalls.", "Nipponbashi, Osaka"),
        Act(d, "Sights & Landmarks", "14:30", "2h", "Shinsekai retro district",
            "Tsutenkaku tower and kushikatsu counters.", "Shinsekai, Osaka"),
        Act(d, "Ticketed Attraction", "17:30", "1.5h", "Sunset skyscraper observatory",
            "Umeda Sky Building floating garden or similar.", "Umeda, Osaka"),
    ]


def himeji_option(d):
    return [Act(d, "Day Trip", "", "6h", "Optional: Himeji Castle day trip",
                "Japan's finest original castle, ~1h by shinkansen. Swap for any Osaka day.",
                "Himeji, Hyogo")]


def hiroshima_arrival(d, frm):
    return shinkansen(d, frm, "Hiroshima", "08:00", "1.75h", f"{frm} Station") + [
        Act(d, "Sights & Landmarks", "10:30", "3h", "Peace Memorial Park & Museum",
            "Allow at least 2 hours for the museum.", "Naka, Hiroshima"),
        Act(d, "Sights & Landmarks", "14:30", "1h", "Shukkeien Garden", "", "Naka, Hiroshima"),
        Act(d, "Food & Drink", "19:00", "1.5h", "Hiroshima-style okonomiyaki dinner",
            "Layered noodle okonomiyaki at a griddle counter.", "Naka, Hiroshima"),
    ]


def miyajima(d, overnight=False, onward=None):
    acts = [
        L(d, "Train", "Hiroshima Station", "Miyajimaguchi Station", "08:00", 30, "JR Sanyo Line (local)"),
        L(d, "Ferry", "Miyajimaguchi Pier", "Miyajima Pier", "08:40", 10, "JR Miyajima Ferry",
          "JR Pass covers the JR ferry. Check the tide table before you go."),
        Act(d, "Sights & Landmarks", "09:30", "2h", "Itsukushima Shrine & floating torii",
            "Check the tide table: torii 'floats' at high tide, walkable at low tide.", "Miyajima, Hiroshima"),
        Act(d, "Hike", "12:00", "3h", "Mt Misen hike or ropeway",
            "Summit views over the Seto Inland Sea.", "Miyajima, Hiroshima"),
    ]
    if overnight:
        acts.append(Act(d, "Sights & Landmarks", "19:00", "1h", "Illuminated torii after day-trippers leave",
                        "The payoff for staying on the island.", "Miyajima, Hiroshima"))
    if onward:
        acts += miyajima_out(d, "16:00", "Shin-Osaka Station", 85, "JR Sanyo Shinkansen (Nozomi/Hikari/Sakura)")
    return acts


def depart_kix(d, frm):
    if frm == "Osaka":
        return [L(d, "Train", "Namba Station (Osaka)", "Kansai International Airport (KIX)", "", 40,
                  "Nankai Rapi:t (limited express)",
                  "Or JR Haruka from Shin-Osaka/Tennoji. Time to the flight; KIX check-in closes ~60 min before departure.")]
    return [L(d, "Train", f"{frm} Station", "Kansai International Airport (KIX)", "", 80,
              "JR Haruka (limited express)",
              "Open-jaw ticket. If flying home from Tokyo instead, take the Tokaido Shinkansen back (~2h15).")]


def arrive_kix(d):
    return [L(d, "Train", "Kansai International Airport (KIX)", "Kyoto Station", "", 80,
              "JR Haruka (limited express)", "Get an ICOCA card at the airport.")]


def kyoto_to_osaka(d, time):
    return [L(d, "Train", "Kyoto Station", "Osaka (Umeda)", time, 30,
              "JR Special Rapid (or Hankyu/Keihan to Umeda/Namba)", "No reservation needed.")]


def kanazawa_arrive(d):
    return shinkansen(d, "Tokyo", "Kanazawa", "08:30", "2.75h", "Tokyo Station") + [
        Act(d, "Sights & Landmarks", "13:00", "1.5h", "Kenroku-en Garden", "One of Japan's top three gardens.", "Kanazawa, Ishikawa"),
        Act(d, "Sights & Landmarks", "14:45", "1h", "Kanazawa Castle Park", "", "Kanazawa, Ishikawa"),
        Act(d, "Sights & Landmarks", "17:00", "1.5h", "Higashi Chaya teahouse district",
            "Gold-leaf shops; quieter alternative to Gion.", "Higashiyama, Kanazawa"),
    ]


def kanazawa_day(d):
    return [
        Act(d, "Food & Drink", "08:30", "1.5h", "Omicho Market seafood breakfast", "", "Kanazawa, Ishikawa"),
        Act(d, "Ticketed Attraction", "10:30", "1.5h", "Contemporary art museum",
            "21st Century Museum; closed Mondays.", "Kanazawa, Ishikawa"),
        Act(d, "Sights & Landmarks", "13:30", "2h", "Nagamachi samurai district", "", "Nagamachi, Kanazawa"),
        Act(d, "Class", "16:00", "1.5h", "Gold-leaf or craft workshop", "", "Kanazawa, Ishikawa",
            "Yes - book a workshop"),
    ]


def shirakawago(d, frm, to):
    mins = 75 if frm == "Kanazawa" else 50
    back = 75 if to == "Kanazawa" else 50
    return [
        L(d, "Bus", f"{frm} bus terminal", "Shirakawa-go bus terminal", "08:30", mins,
          "Nohi Bus / Hokutetsu highway bus", "Seats sell out in foliage and snow seasons. Coin lockers at the terminal.",
          "Yes - reserve highway bus"),
        Act(d, "Sights & Landmarks", "10:00", "3h", "Shirakawa-go thatched-roof village",
            "Gassho-zukuri farmhouses and the Shiroyama viewpoint.", "Shirakawa-go, Gifu"),
        L(d, "Bus", "Shirakawa-go bus terminal", f"{to} bus terminal", "14:00", back,
          "Nohi Bus / Hokutetsu highway bus", "", "Yes - reserve highway bus"),
    ]


def takayama_day(d):
    return [
        Act(d, "Food & Drink", "07:30", "1.5h", "Riverside morning market", "Miyagawa market; Hida beef snacks.", "Takayama, Gifu"),
        Act(d, "Sights & Landmarks", "09:30", "2h", "Old town (Sanmachi Suji) & former government house",
            "Edo-era merchant streets and sake breweries.", "Takayama, Gifu"),
        Act(d, "Sights & Landmarks", "13:00", "2h", "Hida open-air folk village", "", "Takayama, Gifu"),
    ]


# ------------------------------------------------------------ templates

def build() -> list[Template]:
    T = []

    t = Template(
        "T01", "Classic Tokyo & Kyoto - 7 days", 7, "Tokyo > Kyoto (Nara day trip)",
        "Tokyo (NRT/HND)", "Osaka (KIX) or Tokyo",
        ["InsideKyoto #1", "Japan Activity 7-day", "Japan Starts Here", "kimkim Best of Tokyo & Kyoto", "Frommers 1 week"],
        [Stay("Tokyo", "Hotel in Tokyo", 0, 3, "Shinjuku, Shibuya, or Tokyo Station area"),
         Stay("Kyoto", "Hotel in Kyoto", 3, 3, "Kyoto Station, Downtown (Shijo/Kawaramachi), or Gion")])
    t.acts = (arrive_tokyo(0) + tokyo_west(1) + tokyo_east(2)
              + shinkansen(3, "Tokyo", "Kyoto", "09:00", "2.25h", "Tokyo Station") + fushimi_inari(3) + gion_evening(3)
              + kyoto_arashiyama_north(4)
              + nara_day_trip(5) + kyoto_higashiyama(5, "15:00")[:2]
              + kyoto_market_and_castle(6)[:1] + depart_kix(6, "Kyoto"))
    T.append(t)

    t = Template(
        "T02", "Golden Route with Hakone - 7 days", 7, "Tokyo > Hakone > Kyoto (Osaka evening)",
        "Tokyo (NRT/HND)", "Osaka (KIX)",
        ["JW Web Magazine 1 week", "Two Wandering Soles 1 week", "Japan Experience Japan in a Week", "kimkim Tokyo, Hakone & Kyoto 7 days"],
        [Stay("Tokyo", "Hotel in Tokyo", 0, 2, "Shinjuku (easiest for the Hakone train)"),
         Stay("Hakone", "Ryokan with onsen in Hakone", 2, 1, "Hakone-Yumoto, Gora, or Lake Ashi", True, True),
         Stay("Kyoto", "Hotel in Kyoto", 3, 3, "Kyoto Station or Downtown")])
    t.acts = (arrive_tokyo(0)
              + [tokyo_east(1)[1], tokyo_pop_culture(1)[0], tokyo_west(1)[0], tokyo_west(1)[2]]
              + to_hakone_with_ryokan(2)
              + hakone_to_kyoto(3) + fushimi_inari(3) + gion_evening(3)
              + kyoto_arashiyama_north(4)
              + kyoto_higashiyama(5)[:2] + kyoto_market_and_castle(5)[:1] + osaka_evening(5)
              + depart_kix(6, "Kyoto"))
    for a in t.acts:
        if a.day == 1 and a.name.startswith("Senso-ji"):
            a.time = "08:30"
        if a.day == 1 and a.name.startswith("Akihabara"):
            a.time = "11:00"
        if a.day == 1 and a.name.startswith("Meiji"):
            a.time = "14:00"
        if a.day == 1 and a.name.startswith("Shibuya"):
            a.time = "17:00"
        if a.day == 5 and a.name.startswith("Nishiki"):
            a.time = "12:00"
    T.append(t)

    t = Template(
        "T03", "Kansai Focus - 7 days (fly into Osaka)", 7, "Kyoto (Nara day trip) > Osaka",
        "Osaka (KIX)", "Osaka (KIX)",
        ["InsideKyoto #5 (Kansai & West)", "kimkim Culinary Tokyo/Kyoto/Osaka (Kansai leg)", "GoWithGuide 7 days"],
        [Stay("Kyoto", "Hotel in Kyoto", 0, 4, "Kyoto Station or Downtown"),
         Stay("Osaka", "Hotel in Osaka", 4, 2, "Namba or Umeda")])
    t.acts = (arrive_kix(0)
              + [Act(0, "Food & Drink", "19:00", "2h", "Riverside alley dinner",
                     "Pontocho lane or Kiyamachi; seasonal river terraces in summer.", "Downtown Kyoto")]
              + kyoto_higashiyama(1) + gion_evening(1)
              + nara_day_trip(2)
              + kyoto_arashiyama_north(3) + kyoto_market_and_castle(3)[1:]
              + fushimi_inari(4, "07:30")
              + kyoto_to_osaka(4, "11:00")
              + osaka_day(4)[:1] + osaka_evening(4)
              + osaka_day(5)[1:] + himeji_option(5)
              + depart_kix(6, "Osaka"))
    for a in t.acts:
        if a.day == 4 and a.name.startswith("Osaka Castle"):
            a.time = "13:00"
        if a.day == 3 and a.name.startswith("Nijo"):
            a.time = "14:30"
    T.append(t)

    t = Template(
        "T04", "Golden Route + Hiroshima - 10 days", 10, "Tokyo (Fuji day trip) > Kyoto (Nara) > Hiroshima/Miyajima > Osaka",
        "Tokyo (NRT/HND)", "Osaka (KIX)",
        ["kimkim 10 days #1 Golden Route with Hiroshima", "kimkim 10 days #2 Food & History", "Japan Activity 10-day",
         "Intrepid Japan Express", "kimkim Japan's Big Four"],
        [Stay("Tokyo", "Hotel in Tokyo", 0, 3, "Shinjuku, Shibuya, or Tokyo Station area"),
         Stay("Kyoto", "Hotel in Kyoto", 3, 3, "Kyoto Station or Downtown"),
         Stay("Hiroshima", "Hotel in Hiroshima", 6, 1, "Near Hiroshima Station or Peace Park"),
         Stay("Osaka", "Hotel in Osaka", 7, 2, "Namba or Umeda")])
    t.acts = (arrive_tokyo(0)
              + [tokyo_east(1)[0], tokyo_east(1)[1]] + tokyo_west(1)[0:1] + tokyo_west(1)[2:]
              + fuji_day_trip(2)
              + shinkansen(3, "Tokyo", "Kyoto", "09:00", "2.25h", "Tokyo Station") + fushimi_inari(3) + gion_evening(3)
              + kyoto_arashiyama_north(4)
              + nara_day_trip(5) + kyoto_higashiyama(5, "15:00")[:2]
              + hiroshima_arrival(6, "Kyoto")
              + miyajima(7, onward="Osaka") + osaka_evening(7, "19:00")
              + osaka_day(8)
              + depart_kix(9, "Osaka"))
    for a in t.acts:
        if a.day == 1 and a.name.startswith("Fish market"):
            a.time = "08:00"
        if a.day == 1 and a.name.startswith("Senso-ji"):
            a.time = "10:00"
        if a.day == 1 and a.name.startswith("Meiji"):
            a.time = "13:30"
        if a.day == 1 and a.name.startswith("Shibuya Crossing"):
            a.time = "15:30"
    T.append(t)

    t = Template(
        "T05", "Tokyo, Japanese Alps & Kyoto - 10 days", 10, "Tokyo > Kanazawa > Shirakawa-go > Takayama > Kyoto",
        "Tokyo (NRT/HND)", "Osaka (KIX)",
        ["InsideKyoto #2 Tokyo-Kanazawa-Kyoto", "InsideKyoto #3 Tokyo-Takayama-Kyoto", "kimkim Cities & Countryside 7 days",
         "Japan Activity 10-day (Takayama option)"],
        [Stay("Tokyo", "Hotel in Tokyo", 0, 3, "Tokyo Station or Ueno (direct Hokuriku shinkansen)"),
         Stay("Kanazawa", "Hotel in Kanazawa", 3, 2, "Kanazawa Station or Korinbo"),
         Stay("Takayama", "Ryokan in Takayama", 5, 1, "Old town, walkable to Sanmachi Suji", True, True),
         Stay("Kyoto", "Hotel in Kyoto", 6, 3, "Kyoto Station or Downtown")])
    t.acts = (arrive_tokyo(0) + tokyo_west(1) + tokyo_east(2)
              + kanazawa_arrive(3) + kanazawa_day(4)
              + shirakawago(5, "Kanazawa", "Takayama")
              + [Act(5, "Sights & Landmarks", "16:00", "1.5h", "Takayama old town stroll", "Sake brewery tastings close around 17:00.", "Takayama, Gifu"),
                 Act(5, "Spa/Wellness", "18:30", "2.5h", "Ryokan onsen & Hida beef dinner", "", "Takayama, Gifu")]
              + takayama_day(6)[:2]
              + [L(6, "Train", "Takayama Station", "Nagoya Station", "12:30", 140, "JR Hida (limited express)",
                   "Scenic river-gorge line; sit on the right heading south.", SEAT),
                 L(6, "Train", "Nagoya Station", "Kyoto Station", "15:05", 35, "JR Tokaido Shinkansen", "", SEAT)]
              + kyoto_higashiyama(7) + fushimi_inari(7, "16:00")
              + kyoto_arashiyama_north(8) + gion_evening(8)
              + kyoto_market_and_castle(9)[:1] + depart_kix(9, "Kyoto"))
    T.append(t)

    t = Template(
        "T06", "Grand Tour - 14 days", 14, "Tokyo (Nikko) > Hakone > Kyoto (Nara) > Hiroshima > Miyajima > Osaka",
        "Tokyo (NRT/HND)", "Osaka (KIX)",
        ["InsideKyoto #4 Grand Tour", "Japan Experience Classic Japan 14 days", "CabinZero 2-week", "JW Web Magazine 2 weeks",
         "ExplorerTom 2 weeks"],
        [Stay("Tokyo", "Hotel in Tokyo", 0, 4, "Shinjuku, Shibuya, or Tokyo Station area"),
         Stay("Hakone", "Ryokan with onsen in Hakone", 4, 1, "Hakone-Yumoto, Gora, or Lake Ashi", True, True),
         Stay("Kyoto", "Hotel in Kyoto", 5, 4, "Kyoto Station, Downtown, or Gion"),
         Stay("Hiroshima", "Hotel in Hiroshima", 9, 1, "Near Hiroshima Station or Peace Park"),
         Stay("Miyajima", "Ryokan on Miyajima", 10, 1, "On the island, near the shrine", True, True),
         Stay("Osaka", "Hotel in Osaka", 11, 2, "Namba or Umeda")])
    t.acts = (arrive_tokyo(0) + tokyo_west(1) + tokyo_east(2) + nikko_day_trip(3)
              + to_hakone_with_ryokan(4)
              + hakone_to_kyoto(5) + fushimi_inari(5) + gion_evening(5)
              + kyoto_higashiyama(6) + kyoto_market_and_castle(6)[:1]
              + nara_day_trip(7)
              + kyoto_arashiyama_north(8) + kyoto_market_and_castle(8)[1:]
              + hiroshima_arrival(9, "Kyoto")
              + miyajima(10, overnight=True)
              + miyajima_out(11, "09:30", "Shin-Osaka Station", 85, "JR Sanyo Shinkansen (Nozomi/Hikari/Sakura)")
              + osaka_day(11)[:1] + osaka_evening(11)
              + osaka_day(12)[1:] + himeji_option(12)
              + depart_kix(13, "Osaka"))
    for a in t.acts:
        if a.day == 6 and a.name.startswith("Nishiki"):
            a.time = "16:00"
        if a.day == 8 and a.name.startswith("Nijo"):
            a.time = "14:30"
        if a.day == 11 and a.name.startswith("Osaka Castle"):
            a.time = "13:00"
    T.append(t)

    t = Template(
        "T07", "Grand Tour with the Japanese Alps - 14 days", 14,
        "Tokyo > Hakone > Takayama > Shirakawa-go > Kanazawa > Kyoto (Nara) > Osaka",
        "Tokyo (NRT/HND)", "Osaka (KIX)",
        ["InsideJapan Tours Classic Japan", "Japan Activity 2-week Grand Tour", "kimkim Traditions of Japan 14 days",
         "Intrepid Japan: Land of the Rising Sun"],
        [Stay("Tokyo", "Hotel in Tokyo", 0, 3, "Shinjuku (easiest for the Hakone train)"),
         Stay("Hakone", "Ryokan with onsen in Hakone", 3, 1, "Hakone-Yumoto, Gora, or Lake Ashi", True, True),
         Stay("Takayama", "Ryokan in Takayama", 4, 2, "Old town, walkable to Sanmachi Suji", True, True),
         Stay("Kanazawa", "Hotel in Kanazawa", 6, 2, "Kanazawa Station or Korinbo"),
         Stay("Kyoto", "Hotel in Kyoto", 8, 3, "Kyoto Station or Downtown"),
         Stay("Osaka", "Hotel in Osaka", 11, 2, "Namba or Umeda")])
    t.acts = (arrive_tokyo(0) + tokyo_west(1) + tokyo_east(2)
              + to_hakone_with_ryokan(3)
              + [L(4, "Bus", "Hakone (Gora or Lake Ashi)", "Odawara Station", "09:00", 50, "Hakone Tozan Bus",
                   "Covered by the Hakone Free Pass."),
                 L(4, "Train", "Odawara Station", "Nagoya Station", "10:10", 75, "JR Tokaido Shinkansen (Hikari)", "", SEAT),
                 L(4, "Train", "Nagoya Station", "Takayama Station", "11:48", 150, "JR Hida (limited express)",
                   "Forward big luggage ahead; the Alps leg has little rack space.", SEAT),
                 Act(4, "Sights & Landmarks", "15:00", "2h", "Takayama old town stroll",
                     "Sake brewery tastings close around 17:00.", "Takayama, Gifu")]
              + takayama_day(5)
              + [Act(5, "Outdoor Activity", "15:30", "2h", "Countryside cycling tour", "Rice fields and villages outside town.",
                     "Takayama, Gifu", "Yes - book a guided ride")]
              + shirakawago(6, "Takayama", "Kanazawa")
              + [Act(6, "Sights & Landmarks", "17:00", "1.5h", "Higashi Chaya teahouse district", "", "Higashiyama, Kanazawa")]
              + kanazawa_day(7)
              + [Act(7, "Sights & Landmarks", "07:00", "1.25h", "Kenroku-en Garden", "Open from early morning; pair with Omicho.", "Kanazawa, Ishikawa")]
              + [L(8, "Train", "Kanazawa Station", "Tsuruga Station", "08:30", 50, "JR Hokuriku Shinkansen", "", SEAT),
                 L(8, "Train", "Tsuruga Station", "Kyoto Station", "09:30", 55, "JR Thunderbird (limited express)",
                   "Same-station transfer at Tsuruga, ~10 min.", SEAT)]
              + fushimi_inari(8, "14:00") + gion_evening(8)
              + kyoto_higashiyama(9) + kyoto_market_and_castle(9)[:1]
              + kyoto_arashiyama_north(10)
              + [L(11, "Train", "Kyoto Station", "Kintetsu Nara Station", "08:00", 45, "Kintetsu Kyoto Line (limited express)",
                   "Moving day: send big bags ahead to the Osaka hotel (takkyubin).")]
              + nara_day_trip(11, "09:00", "5.5h")
              + [L(11, "Train", "Kintetsu Nara Station", "Osaka Namba Station", "15:00", 40, "Kintetsu Nara Line (rapid express)")]
              + osaka_evening(11, "18:00")
              + osaka_day(12)
              + depart_kix(13, "Osaka"))
    for a in t.acts:
        if a.day == 9 and a.name.startswith("Nishiki"):
            a.time = "16:00"
    T.append(t)

    t = Template(
        "T08", "Kansai & West - 10 days (fly into Osaka)", 10, "Kyoto (Nara, Kurama) > Osaka > Hiroshima > Miyajima",
        "Osaka (KIX)", "Osaka (KIX)",
        ["InsideKyoto #5 Kansai & West (10-day)", "kimkim 10 days #2 Food & History (west leg)", "Intrepid Japan Express (west leg)"],
        [Stay("Kyoto", "Hotel in Kyoto", 0, 5, "Kyoto Station or Downtown"),
         Stay("Osaka", "Hotel in Osaka", 5, 2, "Namba or Umeda (Shin-Osaka for the shinkansen)"),
         Stay("Hiroshima", "Hotel in Hiroshima", 7, 1, "Near Hiroshima Station or Peace Park"),
         Stay("Miyajima", "Ryokan on Miyajima", 8, 1, "On the island, near the shrine", True, True)])
    t.acts = (arrive_kix(0)
              + [Act(0, "Food & Drink", "19:00", "2h", "Riverside alley dinner",
                   "Pontocho lane or Kiyamachi.", "Downtown Kyoto")]
              + fushimi_inari(1, "07:30") + kyoto_higashiyama(1, "11:00")[:2] + gion_evening(1)
              + nara_day_trip(2)
              + kyoto_arashiyama_north(3) + kyoto_market_and_castle(3)[1:]
              + kyoto_north_hike(4) + kyoto_higashiyama(4)[2:]
              + kyoto_market_and_castle(5)[:1]
              + kyoto_to_osaka(5, "12:00")
              + osaka_day(5)[:1] + osaka_evening(5)
              + osaka_day(6)[1:] + himeji_option(6)
              + hiroshima_arrival(7, "Shin-Osaka")
              + miyajima(8, overnight=True)
              + miyajima_out(9, "09:00", "Shin-Osaka Station", 85, "JR Sanyo Shinkansen (Nozomi/Hikari/Sakura)")
              + [L(9, "Train", "Shin-Osaka Station", "Kansai International Airport (KIX)", "11:50", 50,
                   "JR Haruka (limited express)", "Book a flight leaving after ~14:30.")])
    for a in t.acts:
        if a.day == 4 and a.name.startswith("Tea ceremony"):
            a.time = "18:00"
        if a.day == 5 and a.name.startswith("Osaka Castle"):
            a.time = "14:00"
        if a.day == 3 and a.name.startswith("Nijo"):
            a.time = "14:30"
    T.append(t)
    return T


def build_with_meta() -> list[Template]:
    """The templates with their destination metadata applied."""
    out = build()
    for t in out:
        meta = META.get(t.id, {})
        t.summary = meta.get("summary", "")
        t.image_query = meta.get("image_query", "")
        t.highlights = list(meta.get("highlights", []))
        t.countries = [COUNTRY]
        t.cities = list(dict.fromkeys(s.base for s in t.stays))
        t.place_keys = dict(japan_media.ACTIVITY_PLACE)
        city_keys = [f"{japan_media.PREFIX}/{c.lower()}" for c in t.cities if c.lower() in japan_media.DESTINATIONS]
        t.destination_keys = [japan_media.PREFIX] + city_keys
        hero = japan_media.HERO.get(t.id, "")
        t.hero = hero if hero == japan_media.PREFIX else f"{japan_media.PREFIX}/{hero}" if hero else ""
    return out
