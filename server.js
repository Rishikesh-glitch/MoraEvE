// MoraEvE – Node.js back end. Run: npm start
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  createCheckoutHash,
  formatAmount,
  verifyNotificationSignature
} = require("./payment-utils");
const { fromTicketDatabase } = require("./ticket-utils");
const { fromEventDatabase, validateEvent } = require("./event-utils");

const ROOT = __dirname;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const RESOURCES = new Set(["events", "registrations", "members"]);
const STATIC_FILES = new Set(["index.html", "script.js", "style.css"]);

function loadEnv() {
  const envFile = path.join(ROOT, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith("#") || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnv();

const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PAYHERE_MERCHANT_ID = process.env.PAYHERE_MERCHANT_ID || "";
const PAYHERE_MERCHANT_SECRET = process.env.PAYHERE_MERCHANT_SECRET || "";
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const PAYHERE_NOTIFY_URL = process.env.PAYHERE_NOTIFY_URL || "";
const MAX_TICKETS_PER_ORDER = 5;
const PAYHERE_CHECKOUT_URL = "https://sandbox.payhere.lk/pay/checkout";
const SUPABASE_CONFIGURED = Boolean(
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !/YOUR_PROJECT_ID|PASTE_YOUR_SUPABASE_ANON_KEY_HERE/i.test(`${SUPABASE_URL} ${SUPABASE_ANON_KEY}`) &&
  (() => {
    try { return new URL(SUPABASE_URL).protocol === "https:"; } catch { return false; }
  })()
);

const clean = (value, limit = 200) => String(value ?? "").trim().slice(0, limit);
const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

function validate(resource, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (resource === "events") {
    const event = validateEvent(body);
    return event ? { id: crypto.randomUUID(), ...event } : null;
  }
  if (resource === "registrations") {
    const registration = {
      id: crypto.randomUUID(),
      eventId: clean(body.eventId, 40),
      eventTitle: clean(body.eventTitle),
      name: clean(body.name, 100),
      email: clean(body.email, 120)
    };
    return registration.id && registration.eventId && registration.name &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registration.email) ? registration : null;
  }
  const member = {
    id: clean(body.id, 40),
    name: clean(body.name, 100),
    email: clean(body.email, 120)
  };
  return member.id && member.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email) ? member : null;
}

function fromDatabase(resource, row) {
  if (resource === "events") {
    return fromEventDatabase(row);
  }
  if (resource === "registrations") {
    return { id: row.id, eventId: row.event_id, eventTitle: row.event_title, name: row.name, email: row.email, at: row.registered_at };
  }
  return { id: row.id, name: row.name, email: row.email, at: row.created_at };
}

async function supabaseRequest(resource, method, body, accessToken) {
  const columns = resource === "events"
    ? "id,title,organizer,venue,date,price"
    : resource === "registrations"
      ? "id,event_id,event_title,name,email,registered_at"
      : "id,name,email,created_at";
  const url = new URL(`/rest/v1/${resource}`, SUPABASE_URL);
  url.searchParams.set("select", columns);
  if (method === "GET") {
    const order = resource === "events" ? "date.asc" : resource === "registrations" ? "registered_at.desc" : "created_at.desc";
    url.searchParams.set("order", order);
  }
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  else if (SUPABASE_ANON_KEY.split(".").length === 3) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : null; } catch { result = null; }
  if (!response.ok) {
    const detail = result && (result.message || result.details || result.hint);
    console.error(`Supabase ${method} ${resource} failed (${response.status}): ${detail || text}`);
    if (response.status === 409 && resource === "registrations") {
      throw Object.assign(new Error("You are already registered for this event."), { status: 409 });
    }
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error("Please sign in, or your account does not have permission for this action."), { status: response.status });
    }
    throw new Error("Database request failed. Check the Supabase schema and server credentials.");
  }
  return result;
}

function ticketStorageAvailable() {
  return Boolean(
    SUPABASE_SERVICE_ROLE_KEY &&
    !/YOUR_|PASTE_/i.test(SUPABASE_SERVICE_ROLE_KEY)
  );
}

function payhereConfigAvailable() {
  return Boolean(
    PAYHERE_MERCHANT_ID &&
    PAYHERE_MERCHANT_SECRET &&
    !/YOUR_|PASTE_/i.test(`${PAYHERE_MERCHANT_ID} ${PAYHERE_MERCHANT_SECRET}`)
  );
}

