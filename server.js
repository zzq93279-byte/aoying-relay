const http = require("http");

const PID = process.env.PID;
const TOKEN = process.env.TOKEN;
const CHAT = process.env.CHAT;
const NAME = process.env.NAME || "带单";
const EP = process.env.EP || "";
const WINDOW_MS = 4 * 60 * 1000;

const HOST = "https://www.binance.com/";
const DEF = "bapi/futures/v1/public/future/copy-trade/lead-portfolio/trade-history";

const H = {
  "content-type": "application/json",
  "accept": "*/*",
  "accept-language": "zh-CN,zh;q=0.9",
  "clienttype": "web",
  "lang": "zh-CN",
  "origin": "https://www.binance.com",
  "referer": "https://www.binance.com/zh-CN/copy-trading",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
};

const g = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; };
const N = v => { const x = parseFloat(v); return isNaN(x) ? null : x; };

async function grab() {
  const path = EP || DEF;
  const r = await fetch(HOST + path, {
    method: "POST", headers: H,
    body: JSON.stringify({ portfolioId: PID, pageNumber: 1, pageSize: 20 })
  });
  const t = await r.text();
  if (!t.trim().startsWith("{")) throw new Error("HTTP " + r.status + " 非JSON");
  const j = JSON.parse(t), d = j.data ?? j;
  return { arr: Array.isArray(d) ? d : (d.list || d.rows || d.records || []), path };
}

function T(v) {
  let x = N(v); if (x == null) return "";
  if (x < 1e12) x *= 1000;
  return new Date(x + 288e5).toISOString().slice(5, 16).replace("T", " ");
}

function line(t) {
  const s = g(t, "symbol", "symbolName") || "?";
  const sd = String(g(t, "side", "orderSide") || "").toUpperCase();
  const ps = String(g(t, "positionSide") || "").toUpperCase();
  const lg = ps.includes("SHORT") ? false : (ps.includes("LONG") ? true : sd === "BUY");
  const op = g(t, "isOpen", "open") != null ? !!g(t, "isOpen", "open") : (sd === "BUY" ? !ps.includes("SHORT") : ps.includes("SHORT"));
  const pr = N(g(t, "price", "avgPrice", "averagePrice"));
  const q = Math.abs(N(g(t, "quantity", "qty", "amount", "executedQty")) || 0);
  let qv = N(g(t, "quoteQty", "notional", "notionalValue", "turnover"));
  if (qv == null && pr != null) qv = pr * q;
  const pl = N(g(t, "realizedPnl", "realizedProfit", "profit"));
  return (op ? "🟢 " : "🔴 ") + (op ? "开" : "平") + (lg ? "多" : "空") + "  " + s +
    "\n均价 " + (pr ?? "--") + "   数量 " + q.toLocaleString("en-US") +
    "\n名义 " + (qv != null ? Math.round(qv).toLocaleString("en-US") : "--") + " USDT" +
    (pl ? "   已实现 " + (pl > 0 ? "+" : "") + pl.toFixed(2) : "") +
    "\n" + T(g(t, "time", "tradeTime", "updateTime", "createTime"));
}

async function push(text) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text })
  });
  return await r.text();
}

async function run(force) {
  const { arr, path } = await grab();
  const cut = Date.now() - WINDOW_MS;
  const fresh = arr.filter(t => {
    let x = N(g(t, "time", "tradeTime", "updateTime", "createTime"));
    if (x == null) return false;
    if (x < 1e12) x *= 1000;
    return x > cut;
  });
  let tg = "未发送";
  if (force) {
    tg = await push("连接正常（新加坡节点）\n最近一笔:\n" + (arr.length ? line(arr[0]) : "无记录"));
  } else if (fresh.length) {
    tg = await push("【" + NAME + "】\n\n" + fresh.map(line).join("\n\n———\n\n"));
  }
  return { ok: 1, path, total: arr.length, fresh: fresh.length, tokenLen: (TOKEN || "").length, chat: CHAT, tg };
}

http.createServer(async (req, res) => {
  const p = req.url.split("?")[0];
  const send = (b, t) => { res.writeHead(200, { "content-type": t + "; charset=utf-8" }); res.end(b); };
  try {
    if (p === "/test") return send(JSON.stringify(await run(true), null, 2), "application/json");
    if (p === "/check") return send(JSON.stringify(await run(false), null, 2), "application/json");
    send("ok. /test 测试  /check 检查一次", "text/plain");
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: 0, err: String(e.message || e) }, null, 2));
  }
}).listen(process.env.PORT || 10000);
