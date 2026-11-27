"""Package two deterministic synthesized stereo references, never an actual performance."""
import base64
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from collection import render_collection, script_json
from offline_player import spans, write_hosted
from tools.prepare_performance import performance_clock


def create(source, out):
    html = source.read_text()
    nodes = spans(html)
    start,end = nodes['trainer-config']
    config = json.loads(html[start:end])
    i,j = nodes['playback-data']
    score = json.loads(html[i:j])
    timing = {k:score[k] for k in ('division','endTick','measures','tempos')}
    stops = [row[0] for row in score['tempos'][1:]] + [score['endTick']]
    duration = sum((stop-at)*60/bpm/score['division'] for (at,bpm),stop in zip(score['tempos'],stops))
    # 24 kHz MPEG-2 layer III, 32 kbps, no bit reservoir or ID3. Each 96-byte
    # frame is 24 ms. These are generated sine waves in the two stereo channels.
    tone = (ROOT/'tests/fixtures/stereo-reference-24k.mp3').read_bytes()
    def song(number):
        frame = tone[96*(4+number):96*(5+number)]
        audio = frame * round(duration*1.1/.024)
        seconds=round(len(audio)/96*.024,6)
        last=max(n[2] for n in score['notes'])
        def bar_time(t):
            f=t/last
            return round(seconds*(1.24*min(.5,f)+.76*max(0,f-.5)),6)
        report={'division':score['division'],'measures':[
            {'tick':t,'meter':f'{a}/{b}','start':bar_time(t)} for t,_,a,b,*_ in score['measures']],
            'time_map':{'ticks':[0,1],'seconds':[0,.7],'final_release':seconds}}
        _,points=performance_clock(score,report)
        cfg = {**config,'slug':'reference-test-'+str(number),
               'referenceAudio':{'mime':'audio/mpeg','timing':timing,'data':base64.b64encode(audio).decode(),
                  'seconds':points[-1][1],'audioSeconds':seconds,'performanceMap':{'id':hashlib.sha256(str(points).encode()).hexdigest(),'points':points}}}
        return {'title':'Reference '+str(number),'id':'ref-'+str(number),
                'html':html[:start]+script_json(cfg)+html[end:]}
    for rev, pair in [('a',[1,2]),('b',[1,2]),('c',[1,3])]:
        doc = render_collection([song(n) for n in pair],title='Reference tests')
        write_hosted(doc.replace('</head>',f'<meta name="qa-release" content="{rev}"></head>',1),out/rev)
    write_hosted(song(1)['html'],out/'single')


if __name__=='__main__':
    create(Path(sys.argv[1]),Path(sys.argv[2]))
