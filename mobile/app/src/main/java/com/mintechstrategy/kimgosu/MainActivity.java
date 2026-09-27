package com.mintechstrategy.kimgosu;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Lightweight, offline-first first screen. No login, backend call, or UI framework startup. */
public final class MainActivity extends Activity {
    private static final int PURPLE = Color.rgb(111, 35, 239);
    private static final int CORAL = Color.rgb(205, 112, 83);
    private static final int INK = Color.rgb(29, 30, 33);
    private static final int MUTED = Color.rgb(119, 121, 128);
    private static final int LIGHT = Color.rgb(246, 246, 247);
    private static final String[] TABS = {"홈", "검색", "등록", "채팅", "마이"};
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout content;
    private LinearLayout dock;
    private ScrollView homeScroll;
    private int selectedTab;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(PURPLE);
        getWindow().setNavigationBarColor(PURPLE);
        showSplash();
        handler.postDelayed(() -> showMain(0), 500);
    }

    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable shape(int color, float radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radius));
        return d;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextColor(color);
        t.setTextSize(size);
        t.setFontFeatureSettings("kern");
        t.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        t.setIncludeFontPadding(false);
        return t;
    }

    private LinearLayout column() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private LinearLayout row() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.HORIZONTAL);
        return l;
    }

    private void pad(View view, int left, int top, int right, int bottom) {
        view.setPadding(dp(left), dp(top), dp(right), dp(bottom));
    }

    private void showSplash() {
        FrameLayout frame = new FrameLayout(this);
        frame.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{Color.rgb(119, 42, 240), PURPLE, Color.rgb(103, 27, 227)}));
        LinearLayout title = column();
        title.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView slogan = text("우리동네 잘하는 사람은 다 여기", 22, Color.WHITE, true);
        slogan.setGravity(Gravity.CENTER);
        TextView logo = text("김고수", 76, Color.WHITE, true);
        logo.setGravity(Gravity.CENTER);
        title.addView(slogan);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(-1, -2);
        logoParams.topMargin = dp(10);
        title.addView(logo, logoParams);
        FrameLayout.LayoutParams centered = new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER);
        centered.leftMargin = dp(16);
        centered.rightMargin = dp(16);
        frame.addView(title, centered);
        setContentView(frame);
    }

    private void showMain(int tab) {
        selectedTab = tab;
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        getWindow().setNavigationBarColor(Color.WHITE);
        LinearLayout root = column();
        root.setBackgroundColor(Color.WHITE);
        content = column();
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        View divider = new View(this);
        divider.setBackgroundColor(Color.rgb(233, 233, 236));
        root.addView(divider, new LinearLayout.LayoutParams(-1, dp(1)));
        dock = row();
        dock.setGravity(Gravity.CENTER_VERTICAL);
        root.addView(dock, new LinearLayout.LayoutParams(-1, dp(64)));
        setContentView(root);
        renderContent();
        renderDock();
    }

    private void renderDock() {
        dock.removeAllViews();
        for (int i = 0; i < TABS.length; i++) {
            final int index = i;
            LinearLayout item = column();
            item.setGravity(Gravity.CENTER);
            int color = i == selectedTab ? INK : MUTED;
            Icon icon = new Icon(this, i, color);
            item.addView(icon, new LinearLayout.LayoutParams(dp(25), dp(25)));
            TextView label = text(TABS[i], 11, color, i == selectedTab);
            label.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = dp(3);
            item.addView(label, lp);
            item.setContentDescription(TABS[i] + (i == selectedTab ? " 선택됨" : ""));
            item.setOnClickListener(v -> {
                if (selectedTab != index) {
                    selectedTab = index;
                    renderContent();
                    renderDock();
                }
            });
            dock.addView(item, new LinearLayout.LayoutParams(0, -1, 1));
        }
    }

    private void renderContent() {
        content.removeAllViews();
        if (selectedTab == 0) {
            showHome();
        } else {
            // The remaining tabs have no approved screens yet. Keep switching instantaneous.
            content.setBackgroundColor(Color.WHITE);
        }
    }

    private void showHome() {
        if (homeScroll != null) {
            content.addView(homeScroll, new LinearLayout.LayoutParams(-1, -1));
            return;
        }
        ScrollView scroll = new ScrollView(this);
        homeScroll = scroll;
        scroll.setFillViewport(true);
        scroll.setVerticalScrollBarEnabled(false);
        content.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
        LinearLayout body = column();
        scroll.addView(body);

        LinearLayout header = row();
        header.setGravity(Gravity.CENTER_VERTICAL);
        pad(header, 18, 15, 18, 13);
        TextView brand = text("김고수", 17, CORAL, true);
        header.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
        Icon bell = new Icon(this, 15, INK);
        bell.setContentDescription("알림");
        header.addView(bell, new LinearLayout.LayoutParams(dp(25), dp(25)));
        body.addView(header);
        View line = new View(this);
        line.setBackgroundColor(Color.rgb(246, 246, 246));
        body.addView(line, new LinearLayout.LayoutParams(-1, dp(1)));

        TextView headline = text("내 주변 전문가를\n김고수에서 편리하게 찾으세요", 17, CORAL, true);
        headline.setGravity(Gravity.CENTER);
        headline.setLineSpacing(dp(2), 1f);
        pad(headline, 12, 17, 12, 14);
        body.addView(headline);

        LinearLayout search = row();
        search.setGravity(Gravity.CENTER_VERTICAL);
        search.setBackground(shape(LIGHT, 22));
        pad(search, 15, 0, 14, 0);
        TextView hint = text("어떤 서비스를 찾으시나요?", 12, Color.rgb(159, 160, 164), false);
        search.addView(hint, new LinearLayout.LayoutParams(0, -2, 1));
        search.addView(new Icon(this, 1, INK), new LinearLayout.LayoutParams(dp(23), dp(23)));
        LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(-1, dp(42));
        searchParams.leftMargin = dp(18);
        searchParams.rightMargin = dp(18);
        body.addView(search, searchParams);

        String[] categories = {"디자인/개발", "영상편집", "번역", "법률", "레슨",
                "청소/인테리어", "반려", "헤어/미용", "기타", "전체"};
        for (int r = 0; r < 2; r++) {
            LinearLayout categoryRow = row();
            pad(categoryRow, 18, r == 0 ? 16 : 7, 18, r == 1 ? 16 : 0);
            for (int c = 0; c < 5; c++) {
                int index = r * 5 + c;
                LinearLayout category = column();
                category.setGravity(Gravity.CENTER_HORIZONTAL);
                FrameLayout box = new FrameLayout(this);
                GradientDrawable border = shape(Color.WHITE, 9);
                border.setStroke(dp(1), Color.rgb(230, 154, 129));
                box.setBackground(border);
                Icon icon = new Icon(this, index + 5, CORAL);
                FrameLayout.LayoutParams ip = new FrameLayout.LayoutParams(dp(23), dp(23), Gravity.CENTER);
                box.addView(icon, ip);
                category.addView(box, new LinearLayout.LayoutParams(dp(36), dp(36)));
                TextView label = text(categories[index], 9, INK, false);
                label.setSingleLine(true);
                label.setGravity(Gravity.CENTER);
                LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(-1, -2);
                labelParams.topMargin = dp(5);
                category.addView(label, labelParams);
                categoryRow.addView(category, new LinearLayout.LayoutParams(0, -2, 1));
            }
            body.addView(categoryRow);
        }

        banner(body, "구체적인 요구사항이 있다면 견적을 작성하고\n전문가에게 직접 제안을 받아보세요!", "견적 등록하기 →");
        sectionTitle(body, "최근 등록된 전문가의 서비스");
        serviceCard(body, "프로그램", "Flutter 앱 개발 제작해드려요", "50,000~", "5 ♡");
        serviceCard(body, "프로그램", "iOS 앱 개발 제작해드려요", "50,000~", "5 ♡");
        banner(body, "실제 고객과 함께 만들어가는 나만의 포트폴리오!", "무료로 서비스 등록하기 →");
        sectionTitle(body, "김고수의 비대면 인기 서비스");
        popularChips(body);
        serviceCard(body, "프로그램", "Flutter 앱 개발 제작해드려요", "50,000~", "5 ♡");
        serviceCard(body, "프로그램", "iOS 앱 개발 제작해드려요", "50,000~", "5 ♡");
        sectionTitle(body, "최근 검색한 도배 인기 서비스");
        TextView empty = text("깔끔하게 도배해드립니다.", 12, INK, false);
        pad(empty, 18, 6, 18, 25);
        body.addView(empty);
    }

    private void banner(LinearLayout parent, String title, String action) {
        LinearLayout area = column();
        area.setBackgroundColor(Color.rgb(253, 245, 242));
        pad(area, 18, 13, 18, 10);
        TextView copy = text(title, 12, CORAL, true);
        copy.setLineSpacing(dp(2), 1f);
        area.addView(copy);
        TextView call = text(action, 11, CORAL, false);
        call.setGravity(Gravity.END);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1, -2);
        cp.topMargin = dp(5);
        area.addView(call, cp);
        parent.addView(area, new LinearLayout.LayoutParams(-1, -2));
    }

    private void sectionTitle(LinearLayout parent, String title) {
        TextView heading = text(title, 14, INK, true);
        pad(heading, 18, 18, 18, 10);
        parent.addView(heading);
    }

    private void serviceCard(LinearLayout parent, String category, String title, String price, String likes) {
        LinearLayout card = row();
        card.setBackground(shape(Color.WHITE, 3));
        View photo = new View(this);
        photo.setBackgroundColor(Color.rgb(226, 226, 226));
        card.addView(photo, new LinearLayout.LayoutParams(dp(105), dp(104)));
        LinearLayout info = column();
        pad(info, 10, 5, 9, 6);
        TextView categoryText = text(category, 9, INK, false);
        info.addView(categoryText);
        TextView titleText = text(title, 12, INK, false);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-1, 0, 1);
        tp.topMargin = dp(8);
        info.addView(titleText, tp);
        LinearLayout priceLine = row();
        TextView priceText = text(price, 12, INK, true);
        priceLine.addView(priceText, new LinearLayout.LayoutParams(0, -2, 1));
        priceLine.addView(text(likes, 10, INK, false));
        info.addView(priceLine);
        TextView button = text("문의 하기", 11, INK, false);
        button.setGravity(Gravity.CENTER);
        button.setBackgroundColor(Color.rgb(242, 242, 242));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, dp(24));
        bp.topMargin = dp(5);
        info.addView(button, bp);
        card.addView(info, new LinearLayout.LayoutParams(0, dp(104), 1));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(104));
        params.leftMargin = dp(18);
        params.rightMargin = dp(18);
        params.bottomMargin = dp(8);
        parent.addView(card, params);
    }

    private void popularChips(LinearLayout parent) {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout chips = row();
        pad(chips, 18, 0, 18, 8);
        String[] items = {"프로그램", "마케팅", "도배", "번역", "세탁기"};
        for (int i = 0; i < items.length; i++) {
            TextView chip = text(items[i], 10, i == 0 ? Color.WHITE : INK, false);
            chip.setGravity(Gravity.CENTER);
            chip.setBackground(shape(i == 0 ? CORAL : Color.rgb(239, 239, 240), 15));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(61), dp(25));
            p.rightMargin = dp(5);
            chips.addView(chip, p);
        }
        scroll.addView(chips);
        parent.addView(scroll);
    }

    private static final class Icon extends View {
        private final int kind;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        Icon(Activity activity, int kind, int color) {
            super(activity);
            this.kind = kind;
            paint.setColor(color);
            paint.setStrokeWidth(1.7f);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
        }

        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float scale = Math.min(getWidth(), getHeight()) / 26f;
            canvas.save();
            canvas.translate((getWidth() - 26 * scale) / 2, (getHeight() - 26 * scale) / 2);
            canvas.scale(scale, scale);
            Path path = new Path();
            switch (kind) {
                case 0: // home
                    path.moveTo(3, 12); path.lineTo(13, 3); path.lineTo(23, 12);
                    path.moveTo(6, 11); path.lineTo(6, 23); path.lineTo(20, 23); path.lineTo(20, 11);
                    path.moveTo(11, 23); path.lineTo(11, 17); path.lineTo(15, 17); path.lineTo(15, 23);
                    break;
                case 1: // search
                    canvas.drawCircle(11, 11, 7, paint);
                    path.moveTo(16, 16); path.lineTo(23, 23);
                    break;
                case 2: // register
                    canvas.drawCircle(13, 13, 10, paint);
                    path.moveTo(13, 7); path.lineTo(13, 19);
                    path.moveTo(7, 13); path.lineTo(19, 13);
                    break;
                case 3: // chat
                    canvas.drawRoundRect(3, 4, 23, 19, 5, 5, paint);
                    path.moveTo(9, 19); path.lineTo(7, 23); path.lineTo(14, 19);
                    break;
                case 4: // my
                    canvas.drawCircle(13, 8, 4, paint);
                    canvas.drawArc(4, 13, 22, 27, 185, 170, false, paint);
                    break;
                case 15: // bell
                    path.moveTo(7, 18); path.lineTo(9, 15); path.lineTo(9, 10);
                    canvas.drawArc(9, 4, 17, 14, 180, 180, false, paint);
                    path.moveTo(17, 10); path.lineTo(17, 15); path.lineTo(19, 18);
                    path.lineTo(7, 18);
                    canvas.drawArc(11, 18, 15, 22, 0, 180, false, paint);
                    break;
                default: // small category glyphs, intentionally simple line art
                    if (kind == 14) {
                        for (int x = 4; x <= 14; x += 10) for (int y = 4; y <= 14; y += 10)
                            canvas.drawRect(x, y, x + 8, y + 8, paint);
                    } else if (kind % 3 == 0) {
                        canvas.drawRoundRect(4, 5, 22, 18, 3, 3, paint);
                        path.moveTo(9, 22); path.lineTo(17, 22);
                    } else if (kind % 3 == 1) {
                        canvas.drawCircle(13, 12, 8, paint);
                        path.moveTo(8, 20); path.lineTo(18, 20);
                    } else {
                        path.moveTo(6, 20); path.lineTo(18, 6);
                        path.moveTo(5, 21); path.lineTo(10, 20);
                        path.moveTo(18, 6); path.lineTo(21, 9);
                    }
                    break;
            }
            canvas.drawPath(path, paint);
            canvas.restore();
        }
    }
}
