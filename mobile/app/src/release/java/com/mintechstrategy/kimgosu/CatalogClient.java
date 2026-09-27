package com.mintechstrategy.kimgosu;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** HTTPS catalog lookup; bundled data remains available until TLS is configured. */
final class CatalogClient {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    interface Callback { void complete(String json); }

    static void fetch(Callback callback) {
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(
                        "https://mt0205.synology.me:23912/api/v1/catalog/home-categories").openConnection();
                connection.setConnectTimeout(1800);
                connection.setReadTimeout(1800);
                try (InputStream stream = connection.getInputStream()) {
                    if (connection.getResponseCode() == 200)
                        callback.complete(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
                }
            } catch (Exception ignored) {
                // Do not downgrade to HTTP for a release build.
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }
}
