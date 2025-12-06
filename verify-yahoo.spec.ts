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
    Yahoo! JAPANのトップページを「定量評価」と「定性評価」の2つの観点から検証してください。
    
    ## 1. 定量評価（Quantitative）：事実のチェック
    HTMLデータに基づき、要素の存在の有無や形式の正確さを確認してください。
    
    ### 要素の存在:
    - **検索窓**: 画面上部に検索窓が視覚的に存在するか
    - **ロゴ**: "Yahoo! JAPAN"のロゴが表示されているか
    - **ニュース**: メインエリアにニュースのトピックス一覧が表示されているか
    
    ### 禁止事項:
    - **画像読み込みエラー**: 画像が読み込めずエラー表示されていないか
    - **開発者向けエラーコード**: 開発者向けのエラーメッセージやデバッグ情報が表示されていないか
    
    ## 2. 定性評価（Qualitative）：UX・感覚のチェック
    スクリーンショット（画像データ）を基に、人間のQAエンジニアに近い判断をしてください。
    
    ### レイアウト:
    - **要素の重なり**: 要素が重なっていないか
    - **余白**: 余白が不自然ではないか
    
    ### 視認性:
    - **コントラスト**: 文字と背景のコントラストは読みやすいか
    
    ### トーン＆マナー:
    - **エラーメッセージ**: エラーメッセージは丁寧な表現になっているか（エラーがある場合）
    
    ## 重要: 回答フォーマット
    必ず以下のJSON形式のみで回答してください。他の説明は不要です。
    
    {
      "result": "PASS" | "FAIL",
      "quantitative": {
        "searchBar": boolean,
        "logo": boolean,
        "news": boolean,
        "imageErrors": boolean,
        "developerErrors": boolean
      },
      "qualitative": {
        "layout": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD",
        "readability": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD",
        "toneAndManner": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD"
      },
      "reason": "string"
    }
    
    例:
    {
      "result": "PASS",
      "quantitative": {
        "searchBar": true,
        "logo": true,
        "news": true,
        "imageErrors": false,
        "developerErrors": false
      },
      "qualitative": {
        "layout": "GOOD",
        "readability": "GOOD",
        "toneAndManner": "GOOD"
      },
      "reason": "すべての定量評価項目をクリアし、定性評価も良好です。"
    }
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
  
  // 検証結果をチェック（JSON形式をパース）
  const content = response.message.content;
  let isPass = false;
  let parsedResult: {
    result: string;
    quantitative?: {
      searchBar?: boolean;
      logo?: boolean;
      news?: boolean;
      imageErrors?: boolean;
      developerErrors?: boolean;
    };
    qualitative?: {
      layout?: string;
      readability?: string;
      toneAndManner?: string;
    };
    reason?: string;
  } | null = null;
  
  try {
    // JSON形式のレスポンスを抽出（コードブロックや余分なテキストを除去）
    const jsonMatch = content.match(/\{[\s\S]*"result"[\s\S]*\}/);
    if (jsonMatch) {
      parsedResult = JSON.parse(jsonMatch[0]);
      if (parsedResult) {
        isPass = parsedResult.result === 'PASS';
        console.log(`\n解析結果: ${parsedResult.result}`);
        
        // 定量評価の結果を表示
        if (parsedResult.quantitative) {
          console.log('\n【定量評価】');
          console.log(`  検索窓: ${parsedResult.quantitative.searchBar ? '✓' : '✗'}`);
          console.log(`  ロゴ: ${parsedResult.quantitative.logo ? '✓' : '✗'}`);
          console.log(`  ニュース: ${parsedResult.quantitative.news ? '✓' : '✗'}`);
          console.log(`  画像エラー: ${parsedResult.quantitative.imageErrors ? '✗ あり' : '✓ なし'}`);
          console.log(`  開発者エラー: ${parsedResult.quantitative.developerErrors ? '✗ あり' : '✓ なし'}`);
        }
        
        // 定性評価の結果を表示
        if (parsedResult.qualitative) {
          console.log('\n【定性評価】');
          console.log(`  レイアウト: ${parsedResult.qualitative.layout || 'N/A'}`);
          console.log(`  視認性: ${parsedResult.qualitative.readability || 'N/A'}`);
          console.log(`  トーン＆マナー: ${parsedResult.qualitative.toneAndManner || 'N/A'}`);
        }
        
        console.log(`\n理由: ${parsedResult.reason || 'N/A'}`);
      } else {
        isPass = content.includes('[PASS]') || content.includes('"result": "PASS"');
      }
    } else {
      // JSONが見つからない場合、従来の形式をフォールバック
      console.warn('JSON形式が見つかりません。従来の形式で解析します。');
      isPass = content.includes('[PASS]') || content.includes('"result": "PASS"');
    }
  } catch (error) {
    console.error('JSON解析エラー:', error);
    // エラー時は従来の形式でフォールバック
    isPass = content.includes('[PASS]') || content.includes('"result": "PASS"');
  }
  
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
    
    ## 1. 定量評価（Quantitative）：事実のチェック
    HTMLデータとスクリーンショットに基づき、要素の存在を確認してください。
    
    ### 要素の存在:
    - **天気情報ウィジェット**: 画面上部またはメインエリアに、現在の天気（気温、天候アイコンなど）を表示するウィジェットが存在するか
    - **天気アイコン**: 天候を表すアイコン（晴れ、曇り、雨など）が表示されているか
    - **気温表示**: 現在の気温が数値で表示されているか
    
    ## 2. 定性評価（Qualitative）：UX・感覚のチェック
    スクリーンショットを基に、レイアウト、視認性、トーン＆マナーを評価してください。
    
    ## 重要: 回答フォーマット
    必ず以下のJSON形式のみで回答してください。他の説明は不要です。
    
    {
      "result": "PASS" | "FAIL",
      "quantitative": {
        "weatherWidget": boolean,
        "weatherIcon": boolean,
        "temperature": boolean
      },
      "qualitative": {
        "layout": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD",
        "readability": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD",
        "toneAndManner": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD"
      },
      "reason": "string"
    }
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
  
  // 検証結果をチェック（JSON形式をパース、このテストは失敗することを期待）
  const content = response.message.content;
  let isPass = false;
  
  try {
    const jsonMatch = content.match(/\{[\s\S]*"result"[\s\S]*\}/);
    if (jsonMatch) {
      const parsedResult = JSON.parse(jsonMatch[0]);
      isPass = parsedResult.result === 'PASS';
      console.log(`\n解析結果: ${parsedResult.result}`);
      if (parsedResult.quantitative) {
        console.log('\n【定量評価】');
        console.log(JSON.stringify(parsedResult.quantitative, null, 2));
      }
      if (parsedResult.qualitative) {
        console.log('\n【定性評価】');
        console.log(JSON.stringify(parsedResult.qualitative, null, 2));
      }
      console.log(`\n理由: ${parsedResult.reason || 'N/A'}`);
    } else {
      isPass = content.includes('[PASS]') || content.includes('"result": "PASS"');
    }
  } catch (error) {
    isPass = content.includes('[PASS]') || content.includes('"result": "PASS"');
  }
  
  // このテストは失敗することを期待（天気情報ウィジェットが表示されていない可能性が高いため）
  expect(isPass).toBe(false); // AIがFAILを返すことを期待
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
    
    ## 1. 定量評価（Quantitative）：事実のチェック
    HTMLデータとスクリーンショットに基づき、要素の存在を確認してください。
    
    ### 要素の存在:
    - **株価情報セクション**: メインエリアに、日経平均やTOPIXなどの株価指数を表示するセクションが存在するか
    - **株価数値**: 株価の数値（例：38,000円、2,500ポイントなど）が表示されているか
    - **株価チャート**: 株価の変動を示すチャートやグラフが表示されているか
    
    ## 2. 定性評価（Qualitative）：UX・感覚のチェック
    スクリーンショットを基に、レイアウト、視認性、トーン＆マナーを評価してください。
    
    ## 重要: 回答フォーマット
    必ず以下のJSON形式のみで回答してください。他の説明は不要です。
    
    {
      "result": "PASS" | "FAIL",
      "quantitative": {
        "stockSection": boolean,
        "stockValue": boolean,
        "stockChart": boolean
      },
      "qualitative": {
        "layout": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD",
        "readability": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD",
        "toneAndManner": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD"
      },
      "reason": "string"
    }
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
  
  // 検証結果をチェック（JSON形式をパース、このテストは失敗することを期待）
  const content = response.message.content;
  let isPass = false;
  
  try {
    const jsonMatch = content.match(/\{[\s\S]*"result"[\s\S]*\}/);
    if (jsonMatch) {
      const parsedResult = JSON.parse(jsonMatch[0]);
      isPass = parsedResult.result === 'PASS';
      console.log(`\n解析結果: ${parsedResult.result}`);
      if (parsedResult.quantitative) {
        console.log('\n【定量評価】');
        console.log(JSON.stringify(parsedResult.quantitative, null, 2));
      }
      if (parsedResult.qualitative) {
        console.log('\n【定性評価】');
        console.log(JSON.stringify(parsedResult.qualitative, null, 2));
      }
      console.log(`\n理由: ${parsedResult.reason || 'N/A'}`);
    } else {
      isPass = content.includes('[PASS]') || content.includes('"result": "PASS"');
    }
  } catch (error) {
    isPass = content.includes('[PASS]') || content.includes('"result": "PASS"');
  }
  
  // このテストは失敗することを期待（株価情報セクションが表示されていない可能性が高いため）
  expect(isPass).toBe(false); // AIがFAILを返すことを期待
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
    
    ## 1. 定量評価（Quantitative）：事実のチェック
    HTMLデータとスクリーンショットに基づき、要素の存在を確認してください。
    
    ### 要素の存在:
    - **スポーツニュースセクション**: スクリーンショット内（最初に表示される画面）に、スポーツ関連のニュースを表示するセクションが存在するか
    - **スポーツ記事**: 野球、サッカー、その他のスポーツに関する記事の見出しや画像が表示されているか
    - **スポーツカテゴリ**: 「スポーツ」というカテゴリ名やタブが表示されているか
    
    ## 2. 定性評価（Qualitative）：UX・感覚のチェック
    スクリーンショットを基に、レイアウト、視認性、トーン＆マナーを評価してください。
    
    ## 注意:
    スクリーンショットは最初に表示される画面（ビューポート）のみを撮影しています。
    スポーツニュースセクションが画面下部にある場合は、スクリーンショットに含まれない可能性があります。
    
    ## 重要: 回答フォーマット
    必ず以下のJSON形式のみで回答してください。他の説明は不要です。
    
    {
      "result": "PASS" | "FAIL",
      "quantitative": {
        "sportsSection": boolean,
        "sportsArticle": boolean,
        "sportsCategory": boolean
      },
      "qualitative": {
        "layout": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD",
        "readability": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD",
        "toneAndManner": "GOOD" | "NEEDS_IMPROVEMENT" | "BAD"
      },
      "reason": "string"
    }
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
  
  // 検証結果をチェック（JSON形式をパース、このテストは失敗することを期待）
  const content = response.message.content;
  let isPass = false;
  
  try {
    const jsonMatch = content.match(/\{[\s\S]*"result"[\s\S]*\}/);
    if (jsonMatch) {
      const parsedResult = JSON.parse(jsonMatch[0]);
      isPass = parsedResult.result === 'PASS';
      console.log(`\n解析結果: ${parsedResult.result}`);
      if (parsedResult.quantitative) {
        console.log('\n【定量評価】');
        console.log(JSON.stringify(parsedResult.quantitative, null, 2));
      }
      if (parsedResult.qualitative) {
        console.log('\n【定性評価】');
        console.log(JSON.stringify(parsedResult.qualitative, null, 2));
      }
      console.log(`\n理由: ${parsedResult.reason || 'N/A'}`);
    } else {
      isPass = content.includes('[PASS]') || content.includes('"result": "PASS"');
    }
  } catch (error) {
    isPass = content.includes('[PASS]') || content.includes('"result": "PASS"');
  }
  
  // このテストは失敗することを期待（スポーツニュースセクションが最初のビューポートに表示されていない可能性が高いため）
  expect(isPass).toBe(false); // AIがFAILを返すことを期待
});

