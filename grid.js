const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();
const WebSocket = require('ws');
const nodemailer = require('nodemailer');

const EventEmitter = require('events');
const emitter = new EventEmitter();

let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.USER_EMAIL,
      pass: process.env.USER_PASSWORD
    },
  }); 

let bitcoin_product_id;
let current_lot = 5
let current_profit = 0;
let total_profit = 0;
let border_price;
let number_of_time_order_executed = 0;
let lot_size_array = [12, 31, 78, 195]

let border_buy_price;
let border_buy_profit_price;
let border_buy_loss_price;

let border_sell_price;
let border_sell_profit_price;
let border_sell_loss_price;
   
let botRunning = true;
let buy_sell_profit_point = 800
let buy_sell_point = 200
let cancel_gap = 200
let lot_size_increase = 2
let total_error_count = 0

let order_exicuted_at_price = 0
let project_error_message = ""
let current_balance = 0
let orderInProgress = false  
let isBracketOrderExist = false  
let current_running_order = ''  
let buy_order_object = {} 
let sell_order_object = {}
let buy_order_array = [] 
let sell_order_array = [] 

const api_url = process.env.API_URL 
const socket_url = process.env.API_URL_SOCKET 
const key = process.env.WEB_KEY
const secret = process.env.WEB_SECRET 

function resetBot() {
  current_lot = 5;
  botRunning = true;
  current_profit = 0;
  total_profit = 0;
  ordersExecuted = 0;
  buyExecuted = false;
  sellExecuted = false;
  border_price = 0;
  project_error_message = '';
  order_exicuted_at_price = 0;
  emitter.emit("log", { type: "info", message: "Bot reset triggered." });
  init();
}

let reconnectInterval = 2000;
function wsConnect() {
  // Replace with your actual API credentials
  const WEBSOCKET_URL = socket_url;
  const API_KEY = key;
  const API_SECRET = secret;

  // Generate HMAC SHA256 signature
  function generateSignature(secret, message) {
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
  }

  // Subscribe to a specific channel with given symbols
  function subscribe(ws, channel, symbols) {
    const payload = {
      type: 'subscribe',
      payload: {
        channels: [
          {
            name: channel,
            symbols: symbols
          }
        ]
      }
    };
    ws.send(JSON.stringify(payload));
  }
   
  async function onMessage(data) {
    const message = JSON.parse(data)
    //console.log('message___',message)
    if (message.type === 'success' && message.message === 'Authenticated') {
      subscribe(ws, 'orders', ['all']);
      subscribe(ws, 'v2/ticker', ['BTCUSD']);
      subscribe(ws, 'l2_orderbook', ['BTCUSD']);
      subscribe(ws, 'spot_price', ['BTCUSD']);
      //subscribe(ws, 'positions', ['all']);
    } else {
        
        if(total_error_count>1){
            console.log('total_error_count___',total_error_count)
        }
        
        if(total_error_count>5) { 
            ws.close(1000, 'Too many errors');
        } 

        // if(message.type == "spot_price"){ 
        //     console.log('data___ : ',message)
        // }    
        if(message.type == "v2/ticker"){ 
            //console.log('Running spot price : ',Math.round(message?.spot_price))
            //console.log('current_running_order____',current_running_order,message?.spot_price)
            if(current_running_order == 'sell' && message?.spot_price>border_buy_price){
                console.log('')
                console.log('')
                console.log('==================CLEAR SELL ORDER==================')
                current_running_order = ''
            }
            if(current_running_order == '' && message?.spot_price>border_buy_price){
                console.log('')
                console.log('')
                console.log('==================BUY PROFIT BORDER==================',border_buy_profit_price)
                console.log('==================BUY BORDER==================',border_buy_price)
                console.log('==================BUY ORDER AT : ==================',Math.round(message?.spot_price))
                await cancelAllOpenOrder()
                current_running_order = 'buy' 
                await createOrder('buy')
            } 
            if(current_running_order == 'buy' && message?.spot_price<border_sell_price){
                console.log('')
                console.log('')
                console.log('==================CLEAR BUY ORDER==================')
                current_running_order = ''
            }
            if(current_running_order == '' && message?.spot_price<border_sell_price){
                console.log('')
                console.log('')
                console.log('==================SELL PROFIT BORDER==================',border_sell_profit_price)
                console.log('==================SELL BORDER==================',border_sell_price)
                console.log('==================SELL ORDER AT : ==================',Math.round(message?.spot_price))
                await cancelAllOpenOrder()
                current_running_order = 'sell'  
                await createOrder('sell')
                
            }
 
            if (message?.spot_price > border_buy_profit_price || message?.spot_price < border_sell_profit_price) { 
                console.log('RESER LOOP : ',message?.spot_price,border_buy_profit_price,border_sell_profit_price)
                console.log('cancel_order_on_profit___')
                await cancelAllOpenOrder()
                await resetLoop(5)
            }

            await triggerOrder(message?.spot_price)
        } 
    } 
  } 
  async function onError(error) {
    await cancelAllOpenOrder()
    console.error('Socket Error:', error.message);
  }
  async function resetLoop(lot_size){
    current_lot = lot_size
    number_of_time_order_executed = 0
    await init()
  }
  async function onClose(code, reason) {
    console.log(`Socket closed with code: ${code}, reason: ${reason}`)
    
    if(code == 1000){
      console.log('cancle all order')
      await cancelAllOpenOrder()

      setTimeout(() => { // connect again after 1 minute
        total_error_count = 0
        console.log('Reconnecting after long time...')
        wsConnect();
        resetLoop(5)
      }, 60000);

    }else{
      total_error_count = 0
      setTimeout(() => {
        console.log('Reconnecting...')
        wsConnect();
      }, reconnectInterval);
    }
  }
  
  function sendAuthentication(ws) {
    const method = 'GET';
    const path = '/live';
    const timestamp = Math.floor(Date.now() / 1000).toString(); // Unix timestamp in seconds
    const signatureData = method + timestamp + path;
    const signature = generateSignature(API_SECRET, signatureData);

    const authPayload = {
      type: 'auth',
      payload: {
        'api-key': API_KEY,
        signature: signature,
        timestamp: timestamp
      }
    };

    ws.send(JSON.stringify(authPayload));
  }

  // Initialize WebSocket connection
  const ws = new WebSocket(WEBSOCKET_URL);
  ws.on('open', () => {
    console.log('Socket opened');
    sendAuthentication(ws);
  });
  ws.on('message', onMessage);
  ws.on('error', onError);
  ws.on('close', onClose);
}
wsConnect();


