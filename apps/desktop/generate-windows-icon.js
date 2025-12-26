const { default: pngToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 64, 128, 256];
const iconDir = path.join(__dirname, 'resources', 'icons');
const outputPath = path.join(__dirname, 'resources', 'icon.ico');

const pngFiles = sizes.map(size => path.join(iconDir, `${size}x${size}.png`));

pngToIco(pngFiles)
  .then(buf => {
    fs.writeFileSync(outputPath, buf);
    console.log('✅ Windows icon created at:', outputPath);
  })
  .catch(err => {
    console.error('❌ Error creating icon:', err);
    process.exit(1);
  });
