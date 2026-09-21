<!-- 把下载好的地形模型放到本目录，命名为 terrain.glb，然后执行 node build.mjs 即可嵌入单文件 index.html。 -->

# assets —— 可选的真实地形模型

在此放入 `terrain.glb`，再运行 `node build.mjs`，模型会被 base64 内联进单文件 `index.html`（页面仍可双击直开、完全离线）。

下载要求：

- 格式 **.glb**，贴图**内嵌**（embedded）；不要选 .gltf + 外部贴图目录的版本。
- **不要 Draco / KTX2 压缩**（本项目未内联对应解码器，会加载失败）。
- 许可建议 CC0 或 CC-BY；单文件建议 ≤ 30 MB（会以 base64 形式放大 ~33%）。

也可以不放在这里，直接用参数指定路径：

```
node build.mjs --terrain D:\downloads\mountain.glb --out index.html
```

模型会被自动缩放（默认跨度 11 km）、底面贴合水面、水平居中于观测点附近；这些参数在 `src/app.mjs` 顶部的 `TERRAIN` 常量里。已嵌入模型时，着色器的程序化山脊自动关闭，改由真实网格 + 三盏恒星平行光照明。
