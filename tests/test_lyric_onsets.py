import importlib.util
from pathlib import Path
import unittest

try:
    import numpy as np
    import scipy
except ImportError:
    np=None
if np is not None:
    spec=importlib.util.spec_from_file_location('lyric_onsets',Path(__file__).resolve().parents[1]/'tools/local_station/lyric_onsets.py')
    on=importlib.util.module_from_spec(spec);spec.loader.exec_module(on)


@unittest.skipIf(np is None,'offline archival alignment requires numpy and scipy')
class LyricOnsets(unittest.TestCase):
    def test_same_pitch_and_anticipated_fricatives(self):
        sr=on.RATE;rng=np.random.default_rng(71)
        events=[(1+float(t),'fricative' if i%2 else 'stop',i,'feel' if i%2 else 'deep')
                for i,t in enumerate(np.cumsum(rng.uniform(.48,.94,30)))]
        for offset in [-.104,0,.164]:
            audio=rng.normal(0,9,int((events[-1][0]+1)*sr))
            for j,(t,kind,_,_) in enumerate(events):
                at=round((t+offset)*sr); tt=np.arange(round(.27*sr))/sr
                # No sung pitch changes at all. Only articulation can recover the offset.
                audio[at:at+len(tt)]+=np.minimum(1,tt/.009)*np.exp(-tt/.10)*(
                    2100*np.sin(2*np.pi*178*tt)+560*np.sin(2*np.pi*534*tt))
                n=round(sr*(.085 if kind=='fricative' else .008))
                noise=np.diff(rng.normal(0,670,n+1))
                audio[at-n:at]+=noise*np.hanning(n)
                if j%5==0:
                    b=round((t+.34)*sr);v=rng.normal(0,1250,round(.06*sr))
                    audio[b:b+len(v)]+=v*np.hanning(len(v))
            r=on.fit_wave(audio,sr,events,250)
            self.assertTrue(r['strong'],r['reason'])
            self.assertLessEqual(abs(r['peakMs']-offset*1000),18,(offset,r['peakMs']))

    def test_no_transient_no_offset(self):
        r=on.fit_wave(np.zeros(6*on.RATE),on.RATE,[(i,'stop',i,'do') for i in range(1,5)],250)
        self.assertFalse(r['usable'])

    def test_not_every_note_onset_is_a_syllable(self):
        seq={'division':100,'tempos':[[0,60]],'notes':[[0,i,i+50,60] for i in range(0,300,50)],
             'lyrics':[[0,0,0,'mm'],[0,50,0,'mm'],[0,100,0,'take'],[1,150,0,'fake'],[0,200,1,'other'],[0,250,0,'the']]}
        take={'rate':1,'pitchReference':{'part':0,'captureStart':0,'latency':.06,'notes':[[0,3,[60]]]}}
        self.assertEqual([(a[1],a[2]) for a in on.anchors(seq,take)],[('vowel-entry',0),('stop',100),('fricative',250)])
