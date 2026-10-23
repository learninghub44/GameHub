import { authenticatedUser, configuration, json, serviceFetch, validUuid } from "../../_shared/api.js";

export async function onRequestPost({ request, env }) {
  if (env.MARKETPLACE_PURCHASES_ENABLED !== "true") {
    return json({ error: "Marketplace checkout is disabled for this deployment." }, 503);
  }

  let user;
  try {
    user = await authenticatedUser(request, env);
  } catch {
    return json({ error: "Authentication service is temporarily unavailable." }, 503);
  }
  if (!user) return json({ error: "Sign in to make a purchase." }, 401);
  if (!env.PAYSTACK_SECRET_KEY || !env.GAMEHUB_ORIGIN) {
    return json({ error: "Payments are not configured for this deployment." }, 503);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid JSON request." }, 400);
  }
  if (!validUuid(input?.productId) || !validUuid(input?.idempotencyKey)) {
    return json({ error: "A valid product and idempotency key are required." }, 400);
  }

  const origin = new URL(env.GAMEHUB_ORIGIN);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
    return json({ error: "The configured payment return origin must use HTTPS." }, 503);
  }

  try {
    configuration(env);
    const checkoutRows = await serviceFetch(env, "/rest/v1/rpc/create_checkout_order", {
      method: "POST",
      body: JSON.stringify({
        requested_user_id: user.id,
        requested_product_id: input.productId,
        requested_idempotency_key: input.idempotencyKey,
      }),
    });
    const checkout = checkoutRows?.[0];
    if (!checkout) throw new Error("Checkout order could not be created.");
    if (checkout.authorization_url) return json({ authorizationUrl: checkout.authorization_url });

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: checkout.amount_minor,
        currency: checkout.currency_code,
        reference: checkout.payment_reference,
        callback_url: `${origin.origin}/?payment=return`,
        metadata: { order_id: checkout.order_id, product_id: input.productId },
      }),
    });
    const paystack = await response.json();
    if (!response.ok || !paystack.status || !paystack.data?.authorization_url) {
      await serviceFetch(env, `/rest/v1/payments?reference=eq.${encodeURIComponent(checkout.payment_reference)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "failed" }),
      });
      await serviceFetch(env, `/rest/v1/orders?id=eq.${checkout.order_id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      return json({ error: "Paystack could not start checkout. Please try again." }, 502);
    }
    await serviceFetch(env, `/rest/v1/payments?reference=eq.${encodeURIComponent(checkout.payment_reference)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ authorization_url: paystack.data.authorization_url }),
    });
    return json({ authorizationUrl: paystack.data.authorization_url });
  } catch (error) {
    const message = /rate limit/i.test(error.message) ? "Too many checkout attempts. Please try again later." : error.message;
    const status = /rate limit/i.test(error.message) ? 429 : 502;
    return json({ error: message }, status);
  }
}
