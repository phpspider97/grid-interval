const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
//const { startBot, emitter } = require("./index");
const { startBot, emitter } = require("./grid"); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);
let lastConsoleUpdate = null;

// Serve static HTML
app.use(express.static(path.join(__dirname, "public")));

// Emit updates via socket
emitter.on("update", (data) => {
  io.emit("update", data);
  const now = Date.now();
  if (!lastConsoleUpdate || now - lastConsoleUpdate > 1000) {
    // console.clear();
    lastConsoleUpdate = now;
    emitter.emit("log", { type: "Info", message: 
         `${JSON.stringify({
            "Bitcoin Product Id":data.bitcoin_product_id,
            "Border Buy Profit Price":data.border_buy_profit_price,
            "Border Buy Price":data.border_buy_price,
            "Border Price":data.border_price,
            "Border Sell Price":data.border_sell_price,
            "Border Sell Profit Price":data.border_sell_profit_price,
            "Current Price": data.price,
            "Lot Size": data.lot,
            "Current Profit": data.profit,
            "Total Profit": data.totalProfit,
            "Orders Executed": data.ordersExecuted,
        })}`
    })
  }
});

emitter.on("log", (data) => {
  io.emit("log", data);
});

io.on("connection", (socket) => {
  console.log("🟢 Client connected");
  socket.on("restart", () => {
    console.log("🔁 Restarting bot...");
    emitter.emit("restart");
  });
  socket.on("stop", () => {
    console.log("⛔ Bot stopped manually.");
    emitter.emit("stop");
  });
});

  

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
  startBot();
});
