package com.mintechstrategy.kimgosu;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Fetch ordered public catalog codes after the bundled home has painted. */
final class CatalogClient {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    interface Callback { void complete(String json); }

    static void fetch(Callback callback) {
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(
                        ApiEndpoint.BASE + "/api/v1/catalog/home-categories").openConnection();
                connection.setConnectTimeout(1800);
                connection.setReadTimeout(1800);
                try (InputStream stream = connection.getInputStream()) {
                    if (connection.getResponseCode() == 200)
                        callback.complete(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
                }
            } catch (Exception ignored) {
                // The bundled codes keep the home immediately usable offline.
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }
}
