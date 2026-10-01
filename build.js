// 產生 index.html（本機雙擊開啟）與 dist/brewlab.html（內嵌 CSS/JS 的分享版）
const fs = require('fs');
const path = require('path');
const root = __dirname;
// Blender 匯出的模型（blender/brewers.py → models/brewers.glb）轉成 base64，讓 file:// 也能載入
const glb = path.join(root, 'models', 'brewers.glb');
if (fs.existsSync(glb)) {
  fs.writeFileSync(path.join(root, 'js', 'models.js'), '/* 由 build.js 從 models/brewers.glb 產生，請勿手改 */\nwindow.BREWER_GLB = "' + fs.readFileSync(glb).toString('base64') + '";\n');
}
const page = fs.readFileSync(path.join(root, 'page.html'), 'utf8');
const head = '<!doctype html>\n<html lang="zh-Hant">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
// file:// 不能載入外部 ES module，本機版也要把 module 內嵌
const localPage = page.replace(/<script type="module" src="(js\/[^"]+)"><\/script>/g, (m, p) => '<script type="module">\n' + fs.readFileSync(path.join(root, p), 'utf8') + '\n</script>');
fs.writeFileSync(path.join(root, 'index.html'), head + localPage + '\n</html>\n');

let inlined = page.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (m, p) => '<style>\n' + fs.readFileSync(path.join(root, p), 'utf8') + '\n</style>');
inlined = inlined.replace(/<script( type="module")? src="(js\/[^"]+)"><\/script>/g, (m, mod, p) => {
  const js = fs.readFileSync(path.join(root, p), 'utf8');
  if (js.includes('</script')) throw new Error(p + ' contains </script');
  return '<script' + (mod || '') + '>\n' + js + '\n</script>';
});
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'brewlab.html'), inlined);
console.log('index.html', fs.statSync(path.join(root, 'index.html')).size, 'dist/brewlab.html', fs.statSync(path.join(root, 'dist', 'brewlab.html')).size);
