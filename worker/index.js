const DEFAULT_QUESTION = "用一個詞說說，你想到『空氣』時會想到什麼？";

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function adminOk(request, env) {
  return request.headers.get("x-admin-pin") === (env.ADMIN_PIN || "2468");
}

function safeCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function getState(env) {
  const setting = await env.DB.prepare(
    "SELECT question, is_open AS isOpen, updated_at AS updatedAt FROM settings WHERE id = 1"
  ).first();
  const grouped = await env.DB.prepare(
    "SELECT answer, COUNT(*) AS count FROM responses GROUP BY answer ORDER BY count DESC, MAX(created_at) DESC LIMIT 120"
  ).all();
  const total = await env.DB.prepare("SELECT COUNT(*) AS count FROM responses").first();
  return {
    question: setting?.question || DEFAULT_QUESTION,
    isOpen: setting ? Boolean(setting.isOpen) : true,
    updatedAt: setting?.updatedAt || null,
    total: Number(total?.count || 0),
    words: grouped.results.map((row) => ({ answer: row.answer, count: Number(row.count) })),
  };
}

async function api(request, env, url) {
  try {
    if (url.pathname === "/api/state" && request.method === "GET") {
      return json(await getState(env));
    }

    if (url.pathname === "/api/respond" && request.method === "POST") {
      const body = await request.json();
      const answer = String(body.answer || "").trim().replace(/\s+/g, " ");
      const name = String(body.name || "").trim().slice(0, 30);
      if (!answer) return json({ error: "請先輸入你的回答。" }, 400);
      if (answer.length > 60) return json({ error: "回答請控制在 60 個字以內。" }, 400);
      const current = await env.DB.prepare("SELECT is_open AS isOpen FROM settings WHERE id = 1").first();
      if (current && !current.isOpen) return json({ error: "老師目前已暫停收件。" }, 409);
      await env.DB.prepare("INSERT INTO responses (answer, student_name) VALUES (?, ?)")
        .bind(answer, name || null)
        .run();
      return json({ ok: true }, 201);
    }

    if (url.pathname === "/api/question" && request.method === "POST") {
      if (!adminOk(request, env)) return json({ error: "老師密碼不正確。" }, 401);
      const body = await request.json();
      const question = String(body.question || "").trim();
      if (!question) return json({ error: "題目不能留白。" }, 400);
      if (question.length > 160) return json({ error: "題目請控制在 160 個字以內。" }, 400);
      const commands = [env.DB.prepare(
        "INSERT INTO settings (id, question, is_open, updated_at) VALUES (1, ?, 1, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET question = excluded.question, is_open = 1, updated_at = CURRENT_TIMESTAMP"
      ).bind(question)];
      if (body.clear) commands.push(env.DB.prepare("DELETE FROM responses"));
      await env.DB.batch(commands);
      return json(await getState(env));
    }

    if (url.pathname === "/api/open" && request.method === "POST") {
      if (!adminOk(request, env)) return json({ error: "老師密碼不正確。" }, 401);
      const body = await request.json();
      const isOpen = body.isOpen ? 1 : 0;
      await env.DB.prepare(
        "INSERT INTO settings (id, question, is_open, updated_at) VALUES (1, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET is_open = excluded.is_open, updated_at = CURRENT_TIMESTAMP"
      ).bind(DEFAULT_QUESTION, isOpen).run();
      return json({ ok: true, isOpen: Boolean(isOpen) });
    }

    if (url.pathname === "/api/responses" && request.method === "DELETE") {
      if (!adminOk(request, env)) return json({ error: "老師密碼不正確。" }, 401);
      await env.DB.prepare("DELETE FROM responses").run();
      return json({ ok: true });
    }

    if ((url.pathname === "/api/export.csv" || url.pathname === "/api/export.xls") && request.method === "GET") {
      if (!adminOk(request, env)) return json({ error: "老師密碼不正確。" }, 401);
      const state = await getState(env);
      const rows = await env.DB.prepare(
        "SELECT id, student_name AS studentName, answer, created_at AS createdAt FROM responses ORDER BY id"
      ).all();
      if (url.pathname.endsWith(".csv")) {
        const csv = "\ufeff" + [
          ["編號", "題目", "學生姓名", "回答", "送出時間"].map(safeCell).join(","),
          ...rows.results.map((r) => [r.id, state.question, r.studentName || "", r.answer, r.createdAt].map(safeCell).join(",")),
        ].join("\r\n");
        return new Response(csv, { headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="student-word-cloud.csv"',
        }});
      }
      const tableRows = rows.results.map((r) => `<tr><td>${r.id}</td><td>${escapeHtml(state.question)}</td><td>${escapeHtml(r.studentName || "")}</td><td>${escapeHtml(r.answer)}</td><td>${escapeHtml(r.createdAt)}</td></tr>`).join("");
      const xls = `\ufeff<html><head><meta charset="utf-8"></head><body><table border="1"><tr><th>編號</th><th>題目</th><th>學生姓名</th><th>回答</th><th>送出時間</th></tr>${tableRows}</table></body></html>`;
      return new Response(xls, { headers: {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": 'attachment; filename="student-word-cloud.xls"',
      }});
    }

    return json({ error: "找不到這個功能。" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "資料服務暫時無法使用";
    return json({ error: message.includes("no such table") ? "資料庫正在準備中，請稍後再試。" : "資料服務暫時無法使用，請稍後再試。" }, 500);
  }
}

const css = String.raw`
:root{--ink:#17233c;--navy:#172b4d;--blue:#2867c7;--cyan:#34b9d1;--lime:#b9dc3a;--yellow:#ffd34f;--coral:#ff735d;--paper:#f7f8f3;--white:#fff;--muted:#6c7890;--line:#dfe5ed;--shadow:0 18px 45px rgba(24,39,75,.12)}*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;color:var(--ink);background:linear-gradient(135deg,#eef7ff 0%,#f8fbf4 52%,#fff7e6 100%)}button,input,textarea{font:inherit}button{cursor:pointer}.app{min-height:100vh;padding:20px 24px 28px}.topbar{max-width:1500px;margin:auto;display:flex;align-items:center;gap:18px}.brand{display:flex;align-items:center;gap:12px;font-weight:900;letter-spacing:.04em;font-size:20px;white-space:nowrap}.brandmark{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:var(--navy);color:var(--yellow);box-shadow:0 8px 0 #cadbff}.status{margin-left:auto;display:flex;align-items:center;gap:8px;font-weight:700;color:var(--muted)}.dot{width:10px;height:10px;border-radius:50%;background:#38b36a;box-shadow:0 0 0 5px #38b36a22}.grid{max-width:1500px;margin:20px auto 0;display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:20px}.main{min-width:0}.question-wrap{display:flex;gap:10px;align-items:stretch;margin-bottom:14px}.question-input{flex:1;border:2px solid transparent;background:white;border-radius:18px;padding:16px 19px;font-size:clamp(18px,2vw,27px);font-weight:900;box-shadow:0 8px 24px rgba(24,39,75,.08);outline:none}.question-input:focus{border-color:var(--blue)}.save{border:0;border-radius:17px;padding:0 23px;background:var(--blue);color:white;font-weight:900;box-shadow:0 7px 0 #164b9a}.save:active{transform:translateY(3px);box-shadow:0 4px 0 #164b9a}.board{position:relative;min-height:610px;border-radius:30px;overflow:hidden;background:var(--navy);box-shadow:var(--shadow);border:7px solid white}.board:before{content:"";position:absolute;inset:0;background-image:radial-gradient(#ffffff18 1px,transparent 1px);background-size:18px 18px}.board-head{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;padding:20px 24px;color:white}.eyebrow{font-size:13px;font-weight:900;letter-spacing:.12em;color:#9fb7dc}.count{background:#ffffff16;border:1px solid #ffffff25;border-radius:999px;padding:8px 13px;font-weight:800}.cloud{position:relative;z-index:1;min-height:495px;padding:28px 35px 55px;display:flex;flex-wrap:wrap;align-content:center;align-items:center;justify-content:center;gap:15px 24px}.word{display:inline-block;font-weight:950;line-height:1.05;text-shadow:0 3px 0 #00000030;animation:pop .35s ease both;max-width:100%;overflow-wrap:anywhere}.word:nth-child(5n+1){color:var(--yellow)}.word:nth-child(5n+2){color:#74ddec}.word:nth-child(5n+3){color:#ff8b76}.word:nth-child(5n+4){color:#cfe95e}.word:nth-child(5n){color:white}.word:nth-child(7n){transform:rotate(-3deg)}.word:nth-child(9n){transform:rotate(3deg)}@keyframes pop{from{opacity:0;transform:scale(.82)}to{opacity:1}}.empty{color:#cbd7e9;text-align:center;max-width:400px;font-size:18px;line-height:1.7}.empty-icon{font-size:46px;display:block;margin-bottom:8px}.side{display:flex;flex-direction:column;gap:15px}.card{background:white;border:1px solid #e7ebf1;border-radius:24px;padding:20px;box-shadow:0 10px 30px rgba(24,39,75,.08)}.qr-title{font-weight:950;font-size:20px}.qr-note{margin:5px 0 14px;color:var(--muted);font-size:14px}.qr{display:block;width:100%;aspect-ratio:1;border-radius:16px;background:#fff;border:8px solid #f2f5f8}.join-url{margin-top:10px;padding:10px;background:#f3f6fa;border-radius:10px;font-size:12px;color:var(--muted);word-break:break-all}.actions{display:grid;gap:9px}.btn{border:1px solid var(--line);border-radius:13px;padding:12px 14px;background:white;color:var(--ink);font-weight:850;text-align:left;display:flex;justify-content:space-between;align-items:center}.btn:hover{border-color:#a8bad1;background:#f8fbff}.btn.primary{background:#e8f2ff;border-color:#c8ddff;color:#174c96}.btn.warn{color:#a43a2d;background:#fff6f4;border-color:#ffd6cf}.toggle-row{display:flex;align-items:center;justify-content:space-between}.switch{position:relative;width:52px;height:30px;border:0;border-radius:99px;background:#cad2de;padding:0}.switch:after{content:"";position:absolute;width:24px;height:24px;left:3px;top:3px;border-radius:50%;background:white;transition:.2s;box-shadow:0 2px 6px #0003}.switch.on{background:#36ae69}.switch.on:after{left:25px}.hint{font-size:13px;line-height:1.55;color:var(--muted);margin:0}.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);background:#17233cf2;color:white;border-radius:13px;padding:12px 18px;font-weight:750;opacity:0;pointer-events:none;transition:.2s;z-index:30}.toast.show{opacity:1;transform:translate(-50%,0)}.lock{position:fixed;inset:0;display:grid;place-items:center;background:#17233ce8;backdrop-filter:blur(8px);z-index:40;padding:20px}.lockbox{width:min(420px,100%);background:white;border-radius:28px;padding:30px;box-shadow:0 25px 80px #0005}.lockbox h1{margin:0 0 8px;font-size:28px}.lockbox p{color:var(--muted);line-height:1.6}.pin{width:100%;border:2px solid var(--line);border-radius:14px;padding:14px;font-size:24px;letter-spacing:.25em;text-align:center;outline:none}.pin:focus{border-color:var(--blue)}.unlock{width:100%;margin-top:12px;border:0;border-radius:14px;padding:14px;background:var(--blue);color:white;font-weight:900}.student-shell{min-height:100vh;display:grid;place-items:center;padding:24px}.student-card{width:min(620px,100%);background:white;border-radius:30px;padding:clamp(24px,6vw,44px);box-shadow:var(--shadow);border-top:9px solid var(--yellow)}.student-card .mini{font-weight:900;color:var(--blue);letter-spacing:.08em}.student-card h1{font-size:clamp(25px,6vw,40px);line-height:1.35;margin:13px 0 24px}.field{display:grid;gap:8px;margin:14px 0}.field label{font-weight:850}.field input,.field textarea{width:100%;border:2px solid var(--line);border-radius:15px;padding:14px 16px;outline:none;font-size:18px}.field textarea{min-height:125px;resize:vertical}.field input:focus,.field textarea:focus{border-color:var(--blue)}.submit{width:100%;border:0;border-radius:16px;padding:16px;background:var(--navy);color:white;font-weight:950;font-size:18px;box-shadow:0 7px 0 #0b172c}.success{text-align:center;padding:28px 0}.success-badge{width:82px;height:82px;margin:auto;display:grid;place-items:center;border-radius:50%;background:#eaf8ef;color:#269458;font-size:42px}.success h2{font-size:28px}.again{border:1px solid var(--line);border-radius:13px;padding:12px 18px;background:white;font-weight:850}.closed{background:#fff4dc;border-radius:14px;padding:14px;color:#7b5710;font-weight:750}.hidden{display:none!important}@media(max-width:900px){.app{padding:14px}.grid{grid-template-columns:1fr}.side{display:grid;grid-template-columns:1fr 1fr}.board{min-height:500px}.cloud{min-height:390px}.qr-card{order:2}}@media(max-width:620px){.topbar{align-items:flex-start}.brand{font-size:17px}.status{font-size:13px}.question-wrap{display:grid}.save{padding:14px}.side{grid-template-columns:1fr}.board{border-width:4px;border-radius:22px}.board-head{padding:16px}.cloud{padding:20px 16px 40px}.qr-card{order:0}}
`;

const teacherScript = String.raw`
const $=s=>document.querySelector(s);let pin=sessionStorage.getItem('teacherPin')||'';let state=null;let toastTimer;const showToast=m=>{const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200)};async function call(url,options={}){options.headers={...(options.headers||{}),'content-type':'application/json','x-admin-pin':pin};const r=await fetch(url,options);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'操作失敗');return data}function draw(data){state=data;$('#question').value=data.question;$('#count').textContent=data.total+' 份回答';$('#openText').textContent=data.isOpen?'正在收件':'已暫停';$('#statusDot').style.background=data.isOpen?'#38b36a':'#ff735d';$('#toggle').classList.toggle('on',data.isOpen);$('#toggle').setAttribute('aria-pressed',String(data.isOpen));const c=$('#cloud');c.innerHTML='';if(!data.words.length){c.innerHTML='<div class="empty"><span class="empty-icon">✦</span>學生送出回答後，文字會即時出現在這裡。<br>相同回答越多，字會越大。</div>';return}const max=Math.max(...data.words.map(w=>w.count));data.words.forEach((w,i)=>{const el=document.createElement('span');el.className='word';el.textContent=w.answer;el.title=w.count+' 人回答';el.style.fontSize=(20+Math.sqrt(w.count/max)*42)+'px';el.style.animationDelay=Math.min(i*.025,.4)+'s';c.appendChild(el)})}async function refresh(){try{draw(await call('/api/state'))}catch(e){showToast(e.message)}}async function unlock(){pin=$('#pin').value.trim();try{await call('/api/state');await call('/api/open',{method:'POST',body:JSON.stringify({isOpen:true})});sessionStorage.setItem('teacherPin',pin);$('#lock').classList.add('hidden');await refresh()}catch(e){showToast('密碼不正確，請再試一次')}}$('#unlock').onclick=unlock;$('#pin').addEventListener('keydown',e=>{if(e.key==='Enter')unlock()});$('#save').onclick=async()=>{const q=$('#question').value.trim();if(!q)return showToast('請先輸入題目');const clear=state&&q!==state.question?confirm('換題目時，要同時清除上一題的回答嗎？'):false;try{draw(await call('/api/question',{method:'POST',body:JSON.stringify({question:q,clear})}));showToast('題目已更新')}catch(e){showToast(e.message)}};$('#toggle').onclick=async()=>{try{const next=!state.isOpen;await call('/api/open',{method:'POST',body:JSON.stringify({isOpen:next})});state.isOpen=next;draw(state);showToast(next?'已開放學生回答':'已暫停收件')}catch(e){showToast(e.message)}};$('#clear').onclick=async()=>{if(!confirm('確定清除目前全部回答？此動作無法復原。'))return;try{await call('/api/responses',{method:'DELETE'});await refresh();showToast('回答已清空')}catch(e){showToast(e.message)}};async function download(kind){try{const r=await fetch('/api/export.'+kind,{headers:{'x-admin-pin':pin}});if(!r.ok){const d=await r.json();throw new Error(d.error)}const b=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='學生文字雲回答.'+kind;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),500)}catch(e){showToast(e.message)}}$('#csv').onclick=()=>download('csv');$('#xls').onclick=()=>download('xls');const join=location.origin+'/join';$('#qr').src='https://quickchart.io/qr?size=480&margin=2&text='+encodeURIComponent(join);$('#joinUrl').textContent=join;if(pin){$('#pin').value=pin;$('#lock').classList.add('hidden');refresh()}setInterval(()=>{if(pin)refresh()},2500);if(document.modelContext?.registerTool){document.modelContext.registerTool({name:'read_word_cloud',title:'讀取文字雲',description:'讀取目前題目、收件狀態、回答總數與文字統計。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async()=>await call('/api/state')});document.modelContext.registerTool({name:'update_word_cloud_question',title:'更新文字雲題目',description:'更新老師端目前題目，並可選擇清除舊回答。',inputSchema:{type:'object',properties:{question:{type:'string'},clearPrevious:{type:'boolean'}},required:['question'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async({question,clearPrevious=false})=>{const next=await call('/api/question',{method:'POST',body:JSON.stringify({question,clear:clearPrevious})});draw(next);return{ok:true,question:next.question,total:next.total}}})}
`;

const studentScript = String.raw`
const $=s=>document.querySelector(s);let state;async function load(){try{const r=await fetch('/api/state',{cache:'no-store'});state=await r.json();$('#question').textContent=state.question;$('#closed').classList.toggle('hidden',state.isOpen);$('#form').classList.toggle('hidden',!state.isOpen)}catch{$('#question').textContent='目前無法載入題目，請稍後重新整理。'}}async function submitAnswer(name,answer){const r=await fetch('/api/respond',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,answer})});const d=await r.json();if(!r.ok)throw new Error(d.error);return d}load();setInterval(load,4000);$('#form').onsubmit=async e=>{e.preventDefault();const btn=$('#submit');btn.disabled=true;btn.textContent='送出中…';try{await submitAnswer($('#name').value,$('#answer').value);$('#form').classList.add('hidden');$('#success').classList.remove('hidden')}catch(err){$('#error').textContent=err.message;$('#error').classList.remove('hidden')}finally{btn.disabled=false;btn.textContent='送出回答'}};$('#again').onclick=()=>{$('#answer').value='';$('#success').classList.add('hidden');$('#form').classList.remove('hidden');$('#answer').focus()};if(document.modelContext?.registerTool){document.modelContext.registerTool({name:'submit_word_cloud_answer',title:'送出文字雲回答',description:'把一個學生回答送到目前的課堂文字雲。',inputSchema:{type:'object',properties:{answer:{type:'string'},name:{type:'string'}},required:['answer'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async({answer,name=''})=>{await submitAnswer(name,answer);return{ok:true,answer}}})}
`;

function teacherPage() {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>學生即時文字雲｜老師端</title><meta name="description" content="讓學生掃描 QR Code 即時回答，答案自動形成文字雲。"><link rel="icon" href="/favicon.svg"><style>${css}</style></head><body><div class="app"><header class="topbar"><div class="brand"><span class="brandmark">☁</span>學生即時文字雲</div><div class="status"><span class="dot" id="statusDot"></span><span id="openText">正在連線</span></div></header><div class="grid"><main class="main"><div class="question-wrap"><input id="question" class="question-input" aria-label="題目" maxlength="160" value="${DEFAULT_QUESTION}"><button id="save" class="save">更新題目</button></div><section class="board" aria-label="學生回答文字雲"><div class="board-head"><span class="eyebrow">LIVE WORD CLOUD</span><span class="count" id="count">0 份回答</span></div><div class="cloud" id="cloud"><div class="empty"><span class="empty-icon">✦</span>學生送出回答後，文字會即時出現在這裡。<br>相同回答越多，字會越大。</div></div></section></main><aside class="side"><section class="card qr-card"><div class="qr-title">掃描後立即回答</div><p class="qr-note">把這個畫面投影給學生即可</p><img id="qr" class="qr" alt="學生回答頁 QR Code"><div id="joinUrl" class="join-url"></div></section><section class="card actions"><div class="toggle-row"><div><strong>開放回答</strong><p class="hint">暫停後學生仍看得到題目</p></div><button id="toggle" class="switch on" aria-label="切換開放回答" aria-pressed="true"></button></div><button id="csv" class="btn primary">下載 CSV <span>↓</span></button><button id="xls" class="btn primary">下載 Excel <span>↓</span></button><button id="clear" class="btn warn">清空本題回答 <span>×</span></button></section><section class="card"><p class="hint">小提醒：重複出現的回答會自動放大。換題目時，系統會詢問是否清除上一題資料。</p></section></aside></div></div><div id="lock" class="lock"><div class="lockbox"><h1>老師您好 👋</h1><p>請輸入老師密碼，進入題目與資料管理畫面。</p><input id="pin" class="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="current-password" aria-label="老師密碼"><button id="unlock" class="unlock">進入老師端</button></div></div><div id="toast" class="toast" role="status"></div><script>${teacherScript}</script></body></html>`;
}

function studentPage() {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>送出你的回答｜學生即時文字雲</title><meta name="description" content="掃描後送出你的課堂回答。"><link rel="icon" href="/favicon.svg"><style>${css}</style></head><body><main class="student-shell"><section class="student-card"><div class="mini">即時文字雲</div><h1 id="question">題目載入中…</h1><div id="closed" class="closed hidden">老師目前已暫停收件，請留意課堂指示。</div><form id="form"><div class="field"><label for="name">姓名或座號 <span style="font-weight:400;color:#78849a">（選填）</span></label><input id="name" maxlength="30" autocomplete="name" placeholder="例如：12號"></div><div class="field"><label for="answer">我的回答</label><textarea id="answer" maxlength="60" required placeholder="輸入一個詞或一句短句…"></textarea></div><div id="error" class="closed hidden"></div><button id="submit" class="submit" type="submit">送出回答</button></form><div id="success" class="success hidden"><div class="success-badge">✓</div><h2>回答已送出！</h2><p>你的文字已經出現在老師的大螢幕上。</p><button id="again" class="again">再送一個回答</button></div></section></main><script>${studentScript}</script></body></html>`;
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#172b4d"/><path d="M19 43h29a9 9 0 0 0 0-18 16 16 0 0 0-30-2A10 10 0 0 0 19 43Z" fill="#ffd34f"/><circle cx="26" cy="31" r="3" fill="#172b4d"/><circle cx="38" cy="31" r="3" fill="#172b4d"/></svg>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env, url);
    if (url.pathname === "/favicon.svg") return new Response(favicon, { headers: { "content-type": "image/svg+xml", "cache-control": "public,max-age=86400" } });
    if (url.pathname === "/join") return new Response(studentPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response(teacherPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
