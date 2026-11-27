#!/usr/bin/env python3
"""Sync restaurant data copies from the master D in eat/app/index.html.

Usage: python3 sync_data.py <repo_dir> [--check]
  --check  only report differences, write nothing.

Also makes sure every row in the master has a unique numeric `id`
(photos are keyed by it). Rows without one get max+1, oldest first.
"""
import json, sys, os, re

HOME_FIELDS = ['id', 'n', 'a', 't', 'r', 'p', 'd', 'i', 'dt', 'ne', 'xy']
GAME_FIELDS = ['n', 't', 'a', 'p', 'r', 'd']
ADMIN_FIELDS = ['id', 'n', 'ne', 'a', 't', 'r', 'dt']
GAME_RATINGS = {'5', '4', '3'}
TARGETS = [  # (path, variable name, fields, filter, short address)
    ('eat/index.html', 'D', HOME_FIELDS, None, False),
    ('eat/vote/index.html', 'D', GAME_FIELDS, GAME_RATINGS, True),
    ('eat/mix/index.html', 'D0', GAME_FIELDS, GAME_RATINGS, True),
    ('eat/cut/index.html', 'D', GAME_FIELDS, GAME_RATINGS, True),
    ('eat/admin/index.html', 'D', ADMIN_FIELDS, None, False),
]
dec = json.JSONDecoder()


def locate(text, var):
    """Return (start, end, value) of the JSON array assigned to `const var=`."""
    for pre in ('const %s=[' % var, 'const %s = [' % var, 'let %s=[' % var, 'var %s=[' % var):
        k = text.find(pre)
        if k >= 0:
            start = k + len(pre) - 1
            val, end = dec.raw_decode(text, start)
            return start, end, val
    raise SystemExit('cannot find %s' % var)


def dump(rows):
    return json.dumps(rows, ensure_ascii=False)


def ensure_ids(D):
    """Give rows without an id the next free number, oldest first. Returns count added."""
    ids = [d['id'] for d in D if 'id' in d]
    if len(ids) != len(set(ids)):
        dup = sorted({i for i in ids if ids.count(i) > 1})
        raise SystemExit('duplicate ids: %s' % dup)
    nxt = max(ids, default=0) + 1
    missing = [d for d in D if 'id' not in d]
    missing.sort(key=lambda d: d.get('dt') or '')  # oldest first, stable
    for d in missing:
        d['id'] = nxt
        nxt += 1
    for k, d in enumerate(D):  # keep id as the first key
        if list(d.keys())[0] != 'id':
            D[k] = {'id': d['id'], **{x: y for x, y in d.items() if x != 'id'}}
    return len(missing)


def main():
    repo = sys.argv[1]
    check = '--check' in sys.argv
    mp = os.path.join(repo, 'eat/app/index.html')
    master = open(mp, encoding='utf8').read()
    s, e, D = locate(master, 'D')
    added = ensure_ids(D)
    print('master D: %d rows, %d new ids' % (len(D), added))
    bad = 0
    if added:
        bad += 1
        if not check:
            open(mp, 'w', encoding='utf8').write(master[:s] + dump(D) + master[e:])
    for path, var, fields, flt, short in TARGETS:
        fp = os.path.join(repo, path)
        if not os.path.exists(fp):
            print('%-22s missing, skipped' % path)
            continue
        text = open(fp, encoding='utf8').read()
        s, e, old = locate(text, var)
        # keep the field order the copy already uses, new fields go at the end
        order = list(old[0].keys()) if old else fields
        order = [f for f in order if f in fields] + [f for f in fields if f not in order]
        new = [{f: d[f] for f in order if f in d} for d in D if flt is None or d['r'] in flt]
        if short:  # game pages show a short area: text before first bracket or comma
            for x in new:
                x['a'] = re.split(r'[（(,，]', x['a'])[0].strip()
        same = new == old
        print('%-22s %-3s %4d -> %4d  %s' % (path, var, len(old), len(new), 'ok' if same else 'CHANGED'))
        if not same:
            bad += 1
            on = {x['n'] for x in old}; nn = {x['n'] for x in new}
            if on - nn: print('   removed:', sorted(on - nn)[:20])
            if nn - on: print('   added:  ', sorted(nn - on)[:20])
            if not check:
                open(fp, 'w', encoding='utf8').write(text[:s] + dump(new) + text[e:])
    if check and bad:
        sys.exit(1)


if __name__ == '__main__':
    main()
