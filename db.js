const mysql = require('mysql2');
const fs = require('fs');
require('dotenv').config();

const connectionConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

// Add SSL config only if certificate file exists
if (process.env.DB_SSL_CA && fs.existsSync(process.env.DB_SSL_CA)) {
  connectionConfig.ssl = {
    ca: fs.readFileSync(process.env.DB_SSL_CA)
  };
}

const connection = mysql.createConnection(connectionConfig);

connection.connect((err) => {
    if (err) {
        console.error('❌ Localhost Database connection failed:', err);
        return;
    }
    console.log('✅ Connected to Localhost Database !');
});

// Handle connection errors and attempt reconnection
connection.on('error', (err) => {
    console.error('Database connection error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
        console.log('Attempting to reconnect...');
        connection.connect();
    } else {
        throw err;
    }
}); 

module.exports = connection;
