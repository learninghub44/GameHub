export function whatsappShareUrl(message, publicUrl, mobile = false) {
  const base = mobile ? "https://wa.me/?text=" : "https://web.whatsapp.com/send?text=";
  return `${base}${encodeURIComponent(`${String(message || "").trim()}\n${publicUrl}`)}`;
}
