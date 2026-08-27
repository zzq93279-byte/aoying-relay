const http = require("http");

// 如果 Render 环境变量未读到，默认使用该 PID（请确保填写正确）
const PID = process.env.PID || "4458313881518349569"; // ← 如果有默认PID可填在此处
const TOKEN = process.env.TOKEN;
const CHAT = process.env.CHAT;
const NAME = process.env.NAME || "熬鹰资本";
const PORT = process.env.PORT || 10000;

const DASHBOARD_URL = "https://binance-leader-tracker.cyanbin96.workers.dev/";

const HOST = "https://www.binance.com/";
const H = {
  "content-type": "application/json",
  "accept": "*/*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "clienttype": "web",
  "lang": "zh-CN",
  "origin": "https://www.binance.com",
  "referer": "https://www.binance.com/zh-CN/copy-trading",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
};

const g = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; };
const N = v => { const x = parseFloat(v); return isNaN(x) ? null : x; };

function T(v) {
  let x = N(v); if (x == null) return "--";
  if (x < 1e12) x *= 1000;
  return new Date(x + 288e5).toISOString().slice(0, 19).replace("T", " ");
}

function fN(v, dec = 2) {
  const x = N(v);
  if (x == null) return "--";
  return x.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

async function grabAllData() {
  if (!PID) {
    return { error: "PID 未设置，请在 Render 环境变量中配置 PID！" };
  }

  try {
    const reqDetail = fetch(HOST + "bapi/futures/v1/public/future/copy-trade/lead-portfolio/detail", {
      method: "POST", headers: H, body: JSON.stringify({ portfolioId: PID })
    });
    const reqPositions = fetch(HOST + "bapi/futures/v1/public/future/copy-trade/lead-portfolio/position-list", {
      method: "POST", headers: H, body: JSON.stringify({ portfolioId: PID })
    });

    const [resDetail, resPositions] = await Promise.all([reqDetail, reqPositions]);
    
    const detailJson = await resDetail.json();
    const posJson = await resPositions.json();

    if (detailJson.code !== "000000" && detailJson.message) {
      return { error: `币安API返回异常: ${detailJson.message} (${detailJson.code})` };
    }

    return {
      detail: detailJson.data || {},
      positions: posJson.data || []
    };
  } catch (err) {
    return { error: `网络请求失败: ${err.message}` };
  }
}

function buildFullMessage(data) {
  if (data.error) {
    return `⚠️ <b>【${NAME}】监控告警</b>\n\n<b>数据获取失败：</b> ${data.error}\n<i>请检查 Render 的 PID 环境变量设置。</i>`;
  }

  const d = data.detail;
  const posList = data.positions;

  let text = `🦅 <b>【${NAME}】全要素持仓与实时监控</b>\n`;
  text += `推送时间：${T(Date.now())}\n\n`;

  text += `📌 <b>一、 账户总览</b>\n`;
  text += `--------------------------------\n`;
  text += `• <b>带单余额：</b> ${fN(d.marginBalance)} USDT\n`;
  text += `• <b>管理规模 (AUM)：</b> ${fN(d.aum)} USDT\n`;
  text += `• <b>跟单人数：</b> ${d.currentFollowerCount || "--"}/${d.maxFollowerCount || "--"}\n\n`;

  text += `📈 <b>二、 持有仓位明细 (${posList.length}个)</b>\n`;
  text += `--------------------------------\n`;

  if (posList.length === 0) {
    text += `当前无持有仓位 (空仓中)\n\n`;
  } else {
    posList.forEach((p, idx) => {
      const amount = Math.abs(N(g(p, "positionAmount", "amount", "qty")) || 0);
      const entryPrice = N(g(p, "entryPrice", "avgPrice")) || 0;
      const markPrice = N(g(p, "markPrice", "price")) || entryPrice;
      const margin = N(g(p, "initialMargin", "isolatedMargin", "margin")) || 0;
      const unrealizedPnl = N(g(p, "unrealizedProfit", "unrealizedPnl", "pnl")) || 0;
      
      const notional = amount * markPrice;
      const roe = margin > 0 ? ((unrealizedPnl / margin) * 100).toFixed(2) + "%" : "--";
      
      const levNum = margin > 0 ? (notional / margin) : 1;
      const leverageStr = margin > 0 ? levNum.toFixed(2) + "x" : "--";
      const marginRatioStr = notional > 0 ? ((margin / notional) * 100).toFixed(2) + "%" : "--";
      
      const isLong = (g(p, "positionSide") || (N(p.positionAmount) < 0 ? "SHORT" : "LONG")).includes("LONG");
      const sideText = isLong ? "🟢 多" : "🔴 空";
      
      let estLiqPrice = "--";
      if (entryPrice > 0 && levNum > 0) {
        const liqCalc = isLong 
          ? entryPrice * (1 - 0.9 / levNum) 
          : entryPrice * (1 + 0.9 / levNum);
        estLiqPrice = (liqCalc > 0 ? liqCalc : 0).toFixed(5);
      }

      const openTime = T(g(p, "createTime", "openTime", "updateTime"));
      const updateTime = T(g(p, "updateTime", "time"));
      const pnlIcon = unrealizedPnl >= 0 ? "🟢 +" : "🔴 ";

      text += `<b>${idx + 1}. ${p.symbol} (${sideText} | ${p.marginType || "全仓"})</b>\n`;
      text += `• <b>持仓量：</b> ${fN(amount, 4)}\n`;
      text += `• <b>持仓均价：</b> ${fN(entryPrice, 4)}\n`;
      text += `• <b>实时标记价格：</b> ${fN(markPrice, 4)}\n`;
      text += `• <b>名义价值：</b> ${fN(notional)} USDT\n`;
      text += `• <b>保证金：</b> ${fN(margin)} USDT\n`;
      text += `• <b>未实现盈亏：</b> ${pnlIcon}${fN(unrealizedPnl)} USDT\n`;
      text += `• <b>回报率 (ROE)：</b> ${roe}\n`;
      text += `• <b>保证金比例：</b> ${marginRatioStr}\n`;
      text += `• <b>推算杠杆：</b> ${leverageStr}\n`;
      text += `• <b>预估强平价：</b> ${estLiqPrice}\n`;
      text += `• <b>开仓时间：</b> ${openTime}\n`;
      text += `• <b>平/加仓最新变动时间：</b> ${updateTime}\n\n`;
    });
  }

  text += `--------------------------------\n`;
  text += `🌐 <b>查看实时看板：</b>\n${DASHBOARD_URL}`;

  return text;
}

async function push(text) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: false })
  });
  return await r.text();
}

async function run(force) {
  const data = await grabAllData();
  const text = buildFullMessage(data);

  let tg = "未发送";
  if (force) {
    tg = await push(text);
  }

  return { ok: 1, tokenLen: (TOKEN || "").length, chat: CHAT, tg };
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
}).listen(PORT);
