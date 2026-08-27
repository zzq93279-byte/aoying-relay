const http = require("http");

const PID = process.env.PID;
const TOKEN = process.env.TOKEN;
const CHAT = process.env.CHAT;
const NAME = process.env.NAME || "带单";
const EP = process.env.EP || "";
const EM = process.env.EM || "";
const WINDOW_MS = 4 * 60 * 1000;

const HOST = "https://www.binance.com/";

const PATHS = [
  "bapi/futures/v1/public/future/copy-trade/lead-portfolio/detail",
  "bapi/futures/v1/friendly/future/copy-trade/lead-portfolio/detail",
  "bapi/futures/v1/public/future/copy-trade/lead-data/positions",
  "bapi/futures/v1/friendly/future/copy-trade/lead-data/positions",
  "bapi/futures/v1/public/future/copy-trade/lead-portfolio/position",
  "bapi/futures/v1/friendly/future/copy-trade/lead-portfolio/position",
  "bapi/futures/v1/public/future/copy-trade/lead-portfolio/position-history",
  "bapi/futures/v1/friendly/future/copy-trade/lead-portfolio/position-history",
  "bapi/futures/v1/public/future/copy-trade/lead-portfolio/trade-history",
  "bapi/futures/v1/friendly/future/copy-trade/lead-portfolio/trade-history",
  "bapi/futures/v1/public/future/copy-trade/lead-data/trade-history",
  "bapi/futures/v1/public/future/copy-trade/lead-portfolio/performance"
];

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

async function hit(path, method) {
  const url = HOST + path + (method === "GET" ? "?portfolioId=" + PID : "");
  const opt = { method, headers: H };
  if (method === "POST") opt.body = JSON.stringify({ portfolioId: PID, pageNumber: 1, pageSize: 20 });
  const r = await fetch(url, opt);
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, json: j, text: t };
}

async function scan() {
  const out = [];
  try {
    const r = await fetch("https://fapi.binance.com/fapi/v1/time");
    out.push("基准 fapi/time -> " + r.status + "  " + (await r.text()).slice(0, 60));
  } catch (e) { out.push("基准 fapi/time -> ERR " + e.message); }
  out.push("");
  for (const p of PATHS) {
    for (const m of ["GET", "POST"]) {
      try {
        const { status, json } = await hit(p, m);
        if (json) out.push("OK " + m + " " + status + " code=" + (json.code || "-") + "\n   " + p + "\n   " + JSON.stringify(json.data ?? json).slice(0, 160));
        else out.push("   " + m + " " + status + " HTML | " + p);
      } catch (e) { out.push("   " + m + " ERR | " + p + " | " + e.message); }
    }
  }
  return out.join("\n");
}

function list(d) {
  if (Array.isArray(d)) return d;
  if (!d) return [];
  return d.list || d.data || d.rows || d.records || d.positions || [];
}

async function grab() {
  if (EP) {
    const { json, status } = await hit(EP, EM || "POST");
    if (!json) throw new Error("HTTP " + status + " 非JSON");
    return { arr: list(json.data ?? json), path: EP };
  }
  const errs = [];
  for (const p of PATHS.filter(x => x.includes("trade-history"))) {
    try {
      const { json, status } = await hit(p, "POST");
      if (!json) throw new Error("HTTP " + status);
      const a = list(json.data ?? json);
      if (!Array.isArray(a)) throw new Error("结构不符");
      return { arr: a, path: p };
    } catch (e) { errs.push(p.split("/").pop() + ": " + e.message); }
  }
  throw new Error(errs.join(" | ") + "  先访问 /scan");
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
  await fetch("https://api.telegram.org/bot" + TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true })
  });
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
  if (force) {
    await push("连接正常（新加坡节点）\n路径 " + path + "\n最近一笔:\n" + (arr.length ? line(arr[0]) : "无记录"));
  } else if (fresh.length) {
    await push("【" + NAME + "】\n\n" + fresh.map(line).join("\n\n———\n\n"));
  }
  return { ok: 1, path, total: arr.length, fresh: fresh.length };
}

http.createServer(async (req, res) => {
  const p = req.url.split("?")[0];
  const send = (body, type) => {
    res.writeHead(200, { "content-type": type + "; charset=utf-8" });
    res.end(body);
  };
  try {
    if (p === "/scan") return send(await scan(), "text/plain");
    if (p === "/test") return send(JSON.stringify(await run(true), null, 2), "application/json");
    if (p === "/check") return send(JSON.stringify(await run(false), null, 2), "application/json");
    send("ok. /scan 扫描  /test 测试  /check 检查一次", "text/plain");
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: 0, err: String(e.message || e) }, null, 2));
  }
}).listen(process.env.PORT || 10000);
