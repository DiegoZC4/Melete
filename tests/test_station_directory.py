import importlib.util
from pathlib import Path
import tempfile
import unittest

module_path=Path(__file__).resolve().parents[1]/'tools'/'local_station'/'directory.py'
spec=importlib.util.spec_from_file_location('station_directory',module_path)
directory=importlib.util.module_from_spec(spec)
spec.loader.exec_module(directory)


class StationDirectory(unittest.TestCase):
    def test_partial_transfer_keeps_all_credits_and_richer_handles(self):
        prior={'singers':[{'name':'Demo','discord':'demo.one'},{'name':'Second'}], 'credits':{'t1':'Second'}, 'playbackAdvanceMs':{'t1':120}, 'assignments':{'piece':{'T1':['Demo','Second']}}}
        refreshed=directory.merged(prior,{'singers':[{'name':'Demo'},{'name':'Third'}],'credits':{'t1':'Third'},'assignments':{'piece':{'T2':['Demo']}}})
        self.assertEqual(directory.summary(refreshed),'3 singers, 1 Discord handle, 1 credited take')
        self.assertEqual(refreshed['credits'],{'t1':'Second'})
        self.assertEqual(refreshed['playbackAdvanceMs'],{'t1':120})
        self.assertEqual(refreshed['assignments']['piece'],{'T1':['Second'],'T2':['Demo']})
        with self.assertRaisesRegex(ValueError,'Conflicting handles'):
            directory.merged(refreshed,{'singers':[{'name':'Demo','discord':'someone.else'}]})

    def test_read_a_previous_station_sidecar_without_executing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'station-roster.js'
            path.write_text('/* Locally installed */\nwindow.MeleteLocalStationRoster = {"singers":[{"name":"Example","discordUsername":"@demo"}]};',encoding='utf-8')
            row=directory.merged({},directory.read(path))['singers'][0]
            self.assertEqual(row,{'name':'Example','discord':'demo'})
            path.write_text('alert(1); window.MeleteLocalStationRoster = {};',encoding='utf-8')
            with self.assertRaises(ValueError): directory.read(path)
