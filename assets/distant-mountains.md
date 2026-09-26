# 远山贴图

文件：`distant-mountains.png`，由内置 imagegen 生成，2172 × 724 PNG，保留透明天空与原始 alpha。

用于地平线远山背景，近景仍为原 GLB 地形。着色器根据观察方位映射贴图，镜像拼接闭合 360° 环景，使用当前光照与大气雾色融合；星空在山脊后遮挡。构建时内嵌到 HTML，无额外网络或外链文件依赖。

## 生成提示词

Use case: stylized-concept. Asset type: seamless panoramic distant mountain texture for a realtime three-body planet landscape. Create one very wide 3:1 landscape PNG with genuine transparent background above the mountain skyline (alpha, NOT checkerboard artwork). Mountain range occupies bottom 60 percent, transparent sky top 40 percent; solid mountain base reaches bottom edge. Elegant realistic weathered arid mountain ridges, low rolling folded hills interspersed with a few eroded pointed peaks, like a rocky barren terrestrial plateau, no dramatic alpine snow, no vertical karst pillars. Three receding overlapping ridge layers with atmospheric perspective. Pale desaturated slate blue, warm ash stone, misty grey-sage, subtly lighter than near black brown foreground terrain. Finely painted natural sedimentary detail, cinematic matte-painting quality, soft diffuse ambient lighting without directional sun shadows, restrained contrast, beautiful graceful irregular silhouette. No sky color, sun, stars, clouds, water, buildings, vegetation, text or borders. Left and right edges must tile seamlessly as a horizontal panorama, matching mountain height and color at both edges. Soft atmosphere within mountains but crisp clean alpha silhouette. Intended for a thin horizon belt, broad horizontal composition with varied low peaks, not a standalone framed painting.
