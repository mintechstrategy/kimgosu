package com.mintechstrategy.kimgosu;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.util.Log;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.widget.Toast;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.UUID;

/** Narrow HTTP adapter for local WebView pages; the JSON API remains usable by a future web client. */
final class ApiBridge {
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(3);
    private final WebView page;
    private final int tabIndex;
    private final AuthSession session;
    private final MainActivity activity;

    ApiBridge(MainActivity activity, WebView page, int tabIndex, AuthSession session) {
        this.activity = activity;
        this.page = page;
        this.tabIndex = tabIndex;
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

    @JavascriptInterface public boolean isPageVisible() {
        return activity.isTabVisible(tabIndex);
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
                connection.setInstanceFollowRedirects(false);
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
            } catch (Exception exception) {
                Log.w("KimgosuApi", "Request failed: " + exception.getClass().getSimpleName());
            }
            finally { if (connection != null) connection.disconnect(); }
            reply(callbackId, status, response);
        });
    }

    @JavascriptInterface public void pickAttachment(int callbackId, String roomId) {
        if (session == null || callbackId < 1 || callbackId > 1000000 || !isUuid(roomId)) {
            attachmentReply(callbackId, 400, "{\"detail\":\"잘못된 첨부 요청입니다\"}");
            return;
        }
        activity.runOnUiThread(() -> activity.pickChatAttachment(this, callbackId, roomId));
    }

    @JavascriptInterface public void saveAttachment(String attachmentId, String filename) {
        if (session == null || !isUuid(attachmentId)) return;
        String safeName = filename == null ? "attachment" : filename.replaceAll("[\\\\/\\p{Cntrl}]", "_");
        activity.runOnUiThread(() -> activity.saveChatAttachment(this, attachmentId, safeName));
    }

    private static boolean isUuid(String value) {
        try { UUID.fromString(value); return true; }
        catch (Exception ignored) { return false; }
    }

    void uploadAttachment(int callbackId, String roomId, Uri uri) {
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            int status = 503;
            String response = "{\"detail\":\"파일 업로드에 실패했습니다\"}";
            try {
                String filename = "attachment";
                try (Cursor cursor = activity.getContentResolver().query(uri,
                        new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int name = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        int size = cursor.getColumnIndex(OpenableColumns.SIZE);
                        if (name >= 0) filename = cursor.getString(name);
                        if (size >= 0 && !cursor.isNull(size) && cursor.getLong(size) > 100L * 1024 * 1024)
                            throw new IOException("FILE_TOO_LARGE");
                    }
                }
                filename = filename.replace("\\", "_").replace("/", "_").replace("\"", "_")
                        .replace("\r", "_").replace("\n", "_");
                String mime = activity.getContentResolver().getType(uri);
                if (mime == null) mime = "application/octet-stream";
                String boundary = "kimgosu-" + UUID.randomUUID();
                connection = (HttpURLConnection) new URL(ApiEndpoint.BASE +
                        "/api/v1/chat/rooms/" + roomId + "/attachments").openConnection();
                connection.setRequestMethod("POST");
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(30000);
                connection.setDoOutput(true);
                connection.setChunkedStreamingMode(65536);
                connection.setRequestProperty("Authorization", "Bearer " + session.accessToken);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                try (InputStream input = activity.getContentResolver().openInputStream(uri);
                     OutputStream output = connection.getOutputStream()) {
                    if (input == null) throw new IOException("FILE_UNAVAILABLE");
                    output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" +
                            filename + "\"\r\nContent-Type: " + mime + "\r\n\r\n")
                            .getBytes(StandardCharsets.UTF_8));
                    byte[] buffer = new byte[65536];
                    long size = 0;
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        size += count;
                        if (size > 100L * 1024 * 1024) throw new IOException("FILE_TOO_LARGE");
                        output.write(buffer, 0, count);
                    }
                    output.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
                }
                status = connection.getResponseCode();
                InputStream result = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                response = result == null ? "{}" : new String(result.readAllBytes(), StandardCharsets.UTF_8);
            } catch (Exception exception) {
                Log.w("KimgosuApi", "Attachment upload failed: " + exception.getClass().getSimpleName());
                if ("FILE_TOO_LARGE".equals(exception.getMessage())) {
                    status = 413; response = "{\"detail\":\"파일은 100MB 이하만 첨부할 수 있습니다\"}";
                }
            } finally { if (connection != null) connection.disconnect(); }
            attachmentReply(callbackId, status, response);
        });
    }

    void downloadAttachment(String attachmentId, Uri destination) {
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            boolean saved = false;
            try {
                connection = (HttpURLConnection) new URL(ApiEndpoint.BASE +
                        "/api/v1/chat/attachments/" + attachmentId + "/download").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("Authorization", "Bearer " + session.accessToken);
                if (connection.getResponseCode() == 200) {
                    try (InputStream input = connection.getInputStream();
                         OutputStream output = activity.getContentResolver().openOutputStream(destination)) {
                        if (output == null) throw new IOException("DESTINATION_UNAVAILABLE");
                        byte[] buffer = new byte[65536]; int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                        saved = true;
                    }
                }
            } catch (Exception exception) {
                Log.w("KimgosuApi", "Attachment download failed: " + exception.getClass().getSimpleName());
            } finally { if (connection != null) connection.disconnect(); }
            boolean success = saved;
            activity.runOnUiThread(() -> Toast.makeText(activity,
                    success ? "파일을 저장했습니다" : "파일 저장에 실패했습니다", Toast.LENGTH_SHORT).show());
        });
    }

    void attachmentReply(int callbackId, int status, String response) { reply(callbackId, status, response); }

    private void reply(int callbackId, int status, String response) {
        String quoted = JSONObject.quote(response);
        page.post(() -> page.evaluateJavascript("window.KimgosuApi&&KimgosuApi.resolve(" +
                callbackId + "," + status + "," + quoted + ")", null));
    }
}
