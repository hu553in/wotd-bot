exports.up = async function (knex) {
  await knex.schema.alterTable("chats", (table) => {
    table.integer("current_word_sends").defaultTo(0);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("chats", (table) => {
    table.dropColumn("current_word_sends");
  });
};
