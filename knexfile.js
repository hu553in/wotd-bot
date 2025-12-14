module.exports = {
  development: {
    client: "sqlite3",
    connection: {
      filename: process.env.DB_PATH || "db.sqlite",
    },
    useNullAsDefault: true,
    migrations: {
      directory: "./migrations",
    },
  },
};
