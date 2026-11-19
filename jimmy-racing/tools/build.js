// Bundles every source file into one self-contained HTML (dist/jimmy-racing.html)
const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
const files = ['core/util', 'core/track', 'core/vehicle', 'core/obstacles', 'core/items', 'core/ai', 'core/sim', 'core/netproto', 'core/levels', 'render/gl', 'render/shaders', 'render/env', 'render/textures', 'render/renderer', 'render/world', 'render/features', 'render/cars_gfx', 'render/obstacles_gfx', 'render/items_gfx', 'render/fx', 'render/debris_gfx', 'game/camera', 'game/net', 'game/audio', 'game/ui', 'game/game', 'game/online'];
let js = files.map(f => '/* ==== ' + f + ' ==== */\n' + fs.readFileSync(path.join(root, 'src', f + '.js'), 'utf8').replace(/<\/script/gi, '<\\/script')).join('\n');
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8').replace('/*SCRIPTS*/', () => js);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/jimmy-racing.html'), html);
console.log('dist/jimmy-racing.html', (html.length / 1024).toFixed(0) + ' KB');
