// 生成 build/icon.png(512) 与 build/icon.ico，供 Electron 打包与安卓工程使用
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'build', 'icon.svg');
const pngPath = path.join(root, 'build', 'icon.png');
const icoPath = path.join(root, 'build', 'icon.ico');

async function main() {
  const svg = fs.readFileSync(svgPath);
  await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(pngPath);
  await sharp(svg, { density: 384 }).resize(1024, 1024).png().toFile(pngPath.replace('icon.png', 'icon@2x.png'));

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(
    sizes.map(size => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer())
  );
  const ico = await pngToIco(buffers);
  fs.writeFileSync(icoPath, ico);

  console.log('icons written:', pngPath, icoPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
