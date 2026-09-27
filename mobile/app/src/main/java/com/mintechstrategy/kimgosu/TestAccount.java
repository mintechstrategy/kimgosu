package com.mintechstrategy.kimgosu;

/** Synthetic CI choice used only in the debug APK. The server allocates userId. */
final class TestAccount {
    final String syntheticCi;
    final String label;
    final String mode;

    TestAccount(String syntheticCi, String label, String mode) {
        this.syntheticCi = syntheticCi;
        this.label = label;
        this.mode = mode;
    }
}
