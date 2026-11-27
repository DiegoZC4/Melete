import copy
import unittest

from build_trainer import BuildError, validate_reference
from tools.prepare_performance import editor_id, performance_clock, primary_anchors


class PerformanceClockTests(unittest.TestCase):
    def setUp(self):
        self.score = dict(division=480, endTick=4800, tempos=[[0,112]],
                          measures=[[0,3360,7,4],[3360,1440,3,4]],
                          notes=[[0,0,480,60,80],[0,480,1440,62,80],[0,1440,4320,63,80]])
        self.report = dict(division=480, audio_sha256='a'*64, measures=[
            dict(tick=0,meter='7/4',start=1),dict(tick=3360,meter='3/4',start=8)],
            time_map=dict(ticks=[0,480,1440],seconds=[1.01,1.26,4.25],final_release=10))
        self.groups = {'7/4':[3,4]}

    def test_downbeats_ignore_detected_syllables_and_extend_final_rest(self):
        self.assertEqual(performance_clock(self.score,self.report),(1,[[0,0],[3360,7],[4800,10]]))
        _,points = performance_clock(self.score,self.report,self.groups)
        self.assertEqual(points,[[0,0],[1440,3.25],[3360,7],[4800,10]])
        ref = dict(timing={k:self.score[k] for k in ('division','endTick','tempos','measures')},
                   seconds=10,audioSeconds=9,performanceMap={'id':'b'*64,'points':points})
        validate_reference(ref,self.score)
        for wrong in [8,0,11,float('nan')]:
            with self.assertRaises(BuildError):
                validate_reference({**ref,'audioSeconds':wrong},self.score)
        with self.assertRaises(BuildError):
            validate_reference({**ref,'sourceSha256':'a'*64},self.score)

    def test_manual_onsets_are_opt_in_and_bound_to_the_correct_recording(self):
        base = primary_anchors(self.score,self.report,self.groups)
        review = dict(schema=1,baseId=editor_id(self.score,self.report,base),
                      anchors=[base[0],[480,1.6],*base[1:]])
        _,points = performance_clock(self.score,self.report,self.groups,review)
        self.assertEqual(points[1],[480,.6])
        for bad in [{**review,'baseId':'stale'}, {**review,'anchors':base[1:]},
                    {**review,'anchors':[base[0],[479,2],*base[1:]]},
                    {**review,'anchors':[base[0],[480,9],*base[1:]]}]:
            with self.assertRaises(ValueError):
                performance_clock(self.score,self.report,self.groups,bad)

    def test_missing_group_attacks_use_written_subdivision_not_another_note(self):
        self.report['time_map']['ticks'] = [480]
        self.report['time_map']['seconds'] = [6.]
        self.assertEqual(primary_anchors(self.score,self.report,self.groups)[1],[1440,4.])

    def test_invalid_barlines_and_release(self):
        for change in [lambda r:r.update(division=96),lambda r:r['measures'][0].update(meter='3/4'),
                       lambda r:r['measures'][1].update(start=.4),
                       lambda r:r['time_map'].update(final_release=7)]:
            r=copy.deepcopy(self.report)
            change(r)
            with self.assertRaises(ValueError):
                performance_clock(self.score,r)
