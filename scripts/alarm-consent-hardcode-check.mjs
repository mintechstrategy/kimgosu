#!/usr/bin/env node
// 알림 설정·동의 화면 코드에 색·크기 수치를 직접 쓰지 않았는지 검사한다.
// 값은 ConsentTokens(양 앱)에만 있고, 화면은 이름만 쓴다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const files = [
  'apps/android/app/src/main/java/ai/mintech/kimgosu/settings/AlarmConsentScreen.kt',
  'apps/android/app/src/main/java/ai/mintech/kimgosu/settings/AlarmConsentModel.kt',
  'apps/android/app/src/main/java/ai/mintech/kimgosu/settings/AlarmConsentStrings.kt',
  'apps/ios/Kimgosu/AlarmConsentView.swift',
  'apps/ios/Kimgosu/AlarmConsentStrings.swift',
];

// 화면 파일에서 금지하는 형태들. 토큰 파일(ConsentTokens.kt / AlarmConsentTokens.swift)은 값의 정본이므로 제외한다.
const rules = [
  { name: '직접 색상', pattern: /Color\s*\(\s*(0x|red:|\s*\.)/ },
  { name: '직접 dp', pattern: /\b\d+(?:\.\d+)?\.dp\b/ },
  { name: '직접 sp', pattern: /\b\d+(?:\.\d+)?\.sp\b/ },
  { name: '직접 글자 크기', pattern: /\bsize:\s*\d/ },
  { name: '직접 여백', pattern: /\.padding\(\s*(horizontal:|vertical:|top:|bottom:|leading:|trailing:)?\s*\d/ },
  { name: '직접 간격', pattern: /\bspacing:\s*\d/ },
  { name: '직접 프레임', pattern: /\.frame\([^)]*\b\d+(\.\d+)?\b/ },
  { name: '직접 선 두께', pattern: /strokeWidth\s*=\s*\d/ },
  { name: '직접 투명도', pattern: /\.opacity\(\s*\d/ },
  { name: '시스템 폰트 크기', pattern: /\.system\(size:\s*\d/ },
];

const found = [];
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  text.split('\n').forEach((line, index) => {
    for (const rule of rules) {
      if (rule.pattern.test(line)) found.push(`${file}:${index + 1} ${rule.name} → ${line.trim()}`);
    }
  });
}

const tokens = [
  'apps/android/app/src/main/java/ai/mintech/kimgosu/settings/ConsentTokens.kt',
  'apps/ios/Kimgosu/AlarmConsentTokens.swift',
].map((file) => `${file} ${readFileSync(join(root, file), 'utf8').split('\n').length}줄`);

if (found.length > 0) {
  console.error(`FAIL — 하드코딩 ${found.length}건`);
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`PASS — 화면·문자열 파일 ${files.length}개에 직접 색·크기 수치 0건. 값은 토큰 파일에만 있음:`);
for (const line of tokens) console.log(`  ${line}`);
