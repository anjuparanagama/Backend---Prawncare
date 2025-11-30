const mysql = require('mysql2');
const fs = require('fs');
require('dotenv').config();

const connectionConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

// Add SSL config for secure connections (Render, production environments)
if (process.env.DB_SSL_CA) {
  try {
    if (fs.existsSync(process.env.DB_SSL_CA)) {
      connectionConfig.ssl = {
        ca: fs.readFileSync(process.env.DB_SSL_CA)
      };
    }
  } catch (err) {
    console.warn('Warning: Could not load SSL certificate:', err.message);
    // Continue without SSL if certificate is not found
  }
} else if (process.env.NODE_ENV === 'production') {
  // Use default SSL in production if no certificate path provided
  connectionConfig.ssl = 'Amazon RDS';
}

const connection = mysql.createConnection(connectionConfig);

connection.connect((err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
        console.error('Connection details:', {
          host: connectionConfig.host,
          port: connectionConfig.port,
          user: connectionConfig.user,
          database: connectionConfig.database
        });
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          console.log('Attempting to reconnect...');
          connection.connect();
        }, 5000);
        return;
    }
    console.log('✅ Connected to Database!');
});

// Handle connection errors and attempt reconnection
connection.on('error', (err) => {
    console.error('Database connection error:', err.message);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
        console.log('Attempting to reconnect...');
        connection.connect();
    } else {
        throw err;
    }
}); 

module.exports = connection;
