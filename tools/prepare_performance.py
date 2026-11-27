"""Encode a performance excerpt at its original speed and validate its score clock."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_trainer import atomic_write


def primary_anchors(score, alignment, beat_groups=None):
    measures = score['measures']
    report = alignment['measures']
    if (not measures or score['division'] != alignment['division'] or len(report) != len(measures)
            or any(m[0] != r['tick'] or f'{m[2]}/{m[3]}' != r['meter'] for m, r in zip(measures, report))):
        raise ValueError('Alignment does not match this score and meter map')
    ticks = [m[0] for m in measures] + [score['endTick']]
    if ticks[0] != 0 or any(b-a != m[1] or b <= a for a,b,m in zip(ticks,ticks[1:],measures)):
        raise ValueError('Invalid score barlines')
    release_tick = max((n[2] for n in score['notes']), default=0)
    if not 0 < release_tick <= ticks[-1]:
        raise ValueError('Missing final sounding note in score')
    release = alignment['time_map']['final_release']
    last = next(i for i in range(len(report)) if ticks[i+1] >= release_tick)
    source = alignment['time_map']
    measured = dict(zip(source.get('ticks',[]), source.get('seconds',[]), strict=True))
    points = []
    for i,r in enumerate(report[:last+1]):
        at = r['tick']
        stop = ticks[i+1] if i < last else release_tick
        start, end = r['start'], report[i+1]['start'] if i < last else release
        points.append([at,start])
        groups = (beat_groups or {}).get(r['meter'], [])
        if groups and (sum(groups) != measures[i][2] or any(type(g) is not int or g < 1 for g in groups)):
            raise ValueError('Invalid beat groups for '+r['meter'])
        inside = []
        t = at
        for count in groups[:-1]:
            t += count*score['division']*4//measures[i][3]
            if t < stop:
                linear = start + (end-start)*(t-at)/(stop-at)
                inside.append((t,measured.get(t,linear),linear))
        values = [start]+[p[1] for p in inside]+[end]
        ordered = all(math.isfinite(y) and y>x for x,y in zip(values,values[1:]))
        points.extend([t,v if ordered else linear] for t,v,linear in inside)
    points.append([release_tick,release])
    if (points[0][1]<0 or any(not math.isfinite(y) for _,y in points)
            or any(b[1]<=a[1] for a,b in zip(points,points[1:]))):
        raise ValueError('Performance clock must be strictly increasing')
    return points


def editor_id(score, alignment, base):
    body = [alignment['audio_sha256'],score['division'],score['measures'],score['notes'],base]
    return hashlib.sha256(json.dumps(body,separators=(',',':')).encode()).hexdigest()


def reviewed_anchors(score, alignment, base, review):
    if review is None:
        return base
    if review.get('schema') != 1 or review.get('baseId') != editor_id(score,alignment,base):
        raise ValueError('Reviewed anchors belong to a different score, recording or downbeat grid')
    points = review.get('anchors')
    required = {t for t,_ in base}
    allowed = required | {n[1] for n in score['notes'] if 0 <= n[1] < base[-1][0]}
    if (not isinstance(points,list) or not 2 <= len(points) <= len(allowed)
            or any(not isinstance(p,list) or len(p)!=2 or type(p[0]) is not int or p[0] not in allowed
                   or type(p[1]) not in (float,int) or not math.isfinite(p[1]) or p[1]<0 for p in points)
            or not required.issubset(t for t,_ in points)
            or any(b[0]<=a[0] or b[1]<=a[1] for a,b in zip(points,points[1:]))):
        raise ValueError('Invalid reviewed anchors')
    return points


def score_clock(score, points):
    # A release is not the end of a printed rest. Extend the last pulse through
    # silent bars without moving the release, or putting a tempo kink on it.
    (prev,s0),(last,s1) = points[-2:]
    after = [m[0] for m in score['measures'] if m[0]>=last]+[score['endTick']]
    raw = points[:-1]+[[t,s1+(t-last)*(s1-s0)/(last-prev)] for t in after]
    offset = raw[0][1]
    pairs = [[t,round(s-offset,6)] for t,s in raw]
    if any(b[1]<=a[1] for a,b in zip(pairs,pairs[1:])):
        raise ValueError('Reference clock anchors are too close')
    return offset,pairs


def performance_clock(score, alignment, beat_groups=None, review=None):
    base = primary_anchors(score,alignment,beat_groups)
    return score_clock(score,reviewed_anchors(score,alignment,base,review))


def prepare(playback, alignment, audio, output, *, beat_groups=None, review=None):
    score = json.loads(playback.read_text())
    report = json.loads(alignment.read_text())
    with audio.open('rb') as stream:
        source_hash = hashlib.file_digest(stream,'sha256').hexdigest()
    if source_hash != report['audio_sha256']:
        raise ValueError('Alignment belongs to a different recording')
    base = primary_anchors(score,report,beat_groups)
    anchors = reviewed_anchors(score,report,base,review)
    offset,points = score_clock(score,anchors)
    seconds = points[-1][1]
    audio_seconds = round(anchors[-1][1]-offset, 6)
    output.parent.mkdir(parents=True,exist_ok=True)
    sidecar = output.with_suffix('.json')
    existing = json.loads(sidecar.read_text()) if sidecar.is_file() else {}
    same_clip = (existing.get('sourceSha256')==source_hash and existing.get('sourceOffset')==offset
                 and existing.get('audioSeconds',existing.get('seconds'))==audio_seconds and output.is_file())
    audio_hash = hashlib.sha256(output.read_bytes()).hexdigest() if same_clip else None
    if not audio_hash or audio_hash != existing.get('audioSha256'):
        with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
            clip = Path(tmp)/'performance.mp3'
            subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(audio),'-ss',str(offset),
                            '-t',str(audio_seconds),'-map','0:a:0','-map_metadata','-1','-ac','2',
                            '-c:a','libmp3lame','-b:a','112k',str(clip)],check=True,timeout=180)
            actual = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration',
                            '-of','csv=p=0',str(clip)],text=True,timeout=10))
            if abs(actual-audio_seconds) > .09:
                raise ValueError('Source audio does not cover the requested performance')
            data = clip.read_bytes()
            atomic_write(output,data)
            audio_hash = hashlib.sha256(data).hexdigest()
    clock_id=hashlib.sha256((source_hash+json.dumps(points,separators=(',',':'))).encode()).hexdigest()
    metadata={'timing':{k:score[k] for k in ('division','endTick','measures','tempos')},
              'sourceSha256':source_hash,'sourceOffset':offset,'seconds':seconds,
              'audioSha256':audio_hash,
              'performanceMap':{'id':clock_id,'points':points},
              'method':'Original performance speed; trim only, no time stretch or pitch shift'}
    if audio_seconds != seconds:
        metadata['audioSeconds'] = audio_seconds
    atomic_write(sidecar,json.dumps(metadata,indent=2)+'\n')
    return metadata


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('playback','alignment','audio','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--beat-groups',type=Path)
    parser.add_argument('--review',type=Path)
    args=parser.parse_args()
    result=prepare(args.playback,args.alignment,args.audio,args.output,
                   beat_groups=json.loads(args.beat_groups.read_text()) if args.beat_groups else None,
                   review=json.loads(args.review.read_text()) if args.review else None)
    print(f"{args.output.name}: {result['seconds']:.3f}s; {len(result['performanceMap']['points'])} anchors")
