// 生成安卓各密度启动图标与启动画面，保持与桌面端一致的视觉
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'));

const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const SPLASH = {
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280]
};

// 前景层：透明背景，图形缩到中间安全区，适配自适应图标
function foregroundSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 432 432">
    <g transform="translate(108 108) scale(0.4219)">
      <rect width="512" height="512" rx="112" fill="#171a23"/>
      <circle cx="256" cy="228" r="118" fill="none" stroke="#4f8cff" stroke-width="34"
              stroke-linecap="round" stroke-dasharray="556 186" transform="rotate(-45 256 228)"/>
      <rect x="222" y="196" width="68" height="128" rx="20" fill="#33d69f"/>
      <circle cx="256" cy="228" r="13" fill="#0f1117"/>
      <rect x="248" y="228" width="16" height="52" rx="8" fill="#0f1117"/>
    </g>
  </svg>`;
}

async function main() {
  for (const [density, size] of Object.entries(LAUNCHER)) {
    const dir = path.join(res, 'mipmap-' + density);
    fs.mkdirSync(dir, { recursive: true });
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path.join(dir, 'ic_launcher.png'));
    // 圆形图标：用椭圆遮罩
    const roundMask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
    );
    const base = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    await sharp(base).composite([{ input: roundMask, blend: 'dest-in' }]).png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));
  }

  for (const [density, size] of Object.entries(FOREGROUND)) {
    const dir = path.join(res, 'mipmap-' + density);
    fs.mkdirSync(dir, { recursive: true });
    await sharp(Buffer.from(foregroundSvg()), { density: 384 }).resize(size, size).png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }

  for (const [dirName, [w, h]] of Object.entries(SPLASH)) {
    const dir = path.join(res, dirName);
    fs.mkdirSync(dir, { recursive: true });
    const logo = await sharp(svg, { density: 384 }).resize(160, 160).png().toBuffer();
    await sharp({
      create: { width: w, height: h, channels: 4, background: '#0f1117' }
    }).composite([{ input: logo, gravity: 'center' }]).png()
      .toFile(path.join(dir, 'splash.png'));
  }

  console.log('android icons + splash generated');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
