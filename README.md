# Beamup

> 想到就寫，Blip 幫你傳上去。

首頁住著一隻像素外星人（預設是 **Blip**）。點舞台下方的名字，或到「外觀」頁，可以隨時換成其他角色：

| 角色 | 特色 |
|---|---|
| **Blip** | 綠色小外星人，顏色跟著配色換 |
| **Zorp** | 獨眼紫怪，好奇心超重，很愛東張西望 |
| **Pom** | 粉紅麻糬，最愛被摸頭 |
| **Glim** | 會飄的水母星人，觸手會一直擺動 |
| **Bolt** | 戴頭盔的機器人星人，愛跳機器人舞 |

換角色時會有一道光束把原本的吸上去，再把新的送下來。

互動方式（每隻都一樣）：
- **戳他**會有反應（嚇一跳、怕癢、冒愛心、轉圈圈）；**連戳 5 下**他會頭暈。
- **長按**是摸摸頭。**點空地**他會走過去。
- 放著不管，他會自己散步、東張西望、跳舞、接星星，偶爾會有飛碟來找他，或**自己開飛碟兜風**（開飛碟時點空地，他會往那邊飛）；太久沒理他就會睡著，戳一下會醒來。
- 他也會提醒你：還有幾件待辦、有沒有逾期、下一個行程是什麼。你完成待辦或送出筆記、行程後，回到首頁他會幫你慶祝。


iPhone 用的「待辦 / 筆記 / 行程」三合一小工具。打開後有三個入口：

| 功能 | 在 App 內 | 同步到 |
|---|---|---|
| **待辦事項** | 新增（可一次多行）→ 清單子頁可勾選完成、篩選 | 你自己的專案管理工具（Webhook） |
| **筆記** | 寫筆記、加標籤、☰ 看全部筆記（可搜尋、依標籤篩選） | OneNote 指定分區（公司帳號），標籤會寫進頁面標題與內文 |
| **行程** | 輸入一句話，即時預覽解析結果 | iPhone 內建行事曆（透過 iOS 捷徑），或公司 Outlook 行事曆 |

介面採用 iOS 原生風格（大標題、圓角分組清單、線條圖示、毛玻璃導覽列）。首頁右上角的 🎨 可以切換 **8 組配色**（經典、莫蘭迪、海洋、森林、日落、薰衣草、櫻花、石墨），以及 **自動／淺色／深色** 顯示模式。

這是 **網頁 App（PWA）**：不需要 Mac 編譯、不需要 Apple 開發者年費，用 Safari「加入主畫面」後就像一般 App。
所有資料存在手機本機，只有按下同步時才會送到你設定的服務。

---

## 1. 部署（擇一，都免費）

App 是純靜態檔案，不需要建置步驟，把整個資料夾放上任何 HTTPS 靜態主機即可。

- **Cloudflare Pages**（推薦，私人 repo 也免費）：Workers & Pages → Create → Pages → 連結這個 GitHub repo → Build command 留空、Output directory 填 `/` → 部署。
- **GitHub Pages**：repo → Settings → Pages → Source 選 `Deploy from a branch`，選分支與 `/ (root)`。（免費方案 repo 需為公開）
- **Netlify / Vercel**：匯入 repo，不需建置指令。

部署好後會得到像 `https://xxx.pages.dev/` 的網址，後面設定 Microsoft 登入會用到。

### 加到 iPhone 主畫面
用 **Safari** 開啟網址 → 分享按鈕 → **加入主畫面**。之後從主畫面圖示開啟。

### 本機試跑
```bash
npm start          # http://localhost:8080
npm test           # 行程語句解析的單元測試
```

---

## 2. 行程：一句話進 iPhone 行事曆

