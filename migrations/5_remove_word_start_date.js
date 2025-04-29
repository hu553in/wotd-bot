exports.up = async function (knex) {
  await knex.schema.alterTable("chats", (table) => {
    table.dropColumn("word_start_date");
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("chats", (table) => {
    table.text("word_start_date");
  });
};
