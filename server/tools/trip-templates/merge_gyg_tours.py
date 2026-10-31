"""Validate GetYourGuide tour entries and merge them into server/data/getyourguide-tours.json.

usage: merge_gyg_tours.py TOURS.json [TOURS.json ...]
Each input is a JSON array of tour objects (see data/trip-template-authoring/GETYOURGUIDE.md).
Entries that break the rules are reported and left out; the rest are appended to the data file.
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', '..', 'data')
TOURS_FILE = os.path.join(DATA, 'getyourguide-tours.json')
URL = re.compile(r'https://www\.getyourguide\.com/[a-z0-9-]+-l\d+/[a-z0-9-]+-t\d+/')
KEYS = ['id', 'url', 'title', 'rating', 'reviewCount', 'city', 'country', 'activities', 'checkedAt']


def template_activity_names():
    names = set()
    for path in glob.glob(os.path.join(DATA, 'trip-template-authoring', '*-bundle.json')):
        with open(path, encoding='utf-8') as f:
            for template in json.load(f)['templates']:
                names.update(a['name'] for a in template['activities'])
    return names


def problems(tour, names, ids):
    found = []
    if not re.fullmatch(r't\d+', str(tour.get('id', ''))):
        found.append('bad id')
    url = tour.get('url', '')
    if not URL.fullmatch(url):
        found.append('bad url')
    elif not url.rstrip('/').endswith(str(tour.get('id'))):
        found.append('url does not end with the tour id')
    if not isinstance(tour.get('rating'), (int, float)) or tour['rating'] < 4.0:
        found.append('rating under 4.0')
    if not isinstance(tour.get('reviewCount'), int) or tour['reviewCount'] < 50:
        found.append('fewer than 50 reviews')
    if not tour.get('activities'):
        found.append('no activities')
    missing = [a for a in tour.get('activities', []) if a not in names]
    if missing:
        found.append('no template has: ' + '; '.join(missing))
    if tour.get('id') in ids:
        found.append('already in the file')
    return found


def render(tours):
    def one(tour):
        lines = []
        for key in KEYS:
            value = '[' + ', '.join(json.dumps(a, ensure_ascii=False) for a in tour[key]) + ']' if key == 'activities' else json.dumps(tour[key], ensure_ascii=False)
            lines.append(f'      "{key}": {value}')
        return '    {\n' + ',\n'.join(lines) + '\n    }'
    return '{\n  "tours": [\n' + ',\n'.join(one(t) for t in tours) + '\n  ]\n}\n'


def main(paths):
    with open(TOURS_FILE, 'rb') as f:
        raw = f.read().decode('utf-8')
    crlf = '\r\n' in raw
    tours = json.loads(raw)['tours']
    names = template_activity_names()
    ids = {t['id'] for t in tours}
    added = 0
    for path in paths:
        with open(path, encoding='utf-8') as f:
            incoming = json.load(f)
        for tour in incoming:
            found = problems(tour, names, ids)
            if found:
                print(f"rejected {tour.get('id')}: {', '.join(found)}")
                continue
            tours.append({key: tour[key] for key in KEYS})
            ids.add(tour['id'])
            added += 1
    out = render(tours)
    with open(TOURS_FILE, 'wb') as f:
        f.write((out.replace('\n', '\r\n') if crlf else out).encode('utf-8'))
    print(f'added {added}; {len(tours)} tours in the file')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1:])
