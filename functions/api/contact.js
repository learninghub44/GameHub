import { json } from "../_shared/api.js";

const categories = new Set(["general", "technical", "partnerships", "creator", "tournament", "payments", "privacy"]);

function failure(code, message, requestId, status) {
  return json({ error: { code, message, requestId } }, status);
}

export async function onRequestPost({ request, env }) {
  const requestId = crypto.randomUUID();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.error(JSON.stringify({ requestId, code: "SERVICE_UNAVAILABLE", service: "contact" }));
    return failure("SERVICE_UNAVAILABLE", "Contact support is temporarily unavailable. Please try again later.", requestId, 503);
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return failure("INVALID_CONTENT_TYPE", "Send the form using the supported format.", requestId, 415);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8_000) return failure("REQUEST_TOO_LARGE", "The message is too large. Shorten it and try again.", requestId, 413);

  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) return failure("INVALID_JSON", "The form could not be read. Review it and try again.", requestId, 400);
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 8_000) {
        await reader.cancel();
        return failure("REQUEST_TOO_LARGE", "The message is too large. Shorten it and try again.", requestId, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = new TextDecoder().decode(bytes);
    input = JSON.parse(body);
  } catch {
    return failure("INVALID_JSON", "The form could not be read. Review it and try again.", requestId, 400);
  }

  const fields = ["name", "email", "category", "subject", "message"];
  if (fields.some((field) => typeof input?.[field] !== "string")
    || !categories.has(input.category)
    || input.name.trim().length < 1 || input.name.trim().length > 100
    || input.email.trim().length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
    || input.subject.trim().length < 4 || input.subject.trim().length > 160
    || input.message.trim().length < 10 || input.message.trim().length > 5000) {
    return failure("VALIDATION_ERROR", "Check your name, email, category, subject and message, then try again.", requestId, 422);
  }

  try {
    const ip = request.headers.get("CF-Connecting-IP") || "local-development";
    const fingerprint = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}\n${input.email.trim().toLowerCase()}`));
    const rateKey = [...new Uint8Array(fingerprint)].map((value) => value.toString(16).padStart(2, "0")).join("");
    const suppliedAuthorization = request.headers.get("Authorization");
    const authorization = suppliedAuthorization && /^Bearer \S+$/.test(suppliedAuthorization)
      ? suppliedAuthorization
      : `Bearer ${env.SUPABASE_ANON_KEY}`;
    const baseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/rest/v1/rpc/submit_contact_request`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requested_name: input.name.trim(),
        requested_email: input.email.trim().toLowerCase(),
        requested_category: input.category,
        requested_subject: input.subject.trim(),
        requested_message: input.message.trim(),
        requested_rate_key: rateKey,
      }),
    });
    if (response.status === 429) {
      return failure("RATE_LIMITED", "Please wait before sending another contact request.", requestId, 429);
    }
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      if (result?.code === "P0001") return failure("RATE_LIMITED", "Please wait before sending another contact request.", requestId, 429);
      if (result?.code === "22023") return failure("VALIDATION_ERROR", "Check your contact details and message fields.", requestId, 422);
      console.error(JSON.stringify({ requestId, code: "CONTACT_STORAGE_FAILED", status: response.status }));
      return failure("SERVICE_UNAVAILABLE", "Your message was not submitted. Please try again later.", requestId, 503);
    }
    const submissionId = await response.json();
    if (typeof submissionId !== "string") {
      console.error(JSON.stringify({ requestId, code: "CONTACT_INVALID_RESPONSE" }));
      return failure("SERVICE_UNAVAILABLE", "Your message could not be confirmed. Please try again later.", requestId, 503);
    }
    return json({ data: { reference: submissionId }, requestId }, 201);
  } catch (error) {
    console.error(JSON.stringify({ requestId, code: "CONTACT_REQUEST_FAILED", name: error.name }));
    return failure("SERVICE_UNAVAILABLE", "Contact support is temporarily unavailable. Please try again later.", requestId, 503);
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    const requestId = crypto.randomUUID();
    return failure("METHOD_NOT_ALLOWED", "Use the contact form to send a message.", requestId, 405);
  }
  return onRequestPost({ request, env });
}
