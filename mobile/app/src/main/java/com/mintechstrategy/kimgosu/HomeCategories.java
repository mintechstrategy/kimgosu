package com.mintechstrategy.kimgosu;

import android.text.TextUtils;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;

/** Render server-owned category codes without enabling JavaScript in the WebView. */
final class HomeCategories {
    private HomeCategories() { }

    static String render(String json) throws Exception {
        JSONArray data = new JSONArray(json);
        ArrayList<JSONObject> items = new ArrayList<>();
        for (int i = 0; i < data.length(); i++) items.add(data.getJSONObject(i));
        items.sort(Comparator.comparingInt(item -> item.optInt("displayOrder", Integer.MAX_VALUE)));
        StringBuilder html = new StringBuilder();
        for (JSONObject item : items) {
            String code = item.getString("code");
            if (!code.matches("[a-z][a-z0-9_]*")) continue;
            String icon = item.optString("iconKey", "");
            html.append("<a class=\"category-card ").append(tone(icon))
                    .append("\" href=\"detail.html?category=").append(code)
                    .append("\" aria-label=\"").append(TextUtils.htmlEncode(item.getString("displayName")))
                    .append("\"><span class=\"category-icon\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">")
                    .append(paths(icon)).append("</svg></span><span class=\"category-name\">")
                    .append(TextUtils.htmlEncode(item.getString("displayName")))
                    .append("</span></a>");
        }
        return html.toString();
    }

    private static String tone(String icon) {
        switch (icon) {
            case "video": case "broom": return "mint";
            case "language": case "scissors": return "purple";
            default: return "blue";
        }
    }

    private static String paths(String icon) {
        switch (icon) {
            case "pencil": return "<path d=\"M4 20l4.5-1 10-10-3.5-3.5-10 10L4 20zM13.8 6.7l3.5 3.5M14.9 5.6l1.4-1.4a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8l-1.4 1.4\"/>";
            case "video": return "<rect x=\"2.5\" y=\"5\" width=\"14\" height=\"14\" rx=\"2\"/><path d=\"M16.5 9l5-3v12l-5-3M9 9l4 3-4 3z\"/>";
            case "language": return "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18\"/>";
            case "scales": return "<path d=\"M12 3v17M7 20h10M4 7h16M5.5 7L3 13h5zM18.5 7L16 13h5z\"/>";
            case "broom": return "<path d=\"M16 3L8 13M7 12l5 4-5 5-4-4zM9 16l-3 3\"/>";
            case "paw": return "<circle cx=\"5\" cy=\"8\" r=\"1\"/><circle cx=\"10\" cy=\"5\" r=\"1\"/><circle cx=\"15\" cy=\"5\" r=\"1\"/><circle cx=\"20\" cy=\"8\" r=\"1\"/><path d=\"M7 18c0-3 3-5 5-5s5 2 5 5c0 3-3 3-5 2-2 1-5 1-5-2z\"/>";
            case "scissors": return "<circle cx=\"5\" cy=\"6\" r=\"2\"/><circle cx=\"5\" cy=\"18\" r=\"2\"/><path d=\"M7 7l13 13M7 17L20 4\"/>";
            default: return "<circle cx=\"12\" cy=\"12\" r=\"8\"/>";
        }
    }
}
