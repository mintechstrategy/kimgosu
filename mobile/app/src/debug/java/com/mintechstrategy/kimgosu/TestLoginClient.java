package com.mintechstrategy.kimgosu;

import org.json.JSONObject;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** LAN-only debug login. The release variant contains no endpoint or synthetic CI. */
final class TestLoginClient {
    private static final String ENDPOINT = ApiEndpoint.BASE + "/api/v1/auth/test-login";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    interface Callback {
        void complete(AuthSession session, String error);
    }

    static void login(TestAccount account, Callback callback) {
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(ENDPOINT).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] body = new JSONObject().put("ci", account.syntheticCi)
                        .toString().getBytes(StandardCharsets.UTF_8);
                connection.getOutputStream().write(body);
                int status = connection.getResponseCode();
                if (status != 200) {
                    callback.complete(null, "로그인에 실패했습니다 (" + status + ")");
                    return;
                }
                String json;
                try (InputStream stream = connection.getInputStream()) {
                    json = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
                }
                JSONObject response = new JSONObject(json);
                JSONObject customer = response.getJSONObject("customer");
                AuthSession session = new AuthSession(
                        response.getString("accessToken"), customer.getString("userId"),
                        customer.optString("customerName", ""),
                        customer.optString("birthDate", ""),
                        customer.optString("homeAddress", ""),
                        customer.getBoolean("expertEnabled"));
                callback.complete(session, null);
            } catch (Exception error) {
                callback.complete(null, "LAN 테스트 API에 연결할 수 없습니다. Wi-Fi와 서버를 확인해 주세요.");
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }
}
