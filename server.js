const http = require("http");
const fs = require("fs");
const path = require("path");

const PID = process.env.PID;
const TOKEN = process.env.TOKEN;
const CHAT = process.env.CHAT;
const NAME = process.env.NAME || "带单";
const EP = process.env.EP || "";
const HIST_EP = process.env.HIST_EP || "bapi/futures/v1/public/future/copy-trade/lead-portfolio/position-history";
const DETAIL_EP = "bapi/futures/v1/friendly/future/copy-trade/lead-portfolio/detail";

const HOST = "https://www.binance.com/";
const DEF = "bapi/futures/v1/public/future/copy-trade/lead-portfolio/trade-history";
const DASHBOARD_URL = "https://binance-leader-tracker.cyanbin96.workers.dev/";
const STATE_FILE = path.join(__dirname, "state.json");

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
function list(d) {
  if (Array.isArray(d)) return d;
  if (!d) return [];
  return d.list || d.rows || d.records || d.positions || [];
}

let posState = {};
let lastSeen = 0;
let bootedAt = null;

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      console.log("状态文件不存在，从零开始");
      return;
    }
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    posState = s.posState || {};
    lastSeen = s.lastSeen || 0;
    bootedAt = s.bootedAt || null;
    console.log("已恢复状态 lastSeen=" + lastSeen + " 持仓数=" + Object.keys(posState).length);
  } catch (e) {
    console.log("读取状态失败:", String(e));
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ posState, lastSeen, bootedAt }));
  } catch (e) {
    console.log("保存状态失败:", String(e));
  }
}

async function grabTrades(pageSize) {
  const p = EP || DEF;
  const r = await fetch(HOST + p, {
    method: "POST", headers: H,
    body: JSON.stringify({ portfolioId: PID, pageNumber: 1, pageSize: pageSize || 100 })
  });
  const t = await r.text();
  if (!t.trim().startsWith("{")) throw new Error("HTTP " + r.status + " 非JSON");
  const j = JSON.parse(t), d = j.data ?? j;
  return { arr: list(d), path: p };
}

async function grabDetail() {
  const r = await fetch(HOST + DETAIL_EP + "?portfolioId=" + PID, { method: "GET", headers: H });
  const t = await r.text();
  if (!t.trim().startsWith("{")) throw new Error("HTTP " + r.status + " 非JSON");
  return (JSON.parse(t).data ?? {});
}

async function grabHistory() {
  const r = await fetch(HOST + HIST_EP, {
    method: "POST", headers: H,
    body: JSON.stringify({ portfolioId: PID, pageNumber: 1, pageSize: 30 })
  });
  const t = await r.text();
  if (!t.trim().startsWith("{")) throw new Error("HTTP " + r.status + " 非JSON");
  const j = JSON.parse(t), d = j.data ?? j;
  return list(d);
}

async function getMark(symbol) {
  try {
    const r = await fetch("https://fapi.binance.com/fapi/v1/ticker/price?symbol=" + symbol);
    return N(JSON.parse(await r.text()).price);
  } catch (e) { return null; }
}

