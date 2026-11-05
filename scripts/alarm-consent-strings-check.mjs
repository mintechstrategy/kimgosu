#!/usr/bin/env node
// design/settings-alarm-consent/screens.md의 문구와 두 앱의 문자열 파일을 대조한다.
// 스펙(문서)이 정본이며, 이 스크립트는 앱 코드가 그 문구를 그대로 쓰는지만 확인한다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
// 스펙 정본은 design/settings-alarm-consent/screens.md다. 이 작업 트리에 없으면 원본 프로젝트에서 읽는다.
const candidates = [
  join(root, 'design/settings-alarm-consent/screens.md'),
  join(root, '..', 'kimgosu', 'design/settings-alarm-consent/screens.md'),
];
const screensPath = process.env.ALARM_CONSENT_SCREENS || candidates.find((path) => existsSync(path));
if (!screensPath) throw new Error('design/settings-alarm-consent/screens.md를 찾지 못했습니다.');
console.log(`spec: ${screensPath}`);
const screens = readFileSync(screensPath, 'utf8');
const android = readFileSync(join(root, 'apps/android/app/src/main/java/ai/mintech/kimgosu/settings/AlarmConsentStrings.kt'), 'utf8');
const ios = readFileSync(join(root, 'apps/ios/Kimgosu/AlarmConsentStrings.swift'), 'utf8');

// | KEY | "문구" | 용도 |
const rows = [...screens.matchAll(/^\|\s*([A-Z][A-Z0-9_]*)\s*\|\s*"([^"]*)"\s*\|/gm)].map((m) => ({ key: m[1], text: m[2] }));
if (rows.length === 0) throw new Error('screens.md에서 문구 행을 찾지 못했습니다.');

const failures = [];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const { key, text } of rows) {
  const placeholders = [...text.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  if (placeholders.length > 0) {
    // 값이 들어가는 문구는 함수로 옮긴다: "버전 {문서버전}" -> "버전 $version" / "버전 \(version)"
    const fn = { H_VERSION: 'hVersion', H_RECORDED: 'hRecorded', D_VERSION: 'dVersion', D_EFFECTIVE: 'dEffective' }[key];
    const [prefix, suffix] = text.split(/\{[^}]+\}/);
    const kotlinOk = fn && new RegExp(`fun ${fn}\\(`).test(android) && android.includes(`"${prefix}$`);
    const swiftOk = fn && new RegExp(`func ${fn}\\(`).test(ios) && ios.includes(`"${prefix}\\(`);
    if (!kotlinOk) failures.push(`${key}: Android에 ${fn ?? '함수'} 문구가 없습니다`);
    if (!swiftOk) failures.push(`${key}: iOS에 ${fn ?? '함수'} 문구가 없습니다`);
    if (suffix && !android.includes(suffix) && !ios.includes(suffix)) failures.push(`${key}: 문구 뒷부분이 없습니다`);
    continue;
  }
  const kotlinPattern = new RegExp(`const val ${key} = "${escape(text)}"`);
  const swiftPattern = new RegExp(`static let ${key} = "${escape(text)}"`);
  if (!kotlinPattern.test(android)) failures.push(`${key}: Android 문구 불일치 — ${text}`);
  if (!swiftPattern.test(ios)) failures.push(`${key}: iOS 문구 불일치 — ${text}`);
}

const androidKeys = [...android.matchAll(/const val ([A-Z][A-Z0-9_]*) =/g)].map((m) => m[1]);
const iosKeys = [...ios.matchAll(/static let ([A-Z][A-Z0-9_]*) =/g)].map((m) => m[1]);
const specKeys = new Set(rows.map((r) => r.key));
for (const key of androidKeys) if (!specKeys.has(key)) failures.push(`${key}: screens.md에 없는 Android 키`);
for (const key of iosKeys) if (!specKeys.has(key)) failures.push(`${key}: screens.md에 없는 iOS 키`);
for (const key of specKeys) if (!androidKeys.includes(key) && !rows.find((r) => r.key === key).text.includes('{')) failures.push(`${key}: Android에 키 없음`);
for (const key of specKeys) if (!iosKeys.includes(key) && !rows.find((r) => r.key === key).text.includes('{')) failures.push(`${key}: iOS에 키 없음`);

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length}건`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`PASS — screens.md 문구 ${rows.length}개가 Android AlarmConsentStrings.kt와 iOS AlarmConsentStrings.swift에 그대로 있습니다.`);