async function generateEncryptSignature(signaturePayload) { 
  return crypto.createHmac("sha256", secret).update(signaturePayload).digest("hex");
}

async function cancelAllOpenOrder() {
  try {
    current_running_order = ''
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyParams = {
      close_all_portfolio: true,
      close_all_isolated: true,
      user_id: process.env.WEB_USER_ID,
    }; 
    const signaturePayload = `POST${timestamp}/v2/positions/close_all${JSON.stringify(bodyParams)}`;
    const signature = await generateEncryptSignature(signaturePayload);

    const headers = {
      "api-key": key,
      "signature": signature,
      "timestamp": timestamp,
      "Content-Type": "application/json",
      "Accept": "application/json",
    }; 
    const response = await axios.post(`${api_url}/v2/positions/close_all`, bodyParams, { headers });
    return { data: response.data, status: true };
  } catch (error) {
    console.log('error.message___1_',error.response.data)
    project_error_message = JSON.stringify(error.response.data)
    botRunning = false
    return { message: error.message, status: false };
  }
}

function sendEmail(message){
    let mailOptions = {
        from: 'phpspider97@gmail.com',
        to: 'neelbhardwaj97@gmail.com',
        subject: 'Grid order created.',
        text: JSON.stringify(message)
    };
    
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return console.log('Error:', error);
        }
        console.log('Email sent:', info.response);
    });
}

async function createOrder(bidType,bitcoin_current_price) {
      return true
      if(total_error_count>5){
        return true
      }
      if (orderInProgress) return { message: "Order already in progress", status: false };
      orderInProgress = true
      try {
       // bidType = (bidType == 'buy')?'sell':'buy'
        const timestamp = Math.floor(Date.now() / 1000);
        const bodyParams = {
          product_id: bitcoin_product_id,
          product_symbol: "BTCUSD",
          size: 1,
          //size: (current_lot == 5)?current_lot:current_lot+20,
          side: bidType,   
          order_type: "market_order", 
        };
        //console.log('order_bodyParams___', bitcoin_current_price, bodyParams)
        const signaturePayload = `POST${timestamp}/v2/orders${JSON.stringify(bodyParams)}`;
        const signature = await generateEncryptSignature(signaturePayload);

        const headers = {
          "api-key": key,
          "signature": signature,
          "timestamp": timestamp,
          "Content-Type": "application/json",
          "Accept": "application/json",
        };
        const response = await axios.post(`${api_url}/v2/orders`, bodyParams, { headers });
         
        if (response.data.success) {
          current_lot *= lot_size_increase
          number_of_time_order_executed++
          sendEmail(bodyParams)
          return { data: response.data, status: true };
        }

        return { message: "Order failed", status: false };
      } catch (error) {
        console.log('error.message___2_',JSON.stringify(error?.response?.data))
        total_error_count++
        project_error_message = JSON.stringify(error?.response?.data)
        orderInProgress = false; 
        //botRunning = false
        return { message: error?.message, status: false };
      } finally {
        orderInProgress = false;
      }
}

