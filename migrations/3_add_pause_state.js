exports.up = async function (knex) {
  await knex.schema.alterTable("chats", (table) => {
    table.boolean("is_paused").defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("chats", (table) => {
    table.dropColumn("is_paused");
  });
};
