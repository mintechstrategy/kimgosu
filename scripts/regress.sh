#!/usr/bin/env bash
# Local regression gate, one command: backend verify -> Android dev build -> iOS build.
# Stops at the first failing stage and exits with that stage's exit code.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAINS="$ROOT/.local-toolchains"

# This machine keeps the JDK, Android SDK and Gradle cache outside PATH; CI
# supplies its own, so only fill in what the caller has not set.
export JAVA_HOME="${JAVA_HOME:-$TOOLCHAINS/jdk17/jdk-17.0.21+9/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$TOOLCHAINS/android-sdk}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$TOOLCHAINS/gradle-user-home}"

START=$SECONDS

stage() {
  local name="$1"; shift
  local start=$SECONDS code=0
  echo
  echo "==> $name"
  "$@" || code=$?
  local took=$((SECONDS - start))
  if [ "$code" -ne 0 ]; then
    echo "==> $name: FAILED (exit $code, ${took}s)" >&2
    echo "==> regression stopped at: $name (total $((SECONDS - START))s)" >&2
    exit "$code"
  fi
  echo "==> $name: OK (${took}s)"
}

verify_backend() { cd "$ROOT" && npm run verify; }
build_android() { cd "$ROOT/apps/android" && ./gradlew :app:assembleDevDebug --no-daemon; }
build_ios() {
  cd "$ROOT/apps/ios" && xcodebuild -project Kimgosu.xcodeproj -scheme Kimgosu \
    -configuration Debug -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
}

stage "backend verify" verify_backend
stage "android assembleDevDebug" build_android
stage "ios build" build_ios

echo
echo "==> regression OK (total $((SECONDS - START))s)"
