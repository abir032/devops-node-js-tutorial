module.exports = {
  HOST: process.env.DB_HOST || "localhost",
  READ_HOST: process.env.DB_READ_HOST || process.env.DB_HOST || "localhost",
  USER: process.env.DB_USER || "appuser",
  PASSWORD: process.env.DB_PASSWORD,
  DB: process.env.DB_NAME || "testdb"
};

