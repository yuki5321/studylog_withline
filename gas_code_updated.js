// 更新版GASコード - エラーログ機能付き

const GEMINI_API_KEY = "AIzaSyAgzeVOttT7wi4-IyKlfBcsAXuwNaASCLM";
const LINE_ACCESS_TOKEN = "F5DpVxGW1hFyDEaxXkJbW6Y49SDhFcGzHEpo+wQCgfKLZUM9su1oQOGcl+ZQn2ip8CXjBxXoWSBwG6CzlfVAlpElY54HjT7hLnzjpjbuBXRyMsy23F9CO58/8GOjIM9mqtwc8QNGycpvz4lKuieApgdB04t89/1O/w1cDnyilFU=";

// ========== エラーログ記録関数 ==========
function logError(functionName, errorMessage, errorStack, additionalInfo = {}) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let errorSheet = ss.getSheetByName('ErrorLogs');
    
    // ErrorLogsシートが存在しない場合は作成
    if (!errorSheet) {
      errorSheet = ss.insertSheet('ErrorLogs');
      errorSheet.appendRow(['タイムスタンプ', '関数名', 'エラーメッセージ', 'スタックトレース', '追加情報', '重要度']);
      errorSheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#ff6b6b');
    }
    
    // エラー情報を記録
    errorSheet.appendRow([
      new Date(),
      functionName,
      errorMessage,
      errorStack || 'N/A',
      JSON.stringify(additionalInfo),
      determineSeverity(errorMessage)
    ]);
    
    // 重大エラーの場合は通知（オプション）
    if (determineSeverity(errorMessage) === 'CRITICAL') {
      console.error(`[CRITICAL ERROR] ${functionName}: ${errorMessage}`);
      // Slack通知などはここに追加可能
    }
    
  } catch (loggingError) {
    // ログ記録自体が失敗した場合はコンソールに出力
    console.error("Failed to log error:", loggingError.toString());
  }
}

// エラーの重要度判定
function determineSeverity(errorMessage) {
  if (errorMessage.includes('Exception') || errorMessage.includes('ReferenceError')) {
    return 'CRITICAL';
  } else if (errorMessage.includes('Timeout') || errorMessage.includes('Network')) {
    return 'WARNING';
  }
  return 'INFO';
}

