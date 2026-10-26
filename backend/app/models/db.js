const mysql = require("mysql");
const dbConfig = require("../config/db.config.js");

const login = {
  user: dbConfig.USER,
  password: dbConfig.PASSWORD,
  database: dbConfig.DB
};

// writes: INSERT, UPDATE, DELETE go to the primary
const writer = mysql.createPool({ host: dbConfig.HOST, ...login });

// reads: SELECT go to the replica (falls back to the primary if no replica is set)
const reader = mysql.createPool({ host: dbConfig.READ_HOST, ...login });

module.exports = writer;
module.exports.reader = reader;
