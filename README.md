# 咖啡沖煮模擬館 Brew Lab

選豆子、處理法、烘焙度與沖煮法，模擬萃取過程並學習咖啡沖煮理論，收錄歷屆世界冠軍配方。

- 理論 12 章、16 種沖煮法、15 支產區豆、8 種處理法、16 份冠軍與名人配方
- 萃取引擎：三池動力學（酸／糖／苦）＋分層滲流，係數以公開配方校準
- 沖煮檯 3D 器具：Blender 程式建模、three.js 即時顯示；不支援 WebGL 時退回 SVG

## 使用

直接用瀏覽器開 `index.html`。

## 建置

```sh
node build.js
```

產生 `index.html`（本機用）與 `dist/brewlab.html`（CSS／JS 全部內嵌的發布版），並把 `models/brewers.glb` 轉成 `js/models.js`。

## 3D 模型

```sh
blender -b --factory-startup -P blender/brewers.py -- --render --export --sheet
```

- `--export`：輸出 `models/brewers.glb`
- `--render`：輸出圖鑑用的 `img/gear/<器具>.webp`
- `--sheet`：輸出總覽檢查圖 `blender/sheet.png`
- `--only cone,chemex`：只處理指定器具

`blender/brewers.blend` 是腳本產生的場景檔，可以直接用 Blender 打開查看或手動修改（重新執行腳本會覆蓋）。

目前有 3D 模型的器具：V60（cone）、Chemex、虹吸壺（siphon）。

## 檔案

| 路徑 | 內容 |
| --- | --- |
| `page.html` | 頁面本體（不含 doctype 的片段） |
| `css/style.css` | 樣式，淺色／深色主題 |
| `js/data.js` | 豆子、處理法、沖煮法、配方資料 |
| `js/engine.js` | 萃取模擬引擎 |
| `js/brew.js` | 設定轉引擎參數、風味與建議 |
| `js/draw.js` | 器具 SVG 插圖 |
| `js/stage3d.js` | 3D 沖煮檯（three.js） |
| `js/charts.js` | 圖表 |
| `js/ui.js` | 介面 |
| `blender/brewers.py` | Blender 建模腳本 |

模擬結果來自簡化模型，適合用來理解趨勢，不能取代實際量測。照片為 AI 生成，僅作氛圍示意。
