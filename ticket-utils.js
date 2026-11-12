function fromTicketDatabase(row) {
  return {
    code: row.code,
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventDate: row.event_date,
    buyerName: row.buyer_name
  };
}

module.exports = { fromTicketDatabase };
