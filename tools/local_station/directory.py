"""Install a private singer directory beside a player, or import an older roster into it."""
import argparse
import json
import os
from pathlib import Path
import re
import tempfile
import unicodedata


def read(path):
    raw = Path(path).read_text(encoding='utf-8-sig')
    if Path(path).suffix.lower() == '.js':
        # A station sidecar contains one JSON assignment; never execute it.
        match = re.fullmatch(r'\s*(?:(?:/\*.*?\*/|//[^\n]*)\s*)*window\.MeleteLocalStationRoster\s*=\s*(\{.*\})\s*;?\s*', raw, re.S)
        if not match:
            raise ValueError(f'Expected a Melete JSON roster or station-roster.js: {path}')
        raw = match[1]
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get('singers', []), list) or not isinstance(data.get('assignments', {}), dict):
        raise ValueError(f'Invalid Melete directory: {path}')
    return data


def key(name):
    # Match the picker’s identity, independently of the Discord handle.
    n = unicodedata.normalize('NFKD', name).lower()
    return re.sub(r'[^\w]+', '-', n.replace('_','-'), flags=re.UNICODE).strip('-')


def merged(base, newer):
    out = dict(base)
    members = {}
    for person in [*base.get('singers', []), *newer.get('singers', [])]:
        if isinstance(person, str): person = {'name': person}
        if not isinstance(person, dict) or not isinstance(person.get('name'), str) or not key(person['name'].strip()):
            raise ValueError('Every singer needs a name.')
        p = {k:v.strip() for k,v in person.items() if k in ('name','voice','guide') and isinstance(v,str) and v.strip()}
        handle = str(person.get('discord') or person.get('discordUsername') or '').strip().lstrip('@')
        prev = members.setdefault(key(p['name']), {})
        if handle and prev.get('discord') and prev['discord'].casefold() != handle.casefold():
            raise ValueError('Conflicting handles for '+p['name']+'; review the two private files before importing.')
        if handle: p['discord'] = handle
        prev.update(p)
    out['singers'] = sorted(members.values(), key=lambda p:p['name'].casefold())
    # A directory may be an older fragment: do not erase unmentioned assignments.
    assignments = {s:{part:list(names) for part,names in parts.items()} for s,parts in base.get('assignments',{}).items()}
    for song,parts in newer.get('assignments',{}).items():
        group=assignments.setdefault(song,{})
        if not isinstance(parts,dict) or any(not isinstance(v,list) or any(not isinstance(n,str) for n in v) for v in parts.values()):
            raise ValueError('Invalid part assignments for '+song)
        incoming = {key(n) for names in parts.values() for n in names}
        group.update({part:[n for n in names if key(n) not in incoming] for part,names in group.items()})
        for part,names in parts.items():
            group[part] = list(dict.fromkeys([*group.get(part,[]),*names]))
    if assignments: out['assignments'] = assignments
    if 'sectionFrom' in newer: out['sectionFrom'] = {**out.get('sectionFrom',{}), **newer['sectionFrom']}
    return out   # Recording credits, timing corrections and local flags stay with the session.


def summary(data):
    names = {key(p['name']) for p in data.get('singers',[])}
    names.update(key(n) for parts in data.get('assignments',{}).values() for part in parts.values() for n in part)
    handles = sum(bool(p.get('discord')) for p in data.get('singers',[]))
    def label(n, noun): return f'{n} {noun}'+('' if n==1 else 's')
    return ', '.join([label(len(names),'singer'),label(handles,'Discord handle'),label(len(data.get('credits',{})),'credited take')])


def put(path, data):
    raw=json.dumps(data, ensure_ascii=False, indent=2)+'\n'
    if path.suffix.lower()=='.js': raw='window.MeleteLocalStationRoster = '+raw.rstrip()+';\n'
    with tempfile.NamedTemporaryFile(dir=path.parent,mode='w',encoding='utf-8',delete=False) as stream:
        stream.write(raw); tmp=Path(stream.name)
    try: os.replace(tmp,path)
    finally: tmp.unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True,help='Private station-roster.json from Drive')
    parser.add_argument('--import-roster',type=Path,help='Merge an older Mac or Windows roster into the private directory. Only names, handles and assignments are imported.')
    parser.add_argument('--player',type=Path,help='Install the roster for this built HTML player; existing recording credits are retained')
    parser.add_argument('--check',action='store_true',help='Report the merged counts without writing anything')
    args=parser.parse_args()
    if args.import_roster and args.directory.suffix.lower()!='.json':parser.error('The destination directory for imports must be JSON.')
    directory=merged({},read(args.directory))
    if args.import_roster: directory=merged(directory,read(args.import_roster))
    sidecar=None; view=directory
    if args.player:
        if not args.player.is_file():parser.error('Choose an existing player HTML file.')
        sidecar=args.player.resolve().with_name('station-roster.js')
        view=merged(read(sidecar) if sidecar.is_file() else {},directory)
    if not args.check:
        if args.import_roster: put(args.directory,directory)
        if sidecar: put(sidecar,view)
    print('Private roster: '+summary(view))
    if not any(p.get('discord') for p in view['singers']):print('No Discord handles loaded. Singers can still record by name.')


if __name__=='__main__':
    main()
