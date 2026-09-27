package com.mintechstrategy.kimgosu;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.text.InputFilter;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.function.Consumer;

/** Delete this debug source file and its release stub to remove the temporary gate. */
final class TestAccountGate {
    private static final int PURPLE = Color.rgb(111, 35, 239);
    static boolean enabled() { return true; }

    static View create(Activity activity, Consumer<TestAccount> onSelect) {
        int density = Math.round(activity.getResources().getDisplayMetrics().density);
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(248, 247, 251));
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(22 * density, 40 * density, 22 * density, 25 * density);
        scroll.addView(root);

        TextView badge = label(activity, "김고수 · 테스트 APK", 14, PURPLE, true);
        root.addView(badge);
        TextView title = label(activity, "테스트 계정을 선택해 주세요", 25, Color.rgb(28, 28, 33), true);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(-1, -2);
        titleParams.topMargin = 14 * density;
        root.addView(title, titleParams);
        TextView detail = label(activity, "스플래시 다음에만 나타나는 임시 화면입니다.\n계정을 누르면 홈으로 바로 이동합니다.",
                13, Color.rgb(109, 109, 119), false);
        detail.setLineSpacing(4 * density, 1f);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(-1, -2);
        detailParams.topMargin = 12 * density;
        detailParams.bottomMargin = 20 * density;
        root.addView(detail, detailParams);

        TextView numberLabel = label(activity, "테스트 계정 번호 (1~50)", 15, Color.rgb(28, 28, 33), true);
        root.addView(numberLabel);
        EditText numberInput = new EditText(activity);
        numberInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        numberInput.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2)});
        numberInput.setText("1");
        numberInput.setSelectAllOnFocus(true);
        numberInput.setContentDescription("테스트 계정 번호, 1부터 50까지");
        root.addView(numberInput, new LinearLayout.LayoutParams(-1, -2));

        for (int roleIndex = 0; roleIndex < 2; roleIndex++) {
            final boolean expert = roleIndex == 1;
            LinearLayout card = new LinearLayout(activity);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(18 * density, 17 * density, 18 * density, 17 * density);
            GradientDrawable background = new GradientDrawable();
            background.setColor(Color.WHITE);
            background.setCornerRadius(15 * density);
            background.setStroke(density, Color.rgb(231, 228, 237));
            card.setBackground(background);
            TextView role = label(activity, expert ? "영등포구 고수 계정" : "강남구 일반 계정", 12, PURPLE, true);
            card.addView(role);
            TextView name = label(activity, expert ? "고수로 시작 →" : "일반 이용자로 시작 →", 19, Color.rgb(28, 28, 33), true);
            LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(-1, -2);
            nameParams.topMargin = 8 * density;
            card.addView(name, nameParams);
            TextView id = label(activity, "서버에서 고객 ID를 조회·발급합니다", 10, Color.rgb(137, 137, 145), false);
            LinearLayout.LayoutParams idParams = new LinearLayout.LayoutParams(-1, -2);
            idParams.topMargin = 8 * density;
            card.addView(id, idParams);
            card.setContentDescription(expert ? "고수 계정 선택" : "일반 계정 선택");
            card.setOnClickListener(v -> {
                int index;
                try { index = Integer.parseInt(numberInput.getText().toString()); }
                catch (NumberFormatException ignored) { index = 0; }
                if (index < 1 || index > 50) {
                    numberInput.setError("1부터 50까지 입력해 주세요");
                    return;
                }
                String serial = String.format(java.util.Locale.ROOT, "%03d", index);
                String kind = expert ? "EXPERT" : "CONSUMER";
                String labelText = (expert ? "고수 사용자 " : "일반 이용자 ") + index;
                onSelect.accept(new TestAccount("TEST-CI-KIMGOSU-" + kind + "-" + serial,
                        labelText, expert ? "고수" : "일반"));
            });
            LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(-1, -2);
            cardParams.bottomMargin = 12 * density;
            root.addView(card, cardParams);
        }

        TextView note = label(activity, "내장된 CI는 실제 개인정보가 아닌 테스트 전용 값입니다.\n선택하면 LAN 테스트 API에서 로그인 토큰을 발급합니다.",
                11, Color.rgb(132, 132, 142), false);
        note.setGravity(Gravity.CENTER);
        note.setLineSpacing(3 * density, 1f);
        LinearLayout.LayoutParams noteParams = new LinearLayout.LayoutParams(-1, -2);
        noteParams.topMargin = 13 * density;
        root.addView(note, noteParams);
        return scroll;
    }

    private static TextView label(Activity activity, String value, int size, int color, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setIncludeFontPadding(false);
        view.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        return view;
    }
}
