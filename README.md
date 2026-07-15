# Fluid Words

指で宇宙に言葉を書く Web アプリ。  
場所: `/Users/hayashiyoshi/Cursor/app/Fluid 001`

脳リフレクソとは別プロジェクト。Vanilla HTML / CSS / JS（バンドラなし）。

---

## どこからでも遊ぶ（iPhone）

公開 URL（GitHub Pages）:

**https://yosie-lab.github.io/Fluid-001/**

iPhone の Safari で上のリンクを開き、そのまま指で書けます。  
ホーム画面に追加すると、アプリのように全画面で開けます。

## 起動方法

```bash
cd "/Users/hayashiyoshi/Cursor/app/Fluid 001"
node server.js
```

| 端末 | URL |
|------|-----|
| Mac | http://localhost:8090 |
| iPhone（同一 Wi‑Fi） | ターミナルに表示される `http://192.168.x.x:8090` |

キャッシュが古いときは URL 末尾に `?v=23` などを付ける（`index.html` 内の版数）。

---

## ファイル構成

```
Fluid 001/
├── index.html       # 画面シェル（キャンバス・イントロ・設定・トースト）
├── styles.css       # 見た目・iOS 画面固定
├── server.js        # ローカル静的サーバー（ポート 8090）
├── README.md        # このまとめ
├── .gitignore
└── js/
    ├── main.js      # 全体の司令塔（入力・星・波紋・OCR連携・ビューポート）
    ├── fluid.js     # WebGL2 流体シミュレーション + bloom + 粒子表示
    ├── ink.js       # 筆跡キャプチャ + Tesseract.js OCR
    ├── positive.js  # ポジティブ語辞書・マッチ
    └── meteors.js   # 流れ星（背景 + バースト）
```

| ファイル | 役割 |
|----------|------|
| `main.js` | タッチ/マウス、筆跡プリセット、星・波紋、ポジティブお祝い、iPhone 画面ロック |
| `fluid.js` | Navier-Stokes 風の流体 + ブルーム + エネルギー粒子シェーダ |
| `ink.js` | 見えないキャンバスに筆跡を記録 → OCR |
| `positive.js` | 日英のポジティブ語リストと部分一致 |
| `meteors.js` | 自然な流れ星と、お祝い時の放射バースト |

---

## できること（機能一覧）

### 描画・宇宙演出

- **フルード筆跡** … 指でなぞると光の粒子が残る
- **星空** … 画面に星。ポジティブ語が増えると星も増える
- **宇宙波紋** … 約 7 秒ごとに自然発生。ブーストで頻度・回数アップ
- **流れ星** … 10〜40 秒ごとに背景流星。ポジティブ時は書いた位置から彩色バースト

### UI

- **イントロ** … 「Fluid Words」「指で気持ちを伝える」→ タップで開始
- **設定（右上）** … Color / Stroke
- **トースト** … ポジティブ語ヒット時に `✦ ありがとう` など表示

### カラーパレット

1. Nebula（シアン〜マゼンタ〜紫）※デフォルト  
2. Aurora（緑〜水色）  
3. Solar（黄〜オレンジ〜ピンク）  
4. Void（淡い紫〜水色）

### 筆跡設定（スライダー）

**太さ:** 細い ←→ 太い（超極細〜中太の範囲を連続調整）  
**消える時間:** 短い ←→ 長い（短め〜超長めの範囲を連続調整）  

デフォルトは 太さ 20% / 時間 80%。最後の設定は端末に保存され、次回起動時に引き継がれます。  

### ポジティブ語 → 宇宙がにぎやかになる

1. 指を離して約 1.2 秒後に OCR（Tesseract `jpn+eng`）
2. `positive.js` の辞書と部分一致
3. ヒットすると `celebratePositiveWord`：
   - `cosmosBoost` +1（最大 12）
   - ボーナス星
   - 書いた位置に波紋
   - 流れ星バースト（4〜10 本ほど）
   - トースト表示

例: ありがとう / 愛 / 希望 / love / hope / thanks / smile など（日英あわせて約 50 語）

---

## 操作の流れ

1. 画面を開く → イントロをタップ  
2. 指（またはマウス）で文字や線を書く  
3. 右上で色・筆跡を変えてもよい  
4. 「ありがとう」などを書くと、星・波紋・流れ星が増える  

---

## iPhone 向けの対策（ここまでで入れたもの）

なぞっていると画面が動く・閉じそうになる問題への対応:

- `html` / `body` を `position: fixed` + `overscroll-behavior: none`
- 全体 `touch-action: none`（設定パネル内だけ縦スクロール可）
- `visualViewport` で高さをロック、スクロール位置を常に先頭へ
- **指を離すまでキャンバス再サイズを保留**（描き中のズレ防止）
- ピンチズーム（`gesturestart` 等）をブロック
- `touchmove` で `preventDefault`

---

## 技術メモ

- **スタック** … バニラ HTML/CSS/JS、WebGL2、ES modules  
- **フォント** … Fraunces / Shippori Mincho（見出し）、Zen Maru Gothic / Nunito（UI）  
- **OCR** … CDN の Tesseract.js。初回は遅い。手書き認識は完璧ではない  
- **LAN** … Mac ファイアウォールで iPhone から届かないことがある。その場合は Cloudflare Tunnel 等を利用  
- **脳リフレクソ** … 波紋・流れ星の見た目の参考元。コードベースは別  

---

## フォルダの経緯（整理メモ）

| 場所 | 状態 |
|------|------|
| `Cursor/app/Fluid 001` | **正式な作業場所（いまここ）** |
| `Cursor/Fluid Words` | 一度作ったが、内容は Fluid 001 に統合済み |
| `AG app/脳リフレクソ` | 別アプリ。Fluid Words の親ではない |

Cursor で開くときは **`/Users/hayashiyoshi/Cursor/app/Fluid 001`** を Open Folder する。

---

## これから触るときの目安

| 変えたいこと | 見るファイル |
|--------------|--------------|
| 筆の太さ・消え方 | `main.js` のスライダー（`STROKE_WIDTH_STOPS` / `STROKE_FADE_STOPS`） |
| 色 | `main.js` の `PALETTES` |
| ポジティブ語の追加 | `js/positive.js` |
| 流れ星の多さ・見た目 | `js/meteors.js` |
| 流体の見た目 | `js/fluid.js` |
| 画面レイアウト・フォント | `index.html` / `styles.css` |
| iPhone の揺れ | `main.js` の viewport / scroll lock、`styles.css` |

---

*最終まとめ: 2026-07-14 時点の Fluid Words*
