# random 密码生成器 · 密钥管理

同一套 `www/` 网页代码，同时打包成 **Windows 桌面客户端** 与 **安卓 APK**。

## 目录结构

```
www/                 共用页面（index.html / styles.css / app.js）
electron/main.js     Electron 主进程
scripts/             图标生成脚本（桌面 ico/png、安卓 mipmap/splash）
build/               图标源文件 icon.svg 及生成的 icon.png / icon.ico
android/             Capacitor 安卓工程（Gradle）
dist/                构建产物
```

## 直接使用

| 产物 | 说明 |
| --- | --- |
| `dist/random-key-manager-1.0.0-setup.exe` | Windows 安装包（可选安装目录、创建快捷方式） |
| `dist/random-key-manager-1.0.0-portable.exe` | 免安装单文件，双击即用 |
| `dist/random-key-manager-1.0.0-debug.apk` | 安卓调试安装包（Android 5.1+） |

APK 安装时需允许「安装未知来源应用」。数据保存在各自应用内（浏览器 WebView 的 localStorage），
跨设备同步使用「导出 JSON/CSV → 另一台设备批量导入」。

## 开发与构建

```bash
npm install          # 安装依赖

npm start            # 本地运行桌面客户端（开发模式）
npm run desktop:build        # 打包当前平台
npm run desktop:build:win    # 打包 Windows（NSIS + portable）

npm run icon                 # 重新生成桌面图标
node scripts/make-android-icons.js   # 重新生成安卓图标与启动图

npm run android:build        # 同步网页资源并编译 debug APK
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

需要 Node 18+、JDK 17/21、Android SDK（`ANDROID_HOME` 已配置，含 platform 34 与 build-tools）。
签名发布版时在 `android/app/build.gradle` 配置 `signingConfigs` 后用 `assembleRelease`。

## 功能

- 长度 15–20，可选 a-z / A-Z / 0-9 / `!@#$=+-_`，可选排除易混淆字符，`crypto.getRandomValues` 生成
- 命名保存、手动记录自有密钥、批量导入（文本 / CSV / JSON）、搜索、显示/隐藏、复制、删除、重命名
- 导出 JSON / CSV（桌面端导出时弹保存对话框）