function T(v) {
  let x = N(v); if (x == null) return "--";
  if (x < 1e12) x *= 1000;
  return new Date(x + 288e5).toISOString().slice(5, 16).replace("T", " ");
}
function fD(v, d) {
  const x = N(v); if (x == null) return "--";
  const dec = d === undefined ? (Math.abs(x) >= 1000 ? 2 : 5) : d;
  return x.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fM(v) { return fD(v, 2); }
function fSigned(v) { const x = N(v); if (x == null) return "--"; return (x >= 0 ? "+" : "") + fM(x); }
function fPct(v) {
  let x = N(v); if (x == null) return "--";
  if (Math.abs(x) < 1) x *= 100;
  return (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
}
function isLongSide(o) {
  const ps = String(g(o, "positionSide") || "").toUpperCase();
  if (ps && ps !== "BOTH") return ps.includes("LONG");
  const sd = String(g(o, "side", "orderSide") || "").toUpperCase();
  if (sd) return sd === "BUY";
  return true;
}
function isOpenTrade(t) {
  if (g(t, "isOpen", "open") != null) return !!g(t, "isOpen", "open");
  const sd = String(g(t, "side", "orderSide") || "").toUpperCase();
  const ps = String(g(t, "positionSide") || "").toUpperCase();
  return sd === "BUY" ? !ps.includes("SHORT") : ps.includes("SHORT");
}

function lineTrade(t) {
  const s = g(t, "symbol", "symbolName") || "?";
  const lg = isLongSide(t), op = isOpenTrade(t);
  const pr = N(g(t, "price", "avgPrice", "averagePrice"));
  const q = Math.abs(N(g(t, "quantity", "qty", "amount", "executedQty")) || 0);
  let qv = N(g(t, "quoteQty", "notional", "notionalValue", "turnover"));
  if (qv == null && pr != null) qv = pr * q;
  return (op ? "🟢 " : "🔴 ") + (op ? "开" : "平") + (lg ? "多" : "空") + "  " + s +
    "\n均价 " + (pr ?? "--") + "   数量 " + q.toLocaleString("en-US") +
    "\n名义 " + (qv != null ? Math.round(qv).toLocaleString("en-US") : "--") + " USDT" +
    "\n" + T(g(t, "time", "tradeTime", "updateTime", "createTime"));
}

function histDetail(h) {
  const sym = g(h, "symbol", "symbolName") || "?";
  const lg = isLongSide(h);
  return (lg ? "🟢 多  " : "🔴 空  ") + sym + "（已平仓）" +
    "\n开仓价 " + fD(g(h, "avgPrice", "entryPrice", "openPrice")) +
    "\n平仓均价 " + fD(g(h, "closePrice", "avgClosePrice", "closeAvgPrice")) +
    "\n已实现盈亏 " + fSigned(g(h, "closingPnl", "realizedPnl", "pnl", "profit")) + " USDT" +
    "\n开仓时间 " + T(g(h, "openTime", "startTime", "opened")) +
    "\n平仓时间 " + T(g(h, "closeTime", "updateTime", "endTime", "closed"));
}

function accountLine(detail) {
  if (!detail.nickname) return "";
  return "带单余额 " + fM(detail.marginBalance) + " USDT\n" +
    "资产管理规模 " + fM(detail.aumAmount) + " USDT\n" +
    "跟单用户 " + detail.currentCopyCount + "/" + detail.maxCopyCount + "\n\n";
}

async function posSummary(sym, pos, marginBalance) {
  const mark = await getMark(sym);
  const lg = pos.qty > 0;
  const base = sym.replace(/USDT$|USDC$|BUSD$/, "");
  const notional = mark != null ? Math.abs(pos.qty) * mark : null;
  const upnl = (mark != null && pos.avgPrice != null) ? (mark - pos.avgPrice) * pos.qty : null;
  const margin = N(marginBalance);
  const roi = (upnl != null && margin) ? upnl / margin : null;
  const lev = (notional != null && margin) ? notional / margin : null;

  return (lg ? "🟢 多  " : "🔴 空  ") + sym +
    "\n持仓量(" + base + ") " + fD(Math.abs(pos.qty), 2) +
    "\n持仓均价 " + fD(pos.avgPrice) +
    "\n标记价格 " + fD(mark) +
    "\n名义价值 " + fM(notional) + " USDT" +
    "\n保证金 " + fM(margin) + " USDT（全仓，账户共用）" +
    "\n未实现盈亏 " + fSigned(upnl) + " USDT" +
    "\n回报率 " + fPct(roi) +
    "\n推算杠杆 " + (lev != null ? fD(lev, 2) + "x" : "--") +
    "\n开仓时间 " + T(pos.openTime);
}

async function push(text) {
  const full = text + "\n\n🌐 " + DASHBOARD_URL;
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: full })
  });
  const out = await r.text();
  console.log("TG推送:", out.slice(0, 150));
  return out;
}

function applyTrade(t) {
  const sym = g(t, "symbol", "symbolName"); if (!sym) return null;
  const price = N(g(t, "price", "avgPrice", "averagePrice"));
  const qty = Math.abs(N(g(t, "quantity", "qty", "amount", "executedQty")) || 0);
  if (!qty || price == null) return null;
  const lg = isLongSide(t), op = isOpenTrade(t);
  const prev = posState[sym] || { qty: 0, avgPrice: null, openTime: null };

  if (!op && prev.qty === 0) {
    const next = { qty: 0, avgPrice: null, openTime: null };
    posState[sym] = next;
    return { symbol: sym, trade: t, prev, next, wasFlat: true, isFlat: true };
  }

  const dir = lg ? 1 : -1;
  const delta = op ? dir * qty : -dir * qty;
  const newQty = prev.qty + delta;
  let next;
  if (prev.qty === 0 || Math.sign(prev.qty) === Math.sign(delta)) {
    const cost = (prev.avgPrice || 0) * Math.abs(prev.qty) + price * qty;
    next = {
      qty: newQty,
      avgPrice: newQty !== 0 ? cost / Math.abs(newQty) : null,
      openTime: prev.openTime || g(t, "time", "tradeTime", "updateTime", "createTime")
    };
  } else if (Math.sign(newQty) === Math.sign(prev.qty) || newQty === 0) {
    next = { qty: newQty, avgPrice: newQty === 0 ? null : prev.avgPrice, openTime: newQty === 0 ? null : prev.openTime };
  } else {
    next = { qty: newQty, avgPrice: price, openTime: g(t, "time", "tradeTime", "updateTime", "createTime") };
  }
  const wasFlat = prev.qty === 0, isFlat = next.qty === 0;
  posState[sym] = next;
  return { symbol: sym, trade: t, prev, next, wasFlat, isFlat };
}

