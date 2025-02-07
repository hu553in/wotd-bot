exports.up = async function (knex) {
  const hasChats = await knex.schema.hasTable("chats");
  if (!hasChats) {
    await knex.schema.createTable("chats", (table) => {
      table.text("chat_id").primary();
      table.text("chat_type");
      table.text("chat_title");
      table.text("last_sent_date");
      table.text("send_time").defaultTo("09:00");
      table.text("timezone").defaultTo("+03:00");
    });
  }

  const hasWords = await knex.schema.hasTable("words");
  if (!hasWords) {
    await knex.schema.createTable("words", (table) => {
      table.increments("id").primary();
      table.text("chat_id").notNullable();
      table.text("word").notNullable();
    });
  }

  const hasHistory = await knex.schema.hasTable("history");
  if (!hasHistory) {
    await knex.schema.createTable("history", (table) => {
      table.text("chat_id").notNullable();
      table.integer("word_id").notNullable();
      table.primary(["chat_id", "word_id"]);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("history");
  await knex.schema.dropTableIfExists("words");
  await knex.schema.dropTableIfExists("chats");
};
