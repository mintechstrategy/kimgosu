#!/usr/bin/env node
// WS-89 문구 대조: design/admin-notice-board/screens.md 의 모든 키·문자열을
// AOS(AdminNoticeScreens.kt)와 iOS(AdminNoticeViews.swift) 소스에서 그대로 찾는다.
//
// 키 이름은 화면 코드에서 lowerCamel 이다(LIST_TITLE -> listTitle).
// {title} 같은 변수 자리는 양 플랫폼의 문자열 보간(${..} / \(..))을 허용한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../../..');
// 스펙 정본은 이 worktree 밖(프로젝트 design/)에 있다. 승인된 원문을 그대로 읽는다.
const md = readFileSync(
  process.env.NOTICE_SCREENS_MD ?? join(root, '../kimgosu/design/admin-notice-board/screens.md'),
  'utf8',
);

const kotlin = readFileSync(join(root, 'apps/android/app/src/main/java/ai/mintech/kimgosu/admin/AdminNoticeScreens.kt'), 'utf8');
const swift = readFileSync(join(root, 'apps/ios/Kimgosu/AdminNoticeViews.swift'), 'utf8');

const camel = (key) =>
  key
    .split('_')
    .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0) + word.slice(1).toLowerCase()))
    .join('');

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// screens.md 의 문자열 -> 정규식. {x} 는 보간으로 바뀐다.
const pattern = (text) =>
  text
    .split(/\{[a-z]+\}/)
    .map((part) => escape(part))
    .join('(?:\\$\\{[a-zA-Z]+\\}|\\$[a-zA-Z]+|\\\\\\([a-zA-Z]+\\)|\\\\\\(.*?\\))');

const literalOf = (source, name, kind) => {
  const declaration =
    kind === 'kotlin'
      ? new RegExp(`(?:const val|fun) ${name}\\b[^\\n]*?(?:")([^"\\n]*)`)
      : new RegExp(`static (?:let|func) ${name}\\b[^\\n]*?(?:")([^"\\n]*)`);
  const match = source.match(declaration);
  return match ? match[1] : null;
};

const rows = [...md.matchAll(/^\|\s*([A-Z][A-Z0-9_]*)\s*\|\s*"([^"]*)"\s*\|\s*$/gm)].map((m) => ({ key: m[1], text: m[2] }));

// 이 세 화면이 그리지 않는 키. 근거를 함께 남긴다.
const notRendered = {
  NAV_NOTICE: '관리자 셸 사이드바 메뉴 라벨 — 셸은 이 화면 묶음 범위 밖',
  BACK: '공통 뒤로가기 라벨 — 이 화면들은 LIST_BACK을 쓴다',
  CONFIRM: '범용 확인 라벨 — DISCARD 대화상자는 KEEP_EDITING/DISCARD를 쓴다',
};

let failed = 0;
const report = [];
for (const row of rows) {
  const name = camel(row.key);
  const expected = new RegExp(pattern(row.text));
  const line = { key: row.key, kotlin: 'MISSING', swift: 'MISSING' };
  if (notRendered[row.key]) {
    line.kotlin = 'EXCLUDED';
    line.swift = 'EXCLUDED';
    line.reason = notRendered[row.key];
  } else {
    for (const [platform, source] of [['kotlin', kotlin], ['swift', swift]]) {
      const names = platform === 'kotlin' ? [row.key, name] : [name];
      let literal = null;
      for (const candidate of names) {
        literal = literalOf(source, candidate, platform);
        if (literal !== null) break;
      }
      if (literal === null) continue;
      line[platform] = expected.test(literal) ? 'PASS' : `MISMATCH(${literal})`;
    }
  }
  const ok = (v) => v === 'PASS' || v === 'EXCLUDED';
  if (!ok(line.kotlin) || !ok(line.swift)) failed += 1;
  report.push(line);
}

for (const line of report) {
  console.log(
    `${line.key.padEnd(20)} AOS=${line.kotlin.padEnd(28)} iOS=${line.swift}${line.reason ? '  // ' + line.reason : ''}`,
  );
}
console.log(`\nkeys=${rows.length} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
