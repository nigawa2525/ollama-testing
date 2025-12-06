# LLMによる画像判定のサンプル - Playwright + Ollama

このリポジトリは、PlaywrightとOllamaを使用して、LLM（大規模言語モデル）による画像判定を実装したサンプルプロジェクトです。

Yahoo! JAPANのトップページをスクリーンショットで撮影し、Ollamaのビジョン言語モデル（qwen3-vl:8b）を使用して、ページの表示内容をAIで検証するテストを実装しています。

## 特徴

- **Playwright**: ブラウザ自動化とスクリーンショット取得
- **Ollama**: ローカルで動作するLLM（qwen3-vl:8bモデルを使用）
- **画像判定**: スクリーンショットとHTMLを組み合わせたAI検証
- **TypeScript**: 型安全なテストコード

## 前提条件

- Node.js (v18以上推奨)
- Ollamaがインストールされ、起動していること
- `qwen3-vl:8b`モデルがインストールされていること

### Ollamaのセットアップ

```bash
# Ollamaをインストール（未インストールの場合）
# https://ollama.ai/ からインストール

# qwen3-vl:8bモデルをインストール
ollama pull qwen3-vl:8b
```

## インストール

```bash
# 依存関係のインストール
npm install

# Playwrightブラウザのインストール
npx playwright install
```

## 使用方法

### すべてのテストを実行

```bash
npm test
```

### 特定のテストを実行

```bash
npm run verify-yahoo
```

## テスト内容

### 成功するテスト

1. **Yahoo! JAPANのトップページをAIで検証**
   - 検索バー、ロゴ、ニュース、レイアウトの正常性を検証

### 失敗するテスト（サンプル）

2. **天気情報ウィジェットの検証**
   - 天気情報ウィジェットが表示されているか検証（通常は表示されないため失敗）

3. **株価情報セクションの検証**
   - 株価情報セクションが表示されているか検証（通常は表示されないため失敗）

4. **スポーツニュースセクションの検証**
   - 最初のビューポートにスポーツニュースセクションが表示されているか検証（画面下部にある可能性があるため失敗）

## プロジェクト構成

```
.
├── verify-yahoo.spec.ts    # メインのテストファイル
├── playwright.config.ts    # Playwright設定
├── tsconfig.json           # TypeScript設定
├── package.json           # 依存関係とスクリプト
└── README.md              # このファイル
```

## 技術スタック

- **Playwright**: ブラウザ自動化フレームワーク
- **Ollama**: ローカルLLM実行環境
- **TypeScript**: 型安全な開発
- **Cheerio**: HTMLパーシングとクリーニング

## ライセンス

ISC

## 参考資料

- [Playwright公式ドキュメント](https://playwright.dev/)
- [Ollama公式ドキュメント](https://ollama.ai/)
- [qwen3-vlモデル](https://ollama.ai/library/qwen3-vl)

