#!/usr/bin/env python3
"""충돌 해결: 추가형 목록(package.json 체인, app.ts import/등록)은 양쪽 합집합.

- <<<<<<< HEAD / ======= / >>>>>>> 브랜치 블록을 읽어, 양쪽 줄을 순서 보존 합집합으로 치환한다.
- 중복 줄(공백 정규화 후 동일)은 한 번만 남긴다.
사용: resolve_conflicts.py <file> [...]
"""
import sys, re

BLOCK = re.compile(r'<<<<<<< HEAD\n(.*?)\n?=======\n(.*?)\n?>>>>>>> [^\n]+\n', re.S)

def union(a, b):
    out, seen = [], set()
    for line in a.split('\n') + b.split('\n'):
        key = line.strip()
        if not key:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
    return '\n'.join(out) + '\n'

def main():
    for path in sys.argv[1:]:
        try:
            s = open(path).read()
        except FileNotFoundError:
            continue
        if '<<<<<<< HEAD' not in s:
            continue
        s2 = BLOCK.sub(lambda m: union(m.group(1), m.group(2)), s)
        open(path, 'w').write(s2)
        print(f'resolved {path} (remaining markers: {s2.count("<<<<<<<")})')

if __name__ == '__main__':
    main()
