const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();
const WebSocket = require('ws'); 
const api_url = process.env.API_URL 
const socket_url = process.env.API_URL_SOCKET 
const key = process.env.WEB_KEY
const secret = process.env.WEB_SECRET 

let reconnectInterval = 2000;
let get_price_range_info = []
function wsConnect() { 
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
    } else {
        if(total_error_count>5) { 
            ws.close(1000, 'Too many errors');
        } 
   
        if(message.type == "orders"){
            if(message.state == 'closed' && message.meta_data.pnl != undefined){ 
                console.log('given_price_range___',given_price_range.length, given_price_range)
                const side = message.side
                const order_at = parseInt(message.limit_price)
   
                const update_order_price = (side == 'buy')?order_at+profitMargin:order_at-profitMargin 
                await createOrder((side == 'buy')?'sell':'buy',update_order_price,message.average_fill_price,true)              
            }
        }

        if(message.type == "v2/ticker"){
            if (message?.spot_price > upperPrice+profitMargin || message?.spot_price < lowerPrice-profitMargin) { 
                await cancelAllOpenOrder()
                setTimeout(async () => {
                    await getCurrentPriceOfBitcoin()
                }, 600000);
            } 
        } 
    } 
  } 
  async function onError(error) {
    await cancelAllOpenOrder()
    console.error('Socket Error:', error.message);
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

let given_price_range       =   []
let lowerPrice              =   0 
let upperPrice              =   0 
let gridSpacing             =   0
let numberOfGrids           =   11
let profitMargin            =   100
let total_error_count       =   0 
let number_of_time_order_executed = 0

const roundedToHundred = (price) => Math.round(price / 100) * 100;
 
async function cancelAllOpenOrder() {
    try {
        given_price_range = [];
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

async function getCurrentPriceOfBitcoin() {
    try {
        await cancelAllOpenOrder()
        const response = await axios.get(`${api_url}/v2/tickers/BTCUSD`);
        const current_price = Math.round(response.data.result.spot_price);  
        bitcoin_product_id = response.data.result.product_id;
        let round_of_current_price = roundedToHundred(current_price)
        upperPrice       =  round_of_current_price + 600
        lowerPrice       =  round_of_current_price - 500
        gridSpacing      = (upperPrice - lowerPrice) / numberOfGrids;
        
        for (let i = 0; i < numberOfGrids; i++) {
            const rawBuyPrice = lowerPrice + i * gridSpacing;  
            given_price_range.push({
                price : rawBuyPrice,
                fill : {
                    buy  : false,
                    sell : false
                }
            }); 
        }
 
        const first_five = given_price_range.slice(0, 5);
        const last_five = given_price_range.slice(-5);

        first_five.forEach(async (data)=>{
            await createOrder('buy',data.price,current_price,true)
        })
        last_five.forEach(async (data)=>{
            await createOrder('sell',data.price,current_price,true)
        })
        
        console.log('current_price___',current_price)
        console.log('given_price_range___',given_price_range.length, given_price_range)
    } catch (error) {
        return { message: error.message, status: false };
    }
}
getCurrentPriceOfBitcoin()

async function generateEncryptSignature(signaturePayload) { 
    return crypto.createHmac("sha256", secret).update(signaturePayload).digest("hex");
}
async function createOrder(bidType,order_price,currentPrice,status){
    if(total_error_count>5){
        return true
    } 
    try { 
        const timestamp = Math.floor(Date.now() / 1000);
        const bodyParams = {
            product_id : bitcoin_product_id,
            product_symbol : "BTCUSD",
            size : 1, 
            side : bidType,   
            order_type : "limit_order",
            limit_price : order_price,
            //stop_trigger_method : "mark_price"
        };

        //console.log('order_params : ',currentPrice,  bodyParams)
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
            number_of_time_order_executed++  
            return { data: response.data, status: true }
        }
        return { message: "Order failed", status: false }
    } catch (error) {
        console.log('create_order_error_message____', error.response?.data || error.message)
        total_error_count++ 
        return { message: error?.message, status: false };
    } finally {
        orderInProgress = false;
    }
}