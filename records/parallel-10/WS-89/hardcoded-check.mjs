#!/usr/bin/env node
// WS-89 하드코딩 검사: 새 화면 파일에 색·크기·간격 원시 값이 있는지 찾는다.
// 허용: 0 (치수가 아님), 토큰 참조(DesignTokens.*), 문자열 안의 날짜 형식/문구.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../../..');
const targets = [
  { path: 'apps/android/app/src/main/java/ai/mintech/kimgosu/admin/AdminNoticeScreens.kt', lang: 'kotlin' },
  { path: 'apps/ios/Kimgosu/AdminNoticeViews.swift', lang: 'swift' },
];

const rules = {
  kotlin: [
    { name: 'hex color', pattern: /Color\(0x[0-9A-Fa-f]{6,8}\)/ },
    { name: 'named color', pattern: /Color\.(White|Black|Gray|Red|Blue|Green|Yellow|Transparent)\b/ },
    { name: 'dp literal', pattern: /(?:^|[^\w.])(\d+(?:\.\d+)?)\.dp\b/ },
    { name: 'sp literal', pattern: /(?:^|[^\w.])(\d+(?:\.\d+)?)\.sp\b/ },
    { name: 'fontSize literal', pattern: /fontSize\s*=\s*(\d+(?:\.\d+)?)\b/ },
  ],
  swift: [
    { name: 'hex color', pattern: /Color\(red:\s*\d/ },
    { name: 'named color', pattern: /Color\.(white|black|gray|red|blue|green|yellow|clear)\b/ },
    { name: 'padding literal', pattern: /\.padding\(\s*(\d+(?:\.\d+)?)\s*[,)]/ },
    { name: 'spacing literal', pattern: /spacing:\s*(\d+(?:\.\d+)?)\b/ },
    { name: 'frame literal', pattern: /(?:minHeight|minWidth|width|height|maxHeight|maxWidth):\s*(\d+(?:\.\d+)?)\b/ },
    { name: 'cornerRadius literal', pattern: /cornerRadius:\s*(\d+(?:\.\d+)?)\b/ },
    { name: 'lineWidth literal', pattern: /lineWidth:\s*(\d+(?:\.\d+)?)\b/ },
    { name: 'font size literal', pattern: /size:\s*(\d+(?:\.\d+)?)\b/ },
  ],
};

let hits = 0;
for (const target of targets) {
  const lines = readFileSync(join(root, target.path), 'utf8').split('\n');
  const found = [];
  lines.forEach((line, index) => {
    for (const rule of rules[target.lang]) {
      const match = line.match(rule.pattern);
      if (!match) continue;
      // 0 은 치수가 아니다(여백 없음).
      const number = match[1];
      if (number !== undefined && Number(number) === 0) continue;
      found.push({ line: index + 1, rule: rule.name, text: line.trim() });
    }
  });
  hits += found.length;
  console.log(`${target.path}: ${found.length} hits`);
  for (const item of found) console.log(`  ${item.line}: [${item.rule}] ${item.text}`);
}
console.log(`\ntotal=${hits}`);
process.exit(hits === 0 ? 0 : 1);
