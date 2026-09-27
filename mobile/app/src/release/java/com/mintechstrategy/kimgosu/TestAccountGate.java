package com.mintechstrategy.kimgosu;

import android.app.Activity;
import android.view.View;
import java.util.function.Consumer;

/** Release build contains no synthetic CI or test accounts. */
final class TestAccountGate {
    static boolean enabled() { return false; }

    static View create(Activity activity, Consumer<TestAccount> onSelect) {
        throw new IllegalStateException("Test account gate is unavailable in release builds");
    }
}
