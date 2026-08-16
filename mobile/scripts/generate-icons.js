const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const src =
  'C:/Users/ADMIN/.cursor/projects/c-Users-ADMIN-Documents-VSCODE-StudyBuddy/assets/c__Users_ADMIN_AppData_Roaming_Cursor_User_workspaceStorage_dc543e486f00c182e6302b7482490b2b_images_studybuddy-logo-dc4ed6d8-0ac4-43a4-a44c-060e8e3cfc1a.png';
const assets = path.join(__dirname, '..', 'assets');

function isBackdrop(r, g, b) {
  const avg = (r + g + b) / 3;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return spread <= 22 && avg >= 120 && avg <= 255;
}

(async () => {
  const { data, info } = await sharp(src)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 20 || isBackdrop(r, g, b)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const pad = 2;
  minX = Math.max(0, minX + pad);
  minY = Math.max(0, minY + pad);
  maxX = Math.min(width - 1, maxX - pad);
  maxY = Math.min(height - 1, maxY - pad);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  console.log('crop', { minX, minY, cropW, cropH });

  // Full-bleed 1024 icon (OS applies the rounded mask)
  const master = await sharp(src)
    .extract({ left: minX, top: minY, width: cropW, height: cropH })
    .resize(1024, 1024, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  await sharp(master).toFile(path.join(assets, 'icon.png'));
  await sharp(master).toFile(path.join(assets, 'splash-icon.png'));
  await sharp(master).toFile(path.join(assets, 'android-icon-foreground.png'));

  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: { r: 79, g: 163, b: 227 },
    },
  })
    .png()
    .toFile(path.join(assets, 'android-icon-background.png'));

  await sharp(master)
    .resize(48, 48, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(path.join(assets, 'favicon.png'));

  fs.copyFileSync(src, path.join(assets, 'studybuddy-logo.png'));
  console.log('done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
