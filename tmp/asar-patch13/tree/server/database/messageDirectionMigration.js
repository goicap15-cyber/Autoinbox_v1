function ensureMessageDirectionStatus(db) {
  const columns = db.pragma('table_info(messages)');
  if (!columns.some((column) => column.name === 'direction_status')) {
    db.exec("ALTER TABLE messages ADD COLUMN direction_status TEXT NOT NULL DEFAULT 'confirmed' CHECK(direction_status IN ('confirmed', 'pending'));");
  }
  db.exec("UPDATE messages SET direction_status = 'confirmed' WHERE direction_status IS NULL OR direction_status NOT IN ('confirmed', 'pending');");
}

module.exports = { ensureMessageDirectionStatus };
