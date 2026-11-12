"""Score-conditioned syllable onset evidence from original microphone PCM (offline).

Spectral novelty uses the frequency-neighborhood maximum from Boeck/Widmer's
SuperFlux approach (DAFx 2013); this is not a speech recognizer or forced aligner.
Times are seconds on the unshifted mic recording, after accounting for the
original recording's nominal latency, not a newly measured route latency.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import unicodedata

import numpy as np
from scipy import ndimage, signal

RATE, HOP = 16000, 64  # 4 ms between successive spectral observations
KINDS = {'stop':1., 'fricative':.85, 'sonorant':.5, 'vowel-entry':.35}


def seconds(seq, tick):
    cur=sec=0; bpm=seq['tempos'][0][1]
    for onset,tempo in seq['tempos']:
        if onset>tick: break
        sec+=(onset-cur)*60/(bpm*seq['division']); cur,bpm=onset,tempo
    return sec+(tick-cur)*60/(bpm*seq['division'])


def classify(lyric, after_rest):
    s=re.sub('[^a-z]', '',unicodedata.normalize('NFKD',lyric).lower())
    if not s:return None
    if s in ('n','nn','ng','mm','oo','oh','ah','uh'):
        return 'vowel-entry' if after_rest and s not in ('n','nn','ng') else None
    if s.startswith(('th','sh','ch','ph')) or s[0] in 'fszvj': return 'fricative'
    if s[0] in 'ptkbdgc':return 'stop'
    if s[0] in 'mnlrwyh':return 'sonorant'
    return 'vowel-entry' if after_rest else None


def anchors(seq,t):
    ref=t['pitchReference'];rate=t['rate'];part=ref['part']
    origin=seconds(seq,ref['captureStart'])/rate
    attacks={n[1] for n in seq['notes'] if n[0]==part}
    notes=ref['notes']; seen=set(); out=[]; ix=0
    for staff,tick,verse,word in seq['lyrics']:
        if staff!=part or verse!=0 or tick not in attacks or tick in seen:continue
        seen.add(tick); local=seconds(seq,tick)/rate-origin
        while ix<len(notes) and notes[ix][1]<=local+.00001:ix+=1
        if ix==len(notes) or notes[ix][0]>local+.001 or not notes[ix][2]:continue
        after_rest=abs(notes[ix][0]-local)<.001 and (ix==0 or local-notes[ix-1][1]>.15)
        kind=classify(word,after_rest)
        if kind:out.append((local+ref['latency'],kind,tick,word))
    return out


def features(pcm, sr):
    gcd=math.gcd(sr,RATE)
    x=signal.resample_poly(np.asarray(pcm,dtype=np.float32)/32768,RATE//gcd,sr//gcd)
    if len(x)<256:return {}
    # Scale compression to this singer, but do not turn digital silence into an attack.
    floor=max(1.e-5,float(np.quantile(np.abs(x[::8]),.9))*.003)
    bins,_,z=signal.stft(x,RATE,nperseg=256,noverlap=256-HOP,boundary='zeros',padded=True)
    a=np.abs(z); mag=np.log1p(a/floor)
    earlier=ndimage.maximum_filter1d(mag,3,axis=0)
    lag=3
    flow=np.maximum(0,mag-np.pad(earlier,((0,0),(lag,0)),mode='edge')[:,:mag.shape[1]])
    def band(spec,lo,hi):return np.mean(spec[(bins>=lo)&(bins<=hi)],axis=0)
    def gain(lo,hi):
        env=np.log1p(np.sqrt(band(a*a,lo,hi))/floor)
        return env-np.pad(env,(lag,0),mode='edge')[:len(env)]
    high=band(flow,2000,7800);middle=band(flow,550,2800)
    rise=np.maximum(0,gain(80,1800)); release=np.maximum(0,-gain(2600,7800))
    return dict(high=high,burst=.6*high+.4*middle,voice=rise+.35*middle,release=release)


def delayed_max(a,early,late):
    # Early and late describe where the sound can fall relative to the beat.
    padded=np.pad(a,(-early,late),mode='edge')
    return np.maximum.reduce([padded[i:i+len(a)] for i in range(late-early+1)])


def fit_wave(pcm,sr,events,limit,seed=217,_features=None):
    f=features(pcm,sr) if _features is None else _features;step=4
    grid=np.arange(-limit,limit+1,step)
    if grid[-1]!=limit:grid=np.append(grid,limit)
    if 0 not in grid:grid=np.sort(np.append(grid,0))
    rows=[]; labels=[]; weights=[]
    if f:
        # A noisy consonant can anticipate its vowel. Preserve the attack as
        # recorded; a preceding hiss alone is not a beat-time observation.
        stop=delayed_max(f['burst'],-5,1)
        fric=delayed_max(f['high'],-28,0)
        syllable=ndimage.gaussian_filter1d(f['voice'],1.2)
        curves={'stop':.48*stop+.30*syllable+.22*np.minimum(stop,syllable),
                'fricative':.42*syllable+.33*np.minimum(fric,syllable)+.25*np.minimum(fric,f['release']),
                'sonorant':syllable,'vowel-entry':syllable}
        for ix,(t,kind,tick,word) in enumerate(events):
            pos=(t+grid/1000)*RATE/HOP;y=curves[kind]
            # The same syllables vote at every shift; no edge or zero-padding advantage.
            if pos[0]<30 or pos[-1]>=len(y)-12:continue
            i=pos.astype(int);v=y[i]+(y[i+1]-y[i])*(pos-i)
            med=np.median(v);scale=max(float(np.quantile(v,.9)-med),.05)
            if np.max(v)-med<.08:continue
            v=np.clip((v-med)/scale,-.6,3)
            v=ndimage.gaussian_filter1d(v,2) # tolerate small real attack differences
            spacing=min(t-events[ix-1][0] if ix else 2.,events[ix+1][0]-t if ix+1<len(events) else 2.)
            rows.append(v);labels.append((tick,word,kind));weights.append(KINDS[kind]*np.clip(spacing/(.002*limit),.5,1.))
    base={'count':len(rows),'kinds':{k:sum(a[2]==k for a in labels) for k in KINDS}}
    if len(rows)<2:return {**base,'usable':False,'reason':'too few lyric attacks'}
    rows=np.asarray(rows);weights=np.asarray(weights)
    def aggregate(rows,w):return np.average(rows,axis=0,weights=w)
    def best(c):return int(grid[min(np.flatnonzero(c>=np.max(c)-1.e-8),key=lambda i:abs(grid[i]))])
    curve=aggregate(rows,weights);peak=best(curve)
    curves=[aggregate(rows[i::2],weights[i::2]) for i in (0,1)]
    folds=[best(c) for c in curves]
    heldout=[float(c[grid==folds[1-i]][0]-np.median(c)) for i,c in enumerate(curves)]
    h=len(rows)//2
    halves=[best(aggregate(rows[:h],weights[:h])),best(aggregate(rows[h:],weights[h:]))]
    # Randomly roll each anchor's local evidence. Compare best against best,
    # not a pointwise threshold that would reward searching hundreds of lags.
    rng=np.random.default_rng(seed);idx=np.arange(len(grid));null=[]
    for _ in range(127):
        roll=(idx[None,:]+rng.integers(0,len(grid),size=(len(rows),1)))%len(grid)
        null.append(aggregate(np.take_along_axis(rows,roll,axis=1),weights).max())
    p=(1+sum(n>=curve.max() for n in null))/128
    close=np.abs(grid-peak)<=28
    support=float(np.average(np.max(rows[:,close],axis=1)>np.quantile(rows,.8,axis=1),weights=weights))
    # Flat/noisy traces must not shift a held note simply because it had text.
    usable=len(rows)>=3 and p<=.10 and support>=.45
    strong=usable and len(rows)>=8 and p<=.025 and min(heldout)>.04 and max(abs(x-peak) for x in folds)<=55
    result={**base,'usable':bool(usable),'strong':bool(strong),'reason':'supported' if strong else 'weak' if usable else 'inconclusive',
            'peakMs':peak,'foldsMs':folds,'halvesMs':halves,'shuffleP':p,'support':round(support,3),
            'heldoutGain':[round(x,3) for x in heldout],'gridMs':grid.tolist(),'curve':np.round(curve,5).tolist(),
            'splitCurves':[np.round(v,5).tolist() for v in curves]}
    if _features is None and len(rows)>=4:
        # Diagnostic only: a repetitive line may have a better peak one syllable
        # away outside the permitted shift. Never fold that peak onto a neighbor.
        wider=fit_wave(None,sr,events,min(limit*2,500),seed,_features=f)
        if 'curve' in wider:
            z=np.array(wider['curve']);g=np.array(wider['gridMs']);keep=np.ones(len(g),bool);peaks=[]
            for _ in range(3):
                i=int(np.argmax(np.where(keep,z,-np.inf)))
                peaks.append([int(g[i]),round(float((z[i]-np.median(z))/max(.01,max(z)-np.median(z))),2)])
                keep &= np.abs(g-g[i])>110
            result['wider']={**wider,'peaks':peaks}
    return result


def run(config):
    scores={s['slug']:Path(s['playback']).read_bytes() for s in config['songs']}
    seqs={slug:json.loads(content) for slug,content in scores.items()}
    with Path(config['library']).open('rb') as stream:
        recording_hash=hashlib.file_digest(stream,'sha256').hexdigest()
        stream.seek(0)
        size=struct.unpack('<I',stream.read(4))[0];db=json.loads(stream.read(size))['stores'];start=stream.tell()
        chunks={}
        for _,c in db['chunks']:chunks.setdefault(c['takeId'],[]).append(c)
        result={}
        for uid,t in db['takes']:
            pcm=np.zeros(t['frames'],dtype='<i2')
            for c in chunks[uid]:
                v=c['pcm'];stream.seek(start+v['at'])
                pcm[c['offset']:c['offset']+v['bytes']//2]=np.frombuffer(stream.read(v['bytes']),dtype='<i2')
            seq=seqs[t['song']]; events=anchors(seq,t)
            ref=t['pitchReference'];left=ref['captureStart'];right=ref['end']
            tem=seq['tempos'];bpms=[v for j,(a,v) in enumerate(tem) if a<=right and (j==len(tem)-1 or tem[j+1][0]>left)]
            limit=math.floor(15000/(max(bpms or [tem[0][1]])*t['rate'])+1e-8)
            result[uid]=fit_wave(pcm,t['sampleRate'],events,limit)
    return {'version':1,'librarySha256':recording_hash,
            'scoreSha256':{slug:hashlib.sha256(content).hexdigest() for slug,content in scores.items()},'takes':result}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('config',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();a.output.write_text(json.dumps(run(json.loads(a.config.read_text())))+'\n')
