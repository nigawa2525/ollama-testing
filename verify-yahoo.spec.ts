import { test, expect } from '@playwright/test';
import ollama from 'ollama';
import * as cheerio from 'cheerio';

/**
 * HTMLの軽量化処理
 * Yahoo! JAPANはDOMが非常に大きいため、この処理が特に重要です。
 */
function cleanHtml(rawHtml: string): string {
  const $ = cheerio.load(rawHtml);
  
  // ノイズ除去
  $('script, style, noscript, svg, link, meta, iframe').remove();
  
  // コメント除去
  $('*').contents().filter(function() {
      return this.type === 'comment';
  }).remove();
  
  // 広告等の不要なラッパーを除去してメインコンテンツにフォーカスしやすくする（任意）
  // Yahooの場合は header, main, footer 構造がしっかりしていればそのままでも可
  const bodyContent = $('body').html() || '';
  
  // 連続する空白を削除
  return bodyContent.replace(/\s+/g, ' ').trim();
}

/**
 * Ollamaへのリクエストをリトライ付きで実行
 * Ollamaの動作が不安定な場合に備えてリトライロジックを追加
 */
async function callOllamaWithRetry(
  modelName: string,
  messages: any[],
  maxRetries: number = 3,
  retryDelay: number = 5000
): Promise<any> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Ollamaリクエスト試行 ${attempt}/${maxRetries}...`);
      
      // リクエスト開始時刻を記録
      const startTime = Date.now();
      
      const response = await ollama.chat({
        model: modelName,
        messages: messages,
        options: {
          // タイムアウトを長めに設定
          num_ctx: 4096,
        }
      });
      
      // レスポンス受信時刻を記録
      const endTime = Date.now();
      const duration = endTime - startTime;
      const durationSeconds = (duration / 1000).toFixed(2);
      
      console.log(`Ollamaリクエスト成功 (試行 ${attempt})`);
      console.log(`レスポンス受信までの時間: ${durationSeconds}秒 (${duration}ms)`);
      
      return response;
    } catch (error: any) {
      lastError = error;
      console.error(`Ollamaリクエスト失敗 (試行 ${attempt}/${maxRetries}):`, error.message);
      
      if (attempt < maxRetries) {
        console.log(`${retryDelay / 1000}秒後にリトライします...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        // リトライ時に待機時間を少し増やす
        retryDelay = Math.min(retryDelay * 1.5, 30000);
      }
    }
  }
  
  throw new Error(`Ollamaリクエストが${maxRetries}回失敗しました。最後のエラー: ${lastError?.message}`);
}

test('Yahoo! JAPANのトップページをAIで検証', async ({ page }) => {
  // AI処理に時間がかかるため、このテストのタイムアウトを3分に設定
  test.setTimeout(3 * 60 * 1000);
  const targetUrl = 'https://www.yahoo.co.jp/';
  
  // 指定されたモデル
  const modelName = 'qwen3-vl:8b';
  
  console.log(`Testing URL: ${targetUrl}`);
  console.log(`Using Model: ${modelName}`);
  
  // 1. Yahoo! JAPANにアクセス
  // Yahooは非同期読み込みが多いため、networkidleまで待機
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  
  // 2. HTML取得とクリーニング
  const rawHtml = await page.content();
  const cleanedHtml = cleanHtml(rawHtml);
  console.log(`Cleaned HTML length: ${cleanedHtml.length} characters`);
  
  // 3. スクリーンショット取得
  const screenshotBuffer = await page.screenshot({ fullPage: false });
  
  // 4. Qwen-VLに検証を依頼
  console.log('Sending to Ollama...');
  const prompt = `
    あなたはWebサイトの品質保証(QA)の専門家です。
    提供された「スクリーンショット」と「HTML構造」をもとに、
    Yahoo! JAPANのトップページが正常に表示されているか検証してください。
    
    ## チェックポイント:
    1. **検索バー**: 画面上部に目立つ検索窓が存在するか。
    2. **ロゴ**: "Yahoo! JAPAN"のロゴが表示されているか。
    3. **ニュース**: メインエリアにニュースのトピックス一覧が表示されているか。
    4. **レイアウト**: 画面が真っ白だったり、要素が大きく崩れて重なったりしていないか。
    
    ## 回答フォーマット:
    結果: [PASS] または [FAIL]
    理由: (簡潔な説明)
  `;
  
  const response = await callOllamaWithRetry(
    modelName,
    [{
      role: 'user',
      content: `
        ${prompt}
        
        ## HTML Context (Partial):
        \`\`\`html
        ${cleanedHtml.substring(0, 10000)}
        \`\`\`
      `,
      images: [screenshotBuffer]
    }],
    3, // 最大3回リトライ
    5000 // 初回リトライ待機時間5秒
  );
  
  console.log('\n=============================================');
  console.log('            AI Verification Result           ');
  console.log('=============================================');
  console.log(response.message.content);
  console.log('=============================================\n');
  
  // 検証結果をチェック
  const result = response.message.content;
  const isPass = result.includes('[PASS]');
  
  // テスト結果をアサート
  expect(isPass).toBe(true);
});

