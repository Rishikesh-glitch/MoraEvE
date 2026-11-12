const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  createCheckoutHash,
  formatAmount,
  verifyNotificationSignature
} = require("../payment-utils");

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex").toUpperCase();
}

test("formats PayHere amounts to two decimal places", () => {
  assert.equal(formatAmount(1500), "1500.00");
  assert.equal(formatAmount(12.5), "12.50");
  assert.throws(() => formatAmount(-1));
});

test("creates the PayHere checkout hash from the server secret", () => {
  const secretHash = md5("sandbox-secret");
  const expected = md5(`merchant-1order-11500.00LKR${secretHash}`);
  assert.equal(createCheckoutHash("merchant-1", "order-1", 1500, "LKR", "sandbox-secret"), expected);
});

test("verifies notifications and rejects altered payment fields", () => {
  const notification = {
    merchant_id: "merchant-1",
    order_id: "order-1",
    payhere_amount: "1500.00",
    payhere_currency: "LKR",
    status_code: "2"
  };
  notification.md5sig = md5(
    `${notification.merchant_id}${notification.order_id}${notification.payhere_amount}` +
    `${notification.payhere_currency}${notification.status_code}${md5("sandbox-secret")}`
  );

  assert.equal(verifyNotificationSignature(notification, "sandbox-secret"), true);
  assert.equal(verifyNotificationSignature({ ...notification, payhere_amount: "1.00" }, "sandbox-secret"), false);
  assert.equal(verifyNotificationSignature({ ...notification, md5sig: "invalid" }, "sandbox-secret"), false);
});
