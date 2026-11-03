#!/usr/bin/env python3
"""Version-accumulation guards of publish_release.prepare().

Runs prepare() against a redirected SITE/ROOT so the real site/ and published
files are never touched. No deploy, no network.
    python3 publish_release.test.py
"""
import hashlib
import importlib.util
import json
import shutil
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

    def record(self, payload, version='0.1.0', build='1', reported=None):
        artifact = self.dir / f'final-{payload}-{version}-{build}.apk'
        artifact.write_bytes(payload.encode())
        aapt2 = self.dir / 'aapt2'
        # aapt2 is the stand-in for the real APK metadata: whatever it reports is what the
        # board displays, so a wrong/hardcoded record version must be rejected.
        reported_version, reported_build = reported or (version, build)
        aapt2.write_text(FAKE_AAPT2.format(build=reported_build, version=reported_version))
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

    def seed_published(self, payload=b'APK-A', rel='/downloads/v0.1.0/kimgosu-aos-0.1.0-b1-abcdef123456.apk'):
        """Seed an already-published entry whose legacy file name still carries a hash prefix."""
        path = publish.SITE / rel.lstrip('/')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        entry = {
            'platform': 'aos', 'kind': 'android-apk', 'kindLabel': 'Android 개발용 APK',
            'version': '0.1.0', 'build': '1', 'builtAt': '2026-01-02T00:00:00Z',
            'publishedAt': '2026-01-03T00:00:00Z', 'status': 'published', 'qaStatus': 'PASS',
            'file': rel, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(),
            'installationNotice': '설치 안내', 'notes': ['이전 게시'],
        }
        (publish.SITE / 'releases.json').write_text(json.dumps(
            {'schemaVersion': 1, 'project': '김고수', 'releases': [entry]}, ensure_ascii=False))
        return entry


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

    def test_new_entry_file_name_carries_no_hash(self):
        entry = publish.prepare(self.record('APK-A'))
        self.assertEqual(entry['file'], '/downloads/v0.1.0/kimgosu-aos-0.1.0-b1.apk')
        self.assertNotRegex(Path(entry['file']).name, r'[0-9a-f]{12}')
        self.assertEqual(entry['sha256'], hashlib.sha256(b'APK-A').hexdigest())
        self.assertTrue((publish.SITE / entry['file'].lstrip('/')).is_file())

    def test_republish_reuses_the_existing_published_url(self):
        legacy = self.seed_published()
        entry = publish.prepare(self.record('APK-A'))
        self.assertEqual(entry['file'], legacy['file'], '기존 게시 URL은 불변이어야 한다')
        self.assertEqual(len(self.releases()), 1)
        self.assertTrue((publish.SITE / legacy['file'].lstrip('/')).is_file())
        self.assertFalse((publish.SITE / 'downloads/v0.1.0/kimgosu-aos-0.1.0-b1.apk').exists(),
                         '재게시가 새 이름으로 파일을 하나 더 만들면 안 된다')

    def test_missing_published_file_is_restored_at_the_original_url(self):
        legacy = self.seed_published()
        (publish.SITE / legacy['file'].lstrip('/')).unlink()
        entry = publish.prepare(self.record('APK-A'))
        self.assertEqual(entry['file'], legacy['file'])
        self.assertTrue((publish.SITE / legacy['file'].lstrip('/')).is_file())
        self.assertEqual(len(self.releases()), 1)

    def test_apk_metadata_not_the_record_decides_the_displayed_version(self):
        path = self.record('APK-A', version='0.1.0', build='1', reported=('0.2.0', '2'))
        with self.assertRaises(ValueError):
            publish.prepare(path)
        self.assertEqual(self.releases(), [], 'APK와 다른 버전은 게시되면 안 된다')

    def test_version_is_read_from_the_apk_itself_without_aapt2(self):
        # 실제 게시된 APK를 그대로 사용해 aapt2 없이 AndroidManifest.xml에서 버전을 읽는다.
        apk = self.dir / 'real.apk'
        shutil.copyfile(HERE / 'site/downloads/v0.1.0/kimgosu-aos-0.1.0-b1-b0cb812cf1ff.apk', apk)
        path = self.record('APK-A')
        rec = json.loads(path.read_text())
        rec.update({'artifact': str(apk), 'artifactSHA256': sha(apk), 'version': '0.1.0', 'build': '1'})
        rec.pop('aapt2')
        path.write_text(json.dumps(rec, ensure_ascii=False))
        entry = publish.prepare(path)
        self.assertEqual((entry['version'], entry['build']), ('0.1.0', '1'))
        self.assertEqual(entry['sha256'], sha(apk))
        self.assertEqual(publish.apk_badging(None, apk), ('0.1.0', '1'))
        # 같은 실제 APK를 두 번 게시해도 항목이 늘지 않는다.
        again = publish.prepare(path)
        self.assertEqual(again['file'], entry['file'])
        self.assertEqual(len(self.releases()), 1)
        self.assertEqual(entry['file'], '/downloads/v0.1.0/kimgosu-aos-0.1.0-b1.apk')

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


class RepositoryBoardTest(unittest.TestCase):
    """The committed public board must keep its existing entry paths and bytes."""

    def test_existing_published_entries_and_files_are_intact(self):
        board = json.loads((HERE / 'site/releases.json').read_text())
        published = [x for x in board['releases'] if x.get('status') == 'published']
        self.assertTrue(published, '기존 게시 항목이 사라졌다')
        for entry in published:
            path = HERE / 'site' / entry['file'].lstrip('/')
            self.assertTrue(path.is_file(), entry['file'])
            self.assertEqual(sha(path), entry['sha256'], entry['file'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
