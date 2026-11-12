function cleanText(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

function validateEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const event = {
    title: cleanText(body.title, 200),
    organizer: cleanText(body.organizer, 100),
    venue: cleanText(body.venue, 120),
    date: cleanText(body.date, 10),
    price: Number(body.price)
  };
  if (!event.title || !event.organizer || !event.venue ||
      !/^\d{4}-\d{2}-\d{2}$/.test(event.date) ||
      !Number.isFinite(event.price) || event.price < 0) {
    return null;
  }
  return event;
}

function fromEventDatabase(row) {
  return {
    id: row.id,
    title: row.title,
    organizer: row.organizer,
    venue: row.venue,
    date: row.date,
    price: Number(row.price)
  };
}

module.exports = { fromEventDatabase, validateEvent };