test('Yahoo! JAPANページで天気情報ウィジェットが表示されているか検証（失敗ケース）', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  const targetUrl = 'https://www.yahoo.co.jp/';
  const modelName = 'qwen3-vl:8b';
  
  console.log(`Testing URL: ${targetUrl}`);
  console.log(`Using Model: ${modelName}`);
  console.log('検証内容: 天気情報ウィジェットの表示確認（通常は表示されないため失敗を期待）');
  
  // 1. Yahoo! JAPANにアクセス
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  
  // 2. HTML取得とクリーニング
  const rawHtml = await page.content();
  const cleanedHtml = cleanHtml(rawHtml);
  console.log(`Cleaned HTML length: ${cleanedHtml.length} characters`);
  
  // 3. スクリーンショット取得
  const screenshotBuffer = await page.screenshot({ fullPage: false });
  
  // 4. Qwen-VLに検証を依頼
  console.log('Sending to Ollama...');
  const prompt = `
    あなたはWebサイトの品質保証(QA)の専門家です。
    提供された「スクリーンショット」と「HTML構造」をもとに、
    Yahoo! JAPANのトップページに「天気情報ウィジェット」が明確に表示されているか検証してください。
    
    ## チェックポイント:
    1. **天気情報ウィジェット**: 画面上部またはメインエリアに、現在の天気（気温、天候アイコンなど）を表示するウィジェットが存在するか。
    2. **天気アイコン**: 天候を表すアイコン（晴れ、曇り、雨など）が表示されているか。
    3. **気温表示**: 現在の気温が数値で表示されているか。
    
    ## 注意:
    天気情報ウィジェットは通常、Yahoo! JAPANのトップページの特定の位置に表示されますが、
    レイアウトやコンテンツの変更により表示されない場合があります。
    
    ## 回答フォーマット:
    結果: [PASS] または [FAIL]
    理由: (簡潔な説明)
  `;
  
  const response = await callOllamaWithRetry(
    modelName,
    [{
      role: 'user',
      content: `
        ${prompt}
        
        ## HTML Context (Partial):
        \`\`\`html
        ${cleanedHtml.substring(0, 10000)}
        \`\`\`
      `,
      images: [screenshotBuffer]
    }],
    3, // 最大3回リトライ
    5000 // 初回リトライ待機時間5秒
  );
  
  console.log('\n=============================================');
  console.log('            AI Verification Result           ');
  console.log('=============================================');
  console.log(response.message.content);
  console.log('=============================================\n');
  
  // 検証結果をチェック（このテストは失敗することを期待）
  const result = response.message.content;
  const isPass = result.includes('[PASS]');
  
  // このテストは失敗することを期待（天気情報ウィジェットが表示されていない可能性が高いため）
  expect(isPass).toBe(false); // AIが[FAIL]を返すことを期待
});