// ========== メイン処理 ==========
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();

    // --- 1. 履歴 & 目標点数取得 ---
    if (params.action === 'getHistory') {
      try {
        const allData = sheet.getDataRange().getValues();
        let totalMinutes = 0;
        for (let i = 1; i < allData.length; i++) {
          if (String(allData[i][1]) === String(params.userName) && !isNaN(allData[i][3])) {
            totalMinutes += Number(allData[i][3]);
          }
        }
        let scores = {};
        const examSheet = ss.getSheetByName('ExamGoals');
        if (examSheet) {
          const examData = examSheet.getDataRange().getValues();
          for (let j = examData.length - 1; j >= 1; j--) {
            if (examData[j][1] === params.userName) {
              scores = JSON.parse(examData[j][4] || "{}");
              break;
            }
          }
        }
        return ContentService.createTextOutput(JSON.stringify({
          status: "success", 
          totalMinutes: Math.floor(totalMinutes), 
          scores: scores
        })).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        logError('getHistory', err.toString(), err.stack, { userName: params.userName });
        throw err;
      }
    }

    // --- 2. 定期考査目標保存 ---
    if (params.action === 'saveExamGoal') {
      try {
        const examSheet = ss.getSheetByName('ExamGoals') || ss.insertSheet('ExamGoals');
        examSheet.appendRow([
          new Date(), 
          params.userName, 
          "学年末考査", 
          "2026-03-02", 
          JSON.stringify(params.scores), 
          params.message
        ]);
        return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        logError('saveExamGoal', err.toString(), err.stack, { userName: params.userName });
        throw err;
      }
    }

    // --- 3. 最新試験情報取得 ---
    if (params.action === 'getLatestExam') {
      try {
        const examSheet = ss.getSheetByName('ExamGoals');
        if (!examSheet) {
          return ContentService.createTextOutput(JSON.stringify({status: "none"})).setMimeType(ContentService.MimeType.JSON);
        }
        const data = examSheet.getDataRange().getValues();
        let userGoal = null;
        for (let i = data.length - 1; i >= 1; i--) {
          if (data[i][1] === params.userName) {
            userGoal = { examName: data[i][2], testDate: data[i][3], message: data[i][5] };
            break;
          }
        }
        return ContentService.createTextOutput(JSON.stringify({
          status: "success", 
          goal: userGoal
        })).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        logError('getLatestExam', err.toString(), err.stack, { userName: params.userName });
        throw err;
      }
    }

    // --- 4. 学習記録保存 (最速化) ---
    try {
      const minutes = Math.ceil(params.duration / 60);
      const goalMin = Number(params.goalMin) || 0;
      sheet.appendRow([
        new Date(), 
        params.userName, 
        params.subject, 
        minutes, 
        params.duration, 
        params.score, 
        goalMin
      ]);
      
      // AIコメント生成 (失敗してもエラーにせず、固定文を返す)
      let aiResponse = "ナイス集中！この調子で頑張ろう🔥";
      try {
        aiResponse = generateAiPraise(params.userName, params.subject, minutes);
      } catch (aiError) {
        logError('generateAiPraise', aiError.toString(), aiError.stack, { 
          userName: params.userName,
          subject: params.subject,
          minutes: minutes 
        });
        console.error("Gemini Error: " + aiError.message);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success", 
        aiMsg: aiResponse
      })).setMimeType(ContentService.MimeType.JSON);
      
    } catch (err) {
      logError('学習記録保存', err.toString(), err.stack, { 
        userName: params.userName, 
        subject: params.subject 
      });
      throw err;
    }

  } catch (err) {
    logError('doPost', err.toString(), err.stack, { rawParams: e.postData.contents });
    return ContentService.createTextOutput(JSON.stringify({
      status: "error", 
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function generateAiPraise(name, subject, minutes) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const prompt = { 
    "contents": [{ 
      "parts": [{ 
        "text": `あなたは武内AIです。${name}さんが${subject}を${minutes}分勉強しました。学年末考査に向けた30文字以内の温かい応援を送って。絵文字多用。` 
      }] 
    }] 
  };
  const options = { 
    "method": "post", 
    "contentType": "application/json", 
    "payload": JSON.stringify(prompt), 
    "muteHttpExceptions": true 
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    if (!json.candidates || !json.candidates[0]) {
      throw new Error("Invalid Gemini API response");
    }
    
    return json.candidates[0].content.parts[0].text;
  } catch (err) {
    logError('generateAiPraise', err.toString(), err.stack, { name, subject, minutes });
    throw err;
  }
}

function doGet() { 
  return ContentService.createTextOutput("武内AI Study Mentor API is running!"); 
}

function sendMorningRanking() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    const data = sheet.getDataRange().getValues();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = Utilities.formatDate(yesterday, "JST", "yyyy/MM/dd");
    
    let ranking = {};
    for (let i = 1; i < data.length; i++) {
      if (Utilities.formatDate(new Date(data[i][0]), "JST", "yyyy/MM/dd") === dateString) {
        ranking[data[i][1]] = (ranking[data[i][1]] || 0) + Number(data[i][3]);
      }
    }
    
    let sorted = Object.entries(ranking).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return;
    
    let text = `【武内AI：昨日のランキング🏆】\n\n`;
    sorted.slice(0, 5).forEach((e, i) => { 
      text += `${i < 3 ? ["🥇","🥈","🥉"][i] : "✨"} 第${i+1}位：${e[0]}さん (${e[1]}分)\n`; 
    });
    text += `\n今日も自分らしく進もう！🔥`;
    
    broadcastToLine(text);
  } catch (err) {
    logError('sendMorningRanking', err.toString(), err.stack);
    throw err;
  }
}

function sendAfterSchoolMessage() {
  try {
    const diffDays = Math.ceil((new Date("2026-03-02") - new Date()) / (86400000));
    const text = `【武内AI：放課後ブースト🔥】\n学年末考査まであと${diffDays}日。未来の自分を楽にするのは今の君だよ。エンジンかけていこう！🚀`;
    const message = [
      { "type": "text", "text": text },
      { 
        "type": "flex", 
        "altText": "集中ログ起動", 
        "contents": { 
          "type": "bubble", 
          "body": { 
            "type": "box", 
            "layout": "vertical", 
            "contents": [ 
              { 
                "type": "button", 
                "style": "primary", 
                "color": "#00b900", 
                "action": { 
                  "type": "uri", 
                  "label": "集中ログを起動 📱", 
                  "uri": "https://liff.line.me/2009056355-TruGatly" 
                } 
              } 
            ] 
          } 
        } 
      }
    ];
    
    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/broadcast", { 
      "method": "post", 
      "headers": { 
        "Content-Type": "application/json", 
        "Authorization": "Bearer " + LINE_ACCESS_TOKEN 
      }, 
      "payload": JSON.stringify({ "messages": message }) 
    });
  } catch (err) {
    logError('sendAfterSchoolMessage', err.toString(), err.stack);
    throw err;
  }
}

function broadcastToLine(text) {
  try {
    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/broadcast", { 
      "method": "post", 
      "headers": { 
        "Content-Type": "application/json", 
        "Authorization": "Bearer " + LINE_ACCESS_TOKEN 
      }, 
      "payload": JSON.stringify({ "messages": [{ "type": "text", "text": text }] }) 
    });
  } catch (err) {
    logError('broadcastToLine', err.toString(), err.stack, { text });
    throw err;
  }
}

// ========== 管理用関数 ==========

// エラーログを確認（管理者用）
function getRecentErrors(limit = 50) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const errorSheet = ss.getSheetByName('ErrorLogs');
    
    if (!errorSheet) {
      return "エラーログが存在しません";
    }
    
    const data = errorSheet.getDataRange().getValues();
    const recent = data.slice(-limit).reverse();
    
    console.log(`最新${limit}件のエラーログ:`);
    recent.forEach(row => {
      console.log(`[${row[0]}] ${row[1]}: ${row[2]}`);
    });
    
    return recent;
  } catch (err) {
    console.error("エラーログ取得失敗:", err);
  }
}

// 古いエラーログを削除（30日以上前のログ）
function cleanupOldErrorLogs() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const errorSheet = ss.getSheetByName('ErrorLogs');
    
    if (!errorSheet) return;
    
    const data = errorSheet.getDataRange().getValues();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    let deleteCount = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      if (new Date(data[i][0]) < thirtyDaysAgo) {
        errorSheet.deleteRow(i + 1);
        deleteCount++;
      }
    }
    
    console.log(`${deleteCount}件の古いエラーログを削除しました`);
  } catch (err) {
    logError('cleanupOldErrorLogs', err.toString(), err.stack);
  }
}
