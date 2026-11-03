#!/usr/bin/env python3
"""Version-accumulation guards of publish_release.prepare().

Runs prepare() against a redirected SITE/ROOT so the real site/ and published
files are never touched. No deploy, no network.
    python3 publish_release.test.py
"""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

spec = importlib.util.spec_from_file_location('publish_release', HERE / 'publish_release.py')
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)

FAKE_AAPT2 = """#!/bin/sh
echo "package: name='ai.mintech.kimgosu' versionCode='{build}' versionName='{version}'"
"""


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class AccumulationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        site = self.dir / 'site'
        site.mkdir()
        (site / 'releases.json').write_text(json.dumps(
            {'schemaVersion': 1, 'project': '김고수', 'releases': []}, ensure_ascii=False))
        self._root, self._site = publish.ROOT, publish.SITE
        publish.ROOT, publish.SITE = ROOT, site
        self.qa = self.dir / 'qa.json'
        self.qa.write_text(json.dumps({'overallVerdict': 'PASS', 'candidate': 'cand-1'}))
        source_rel = 'apps/download-board/README.md'
        self.source = self.dir / 'source.json'
        self.source.write_text(json.dumps(
            {'candidate': 'cand-1', 'files': {source_rel: sha(ROOT / source_rel)}}))

    def tearDown(self):
        publish.ROOT, publish.SITE = self._root, self._site
        self.tmp.cleanup()

    def record(self, payload, version='0.1.0', build='1'):
        artifact = self.dir / f'final-{payload}-{version}-{build}.apk'
        artifact.write_bytes(payload.encode())
        aapt2 = self.dir / 'aapt2'
        aapt2.write_text(FAKE_AAPT2.format(build=build, version=version))
        aapt2.chmod(0o755)
        rec = {
            'stage': 'post-qa-final', 'qaAccepted': True, 'candidate': 'cand-1',
            'qaCompletedAt': '2026-01-01T00:00:00Z', 'builtAt': '2026-01-02T00:00:00Z',
            'artifact': str(artifact), 'artifactSHA256': sha(artifact),
            'platform': 'aos', 'kind': 'android-apk', 'version': version, 'build': build,
            'notes': ['테스트 변경사항'], 'aapt2': str(aapt2),
            'qaResult': {'path': str(self.qa), 'sha256': sha(self.qa)},
            'sourceManifest': {'path': str(self.source), 'sha256': sha(self.source)},
        }
        path = self.dir / 'record.json'
        path.write_text(json.dumps(rec, ensure_ascii=False))
        return path

    def releases(self):
        return json.loads((publish.SITE / 'releases.json').read_text())['releases']

    def test_first_publish_appends_one_entry(self):
        entry = publish.prepare(self.record('APK-A'))
        self.assertEqual(len(self.releases()), 1)
        self.assertEqual(entry['qaStatus'], 'PASS')
        self.assertEqual(entry['status'], 'published')

    def test_same_sha_republish_is_idempotent(self):
        first = publish.prepare(self.record('APK-A'))
        again = publish.prepare(self.record('APK-A'))
        self.assertEqual(first['file'], again['file'])
        self.assertEqual(len(self.releases()), 1)

    def test_same_version_build_with_other_bytes_is_rejected(self):
        publish.prepare(self.record('APK-A'))
        with self.assertRaises(ValueError):
            publish.prepare(self.record('APK-B'))
        self.assertEqual(len(self.releases()), 1, '실패한 게시가 게시판에 남으면 안 된다')

    def test_older_build_of_published_version_is_rejected(self):
        publish.prepare(self.record('APK-B', build='2'))
        with self.assertRaises(ValueError):
            publish.prepare(self.record('APK-A', build='1'))
        self.assertEqual([x['build'] for x in self.releases()], ['2'])

    def test_newer_build_accumulates_and_keeps_previous_file(self):
        publish.prepare(self.record('APK-A', build='1'))
        publish.prepare(self.record('APK-B', build='2'))
        releases = self.releases()
        self.assertEqual([x['build'] for x in releases], ['1', '2'])
        for entry in releases:
            self.assertTrue((publish.SITE / entry['file'].lstrip('/')).is_file(), entry['file'])

    def test_example_template_matches_required_fields(self):
        template = json.loads((HERE / 'examples/release-record.aos-apk.example.json').read_text())
        missing = [k for k in publish.REQUIRED_FIELDS if k not in template]
        self.assertEqual(missing, [], '템플릿에 필수 필드가 빠졌다')
        self.assertEqual(template['stage'], 'post-qa-final')
        self.assertIs(template['qaAccepted'], True)
        self.assertEqual(template['platform'], 'aos')
        self.assertEqual(template['kind'], 'android-apk')

    def test_example_template_is_not_publishable_as_is(self):
        # placeholder 경로/해시 그대로는 반드시 거부되어야 한다 (CLI도 이 두 예외를 실패로 처리한다)
        with self.assertRaises((ValueError, FileNotFoundError)):
            publish.prepare(HERE / 'examples/release-record.aos-apk.example.json')
        self.assertEqual(self.releases(), [])

    def test_missing_field_is_reported_by_name(self):
        path = self.record('APK-A')
        rec = json.loads(path.read_text())
        del rec['sourceManifest']
        path.write_text(json.dumps(rec))
        with self.assertRaises(ValueError) as ctx:
            publish.prepare(path)
        self.assertIn('sourceManifest', str(ctx.exception))

    def test_pre_qa_record_is_rejected(self):
        path = self.record('APK-A')
        rec = json.loads(path.read_text())
        rec['qaAccepted'] = False
        path.write_text(json.dumps(rec))
        with self.assertRaises(ValueError):
            publish.prepare(path)
        self.assertEqual(self.releases(), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
