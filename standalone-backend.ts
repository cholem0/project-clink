interface CleanMessage {
  type: "new_follow" | "donate_emoji" | "stat" | "new_sub_gift";
  username?: string;
  donate_message?: string;
  gifter?: string;

  months?: number;
  ruby_amount?: number;
  live_count?: number;
}

interface AparatResponse {
  response_type: "stat" | "update_status";
  response_data?: {
    live?: number;
    payload?: {
      type?: "new_follow" | "donate_emoji" | "new_sub_gift";
      data: {
        username?: string;
        sponsor_username?: string;
        gifter?: string;
        emoji_coin_count?: number;
        donate_message?: string;
        months?: number;
      };
    };
  };
}
interface AparataJwtResponse {
  jwt: string;
}
const STREAMER_NAME = "cholemo";
const FOLLOW_COOLDOWN = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 45 * 60 * 1000;

const WS_CLIENTS = new Set<WebSocket>();
const RECENT_FOLLOWS = new Map<string, number>();

function wait(ms: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
async function getJwt(streamerName: string): Promise<string> {
  try {
    const response = await fetch(
      `https://www.aparat.com/api/fa/v2/Live/LiveStream/show/username/${streamerName}`,
    );
    if (!response.ok) {
      throw new Error("Response Failed");
    }

    const data = (await response.json()) as AparataJwtResponse;
    return data.jwt;
  } catch (error) {
    console.error("Error fetching JWT:", error);
    throw error;
  }
}

function cleanMsg(msg: string): CleanMessage | null {
  try {
    const json = JSON.parse(msg) as AparatResponse;
    const payloadType = json.response_type;
    const payload = json.response_data;

    if (!payload) return null;

    if (payloadType === "update_status") {
      if (payload.payload?.type === "new_follow") {
        const username = payload.payload.data.username || "undefined";
        const now = Date.now();
        const lastFollowTime = RECENT_FOLLOWS.get(username);

        if (lastFollowTime && (now - lastFollowTime < FOLLOW_COOLDOWN)) {
          console.log(`Dup detected ${username}`);
          return null;
        }

        RECENT_FOLLOWS.set(username, now);
        return {
          type: "new_follow",
          username: username || "undefined",
        };
      } else if (payload.payload?.type === "donate_emoji") {
        return {
          type: "new_follow",
          username: payload.payload?.data.sponsor_username || "undefined",
          donate_message: payload.payload?.data.donate_message,
          ruby_amount: payload.payload?.data.emoji_coin_count || 0,
        };
      } else if (payload.payload?.type === "new_sub_gift") {
        return {
          type: "new_sub_gift",
          username: payload.payload?.data.sponsor_username || "undefined",
          gifter: payload.payload?.data.gifter,
          months: payload.payload?.data.months || 0,
        };
      }
    }
    if (payloadType === "stat") {
      return {
        type: "stat",
        live_count: payload.live || 0,
      };
    }
    return null;
  } catch (err) {
    console.error(`Error in func(clean_msg) : ${err}`);
    return null;
  }
}
async function connectToAparat() {
  let retry = 0;
  const DELAY = 5000;
  while (true) {
    try {
      const jwtoken = await getJwt(STREAMER_NAME);
      retry = 0;
      const uri =
        `wss://lws.aparat.com/v1?JWT=${jwtoken}&source=aparat&room=${STREAMER_NAME}`;
      console.log(uri);
      await new Promise<void>((resolveDisconnection) => {
        const ws = new WebSocket(uri);

        ws.onopen = () => console.log("Connected to Aparat!");

        ws.onmessage = (event) => {
          const msg = event.data.toString();
          const cleanedMsg = cleanMsg(msg);
          if (cleanedMsg) {
            console.log(cleanedMsg);
            broadcaster(cleanedMsg);
          }
        };

        ws.onerror = (err) => console.log(`WS Error : ${err}`);
        ws.onclose = () => {
          console.log("Disconnected!");
          resolveDisconnection();
        };
      });
    } catch (err) {
      retry++;
      console.log(`Connection Failed : ${err}`);
      await wait(DELAY);
    }
  }
}
function broadcaster(data: CleanMessage) {
  if (WS_CLIENTS.size === 0) return;

  const payload = JSON.stringify(data);
  for (const client of WS_CLIENTS) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    } else {
      WS_CLIENTS.delete(client);
    }
  }
}

function cleanupCache() {
  const now = Date.now();
  for (const [username, time] of RECENT_FOLLOWS) {
    if (now - time > FOLLOW_COOLDOWN) {
      RECENT_FOLLOWS.delete(username);
      console.log(`${username} cleared.`);
    }
  }
}
function startLocalWS() {
  console.log("WS Server started at wss://localhost:10000");

  setInterval(cleanupCache, CLEANUP_INTERVAL);
  Deno.serve({ port: 10000 }, (req) => {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {
      WS_CLIENTS.add(socket);
      socket.send("Welcome!");
    };

    socket.onmessage = (event) => {
      console.log("📨 Received:", event.data);
      socket.send(`Echo: ${event.data}`);
    };

    socket.onclose = () => {
      WS_CLIENTS.delete(socket);
      console.log("🔴 Client disconnected");
    };

    socket.onerror = (err) => {
      WS_CLIENTS.delete(socket);
      console.error("WebSocket error:", err);
    };

    return response;
  });
}
async function main() {
  startLocalWS();
  await connectToAparat();
}
main();
