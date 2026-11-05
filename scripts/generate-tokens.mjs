#!/usr/bin/env node
// Generates the clients' design tokens from design/tokens.json.
// Output is a pure function of the JSON, so re-running leaves the tree identical.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const tokens = JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8'));

const hex = /^#[0-9a-fA-F]{6}$/;
for (const [name, token] of Object.entries(tokens.color)) {
<<<<<<< HEAD
  for (const value of [token.value, token.web].filter(Boolean)) {
    if (!hex.test(value)) {
      throw new Error(`color.${name}: expected #RRGGBB, got ${value}`);
=======
  for (const platform of ['value', 'web']) {
    const value = token[platform];
    if (value !== undefined && !hex.test(value)) {
      throw new Error(`color.${name}.${platform}: expected #RRGGBB, got ${value}`);
>>>>>>> ws/WS-89
    }
  }
}

const kebab = (name) => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const scale = (group) => Object.entries(group).filter(([name]) => !name.startsWith('_'));
// "2xl" is not an identifier on either platform.
const ident = (name) => (name === '2xl' ? 'xxl' : name);
const cap = (name) => name[0].toUpperCase() + name.slice(1);
const web = (token) => token.web ?? token.value;
const channels = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const header = (comment) => `${comment} Generated from design/tokens.json by scripts/generate-tokens.mjs — do not edit.` + '\n';

// Token group names become identifiers: space.2xl -> space_2xl (a leading digit is not a valid identifier).
const identifier = (group, name) => `${group}_${name}`;

const css = [
  '/* Generated from design/tokens.json by scripts/generate-tokens.mjs — do not edit. */',
  '',
  ':root {',
  ...Object.entries(tokens.color).map(([name, token]) => `  --${kebab(name)}: ${web(token)};`),
  `  --font-sans: ${tokens.typography.fontFamily.css};`,
  '}',
  '',
].join('\n');

const swift = [
  header('//'),
  'import SwiftUI',
  '',
  'enum DesignTokens {',
  ...Object.entries(tokens.color).map(([name, token]) => {
    const [r, g, b] = channels(token.value);
    return `    static let ${name} = Color(red: ${r} / 255, green: ${g} / 255, blue: ${b} / 255)`;
  }),
  '',
<<<<<<< HEAD
  ...scale(tokens.space).map(([name, token]) => `    static let space${cap(ident(name))}: CGFloat = ${token.value}`),
  '',
  ...scale(tokens.type).map(([name, token]) => `    static let type${cap(name)}Size: CGFloat = ${token.size}`),
  '',
  ...scale(tokens.radius).map(([name, token]) => `    static let radius${cap(name)}: CGFloat = ${token.value}`),
  '',
  `    static let touchIosMinPt: CGFloat = ${tokens.touch.iosMinPt}`,
=======
  ...Object.entries(tokens.space)
    .filter(([name]) => !name.startsWith('_'))
    .map(([name, token]) => `    static let ${identifier('space', name)}: CGFloat = ${token.value}`),
  '',
  ...Object.entries(tokens.type)
    .filter(([name]) => !name.startsWith('_'))
    .map(([name, token]) => `    static let ${identifier('type', name)}: CGFloat = ${token.size}`),
  '',
  ...Object.entries(tokens.radius).map(([name, token]) => `    static let ${identifier('radius', name)}: CGFloat = ${token.value}`),
  '',
  `    static let fontFamilyIos = "${tokens.typography.fontFamily.ios}"`,
  `    static let touchIosMinPt: CGFloat = ${tokens.touch.iosMinPt}`,
  `    static let touchAndroidMinDp: CGFloat = ${tokens.touch.androidMinDp}`,
>>>>>>> ws/WS-89
  '}',
  '',
].join('\n');

const kotlin = [
  header('//'),
  'package ai.mintech.kimgosu.ui',
  '',
  'import androidx.compose.ui.graphics.Color',
  'import androidx.compose.ui.unit.dp',
  'import androidx.compose.ui.unit.sp',
  '',
  'object DesignTokens {',
  ...Object.entries(tokens.color).map(([name, token]) => `    val ${name} = Color(0xFF${token.value.slice(1).toUpperCase()})`),
  '',
<<<<<<< HEAD
  ...scale(tokens.space).map(([name, token]) => `    val space${cap(ident(name))} = ${token.value}.dp`),
  '',
  ...scale(tokens.type).map(([name, token]) => `    val type${cap(name)}Size = ${token.size}.sp`),
  '',
  ...scale(tokens.radius).map(([name, token]) => `    val radius${cap(name)} = ${token.value}.dp`),
  '',
=======
  ...Object.entries(tokens.space)
    .filter(([name]) => !name.startsWith('_'))
    .map(([name, token]) => `    const val ${identifier('space', name)} = ${token.value}`),
  '',
  ...Object.entries(tokens.type)
    .filter(([name]) => !name.startsWith('_'))
    .map(([name, token]) => `    const val ${identifier('type', name)} = ${token.size}`),
  '',
  ...Object.entries(tokens.radius).map(([name, token]) => `    const val ${identifier('radius', name)} = ${token.value}`),
  '',
  `    const val touchIosMinPt = ${tokens.touch.iosMinPt}`,
>>>>>>> ws/WS-89
  `    const val touchAndroidMinDp = ${tokens.touch.androidMinDp}`,
  '}',
  '',
].join('\n');

const outputs = {
  'apps/web/src/tokens.css': css,
  'apps/ios/Kimgosu/DesignTokens.swift': swift,
  'apps/android/app/src/main/java/ai/mintech/kimgosu/ui/DesignTokens.kt': kotlin,
};

for (const [path, content] of Object.entries(outputs)) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`wrote ${path}`);
}
