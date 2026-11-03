#!/usr/bin/env python3
"""Build/test with caller-provided SDK/JDK, or this workspace's isolated toolchains."""
from pathlib import Path
import os
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
env = os.environ.copy()
if not env.get('JAVA_HOME'):
    homes = list((ROOT / '.local-toolchains/jdk17').glob('*/Contents/Home'))
    if len(homes) != 1:
        raise SystemExit('Set JAVA_HOME to JDK 17 before building.')
    env['JAVA_HOME'] = str(homes[0])
if not env.get('ANDROID_HOME'):
    sdk = ROOT / '.local-toolchains/android-sdk'
    if not sdk.is_dir():
        raise SystemExit('Set ANDROID_HOME to an installed Android SDK (compile SDK 35).')
    env['ANDROID_HOME'] = str(sdk)
env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['ANDROID_HOME'] + '/platform-tools:' + env.get('PATH', '')
local = ROOT / '.local-toolchains/gradle-8.11.1/bin/gradle'
command = str(local) if local.is_file() else str(HERE / 'gradlew')
subprocess.run([command, '--no-daemon', '--max-workers=2', *(sys.argv[1:] or [':app:assembleDebug'])], cwd=HERE, env=env, check=True)
