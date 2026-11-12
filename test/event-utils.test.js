const test = require("node:test");
const assert = require("node:assert/strict");
const { fromEventDatabase, validateEvent } = require("../event-utils");

const eventDetails = {
  title: "Club Night",
  organizer: "Mora Music Club",
  venue: "Lagan",
  date: "2026-12-01"
};

test("validates organizer details for free and paid events", () => {
  assert.equal(validateEvent({ ...eventDetails, price: 0 }).price, 0);
  assert.equal(validateEvent({ ...eventDetails, price: 1500 }).price, 1500);
  assert.equal(validateEvent({ ...eventDetails, organizer: "", price: 0 }), null);
  assert.equal(validateEvent({ ...eventDetails, price: -1 }), null);
});

test("maps event database rows to the public event shape", () => {
  assert.deepEqual(fromEventDatabase({
    id: "event-1",
    title: "Club Night",
    organizer: "Mora Music Club",
    venue: "Lagan",
    date: "2026-12-01",
    price: "1500.00"
  }), {
    id: "event-1",
    title: "Club Night",
    organizer: "Mora Music Club",
    venue: "Lagan",
    date: "2026-12-01",
    price: 1500
  });
});
