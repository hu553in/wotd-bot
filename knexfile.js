module.exports = {
  development: {
    client: "sqlite3",
    connection: {
      filename: "./db.sqlite",
    },
    useNullAsDefault: true,
    migrations: {
      directory: "./migrations",
    },
  },
};