async function run(force) {
  if (bootedAt == null) bootedAt = Date.now();
  const { arr: trades, path: p } = await grabTrades(100);
  console.log("抓到成交:", trades.length, "lastSeen:", lastSeen);

  const sorted = trades.slice().sort((a, b) => {
    const ta = N(g(a, "time", "tradeTime", "updateTime", "createTime")) || 0;
    const tb = N(g(b, "time", "tradeTime", "updateTime", "createTime")) || 0;
    return ta - tb;
  });

  const firstRun = lastSeen === 0;
  if (firstRun) {
    let mx = 0;
    for (const t of sorted) {
      let x = N(g(t, "time", "tradeTime", "updateTime", "createTime"));
      if (x == null) continue;
      if (x < 1e12) x *= 1000;
      if (x > mx) mx = x;
    }
    lastSeen = mx || Date.now();
    console.log("首次运行，基准:", lastSeen);
  }

  const newTrades = sorted.filter(t => {
    let x = N(g(t, "time", "tradeTime", "updateTime", "createTime"));
    if (x == null) return false;
    if (x < 1e12) x *= 1000;
    return x > lastSeen;
  });
  console.log("新成交:", newTrades.length);

  const events = [];
  for (const t of newTrades) {
    const ev = applyTrade(t);
    if (ev) events.push(ev);
    let x = N(g(t, "time", "tradeTime", "updateTime", "createTime"));
    if (x < 1e12) x *= 1000;
    if (x > lastSeen) lastSeen = x;
  }

  let detail = {};
  try { detail = await grabDetail(); } catch (e) { console.log("detail失败:", String(e)); }

  if (force) {
    const known = Object.keys(posState).filter(s => posState[s].qty && Math.abs(posState[s].qty) > 1e-9);
    let msg = "连接正常\n路径 " + p + "\n\n" + accountLine(detail);
    msg += "追踪起始 " + T(bootedAt / 1000) + "（在此之前已存在的仓位不计入下方明细）\n\n";
    if (known.length) {
      const parts = [];
      for (const s of known) parts.push(await posSummary(s, posState[s], detail.marginBalance));
      msg += "本次追踪到的持仓 (" + known.length + ")\n\n" + parts.join("\n\n———\n\n");
    } else {
      msg += "尚未追踪到仓位变动\n\n最近一笔成交:\n" + (trades.length ? lineTrade(trades[0]) : "无记录");
    }
    await push(msg);
    saveState();
    return { ok: 1, mode: "test", path: p, total: trades.length, knownPositions: known.length };
  }

  if (firstRun || !events.length) {
    saveState();
    return { ok: 1, mode: "check", path: p, total: trades.length, newEvents: events.length, firstRun };
  }

  const parts = [];
  for (const ev of events) {
    if (ev.wasFlat && !ev.isFlat) {
      parts.push("🟢 新开仓 " + ev.symbol + "\n\n" + await posSummary(ev.symbol, ev.next, detail.marginBalance));
    } else if (!ev.isFlat) {
      const dirTxt = Math.abs(ev.next.qty) > Math.abs(ev.prev.qty) ? "加仓" : "减仓";
      parts.push("🟡 " + dirTxt + " " + ev.symbol + "\n\n" + await posSummary(ev.symbol, ev.next, detail.marginBalance));
    } else {
      let hist = [];
      try { hist = await grabHistory(); } catch (e) {}
      const h = hist.find(x => g(x, "symbol", "symbolName") === ev.symbol);
      parts.push(h ? ("🔴 平仓\n\n" + histDetail(h)) : ("🔴 平仓 " + ev.symbol + "\n" + lineTrade(ev.trade)));
    }
  }

  await push("【" + NAME + "】\n\n" + parts.join("\n\n————————\n\n"));
  saveState();
  return { ok: 1, mode: "check", path: p, total: trades.length, newEvents: events.length };
}

loadState();

setInterval(() => {
  run(false).catch(e => console.log("定时任务出错:", String(e.message || e)));
}, 120000);

http.createServer(async (req, res) => {
  const p = req.url.split("?")[0];
  const send = (b, t) => { res.writeHead(200, { "content-type": t + "; charset=utf-8" }); res.end(b); };
  try {
    if (p === "/test") return send(JSON.stringify(await run(true), null, 2), "application/json");
    if (p === "/check") return send(JSON.stringify(await run(false), null, 2), "application/json");
    if (p === "/reset") {
      posState = {}; lastSeen = 0; bootedAt = null; saveState();
      return send(JSON.stringify({ ok: 1, msg: "状态已清空" }), "application/json");
    }
    send("ok. /test 测试  /check 检查  /reset 清空状态", "text/plain");
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: 0, err: String(e.message || e) }, null, 2));
  }
}).listen(process.env.PORT || 10000);
