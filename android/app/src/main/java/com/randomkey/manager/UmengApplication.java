package com.randomkey.manager;

import android.app.Application;
import com.umeng.commonsdk.UMConfigure;
import android.os.Bundle;
import com.umeng.umcrash.UMCrash;
import com.umeng.analytics.MobclickAgent;

import java.util.HashMap;
import java.util.Map;

public class UmengApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        
        // 友盟统计SDK初始化
        UMConfigure.setLogEnabled(true);
        UMConfigure.preInit(this, "6aeec982863270068cb9b94d", "GitHub");
        
        new Thread(new Runnable() {
            @Override
            public void run() {

        // APM性能监控配置（必须在UMConfigure.init之前调用）
        Bundle bundle = new Bundle();
        bundle.putBoolean(UMCrash.KEY_ENABLE_CRASH_JAVA, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_CRASH_NATIVE, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_ANR, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_PA, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_LAUNCH, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_MEM, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_NET, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_PAGE, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_POWER, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_CODE_LOG, true);
        bundle.putBoolean(UMCrash.KEY_ENABLE_MEMLEAK, true);
        bundle.putLong(UMCrash.KEY_PA_TIMEOUT_TIME, 2000L);
        UMCrash.initConfig(bundle);

                UMConfigure.init(
                    UmengApplication.this,
                    "6aeec982863270068cb9b94d",
                    "GitHub",
                    UMConfigure.DEVICE_TYPE_PHONE,
                    null
                );

                reportRegion();
            }
        }).start();
    }

    /**
     * 上报地区：优先用缓存，无缓存时才请求 IP 归属接口。
     * 已有缓存也照常上报事件，保证每天活跃都能统计到地区分布。
     */
    private void reportRegion() {
        try {
            RegionResolver.Region r = RegionResolver.cached(this);
            if (r == null) {
                r = RegionResolver.fetch(this);
            }
            if (r == null) {
                r = new RegionResolver.Region();
                r.countryCode = "UNKNOWN";
            }

            Map<String, String> params = new HashMap<>();
            params.put("region", r.toEventValue());
            if (!r.country.isEmpty()) params.put("country", r.country);
            if (!r.province.isEmpty()) params.put("province", r.province);
            if (!r.city.isEmpty()) params.put("city", r.city);

            MobclickAgent.onEvent(this, "user_region", params);

            // 有坐标时同步给友盟，网页后台「用户地域」报表会更准确
            if (r.hasCoord()) {
                MobclickAgent.setLocation(r.lat, r.lon);
            }

            android.util.Log.i("RegionResolver", "reported " + RegionResolver.describe(r));
        } catch (Throwable t) {
            android.util.Log.w("RegionResolver", "reportRegion failed: " + t.getMessage());
        }
    }
}