### 支援的寫法
```
2026/11/12 9:30-12:00 @會議室 [期末審查會議]      ← 固定格式
2026/11/12 9：00-10：00 院前瞻期末報告會議         ← 隨意寫（全形符號也可以）
115/11/12 14:00-15:00 [審查]                      ← 民國年
明天 下午2點半-4點 @台大 [口試]
下週三 10:00 例會 #專案A                           ← 只寫開始時間 → 預設 60 分鐘
11/20 員工旅遊                                    ← 沒寫時間 → 全天
```
- 日期：`YYYY/MM/DD`、`MM/DD`、`YYYY-MM-DD`、`11月12日`、民國年、今天/明天/後天、週X/下週X
- 時間：`9:30-12:00`、`9：30～12：00`、`9點-10點半`、上午/下午/晚上
- `@地點`、`[名稱]` 或 `【名稱】`；沒有括號時，剩下的文字就是名稱；有括號時多的文字放進備註
- `#標籤` 會寫進備註

### 寫入方式（設定頁切換）

**A. iOS 捷徑（推薦，全自動寫入內建行事曆）**——只需建立一次：

1. 打開「捷徑」App → 右上角 **＋** → 把捷徑命名為 **加入行程**（要跟 App 設定裡的名稱一樣）。
2. 加入動作 **「從輸入取得辭典」**（Get Dictionary from Input），輸入選「捷徑輸入」。
3. 加入 6 個 **「取得辭典值」**（Get Dictionary Value），分別取得鍵：`title`、`start`、`end`、`location`、`notes`、`allDay`。
4. 加入 **「如果」**：`allDay` 的辭典值 **是** `1`
   - 「如果」區塊裡：加入 **「加入新行程」**，標題 = `title`，開始 = `start`，結束 = `end`，打開「全天」，位置 = `location`，備忘錄 = `notes`，並選擇要寫入的行事曆。
   - 「否則」區塊裡：再加入一個 **「加入新行程」**，設定同上，但「全天」關閉。
   - （不常用全天行程的話，可以省略「如果」，只放一個「加入新行程」。）
5. 第一次執行時，iOS 會詢問是否允許存取行事曆，請按允許。

在 App 按「加入行事曆」後，會自動跳到捷徑執行並寫入行事曆。完成後點左上角的「◀ 返回」就能回到 App。
行事曆可以選 iCloud、Google 或 Outlook，只要那個帳號已經加入 iPhone，就會跟著同步。

**B. 行事曆檔案（.ics）**：不需要設定。按下後 iOS 會顯示「加入行事曆」畫面，要再按一次「加入」。

**C. 公司 Outlook 行事曆**：用第 3 節的 Microsoft 登入直接寫進 Outlook。如果 iPhone「設定 › 行事曆 › 帳號」已經加入公司帳號，內建行事曆也會顯示。切換到這個模式後，需要**登出再重新登入一次**，才會取得行事曆權限。

---

## 3. 筆記：自動送到 OneNote（公司帳號）

App 透過 Microsoft 官方的 Microsoft Graph API 在你選定的分區建立頁面。頁面格式如下：
- 標題：`[會議][專案A] 會議記錄`
- 第一行：`標籤：#會議 #專案A`，接著是筆記內容

之後在 OneNote 搜尋 `#會議` 或 `[會議]`，就能依標籤整理。

### 標籤怎麼用
- 在標籤框輸入名稱後按 **Enter**，或打 **逗號**，就會新增。用注音選字時按空白鍵不會誤加。
- 點標籤的**名字**可以改名（只改這篇），點 **×** 可以移除。
- 筆記清單右上角的「標籤」（或寫筆記時的「管理標籤」）可以：
  - 預先建立常用標籤，寫筆記時直接點選。
  - 重新命名：所有筆記一起改；改成已存在的名稱會合併。
  - 刪除：從所有筆記移除。
- 改名或刪除不會更新已經送到 OneNote 的頁面。

### 需要先註冊一個 App（一次性，免費）
1. 用公司帳號登入 <https://entra.microsoft.com>（或 portal.azure.com → Microsoft Entra ID）→ **應用程式註冊** → **新增註冊**。
2. 名稱隨意，例如「Beamup」；支援的帳戶類型選 **「僅此組織目錄中的帳戶」**。
3. 重新導向 URI：平台選 **「單頁應用程式 (SPA)」**，填入 App 設定頁顯示的網址（也就是你部署的網址，例如 `https://xxx.pages.dev/`）。
4. 建立後，複製 **應用程式 (用戶端) 識別碼** 和 **目錄 (租用戶) 識別碼**。
5. **API 權限** → 新增 → Microsoft Graph → 委派的權限，勾選 `Notes.Create`、`User.Read`；要用 Outlook 寫行程的話，再勾 `Calendars.ReadWrite`。
6. 回到 App → 設定：填入用戶端識別碼、租用戶識別碼（或公司網域，例如 `contoso.com`）→ **登入 Microsoft 帳號** → **載入我的筆記本分區** → 選擇統一筆記的分區。

