const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value) {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

export async function createLiveKitToken({ apiKey, apiSecret, identity, roomName, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!apiKey || !apiSecret || !identity || !roomName) {
    throw new Error("LiveKit token inputs are incomplete.");
  }

  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    iss: apiKey,
    sub: identity,
    nbf: nowSeconds - 5,
    exp: nowSeconds + 600,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    },
  });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput)));
  return `${signingInput}.${base64Url(signature)}`;
}
