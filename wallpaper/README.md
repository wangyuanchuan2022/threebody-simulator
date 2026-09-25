# 三体 · 地表观测站 / 交互式 Wallpaper Engine 壁纸

原项目：[wangyuanchuan2022/threebody-simulator](https://github.com/wangyuanchuan2022/threebody-simulator)。本次为[x1shang](https://github.com/x1shang)的功能扩展与 WE 打包，不改变原作者署名。2024版 `threebody.py` 是功能扩展的参考。

## 功能与交互

- **包含wangyuanchuan2022原版本的所有功能**，ie. 三颗恒星与地球的三维牛顿引力模拟、自适应 Velocity Verlet 积分；地表天空、飞星/太阳、云海、轨道图、温度与纪元记录;主画面拖动环顾，滚轮缩放视野；轨道图拖动旋转、滚轮缩放，面板标题点击折叠;空格暂停/继续，方向键转头；五档时间流速，新世界、重放种子、曝光/云量/画质等设置与网页一致。

- **新增** 浅色层叠远山贴图：灰蓝与灰褐岩脊随视角环顾，并融入昼夜光照和薄雾；保留原真实地形。贴图内嵌 HTML，离线可用。
- 壁纸默认缓慢自动环顾（约 0.006 rad/s，约 17.5 分钟一周），并小幅改变仰角，方便宿主无法拖动时浏览完整地形。网页默认关闭；「观测设置」可切换。手动拖动、方向键转头或滚轮操作后让出镜头 15 秒，暂停或 GM 开启时也停止自动环顾。
- 在画面上依次输入 **↑↓↑↓←→←→ab** 开启 GM，再次输入关闭。选择 α/β/γ/地球；方向键移动（每次 0.05 AU），WASD 调速度（每次 0.001 AU/天），Delete 删除。XY/XZ 切换第三轴；每次编辑自动暂停，空格继续。面板按钮提供同样的移动、调速与删除操作。关闭 GM 不自动恢复模拟。
- 删除恒星后不再施加引力、发光或触发碰撞；删除地球结束本轮。新世界恢复四个天体。GM 修改过的世界不作为可重放随机种子收藏。
- 未编辑世界达到 365 天，种子自动收藏到浏览器本地存储，同一种子去重。刷新后仍保留；隐私模式、清理站点数据或宿主禁止存储可能使缓存丢失。纪元记录面板可导出 `seeds.txt`。
- 存活 **超过 3650 天**，显示「恒纪元的梦，在第 N 号文明终于成为了现实！」，记录胜利，3 秒后自动开始下一轮，不受普通死亡的自动重启开关影响。若同一步触发毁灭，以毁灭为先。此条件指总存续天数，不要求连续恒纪元。

## 自动追加 seeds.txt

纯 HTML/WE 页面没有任意写本地文件权限。要自动落盘，运行随包提供的服务（Node.js 18+）：

```powershell
node seed-server.mjs
```

若当前目录已经是 `wallpaper` 或安装后的壁纸目录，运行 `node seed-server.mjs`。然后在网页/壁纸的「纪元记录」勾选「连接本地种子保存服务」。服务运行期间每 15 秒同步缓存，断开后保留缓存并在恢复连接时补写；每个种子只追加一次。文件位于 **服务脚本旁的 seeds.txt**，与终端当前目录无关。Ctrl+C 停止服务。服务仅监听 `127.0.0.1:18765`，仅接受本地文件页面来源的受校验种子数据，不接受文件路径。若宿主阻止本地请求，可在普通浏览器导出。导出是快照下载；持续追加由服务完成。

## 构建与目录

```powershell
node build.mjs
node wallpaper/build-wallpaper.mjs
```

`wallpaper/` 是可导入的完整 HTML 壁纸包，包含 `build-wallpaper.mjs`、`index.html`、`install.mjs`、`preview.jpg`、`protect.json`、`project.json`、`README.md`、`style.css`、`seed-server.mjs`。源码保留在仓库 `src/`，修改后重新构建。构建脚本需在完整仓库中使用；安装后的运行包无需源码或 Node.js（保存服务除外）。默认沿用原网页的地形设置，优先内嵌 `assets/terrain-2k.glb`，其次查找 `assets/terrain.glb` / `assets/terrain.stl`；均不存在时才使用程序化山脊。可用 `node wallpaper/build-wallpaper.mjs --terrain "模型路径.glb"` 显式选择模型，或 `--no-terrain` 使用程序化山脊。根网页也支持同样参数；分发自备地形前请确认其授权。

`project.json` 是 WE 实际识别的描述文件；`protect.json` 按本次交付文件清单保留为同内容副本，**不承担加密或版权保护功能**。壁纸 HTML 与普通网页使用同一份源码、样式和事件处理；壁纸仅额外注入宿主标志以默认启用自动环顾，不禁用输入。`?seed=42` 固定世界，`?speed=0..4` 选择速度。

## 安装到 Wallpaper Engine

1. 安装 Node.js 后，在仓库执行上面的构建命令。
2. 执行 `node wallpaper/install.mjs --we "D:\SteamLibrary\steamapps\common\wallpaper_engine"`，将示例路径替换为自己的 WE 目录；省略 `--we` 可搜索常见目录。
3. 脚本复制到 `projects/myprojects/threebody-observatory`，在 WE 本地壁纸库选择「三体 · 地表观测站」。更新时覆盖程序文件，保留已有 `seeds.txt`。
4. 也可在 WE 编辑器新建 Web 壁纸，选择本包 `index.html`，并将同目录样式和资源一起导入。

页面保留全部点击、拖动、滚轮和键盘逻辑；桌面是否转发输入受 WE、桌面图标及焦点设置影响。若键盘未送达，先用 WE 编辑器预览或普通浏览器启用 GM；WE 的输入转发需在你的安装环境实测，不能由网页绕过系统焦点。需要 WebGL2。没有将真实 WE 宿主运行与浏览器测试混为一谈。

官方参考：[创建 Web 壁纸](https://docs.wallpaperengine.io/en/web/first/gettingstarted.html)、[Web 壁纸调试](https://docs.wallpaperengine.io/en/web/debug/debug.html)。

## 版本历史

依据《三体模拟器-两代对比.md》整理，以下名称为功能阶段，不冒用上游发布版本号：

| 阶段 | 特性 |
| --- | --- |
| 第一代 Python 手写版（2024） | Pygame 二维模拟，GM 秘技、seed.txt 收藏（旧阈值约 100 秒）、胜利结局（旧阈值约 150 秒），一维天空条带 |
| 第二代网页地表观测站（2026） | 三维、明确物理单位、自适应积分、WebGL 地表天空、真实恒星目录、六类终结判定、种子重放；尚未公开 GM、收藏和胜利 |
| 本次贡献 | 恢复 GM 与胜利，收藏阈值改为 365 天、胜利改为超过 3650 天；缓存/导出/自动追加 seeds.txt；WE 与网页完整交互共用 |


