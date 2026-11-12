const test = require("node:test");
const assert = require("node:assert/strict");
const { fromTicketDatabase } = require("../ticket-utils");

test("maps ticket database fields to the ticket display fields", () => {
  assert.deepEqual(fromTicketDatabase({
    code: "MORA-123",
    event_id: "event-1",
    event_title: "Campus Fest",
    event_date: "2026-11-20",
    buyer_name: "Alex Mora"
  }), {
    code: "MORA-123",
    eventId: "event-1",
    eventTitle: "Campus Fest",
    eventDate: "2026-11-20",
    buyerName: "Alex Mora"
  });
});
