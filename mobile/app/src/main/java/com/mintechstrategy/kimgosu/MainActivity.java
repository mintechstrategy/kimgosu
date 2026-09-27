package com.mintechstrategy.kimgosu;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.net.Uri;
import android.text.TextUtils;
import android.util.Log;
import android.window.OnBackInvokedDispatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.CheckBox;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

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
    // Legacy static home builder remains below until the WebView migration is verified.
    private ScrollView homeScroll;
    private final WebView[] tabViews = new WebView[TABS.length];
    private final ArrayDeque<Integer> tabHistory = new ArrayDeque<>();
    private boolean mainVisible;
    private TestAccount activeTestAccount;
    private AuthSession activeSession;
    private int loginGeneration;
    private int selectedTab;
    private String categoryJson;
    private boolean regionPickerVisible;
    private String pendingProvince = "서울";
    private Set<String> pendingRegions = new HashSet<>();
    private boolean includeRemote = true;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(PURPLE);
        getWindow().setNavigationBarColor(PURPLE);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
        }
        showSplash();
        CatalogClient.fetch(json -> runOnUiThread(() -> {
            categoryJson = json;
            WebView home = tabViews[0];
            if (home != null && selectedTab == 0 && !regionPickerVisible
                    && home.getUrl() != null && home.getUrl().endsWith("home.html")) {
                int scroll = home.getScrollY();
                loadHomePage(home);
                home.postDelayed(() -> home.scrollTo(0, scroll), 120);
            }
        }));
        handler.postDelayed(() -> {
            if (TestAccountGate.enabled()) showTestAccountGate();
            else showMain(0);
        }, 500);
    }

    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        destroyTabViews();
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
        mainVisible = false;
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

    private void showTestAccountGate() {
        mainVisible = false;
        destroyTabViews();
        activeSession = null;
        activeTestAccount = null;
        loginGeneration++;
        getWindow().setStatusBarColor(Color.rgb(248, 247, 251));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        getWindow().setNavigationBarColor(Color.rgb(248, 247, 251));
        setContentView(TestAccountGate.create(this, this::loginAsTestAccount));
    }

    private void loginAsTestAccount(TestAccount account) {
        int generation = ++loginGeneration;
        LinearLayout pending = column();
        pending.setGravity(Gravity.CENTER);
        pending.setBackgroundColor(Color.rgb(248, 247, 251));
        ProgressBar spinner = new ProgressBar(this);
        pending.addView(spinner, new LinearLayout.LayoutParams(dp(36), dp(36)));
        TextView message = text(account.label + " 로그인 중", 16, INK, true);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(-2, -2);
        messageParams.topMargin = dp(20);
        pending.addView(message, messageParams);
        setContentView(pending);
        TestLoginClient.login(account, (session, error) -> runOnUiThread(() -> {
            if (isDestroyed() || generation != loginGeneration) return;
            if (session == null) {
                showTestAccountGate();
                Toast.makeText(this, error == null ? "로그인에 실패했습니다" : error,
                        Toast.LENGTH_LONG).show();
                return;
            }
            activeSession = session;
            activeTestAccount = account;
            showMain(0);
        }));
    }

    private void showMain(int tab) {
        mainVisible = true;
        tabHistory.clear();
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
            int color = i == selectedTab ? Color.rgb(37, 99, 235) : INK;
            Icon icon = new Icon(this, i, color);
            item.addView(icon, new LinearLayout.LayoutParams(dp(25), dp(25)));
            TextView label = text(TABS[i], 11, color, i == selectedTab);
            label.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = dp(3);
            item.addView(label, lp);
            item.setContentDescription(TABS[i] + (i == selectedTab ? " 선택됨" : ""));
            item.setOnClickListener(v -> {
                selectTab(index, true);
            });
            dock.addView(item, new LinearLayout.LayoutParams(0, -1, 1));
        }
    }

    private void renderContent() {
        content.removeAllViews();
        if (regionPickerVisible) {
            renderRegionPicker();
            return;
        }
        if (selectedTab == 0) renderHomeHeader();
        WebView page = tabViews[selectedTab];
        if (page == null) {
            page = new WebView(this);
            page.setBackgroundColor(Color.WHITE);
            if (selectedTab == 0 || selectedTab == 4) page.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            page.getSettings().setJavaScriptEnabled(true);
            page.getSettings().setDomStorageEnabled(false);
            page.getSettings().setAllowFileAccess(true);
            page.getSettings().setAllowContentAccess(false);
            page.addJavascriptInterface(new ApiBridge(this, page, activeSession), "KimgosuNative");
            page.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    Log.d("KimgosuWebView", "Loaded " + url + " title=" + view.getTitle());
                    if (url.endsWith("/home.html") || url.endsWith("/expert.html")) view.clearHistory();
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest request,
                                                      WebResourceError error) {
                    Log.e("KimgosuWebView", "Load failed " + request.getUrl() + ": " + error.getDescription());
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if ("kimgosu".equals(uri.getScheme())) {
                        if ("back".equals(uri.getHost())) navigateBack();
                        else if ("reselect".equals(uri.getHost()) && TestAccountGate.enabled())
                            showTestAccountGate();
                        else if ("tab".equals(uri.getHost())) {
                            try {
                                int target = Integer.parseInt(uri.getPath().substring(1));
                                if (target >= 0 && target < TABS.length) selectTab(target, true);
                            } catch (RuntimeException ignored) { }
                        }
                        return true;
                    }
                    return !("file".equals(uri.getScheme())
                            && uri.toString().startsWith("file:///android_asset/"));
                }
            });
            tabViews[selectedTab] = page;
            if (selectedTab != 0 && selectedTab != 4) page.loadUrl("file:///android_asset/" + new String[]{
                    "home.html", "search.html", "register.html", "chat.html", "my.html"}[selectedTab]);
        }
        content.addView(page, selectedTab == 0
                ? new LinearLayout.LayoutParams(-1, 0, 1)
                : new LinearLayout.LayoutParams(-1, -1));
        final WebView attachedPage = page;
        if (selectedTab == 0 && page.getUrl() == null) page.post(() -> loadHomePage(attachedPage));
        else if (selectedTab == 4 && page.getUrl() == null) page.post(() -> loadMyPage(attachedPage));
    }

    private void selectTab(int tab, boolean remember) {
        if (!mainVisible || selectedTab == tab) return;
        regionPickerVisible = false;
        if (remember) tabHistory.push(selectedTab);
        selectedTab = tab;
        renderContent();
        renderDock();
        WebView current = tabViews[tab];
        if (current != null) current.evaluateJavascript(
                "window.dispatchEvent(new Event('kimgosu-tab-visible'))", null);
    }

    void switchMode(boolean expert) {
        if (activeSession == null || !activeSession.expertEnabled) return;
        getPreferences(Context.MODE_PRIVATE).edit().putBoolean("expert_mode", expert).apply();
        WebView home = tabViews[0];
        if (home != null) {
            if (home.getParent() instanceof ViewGroup) ((ViewGroup) home.getParent()).removeView(home);
            home.destroy();
            tabViews[0] = null;
        }
        WebView my = tabViews[4];
        if (my != null) {
            if (my.getParent() instanceof ViewGroup) ((ViewGroup) my.getParent()).removeView(my);
            my.destroy();
            tabViews[4] = null;
        }
        selectedTab = 0;
        tabHistory.clear();
        renderContent();
        renderDock();
    }

    private void navigateBack() {
        if (!mainVisible) {
            finish();
            return;
        }
        if (regionPickerVisible) {
            regionPickerVisible = false;
            renderContent();
            return;
        }
        WebView current = tabViews[selectedTab];
        if (current != null && current.canGoBack()) {
            current.goBack();
        } else if (!tabHistory.isEmpty()) {
            selectTab(tabHistory.pop(), false);
        } else if (selectedTab != 0) {
            selectTab(0, false);
        } else {
            finish();
        }
    }

    @Override public void onBackPressed() {
        if (Build.VERSION.SDK_INT < 33) navigateBack();
        else super.onBackPressed();
    }

    private void destroyTabViews() {
        for (int i = 0; i < tabViews.length; i++) {
            WebView page = tabViews[i];
            if (page == null) continue;
            if (page.getParent() instanceof ViewGroup) ((ViewGroup) page.getParent()).removeView(page);
            page.destroy();
            tabViews[i] = null;
        }
        tabHistory.clear();
    }

    private void renderHomeHeader() {
        LinearLayout header = row();
        header.setGravity(Gravity.CENTER_VERTICAL);
        pad(header, 18, 2, 18, 2);
        LinearLayout regionTrigger = row();
        regionTrigger.setGravity(Gravity.CENTER_VERTICAL);
        TextView region = text(getPreferences(Context.MODE_PRIVATE)
                .getString("home_region_name", "지역 선택"), 27, INK, true);
        regionTrigger.addView(region);
        View chevron = new View(this) {
            private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
            @Override protected void onDraw(Canvas canvas) {
                super.onDraw(canvas);
                line.setColor(INK);
                line.setStyle(Paint.Style.STROKE);
                line.setStrokeWidth(dp(2.5f));
                line.setStrokeCap(Paint.Cap.ROUND);
                line.setStrokeJoin(Paint.Join.ROUND);
                Path path = new Path();
                path.moveTo(dp(3), dp(10));
                path.lineTo(dp(12), dp(19));
                path.lineTo(dp(21), dp(10));
                canvas.drawPath(path, line);
            }
        };
        LinearLayout.LayoutParams arrowParams = new LinearLayout.LayoutParams(dp(25), dp(27));
        arrowParams.leftMargin = dp(10);
        regionTrigger.addView(chevron, arrowParams);
        regionTrigger.setContentDescription("지역 선택 화면 열기");
        regionTrigger.setOnClickListener(v -> {
            pendingRegions = new HashSet<>(getPreferences(Context.MODE_PRIVATE)
                    .getStringSet("home_regions", new HashSet<>()));
            includeRemote = getPreferences(Context.MODE_PRIVATE).getBoolean("include_remote", true);
            regionPickerVisible = true;
            renderContent();
        });
        header.addView(regionTrigger, new LinearLayout.LayoutParams(0, -2, 1));
        if (TestAccountGate.enabled()) {
            TextView account = text("계정 변경", 12, Color.rgb(37, 99, 235), true);
            pad(account, 9, 8, 9, 8);
            account.setOnClickListener(v -> showTestAccountGate());
            header.addView(account);
        }
        Icon bell = new Icon(this, 15, INK);
        bell.setContentDescription("알림");
        LinearLayout.LayoutParams bellParams = new LinearLayout.LayoutParams(dp(27), dp(27));
        bellParams.leftMargin = dp(9);
        header.addView(bell, bellParams);
        content.addView(header, new LinearLayout.LayoutParams(-1, dp(54)));
    }

    private static final String[] PROVINCES = {"서울", "경기", "인천", "강원", "충남", "충북",
            "대전", "세종", "전남", "전북", "광주", "경남", "경북", "대구", "부산", "울산", "제주"};

    private String[] districtsFor(String province) {
        switch (province) {
            case "서울": return new String[]{"전체", "강남구", "강동구", "강북구", "강서구", "관악구",
                    "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구",
                    "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구",
                    "은평구", "종로구", "중구", "중랑구"};
            case "경기": return new String[]{"전체", "고양시", "과천시", "광명시", "구리시", "군포시",
                    "김포시", "남양주시", "부천시", "성남시", "수원시", "시흥시", "안산시", "안양시",
                    "양주시", "오산시", "용인시", "의정부시", "이천시", "파주시", "평택시", "하남시", "화성시"};
            case "인천": return new String[]{"전체", "강화군", "계양구", "남동구", "동구", "미추홀구",
                    "부평구", "서구", "연수구", "옹진군", "중구"};
            case "부산": return new String[]{"전체", "강서구", "금정구", "기장군", "남구", "동구",
                    "동래구", "부산진구", "북구", "사상구", "사하구", "서구", "수영구", "연제구", "영도구", "중구", "해운대구"};
            default: return new String[]{"전체"};
        }
    }

    private void renderRegionPicker() {
        LinearLayout screen = column();
        screen.setBackgroundColor(Color.WHITE);

        LinearLayout toolbar = row();
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        pad(toolbar, 18, 6, 18, 6);
        TextView brand = text("김고수", 15, Color.rgb(190, 92, 51), true);
        toolbar.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
        toolbar.addView(text("♧", 20, INK, false));
        screen.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(48)));
        View separator = new View(this);
        separator.setBackgroundColor(Color.rgb(236, 236, 236));
        screen.addView(separator, new LinearLayout.LayoutParams(-1, dp(1)));

        TextView prompt = text("어느 지역의 서비스를 찾으시나요?", 14, INK, true);
        pad(prompt, 22, 17, 15, 10);
        screen.addView(prompt);
        CheckBox remote = new CheckBox(this);
        remote.setText("비대면 진행 포함");
        remote.setTextSize(13);
        remote.setTextColor(INK);
        remote.setButtonTintList(ColorStateList.valueOf(Color.BLACK));
        remote.setChecked(includeRemote);
        remote.setOnCheckedChangeListener((button, checked) -> includeRemote = checked);
        pad(remote, 20, 0, 12, 8);
        screen.addView(remote);

        LinearLayout columns = row();
        columns.setBackgroundColor(Color.WHITE);
        ScrollView provinceScroll = new ScrollView(this);
        LinearLayout provinceList = column();
        for (String province : PROVINCES) {
            TextView item = text(province, 13, INK, province.equals(pendingProvince));
            pad(item, 22, 11, 3, 11);
            item.setBackgroundColor(province.equals(pendingProvince)
                    ? Color.rgb(248, 248, 248) : Color.WHITE);
            item.setOnClickListener(v -> {
                pendingProvince = province;
                renderContent();
            });
            provinceList.addView(item);
        }
        provinceScroll.addView(provinceList);
        columns.addView(provinceScroll, new LinearLayout.LayoutParams(dp(90), -1));
        View divider = new View(this);
        divider.setBackgroundColor(Color.rgb(241, 241, 241));
        columns.addView(divider, new LinearLayout.LayoutParams(dp(1), -1));

        ScrollView districtScroll = new ScrollView(this);
        LinearLayout districtList = column();
        ArrayList<CheckBox> options = new ArrayList<>();
        for (String district : districtsFor(pendingProvince)) {
            String key = pendingProvince + "/" + district;
            CheckBox option = new CheckBox(this);
            option.setText(district.equals("전체") ? pendingProvince + " 전체" : district);
            option.setTextSize(13);
            option.setTextColor(INK);
            option.setButtonTintList(ColorStateList.valueOf(Color.BLACK));
            option.setChecked(pendingRegions.contains(key));
            pad(option, 14, 6, 12, 6);
            option.setOnClickListener(v -> {
                if (option.isChecked()) {
                    if (district.equals("전체"))
                        pendingRegions.removeIf(value -> value.startsWith(pendingProvince + "/"));
                    else pendingRegions.remove(pendingProvince + "/전체");
                    pendingRegions.add(key);
                } else pendingRegions.remove(key);
                for (CheckBox other : options) {
                    String otherDistrict = other.getText().toString();
                    if (otherDistrict.equals(pendingProvince + " 전체")) otherDistrict = "전체";
                    other.setChecked(pendingRegions.contains(pendingProvince + "/" + otherDistrict));
                }
            });
            options.add(option);
            districtList.addView(option);
        }
        districtScroll.addView(districtList);
        columns.addView(districtScroll, new LinearLayout.LayoutParams(0, -1, 1));
        screen.addView(columns, new LinearLayout.LayoutParams(-1, 0, 1));

        TextView apply = text("검색 하기", 15, Color.BLACK, true);
        apply.setGravity(Gravity.CENTER);
        apply.setBackgroundColor(Color.rgb(220, 220, 220));
        apply.setOnClickListener(v -> {
            if (pendingRegions.isEmpty() && !includeRemote) {
                Toast.makeText(this, "지역을 한 곳 이상 선택하세요", Toast.LENGTH_SHORT).show();
                return;
            }
            ArrayList<String> chosen = new ArrayList<>(pendingRegions);
            chosen.sort(String::compareTo);
            String label;
            if (chosen.isEmpty()) label = "비대면";
            else {
                String first = chosen.get(0);
                label = first.substring(first.indexOf('/') + 1);
                if (label.equals("전체")) label = first.substring(0, first.indexOf('/')) + " 전체";
                if (chosen.size() > 1) label += " 외 " + (chosen.size() - 1) + "곳";
            }
            getPreferences(Context.MODE_PRIVATE).edit()
                    .putStringSet("home_regions", new HashSet<>(pendingRegions))
                    .putString("home_region_name", label)
                    .putBoolean("include_remote", includeRemote)
                    .apply();
            regionPickerVisible = false;
            renderContent();
        });
        screen.addView(apply, new LinearLayout.LayoutParams(-1, dp(54)));
        content.addView(screen, new LinearLayout.LayoutParams(-1, -1));
    }

    private void loadMyPage(WebView page) {
        try (InputStream file = getAssets().open("my.html")) {
            String html = new String(file.readAllBytes(), StandardCharsets.UTF_8);
            AuthSession session = activeSession;
            html = html.replace("{{NAME}}", TextUtils.htmlEncode(session == null ? "게스트" : session.customerName))
                    .replace("{{USER_ID}}", TextUtils.htmlEncode(session == null ? "로그인 전" : session.userId))
                    .replace("{{BIRTH_DATE}}", TextUtils.htmlEncode(session == null ? "-" : session.birthDate))
                    .replace("{{ADDRESS}}", TextUtils.htmlEncode(session == null ? "-" : session.homeAddress))
                    .replace("{{MODE}}", session != null && session.expertEnabled ? "고수" : "일반");
            page.loadDataWithBaseURL("file:///android_asset/my.html", html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            page.loadUrl("file:///android_asset/my.html");
        }
    }

    private void loadHomePage(WebView page) {
        if (activeSession != null && activeSession.expertEnabled &&
                getPreferences(Context.MODE_PRIVATE).getBoolean("expert_mode", false)) {
            page.loadUrl("file:///android_asset/expert.html");
            return;
        }
        try (InputStream file = getAssets().open("home.html")) {
            String html = new String(file.readAllBytes(), StandardCharsets.UTF_8);
            String json = categoryJson;
            if (json == null) {
                try (InputStream fallback = getAssets().open("categories-default.json")) {
                    json = new String(fallback.readAllBytes(), StandardCharsets.UTF_8);
                }
            }
            html = html.replace("{{CATEGORIES}}", HomeCategories.render(json));
            page.loadDataWithBaseURL("file:///android_asset/home.html", html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            Log.e("KimgosuWebView", "Home catalog render failed", error);
            page.loadUrl("file:///android_asset/home.html");
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
        if (activeTestAccount != null) {
            TextView selected = text(activeTestAccount.label + " ✓", 11, PURPLE, true);
            selected.setGravity(Gravity.CENTER);
            selected.setContentDescription("현재 " + activeTestAccount.label + ", 계정 다시 선택");
            selected.setOnClickListener(v -> showTestAccountGate());
            LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-2, dp(25));
            sp.rightMargin = dp(14);
            header.addView(selected, sp);
        }
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
