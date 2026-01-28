
import { resolve } from "node:path";

interface CleanMessage {
  type: "new_follow" | "donate_emoji" | "stat";
  username?: string;
  ruby_amount?: number;
  live_count?: number;
}
interface AparatPayload {
  type: string;
  data: {
    username?: string;
    sponsor_username?: string;
    emoji_coin_count?: number;
    live?: number;

  };
}

interface AparatResponse {
  response_type: "stat" | "update_status";
  response_data?: {
    live?: number;
    payload?: {
      type?: "new_follow" | "donate_emoji";
      data: {
        username?: string;
        sponsor_username?: string;
        emoji_coin_count?: number;
      };
    };
  };

}

const STREAMER_NAME = "rest_in_peace";
const WS_CLIENTS = new Set<WebSocket>();
// const sharedData: string[] = [];
async function getJwt(streamerName: string): Promise<string> {
  try {
    const response = await fetch(
      `https://www.aparat.com/api/fa/v2/Live/LiveStream/show/username/${streamerName}`,
    );
    const data = (await response.json()) as any;

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
        return {
          type: "new_follow",
          username: payload.payload.data.username || "undefined",
        };
      } else if (payload.payload?.type === "donate_emoji") {
        return {
          type: "new_follow",
          username: payload.payload?.data.sponsor_username || "undefined",
          ruby_amount: payload.payload?.data.emoji_coin_count || 0,
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
  while (true) {
    try {
      const jwtoken = await getJwt(STREAMER_NAME);
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
      console.log(`Connection Failed : ${err}`);
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
function startLocalWS() {
  console.log("WS Server started at wss://localhost:10000");
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
