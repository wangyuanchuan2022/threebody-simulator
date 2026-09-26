import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const passthrough = process.argv.slice(2);

fs.mkdirSync(here, { recursive: true });
const target = path.join(here, 'index.html');

execFileSync(process.execPath, ['build.mjs', ...passthrough, '--out', target], { cwd: root, stdio: 'inherit' });
// Only selects the default camera behaviour and the wallpaper-only framing below;
// all input handlers remain enabled.
const html = fs.readFileSync(target, 'utf8');
if (!html.includes('<body>')) throw new Error('Build output is missing <body>');
// On the desktop the era readout sits at 5vw, right under the icon column. A wallpaper
// moves it out to a third of the width. This is injected here rather than added to
// style.css on purpose: style.css is shared by index.html and docs/index.html, and all
// three files must keep rendering the plain page identically. The min-width guard
// leaves the upstream narrow-screen layout (left: 18px) alone.
const hostStyle = '  <style>@media(min-width:801px){.hud .overview{left:33.333vw}}</style>';
fs.writeFileSync(target, html.replace('<body>',
  '<body>\n  <script>window.__THREEBODY_WALLPAPER__ = true;</script>\n' + hostStyle));

// style.css stays an external file in the upstream build, so the host needs its own
// copy sitting next to index.html.
fs.copyFileSync(path.join(root, 'style.css'), path.join(here, 'style.css'));

const project = {
  contentrating: 'Everyone',
  description: '《三体》地表观测站：三颗恒星与一颗行星在牛顿引力下实时演化，主画面是站在北纬 25° 海岸仰望的天空 —— 大气散射、云层、海面、远山，全部由 WebGL2 实时着色器绘制。恒星远离时只是飞星，接近时骤胀成巨日。文明毁灭后自动开启下一纪元。\n\n完整保留网页点击、拖动、滚轮缩放与 GM 编辑交互。原始程序：github.com/wangyuanchuan2022/threebody-simulator。',
  file: 'index.html',
  general: {
    properties: {
      schemecolor: { order: 0, text: 'ui_browse_properties_scheme_color', type: 'color', value: '0.02 0.06 0.09' }
    },
    supportsaudioprocessing: false
  },
  preview: 'preview.jpg',
  ratingsex: 'none',
  ratingviolence: 'none',
  tags: ['Space'],
  title: '三体 · 地表观测站',
  type: 'Web',
  version: 1,
  visibility: 'private'
};
fs.writeFileSync(path.join(here, 'project.json'), JSON.stringify(project, null, '\t') + '\n');
console.log('[WALLPAPER] project.json written');
console.log('[WALLPAPER] index.html ' + (fs.statSync(target).size / 1048576).toFixed(1) + ' MB');

fs.copyFileSync(path.join(here, 'project.json'), path.join(here, 'protect.json'));