> **公司帳號常見狀況**
> - 如果你沒有權限註冊 App，或登入時出現「需要系統管理員核准」，請把上面的步驟 1–5 交給 IT 處理（只需要 `Notes.Create` 這類最小權限）。
> - 只會列出存在你 OneDrive 的筆記本。SharePoint 團隊網站或別人共用給你的筆記本，不在清單裡。
> - 在 IT 核准之前，可以先用筆記頁的 **「分享到 OneNote App…」**，透過 iOS 分享選單手動送出。
> - 公司的登入工作階段約 24 小時後可能需要重新登入（純前端 App 的安全限制）。到期時 App 會提示，送不出去的筆記會保留，下次開 App 會自動重試。

---

## 4. 待辦：送到你自己的專案管理工具

到設定頁填入 **Webhook 網址**，以及選填的 Token。每新增一筆待辦，App 會送出：

```http
POST {webhookUrl}
Content-Type: application/json
Authorization: Bearer {token}        ← 有填 token 才會帶

{
  "type": "todo.created",
  "id": "8d1f…（App 端 UUID，可用來去重）",
  "title": "寫期末報告",
  "note": "",
  "due": "2026-11-12",               ← 或 null
  "priority": "high",                ← low | normal | high
  "tags": ["專案A"],
  "createdAt": "2026-10-08T12:00:00.000Z",
  "source": "beamup"
}
```
- 回應 2xx 就算成功。如果回應 `{"id": "..."}`，App 會記下遠端 id。
- 「測試連線」按鈕會送出 `{"type": "ping"}`，請直接回 2xx。
- **伺服器必須開啟 CORS**（App 是從瀏覽器直接呼叫），至少要允許你 App 的網域、`POST` 方法，以及 `Content-Type`、`Authorization` 標頭，也要回應 `OPTIONS` 預檢請求。

最小伺服器範例（Node.js / Express）：
```js
app.use('/api/todos', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', 'https://xxx.pages.dev');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.post('/api/todos', express.json(), async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.TODO_TOKEN}`) return res.sendStatus(401);
  if (req.body.type === 'ping') return res.json({ ok: true });
  const task = await createTask(req.body);   // 寫進你的專案管理工具，記得用 req.body.id 去重
  res.json({ id: task.id });
});
```
同步失敗（離線、伺服器沒開）時，待辦會標示「同步失敗」。下次開 App、網路恢復，或在首頁按「重試」時，會自動重送。

---

## 專案結構
```
index.html             App 入口
manifest.webmanifest   加入主畫面用的設定
sw.js                  離線快取
css/style.css          樣式（支援深色模式）
js/app.js              畫面與路由
js/themes.js           配色組合（要新增配色改這裡）
js/icons.js            線條圖示
js/mascot.js           外星人的動作、互動與繪圖
js/aliens.js           外星人角色圖鑑（要新增角色改這裡）
js/store.js            本機資料儲存
js/parser.js           行程語句解析
js/sync/todo.js        Webhook 同步
js/sync/microsoft.js   Microsoft 登入（PKCE）、OneNote、Outlook
js/sync/calendar.js    iOS 捷徑網址、.ics 產生
tests/                 單元測試（node --test）
```

## 注意
- 資料存在 Safari 網站資料裡。iOS 在 App 長期沒開時可能會清除，請偶爾到「設定 › 匯出備份」存一份。
- 待辦完成、刪除只會影響 App 內的資料，不會回寫到專案管理工具；刪除筆記也不會刪掉 OneNote 頁面。
- 修改程式後，手機會在下次開啟時於背景下載新版，再下一次開啟才會套用。
