package com.mintechstrategy.kimgosu;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Narrow HTTP adapter for local WebView pages; the JSON API remains usable by a future web client. */
final class ApiBridge {
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(3);
    private final WebView page;
    private final AuthSession session;
    private final MainActivity activity;

    ApiBridge(MainActivity activity, WebView page, AuthSession session) {
        this.activity = activity;
        this.page = page;
        this.session = session;
    }

    @JavascriptInterface public String profile() {
        if (session == null) return "{}";
        try {
            return new JSONObject().put("userId", session.userId)
                    .put("customerName", session.customerName)
                    .put("expertEnabled", session.expertEnabled)
                    .put("regions", new JSONArray(activity.getPreferences(0)
                            .getStringSet("home_regions", java.util.Collections.emptySet())))
                    .put("includeRemote", activity.getPreferences(0)
                            .getBoolean("include_remote", true))
                    .put("expertMode", session.expertEnabled && activity.getPreferences(0)
                            .getBoolean("expert_mode", false)).toString();
        } catch (Exception ignored) { return "{}"; }
    }

    @JavascriptInterface public void setMode(String mode) {
        if (session == null || !session.expertEnabled ||
                !("expert".equals(mode) || "consumer".equals(mode))) return;
        activity.runOnUiThread(() -> activity.switchMode("expert".equals(mode)));
    }

    @JavascriptInterface public void request(int callbackId, String method, String path, String body) {
        if (callbackId < 1 || callbackId > 1000000 || path == null ||
                !path.startsWith("/api/v1/") || path.contains("..") || path.contains("#") ||
                path.length() > 1500 || body == null || body.length() > 100000 || method == null ||
                !(method.equals("GET") || method.equals("POST") || method.equals("PUT") ||
                  method.equals("DELETE"))) {
            reply(callbackId, 400, "{\"detail\":\"Invalid API request\"}");
            return;
        }
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            int status = 503;
            String response = "{\"detail\":\"Network unavailable\"}";
            try {
                connection = (HttpURLConnection) new URL(ApiEndpoint.BASE + path).openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(10000);
                connection.setRequestProperty("Accept", "application/json");
                if (session != null) connection.setRequestProperty("Authorization", "Bearer " + session.accessToken);
                if (!method.equals("GET") && !body.isEmpty()) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    connection.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
                }
                status = connection.getResponseCode();
                InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                response = input == null ? "{}" : new String(input.readAllBytes(), StandardCharsets.UTF_8);
            } catch (Exception ignored) { }
            finally { if (connection != null) connection.disconnect(); }
            reply(callbackId, status, response);
        });
    }

    private void reply(int callbackId, int status, String response) {
        String quoted = JSONObject.quote(response);
        page.post(() -> page.evaluateJavascript("window.KimgosuApi&&KimgosuApi.resolve(" +
                callbackId + "," + status + "," + quoted + ")", null));
    }
}
