package com.mintechstrategy.kimgosu;

/** Local-only identity for navigating the debug APK. Not an authenticated server session. */
final class TestAccount {
    final String userId;
    final String syntheticCi;
    final String label;
    final String mode;

    TestAccount(String userId, String syntheticCi, String label, String mode) {
        this.userId = userId;
        this.syntheticCi = syntheticCi;
        this.label = label;
        this.mode = mode;
    }
}
