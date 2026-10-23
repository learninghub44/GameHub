import { configuration, json, serviceFetch } from "../../_shared/api.js";

async function matchesSignature(rawBody, signature, secret) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (signature.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) {
    difference |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export async function onRequestPost({ request, env }) {
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: "Payment webhook is not configured." }, 503);
  let rawBody;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
    if (rawBody.byteLength > 1_000_000) return json({ error: "Webhook payload is too large." }, 413);
    if (!await matchesSignature(rawBody, request.headers.get("x-paystack-signature"), env.PAYSTACK_SECRET_KEY)) {
      return json({ error: "Invalid webhook signature." }, 401);
    }
  } catch {
    return json({ error: "Webhook signature verification failed." }, 400);
  }

  let event;
  try {
    event = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return json({ error: "Invalid webhook JSON." }, 400);
  }
  const reference = event?.data?.reference || event?.data?.transaction?.reference;
  if (event?.event !== "charge.success" && event?.event !== "refund.processed") {
    return json({ received: true });
  }
  if (typeof reference !== "string" || reference.length > 100) return json({ error: "Missing payment reference." }, 400);

  try {
    const { service } = configuration(env);
    if (event.event === "charge.success") {
      const verified = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      });
      const verification = await verified.json();
      const transaction = verification?.data;
      if (!verified.ok || !verification.status || transaction?.status !== "success") {
        return json({ error: "Payment verification failed." }, 502);
      }
      await serviceFetch(env, "/rest/v1/rpc/finalize_paystack_payment", {
        method: "POST",
        body: JSON.stringify({
          requested_reference: reference,
          requested_transaction_id: String(transaction.id),
          requested_amount_minor: transaction.amount,
          requested_currency: transaction.currency,
        }),
      });
      return json({ received: true });
    }

    const refundId = String(event.data?.id || "");
    const refundAmount = Number(event.data?.amount);
    const refundCurrency = String(event.data?.currency || "");
    const payments = await serviceFetch(env, `/rest/v1/payments?reference=eq.${encodeURIComponent(reference)}&select=amount_minor,currency_code&limit=1`);
    const payment = payments?.[0];
    if (!payment || payment.amount_minor !== refundAmount || payment.currency_code !== refundCurrency || !refundId) {
      console.error("A partial or unmatched Paystack refund needs manual review.");
      return json({ received: true, reviewRequired: true });
    }
    await serviceFetch(env, "/rest/v1/rpc/finalize_paystack_refund", {
      method: "POST",
      body: JSON.stringify({
        requested_reference: reference,
        requested_refund_id: refundId,
        requested_amount_minor: refundAmount,
        requested_currency: refundCurrency,
      }),
    });
    return json({ received: true });
  } catch (error) {
    console.error("Paystack webhook processing failed:", error.message);
    return json({ error: "Webhook could not be processed. Paystack may retry it." }, 502);
  }
}