test('Yahoo! JAPANページで株価情報セクションが表示されているか検証（失敗ケース）', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  const targetUrl = 'https://www.yahoo.co.jp/';
  const modelName = 'qwen3-vl:8b';
  
  console.log(`Testing URL: ${targetUrl}`);
  console.log(`Using Model: ${modelName}`);
  console.log('検証内容: 株価情報セクションの表示確認（通常は表示されないため失敗を期待）');
  
  // 1. Yahoo! JAPANにアクセス
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  
  // 2. HTML取得とクリーニング
  const rawHtml = await page.content();
  const cleanedHtml = cleanHtml(rawHtml);
  console.log(`Cleaned HTML length: ${cleanedHtml.length} characters`);
  
  // 3. スクリーンショット取得
  const screenshotBuffer = await page.screenshot({ fullPage: false });
  
  // 4. Qwen-VLに検証を依頼
  console.log('Sending to Ollama...');
  const prompt = `
    あなたはWebサイトの品質保証(QA)の専門家です。
    提供された「スクリーンショット」と「HTML構造」をもとに、
    Yahoo! JAPANのトップページに「株価情報セクション」が明確に表示されているか検証してください。
    
    ## チェックポイント:
    1. **株価情報セクション**: メインエリアに、日経平均やTOPIXなどの株価指数を表示するセクションが存在するか。
    2. **株価数値**: 株価の数値（例：38,000円、2,500ポイントなど）が表示されているか。
    3. **株価チャート**: 株価の変動を示すチャートやグラフが表示されているか。
    
    ## 注意:
    株価情報セクションは通常、Yahoo! JAPANのトップページの特定の位置に表示されますが、
    レイアウトやコンテンツの変更により表示されない場合があります。
    
    ## 回答フォーマット:
    結果: [PASS] または [FAIL]
    理由: (簡潔な説明)
  `;
  
  const response = await callOllamaWithRetry(
    modelName,
    [{
      role: 'user',
      content: `
        ${prompt}
        
        ## HTML Context (Partial):
        \`\`\`html
        ${cleanedHtml.substring(0, 10000)}
        \`\`\`
      `,
      images: [screenshotBuffer]
    }],
    3, // 最大3回リトライ
    5000 // 初回リトライ待機時間5秒
  );
  
  console.log('\n=============================================');
  console.log('            AI Verification Result           ');
  console.log('=============================================');
  console.log(response.message.content);
  console.log('=============================================\n');
  
  // 検証結果をチェック（このテストは失敗することを期待）
  const result = response.message.content;
  const isPass = result.includes('[PASS]');
  
  // このテストは失敗することを期待（株価情報セクションが表示されていない可能性が高いため）
  expect(isPass).toBe(false); // AIが[FAIL]を返すことを期待
});

test('Yahoo! JAPANページでスポーツニュースセクションが表示されているか検証（失敗ケース）', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  const targetUrl = 'https://www.yahoo.co.jp/';
  const modelName = 'qwen3-vl:8b';
  
  console.log(`Testing URL: ${targetUrl}`);
  console.log(`Using Model: ${modelName}`);
  console.log('検証内容: スポーツニュースセクションの表示確認（表示位置により失敗する可能性あり）');
  
  // 1. Yahoo! JAPANにアクセス
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  
  // 2. HTML取得とクリーニング
  const rawHtml = await page.content();
  const cleanedHtml = cleanHtml(rawHtml);
  console.log(`Cleaned HTML length: ${cleanedHtml.length} characters`);
  
  // 3. スクリーンショット取得（最初のビューポートのみ）
  const screenshotBuffer = await page.screenshot({ fullPage: false });
  
  // 4. Qwen-VLに検証を依頼
  console.log('Sending to Ollama...');
  const prompt = `
    あなたはWebサイトの品質保証(QA)の専門家です。
    提供された「スクリーンショット」と「HTML構造」をもとに、
    Yahoo! JAPANのトップページの「最初に表示される画面（ビューポート）」に「スポーツニュースセクション」が明確に表示されているか検証してください。
    
    ## チェックポイント:
    1. **スポーツニュースセクション**: スクリーンショット内（最初に表示される画面）に、スポーツ関連のニュースを表示するセクションが存在するか。
    2. **スポーツ記事**: 野球、サッカー、その他のスポーツに関する記事の見出しや画像が表示されているか。
    3. **スポーツカテゴリ**: 「スポーツ」というカテゴリ名やタブが表示されているか。
    
    ## 注意:
    スクリーンショットは最初に表示される画面（ビューポート）のみを撮影しています。
    スポーツニュースセクションが画面下部にある場合は、スクリーンショットに含まれない可能性があります。
    
    ## 回答フォーマット:
    結果: [PASS] または [FAIL]
    理由: (簡潔な説明)
  `;
  
  const response = await callOllamaWithRetry(
    modelName,
    [{
      role: 'user',
      content: `
        ${prompt}
        
        ## HTML Context (Partial):
        \`\`\`html
        ${cleanedHtml.substring(0, 10000)}
        \`\`\`
      `,
      images: [screenshotBuffer]
    }],
    3, // 最大3回リトライ
    5000 // 初回リトライ待機時間5秒
  );
  
  console.log('\n=============================================');
  console.log('            AI Verification Result           ');
  console.log('=============================================');
  console.log(response.message.content);
  console.log('=============================================\n');
  
  // 検証結果をチェック（このテストは失敗することを期待）
  const result = response.message.content;
  const isPass = result.includes('[PASS]');
  
  // このテストは失敗することを期待（スポーツニュースセクションが最初のビューポートに表示されていない可能性が高いため）
  expect(isPass).toBe(false); // AIが[FAIL]を返すことを期待
});

