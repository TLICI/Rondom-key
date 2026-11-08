package com.randomkey.manager;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * 通过 IP 获取粗略地区信息，用于友盟地域统计。
 * 结果缓存在 SharedPreferences，只在首次启动时请求一次。
 */
final class RegionResolver {

    private static final String TAG = "RegionResolver";
    private static final String PREFS = "region_cache";
    private static final String KEY_CACHE = "region_json";
    private static final String ENDPOINT =
            "http://ip-api.com/json/?lang=zh-CN&fields=status,country,countryCode,region,regionName,city,lat,lon";

    private RegionResolver() {}

    static class Region {
        String countryCode = "";
        String country = "";
        String province = "";
        String city = "";
        double lat = 0;
        double lon = 0;

        /** 友盟事件参数值上限 128 字符，这里拼成简短串 */
        String toEventValue() {
            StringBuilder sb = new StringBuilder();
            sb.append(countryCode.isEmpty() ? "UNKNOWN" : countryCode);
            if (!province.isEmpty()) sb.append('/').append(province);
            if (!city.isEmpty() && !city.equals(province)) sb.append('/').append(city);
            return sb.toString();
        }

        boolean hasCoord() {
            return lat != 0 || lon != 0;
        }
    }

    static Region fromJson(JSONObject o) {
        Region r = new Region();
        if (o == null) return r;
        r.countryCode = o.optString("countryCode", "");
        r.country = o.optString("country", "");
        r.province = o.optString("regionName", "");
        r.city = o.optString("city", "");
        r.lat = o.optDouble("lat", 0);
        r.lon = o.optDouble("lon", 0);
        return r;
    }

    /** 读取缓存；没有则返回 null */
    static Region cached(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = sp.getString(KEY_CACHE, null);
        if (raw == null || raw.isEmpty()) return null;
        try {
            return fromJson(new JSONObject(raw));
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 请求 ip-api.com。必须在子线程调用。
     * 失败返回 null，不抛异常。
     */
    static Region fetch(Context ctx) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(ENDPOINT);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.w(TAG, "ip-api http " + code);
                return null;
            }

            InputStream in = conn.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[1024];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();

            String body = new String(bos.toByteArray(), "UTF-8");
            JSONObject o = new JSONObject(body);
            if (!"success".equalsIgnoreCase(o.optString("status"))) {
                Log.w(TAG, "ip-api status " + o.optString("status"));
                return null;
            }

            Region r = fromJson(o);
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(KEY_CACHE, body).apply();
            return r;
        } catch (Exception e) {
            Log.w(TAG, "fetch failed: " + e.getMessage());
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    static String describe(Region r) {
        if (r == null) return "null";
        return String.format(Locale.US, "%s (%s/%s/%s) %.4f,%.4f",
                r.countryCode, r.country, r.province, r.city, r.lat, r.lon);
    }
}
