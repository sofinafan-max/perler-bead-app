# 拼豆图纸生成器 - CLAUDE.md

## 项目概述
基于 MARD 221色拼豆色卡的图纸生成器，纯前端应用（HTML/CSS/JS），无构建工具。

## 仓库信息
- **GitHub**: https://github.com/sofinafan-max/perler-bead-app
- **分支**: main
- **部署**: GitHub Pages（已配置工作流）

## 版本历史
| 版本 | Tag | 说明 |
|------|-----|------|
| v1.0 | `v1.0` | 初始版本 - MARD 221色版拼豆图纸生成器 |
| v1.1 | `v1.1` | 效果图改用压缩原图像素色 + 保存历史飞行动画 |

## 文件结构
```
index.html        - 页面结构（三个 tab：生成图纸/历史记录/我的作品）
app.js            - 主逻辑（图像处理、方案生成、历史管理、动画）
style.css         - 样式（iOS 风格，底部 tab bar，毛玻璃效果）
perler-colors.js  - MARD 221色色卡数据 + LAB 色彩空间匹配算法
```

## 核心架构

### 图像处理流水线
1. 上传图片 → `handleImageFile()`
2. 压缩预览 → 按最长边像素数缩放（默认58），`imageSmoothingEnabled=false` 像素化
3. 生成方案 → `generateVariants()` 生成10种参数组合，取 top 5 展示
4. 每种方案 → `imageToPattern()`: 预处理(对比度/锐化) → 降采样 → Floyd-Steinberg 抖动 → LAB 色彩匹配

### 关键函数
| 函数 | 文件 | 作用 |
|------|------|------|
| `downsampleImage()` | app.js | 图片降采样为像素网格，返回原始 RGB |
| `imageToPattern()` | app.js | 生成拼豆图纸，返回 `{grid, pixels, summary, ...}` |
| `patternToThumbnail()` | app.js | 生成缩略图（使用原始像素色，fallback 到匹配色） |
| `renderPattern()` | app.js | 渲染详细图纸视图（原始像素色背景 + MARD 色号） |
| `exportPattern()` | app.js | 导出 PNG（原始像素色背景 + 色号 + 颜色用量统计） |
| `findNearestColor()` | perler-colors.js | LAB 色彩空间最近邻匹配 |
| `flyToHistoryAnimation()` | app.js | 保存到历史的飞行动画 |

### 数据存储
- `localStorage('perler_history')` — 历史记录（不含 pixels 数据以节省空间）
- `localStorage('perler_gallery')` — 我的作品
- `localStorage('perler_scoring')` — 评分历史（用于自适应参数优化，保留最近50条）

## 设计决策记录

### v1.1 决策
- **效果图使用原始像素色**：所有缩略图和详细视图统一使用压缩后的原始像素色作为背景（而非拼豆匹配色），每个格子叠加 MARD 色号文字。这样效果图更接近原图视觉效果。
- **历史记录不存 pixels**：`saveToHistory()` 时用解构去掉 pixels 字段，查看历史时 fallback 到 `grid[y][x].hex` 匹配色。
- **飞行动画替代 alert**：保存到历史时，缩略图从"保存"按钮沿贝塞尔曲线飞向历史 tab，到达后 tab 按钮脉冲高亮。

## 注意事项
- 色卡为 MARD 品牌 221 色，色号格式为字母+数字（A1-M15），分8大系列
- `textColorForRgb(r,g,b)` 用于原始像素色背景的文字对比度，`textColorFor(hex)` 用于 hex 色值
- 自适应参数优化：评分系统会根据用户打分调整后续生成的参数预设
