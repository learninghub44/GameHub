import { authenticatedUser, json, serviceFetch } from "../../_shared/api.js";

export async function onRequestGet({ request, env }) {
  let user;
  try {
    user = await authenticatedUser(request, env);
  } catch {
    return json({ error: "Authentication service is temporarily unavailable." }, 503);
  }
  if (!user) return json({ error: "Sign in again to verify this payment." }, 401);
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: "Payments are not configured." }, 503);

  const reference = new URL(request.url).searchParams.get("reference");
  if (!reference || !/^GH_[a-f0-9]{32}$/i.test(reference)) return json({ error: "Invalid payment reference." }, 400);
  try {
    const payments = await serviceFetch(env, `/rest/v1/payments?reference=eq.${encodeURIComponent(reference)}&select=id,order_id,status&limit=1`);
    const payment = payments?.[0];
    if (!payment) return json({ error: "Payment not found." }, 404);
    const orders = await serviceFetch(env, `/rest/v1/orders?id=eq.${payment.order_id}&select=id,user_id&limit=1`);
    if (orders?.[0]?.user_id !== user.id) return json({ error: "Payment not found." }, 404);
    if (payment.status === "paid") return json({ status: "paid" });
    if (payment.status !== "pending") return json({ status: payment.status });

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
    });
    const verification = await response.json();
    const transaction = verification?.data;
    if (!response.ok || !verification.status) return json({ error: "Paystack verification is unavailable." }, 502);
    if (transaction?.status !== "success") return json({ status: transaction?.status || "pending" });

    await serviceFetch(env, "/rest/v1/rpc/finalize_paystack_payment", {
      method: "POST",
      body: JSON.stringify({
        requested_reference: reference,
        requested_transaction_id: String(transaction.id),
        requested_amount_minor: transaction.amount,
        requested_currency: transaction.currency,
      }),
    });
    return json({ status: "paid" });
  } catch (error) {
    console.error("Paystack verification failed:", error.message);
    return json({ error: "Payment verification could not be completed." }, 502);
  }
}
