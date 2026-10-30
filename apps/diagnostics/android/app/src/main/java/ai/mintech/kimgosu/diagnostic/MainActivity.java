package ai.mintech.kimgosu.diagnostic;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.io.File;
import java.io.FileOutputStream;
import org.json.JSONObject;

public class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView view = new TextView(this);
        view.setTextSize(22);
        view.setPadding(32, 72, 32, 32);
        view.setText("김고수 개발환경 점검\nAndroid 진단 앱 · 제품 화면 아님\nAPI 연결 확인 중");
        setContentView(view);
        new Thread(() -> {
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) new URL("https://api-dev-kimgosu.mintech.ai/health").openConnection();
                connection.setConnectTimeout(20000); connection.setReadTimeout(20000);
                int code = connection.getResponseCode();
                String ray = connection.getHeaderField("cf-ray");
                String text = new String(connection.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                JSONObject body = new JSONObject(text);
                if (code != 200 || ray == null) throw new Exception("HTTP/proxy verification failed");
                JSONObject receipt = new JSONObject().put("status", "PASS").put("httpStatus", code).put("cfRay", ray).put("release", body.getString("release")).put("platform", "Android emulator").put("observedAt", System.currentTimeMillis());
                try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "api-receipt.json"))) { out.write(receipt.toString(2).getBytes(StandardCharsets.UTF_8)); }
                runOnUiThread(() -> view.setText("김고수 개발환경 점검\nAPI 연결 성공\nCloudflare → Railway"));
            } catch (Exception e) { runOnUiThread(() -> view.setText("연결 실패: " + e.getClass().getSimpleName())); }
            finally { if (connection != null) connection.disconnect(); }
        }).start();
    }
}
