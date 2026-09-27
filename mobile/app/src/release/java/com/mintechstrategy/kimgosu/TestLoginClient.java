package com.mintechstrategy.kimgosu;

/** Release APK has no synthetic login implementation or LAN endpoint. */
final class TestLoginClient {
    interface Callback {
        void complete(AuthSession session, String error);
    }

    static void login(TestAccount account, Callback callback) {
        callback.complete(null, "Test login is unavailable in release builds");
    }
}
