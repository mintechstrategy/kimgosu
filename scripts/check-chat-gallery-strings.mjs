#!/usr/bin/env node
// WS-88 문구 대조: design/chat-media-gallery/screens.md ↔ AOS/iOS 문구 상수.
// 1) 두 앱의 문구 상수가 모두 screens.md 의 인용 문자열과 바이트 단위로 같아야 한다.
// 2) D2 를 제외한 화면들의 상태 4종 문구가 두 앱에 모두 있어야 한다.
// 3) 두 앱의 문구 값 집합이 같아야 한다.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 이 워크트리에는 스펙 폴더가 없을 수 있다. 정본은 kimgosu 프로젝트의 design/chat-media-gallery 다.
const docCandidates = [
  resolve(root, 'design/chat-media-gallery/screens.md'),
  resolve(root, '../kimgosu/design/chat-media-gallery/screens.md'),
];
const docPath = process.argv[2] ?? docCandidates.find((path) => existsSync(path));
if (!docPath) {
  console.error('screens.md 를 찾지 못했습니다. 경로를 인자로 넘기십시오.');
  process.exit(1);
}
const doc = readFileSync(docPath, 'utf8');
const android = readFileSync(resolve(root, 'apps/android/app/src/main/java/ai/mintech/kimgosu/chat/ChatMediaGalleryScreen.kt'), 'utf8');
const ios = readFileSync(resolve(root, 'apps/ios/Kimgosu/ChatGalleryView.swift'), 'utf8');

const docStrings = new Set();
for (const line of doc.split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').map((cell) => cell.trim());
  for (const cell of cells) {
    const match = cell.match(/^"(.*)"$/);
    if (match) docStrings.add(match[1]);
  }
}

const androidCopy = [...android.matchAll(/const val (\w+) = "(.*)"/g)].map((m) => [m[1], m[2]]);
const iosCopy = [...ios.matchAll(/static let (\w+) = "(.*)"/g)].map((m) => [m[1], m[2]]);

const failures = [];
if (androidCopy.length === 0) failures.push('AOS 문구 상수를 찾지 못했습니다.');
if (iosCopy.length === 0) failures.push('iOS 문구 상수를 찾지 못했습니다.');
for (const [platform, key, value] of [...androidCopy.map((c) => ['AOS', ...c]), ...iosCopy.map((c) => ['iOS', ...c])]) {
  if (!docStrings.has(value)) failures.push(`${platform} ${key} 문구가 screens.md 와 다릅니다: ${value}`);
}

// 상태 4종: D2 진입 영역은 이 레인 범위가 아니므로 제외한다.
const stateStrings = [];
for (const line of doc.split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').map((cell) => cell.trim());
  if (cells.length < 5) continue;
  const [screen, state, text] = [cells[1], cells[2], cells[3]];
  if (!['로딩', '빈', '오류', '네트워크 실패'].includes(state)) continue;
  // D2 진입 영역과 VIDEO_READY 는 이 레인(사진 모아보기) 범위가 아니다.
  if (!screen.startsWith('CHAT_MEDIA_GALLERY') && !screen.startsWith('PHOTO_VIEWER')) continue;
  const match = text.match(/^"(.*)"$/);
  if (match) stateStrings.push([screen + ' ' + state, match[1]]);
}
for (const [label, text] of stateStrings) {
  if (!android.includes(`"${text}"`)) failures.push(`AOS 에 상태 문구 없음: ${label}`);
  if (!ios.includes(`"${text}"`)) failures.push(`iOS 에 상태 문구 없음: ${label}`);
}

const androidValues = new Set(androidCopy.map(([, value]) => value));
const iosValues = new Set(iosCopy.map(([, value]) => value));
for (const value of androidValues) if (!iosValues.has(value)) failures.push(`iOS 에 없는 AOS 문구: ${value}`);
for (const value of iosValues) if (!androidValues.has(value)) failures.push(`AOS 에 없는 iOS 문구: ${value}`);

console.log(`screens.md 문구 ${docStrings.size}개, AOS ${androidCopy.length}개, iOS ${iosCopy.length}개, 상태 문구 ${stateStrings.length}개`);
if (failures.length > 0) {
  for (const failure of failures) console.log('FAIL ' + failure);
  process.exit(1);
}
console.log('PASS 문구가 screens.md 와 완전 일치하고 두 앱이 동일합니다.');