function serviceUrl(resource, query = {}) {
  const url = new URL(`/rest/v1/${resource}`, SUPABASE_URL);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function serviceRequest(resource, method = "GET", body, query = {}, prefer = "return=representation") {
  const response = await fetch(serviceUrl(resource, query), {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : null; } catch { result = null; }
  if (!response.ok) {
    console.error(`Supabase privileged request failed (${response.status}): ${result?.message || "request rejected"}`);
    throw Object.assign(new Error("Ticket storage failed. Check the Supabase ticket setup."), { status: 502 });
  }
  return result;
}

async function readBody(req, limit = 100_000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error("Request body is too large."), { status: 413 });
  }
  return raw;
}

async function readJsonBody(req) {
  try {
    const raw = await readBody(req);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("Bad JSON."), { status: 400 });
  }
}

async function requireVerifiedUser(req, res) {
  const accessToken = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    json(res, 401, { error: "Sign in with a verified email to continue." });
    return null;
  }
  const response = await fetch(new URL("/auth/v1/user", SUPABASE_URL), {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    json(res, 401, { error: "Your session has expired. Sign in again." });
    return null;
  }
  const user = await response.json();
  if (!user.email_confirmed_at) {
    json(res, 403, { error: "Confirm your email before buying or enrolling." });
    return null;
  }
  return user;
}

function validateQuantity(value) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_TICKETS_PER_ORDER
    ? quantity
    : null;
}

function safeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function buildBuyer(body, user) {
  const firstName = safeText(body.firstName, 60);
  const lastName = safeText(body.lastName, 60);
  const phone = safeText(body.phone, 40);
  const IndexNumber = safeText(body.IndexNumber, 120);
  const Department = safeText(body.Department, 60);
  const Faculty = safeText(body.Faculty, 60);
  const metadataName = safeText(user.user_metadata?.full_name || user.user_metadata?.name, 120);
  const buyerName = `${firstName} ${lastName}`.trim() || metadataName || safeText(user.email?.split("@")[0], 60);
  if (!buyerName) throw Object.assign(new Error("Enter your name before enrolling."), { status: 422 });
  return { firstName, lastName, phone, IndexNumber, Department, Faculty, buyerName };
}