async function getCurrentPriceOfBitcoin() {
  try {
    const response = await axios.get(`${api_url}/v2/tickers/BTCUSD`);
    return { data: response.data, status: true };
  } catch (error) {
    return { message: error.message, status: false };
  }
}

async function init() { 
    await cancelAllOpenOrder()
    const result = await getCurrentPriceOfBitcoin()
    if (!result.status) return
    //console.log('result___',result.data.result)
    
    const markPrice = Math.round(result.data.result.spot_price); 
    bitcoin_product_id = result.data.result.product_id;

    border_price = markPrice;

    buy_order_array = [border_price-100,border_price-200,border_price-300,border_price-400,border_price-500]

    sell_order_array = [border_price+100,border_price+200,border_price+300,border_price+400,border_price+500]

    border_buy_loss_price = border_price-550
    border_sell_loss_price = border_price+550

    buy_order_object = {
        order_1 : {
            trigger_point : border_price-100,
            is_fill : false
        },
        order_2 : {
            trigger_point : border_price-200,
            is_fill : false
        },
        order_3 : {
            trigger_point : border_price-300,
            is_fill : false
        },
        order_4 : {
            trigger_point : border_price-400,
            is_fill : false
        },
        order_5 : {
            trigger_point : border_price-500,
            is_fill : false
        }
    }

    sell_order_object = {
        order_1 : {
            trigger_point : border_price+100,
            is_fill : false
        },
        order_2 : {
            trigger_point : border_price+200,
            is_fill : false
        },
        order_3 : {
            trigger_point : border_price+300,
            is_fill : false
        },
        order_4 : {
            trigger_point : border_price+400,
            is_fill : false
        },
        order_5 : {
            trigger_point : border_price+500,
            is_fill : false
        }
    }
 
    order_exicuted_at_price = 0 
    total_error_count = 0  
    
    emitter.emit('log', { type: "init", markPrice });
    console.log('==================BUY PROFIT BORDER==================',border_buy_loss_price)
    console.log('==================BUY BORDER==================',buy_order_array)
    console.log('==================CURRENT PRICE==================',markPrice)
    console.log('==================SELL BORDER==================',sell_order_array)
    console.log('==================SELL PROFIT BORDER==================',border_sell_loss_price)
}

async function triggerOrder(current_price,openPosition) {
  try{
    // Calculate current profit
    if (current_price > border_buy_price) {
      current_profit = ((current_price - border_buy_price) / 1000) * current_lot;
    } else if (current_price < border_sell_price) {
      current_profit = ((border_sell_price - current_price) / 1000) * current_lot;
    }

    // Emit updates
    emitter.emit("update", {
      bitcoin_product_id:bitcoin_product_id,
      border_price:border_price,
      border_buy_price:border_buy_price,
      border_buy_profit_price:border_buy_profit_price,
      border_sell_price:border_sell_price,
      border_sell_profit_price:border_sell_profit_price,
      price: current_price,
      lot: current_lot,
      profit: current_profit.toFixed(2),
      totalProfit: total_profit.toFixed(2),
      ordersExecuted: number_of_time_order_executed,
      order_exicuted_at_price: order_exicuted_at_price,
      project_error_message: project_error_message,
      current_balance: current_balance
    })
  }catch(error){
    botRunning = false
    console.log('error____',error)
  }
}
 
emitter.on("stop", () => {
  botRunning = false; 
  emitter.emit("log", { type: "warn", message: "Bot has been stopped." });
});

async function startBot() {
  //setInterval(getBitcoinPriceLoop, 1000);
  init()
}

emitter.on("restart", () => {
  resetBot();
});

module.exports = { startBot, emitter };