const crypto = require("crypto");

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex").toUpperCase();
}

function formatAmount(amount) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) {
    throw new Error("Payment amount must be a non-negative number.");
  }
  return numericAmount.toFixed(2);
}

function createCheckoutHash(merchantId, orderId, amount, currency, merchantSecret) {
  const secretHash = md5(merchantSecret);
  return md5(`${merchantId}${orderId}${formatAmount(amount)}${currency}${secretHash}`);
}

function verifyNotificationSignature(notification, merchantSecret) {
  if (!/^[A-F0-9]{32}$/i.test(notification.md5sig || "")) return false;
  const secretHash = md5(merchantSecret);
  const expected = md5(
    `${notification.merchant_id}${notification.order_id}${notification.payhere_amount}` +
    `${notification.payhere_currency}${notification.status_code}${secretHash}`
  );
  const supplied = Buffer.from(notification.md5sig.toUpperCase(), "hex");
  const calculated = Buffer.from(expected, "hex");
  return supplied.length === calculated.length && crypto.timingSafeEqual(supplied, calculated);
}

module.exports = { createCheckoutHash, formatAmount, verifyNotificationSignature };