async function findEvent(eventId) {
  const rows = await serviceRequest("events", "GET", undefined, {
    select: "id,title,venue,date,price",
    id: `eq.${eventId}`,
    limit: "1"
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function createTicketOrder({ event, user, quantity, buyer, status }) {
  const totalAmount = Number(event.price) * quantity;
  const order = {
    id: crypto.randomUUID(),
    user_id: user.id,
    event_id: event.id,
    event_title: event.title,
    event_date: event.date,
    buyer_name: buyer.buyerName,
    buyer_email: user.email,
    quantity,
    total_amount: totalAmount.toFixed(2),
    currency: "LKR",
    status
  };
  const rows = await serviceRequest("ticket_orders", "POST", order);
  if (!Array.isArray(rows) || !rows[0]) {
    throw Object.assign(new Error("Could not create the ticket order."), { status: 502 });
  }
  return rows[0];
}

async function issueTickets(orderId, amount, currency, transactionId) {
  return serviceRequest("rpc/finalize_ticket_order", "POST", {
    p_order_id: orderId,
    p_transaction_id: transactionId || null,
    p_amount: amount,
    p_currency: currency
  });
}

async function getOrderTickets(orderId, userId) {
  const rows = await serviceRequest("tickets", "GET", undefined, {
    select: "code,event_id,event_title,event_date,buyer_name,created_at",
    order_id: `eq.${orderId}`,
    user_id: `eq.${userId}`,
    order: "created_at.asc"
  });
  return Array.isArray(rows) ? rows.map(fromTicketDatabase) : [];
}

async function handleFreeEnrollment(req, res) {
  if (!SUPABASE_CONFIGURED || !ticketStorageAvailable()) {
    return json(res, 503, { error: "Configure Supabase ticket storage before enrolling." });
  }
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const quantity = validateQuantity(body.quantity);
  if (!quantity) return json(res, 422, { error: `Choose between 1 and ${MAX_TICKETS_PER_ORDER} tickets.` });
  const event = await findEvent(safeText(body.eventId, 80));
  if (!event) return json(res, 404, { error: "Event not found. Refresh the events page and try again." });
  if (Number(event.price) !== 0) return json(res, 422, { error: "Paid events must use PayHere checkout." });
  const buyer = buildBuyer(body, user);
  const order = await createTicketOrder({ event, user, quantity, buyer, status: "free_pending" });
  await issueTickets(order.id, 0, "LKR", null);
  const tickets = await getOrderTickets(order.id, user.id);
  return json(res, 201, { status: "paid", tickets });
}

async function handleCheckout(req, res) {
  if (!SUPABASE_CONFIGURED || !ticketStorageAvailable() || !payhereConfigAvailable()) {
    return json(res, 503, {
      error: "Configure Supabase service-role access and PayHere sandbox credentials in .env."
    });
  }
  if (!PAYHERE_NOTIFY_URL || /YOUR_|PASTE_/i.test(PAYHERE_NOTIFY_URL)) {
    return json(res, 503, {
      error: "Set PAYHERE_NOTIFY_URL to a public HTTPS URL ending in /api/payhere/notify."
    });
  }
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const quantity = validateQuantity(body.quantity);
  if (!quantity) return json(res, 422, { error: `Choose between 1 and ${MAX_TICKETS_PER_ORDER} tickets.` });
  const event = await findEvent(safeText(body.eventId, 80));
  if (!event) return json(res, 404, { error: "Event not found. Refresh the events page and try again." });
  if (!(Number(event.price) > 0)) return json(res, 422, { error: "This event does not require payment." });
  const buyer = buildBuyer(body, user);
  if (!buyer.firstName || !buyer.lastName || !buyer.phone || !buyer.IndexNumber || !buyer.Department || !buyer.Faculty) {
    return json(res, 422, { error: "Complete all billing contact fields before checkout." });
  }
  let notifyUrl;
  let appUrl;
  try {
    notifyUrl = new URL(PAYHERE_NOTIFY_URL);
    appUrl = new URL(APP_BASE_URL);
  } catch {
    return json(res, 503, { error: "APP_BASE_URL and PAYHERE_NOTIFY_URL must be valid URLs." });
  }
  if (notifyUrl.protocol !== "https:" || !notifyUrl.pathname.endsWith("/api/payhere/notify")) {
    return json(res, 503, { error: "PAYHERE_NOTIFY_URL must be a public HTTPS URL ending in /api/payhere/notify." });
  }
  const order = await createTicketOrder({ event, user, quantity, buyer, status: "pending" });
  const amount = formatAmount(order.total_amount);
  const returnUrl = new URL("/", appUrl);
  returnUrl.searchParams.set("payment", "returned");
  returnUrl.searchParams.set("order_id", order.id);
  const cancelUrl = new URL("/", appUrl);
  cancelUrl.searchParams.set("payment", "cancelled");
  cancelUrl.searchParams.set("order_id", order.id);
  const fields = {
    merchant_id: PAYHERE_MERCHANT_ID,
    return_url: returnUrl.toString(),
    cancel_url: cancelUrl.toString(),
    notify_url: notifyUrl.toString(),
    order_id: order.id,
    items: `${event.title} - ${quantity} ticket${quantity === 1 ? "" : "s"}`,
    currency: "LKR",
    amount,
    first_name: buyer.firstName,
    last_name: buyer.lastName,
    email: user.email,
    phone: buyer.phone,
    IndexNumber: buyer.IndexNumber,
    Department: buyer.Department,
    Faculty: buyer.Faculty
  };
  fields.hash = createCheckoutHash(
    PAYHERE_MERCHANT_ID,
    order.id,
    amount,
    "LKR",
    PAYHERE_MERCHANT_SECRET
  );
  return json(res, 200, { url: PAYHERE_CHECKOUT_URL, fields });
}

async function handlePayhereNotification(req, res) {
  if (!ticketStorageAvailable() || !payhereConfigAvailable()) {
    return json(res, 503, { error: "PayHere is not configured." });
  }
  let notification;
  try {
    notification = Object.fromEntries(new URLSearchParams(await readBody(req)));
  } catch (error) {
    return json(res, error.status || 400, { error: error.message || "Invalid notification." });
  }
  if (notification.merchant_id !== PAYHERE_MERCHANT_ID ||
      !verifyNotificationSignature(notification, PAYHERE_MERCHANT_SECRET)) {
    return json(res, 400, { error: "Invalid PayHere notification signature." });
  }
  if (!notification.order_id || !notification.status_code ||
      !notification.payhere_amount || !notification.payhere_currency) {
    return json(res, 400, { error: "PayHere notification is missing required payment fields." });
  }
  if (notification.status_code === "2") {
    const amount = Number(notification.payhere_amount);
    if (!Number.isFinite(amount) || notification.payhere_currency !== "LKR") {
      return json(res, 400, { error: "Invalid payment amount or currency." });
    }
    await issueTickets(notification.order_id, amount, notification.payhere_currency, notification.payment_id);
  } else if (notification.status_code === "-1" || notification.status_code === "-2") {
    await serviceRequest("ticket_orders", "PATCH", {
      status: notification.status_code === "-1" ? "cancelled" : "failed",
      payhere_transaction_id: notification.payment_id || null
    }, { id: `eq.${notification.order_id}`, status: "eq.pending" }, "return=minimal");
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("OK");
}

async function handleMyTickets(req, res) {
  if (!SUPABASE_CONFIGURED || !ticketStorageAvailable()) {
    return json(res, 503, { error: "Ticket storage is not configured." });
  }
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const tickets = await serviceRequest("tickets", "GET", undefined, {
    select: "code,event_id,event_title,event_date,buyer_name,created_at",
    user_id: `eq.${user.id}`,
    order: "created_at.desc"
  });
  return json(res, 200, Array.isArray(tickets) ? tickets.map(fromTicketDatabase) : []);
}

async function handleOrderStatus(req, res, orderId) {
  if (!SUPABASE_CONFIGURED || !ticketStorageAvailable()) {
    return json(res, 503, { error: "Ticket storage is not configured." });
  }
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const rows = await serviceRequest("ticket_orders", "GET", undefined, {
    select: "id,status,event_title,quantity,total_amount,currency",
    id: `eq.${orderId}`,
    user_id: `eq.${user.id}`,
    limit: "1"
  });
  if (!Array.isArray(rows) || !rows[0]) return json(res, 404, { error: "Order not found." });
  return json(res, 200, rows[0]);
}

async function handleSpecialApi(req, res, resource) {
  try {
    if (resource === "payments/checkout" && req.method === "POST") return await handleCheckout(req, res);
    if (resource === "enroll" && req.method === "POST") return await handleFreeEnrollment(req, res);
    if (resource === "payhere/notify" && req.method === "POST") return await handlePayhereNotification(req, res);
    if (resource === "tickets" && req.method === "GET") return await handleMyTickets(req, res);
    const orderMatch = resource.match(/^orders\/([a-f0-9-]+)$/i);
    if (orderMatch && req.method === "GET") return await handleOrderStatus(req, res, orderMatch[1]);
    if (["payments/checkout", "enroll", "payhere/notify", "tickets"].includes(resource) || resource.startsWith("orders/")) {
      return json(res, 405, { error: "Method not allowed." });
    }
    return false;
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { error: error.message || "The server could not complete the request." });
  }
}

async function handleApi(req, res, resource) {
  const specialHandled = await handleSpecialApi(req, res, resource);
  if (specialHandled !== false) return specialHandled;
  if (resource === "config" && req.method === "GET") {
    if (!SUPABASE_CONFIGURED) return json(res, 503, { error: "Set SUPABASE_URL and SUPABASE_ANON_KEY in .env." });
    return json(res, 200, { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  }
  if (!RESOURCES.has(resource)) return json(res, 404, { error: "Unknown resource" });
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  if (resource === "registrations" && req.method === "POST") {
    return json(res, 410, { error: "Use the ticket enrollment endpoint to receive a ticket." });
  }
  if (!SUPABASE_CONFIGURED) {
    return json(res, 503, { error: "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env." });
  }
  const authorization = req.headers.authorization || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if ((req.method === "POST" || resource !== "events") && !accessToken) {
    return json(res, 401, { error: "Sign in is required for this action." });
  }

  try {
    let payload;
    if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100_000) return json(res, 413, { error: "Request body is too large" });
      }
      try { payload = JSON.parse(raw); } catch { return json(res, 400, { error: "Bad JSON" }); }
      payload = validate(resource, payload);
      if (!payload) return json(res, 422, { error: "Invalid data" });
      if (resource === "members") return json(res, 405, { error: "Member profiles are managed by Supabase Auth." });
    }

    const databasePayload = resource === "events"
      ? payload && { id: payload.id, title: payload.title, organizer: payload.organizer, venue: payload.venue, date: payload.date, price: payload.price }
      : resource === "registrations"
        ? payload && { id: payload.id, event_id: payload.eventId, event_title: payload.eventTitle, name: payload.name, email: payload.email }
        : payload && { id: payload.id, name: payload.name, email: payload.email };
    const result = await supabaseRequest(resource, req.method, databasePayload, accessToken);
    const rows = Array.isArray(result) ? result : [];
    if (req.method === "GET") return json(res, 200, rows.map(row => fromDatabase(resource, row)));
    if (!rows[0]) throw new Error("Supabase did not return the saved record.");
    return json(res, 201, fromDatabase(resource, rows[0]));
  } catch (error) {
    console.error(error);
    return json(res, error.status || 502, { error: error.message || "Database request failed." });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url.pathname.slice("/api/".length));
  }

  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  if (!STATIC_FILES.has(requested)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  fs.readFile(path.join(ROOT, requested), (error, content) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(requested)] });
    res.end(content);
  });
});

server.listen(PORT, () => console.log(`MoraEvE running at http://localhost:${PORT}`));
