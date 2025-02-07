exports.up = function (knex) {
  return knex.schema.alterTable("chats", (table) => {
    table.integer("days").defaultTo(1);
    table.integer("current_word_id");
    table.text("word_start_date");
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("chats", (table) => {
    table.dropColumn("days");
    table.dropColumn("current_word_id");
    table.dropColumn("word_start_date");
  });
};
