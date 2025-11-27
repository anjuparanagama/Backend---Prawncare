module.exports = (io) => {
const express = require("express");
const router = express.Router();
const cron = require("node-cron");
const db = require("../../../db");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const JWT_SECRET = process.env.JWT_SECRET || "8f3d2c9b6a1e4f7d9c0b3a6e5d4f1a2b7c9e0d4f6b8a1c3e2f0d9b6a4c8e7f1";
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      token = parts[1];
    } else if (parts.length === 1) {
      token = parts[0];
    }
  }

  if (!token && req.body && req.body.token) {
    token = req.body.token;
  }

  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    console.warn('Authentication failed: token missing');
    return res.status(401).json({ error: "Token missing" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role && decoded.role !== "worker") {
      console.warn('Authentication failed: role mismatch', decoded.role);
      return res.status(403).json({ error: "Access denied" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT verification error:', err && err.message ? err.message : err);
    const msg = err && err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return res.status(401).json({ error: msg });
  }
}

//display all approved orders to worker dashboard
router.get("/New-Orders", async (req,res) => {
    const sql = "SELECT * FROM customer_order WHERE approved_or_rejected = 'Approved' ORDER BY created_at DESC";

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching customer-Order Details: ', err);
            return res.status(500).json({ error: 'Error fetching customer order data' });
        }
        res.json(results);
    });
});

//Update order status by worker
router.patch("/update-order-status", (req,res) => {
    const { order_id, status } = req.body;

    if (!order_id || !status) {
        return res.status(400).json({ error: 'Order ID and status are required' });
    }

    const sql = "UPDATE customer_order SET status = ? WHERE order_id = ?";

    db.query(sql, [status, order_id], (err, results) => {
        if (err) {
            console.error('Error updating order status: ', err);
            return res.status(500).json({ error: 'Error updating order status' });
        }

        // Send email notification
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: 'anjulac2006@gmail.com',
            subject: 'Order Status Updated',
            text: `Order ID: ${order_id}\nStatus: ${status}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email: ', error);
            } else {
                console.log('Email sent: ' + info.response);
            }
        });

        res.json({
            message: 'Order status updated successfully',
            notification: {
                text: 'Order update',
                status: status,
                order_id: order_id
            }
        });
    });
});

router.get("/time-table", (req,res) => {
    const sql = "SELECT * FROM feeding_schedule ORDER BY Pond_ID ASC, feeding_time ASC";
    db.query(sql, (err, results) => {

        if (err) {
            console.error('Error fetching feeding schedule: ', err);
            return res.status(500).json({ error: 'Error fetching feeding schedule' });
        }
        res.json(results);
    });
});

let reminders = [];

// Cron job runs every minute
cron.schedule("* * * * *", () => {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}:00`;

  const sql = `
    SELECT feeding_ID, Pond_ID, feeding_time
    FROM feeding_schedule
    WHERE feeding_time BETWEEN ? AND ADDTIME(?, '00:15:00')
  `;

  db.query(sql, [currentTime, currentTime], (err, results) => {
    if (err) {
      console.error("Error checking reminders:", err);
    } else if (results.length > 0) {
      results.forEach((row) => {
        // Prevent duplicate reminders
        const exists = reminders.some(
          (rem) => rem.feeding_ID === row.feeding_ID
        );

        if (!exists) {
          const reminder = {
            feeding_ID: row.feeding_ID,
            pond_ID: row.Pond_ID,
            reminder_time: currentTime,
            message: `Feeding reminder: Pond ${row.Pond_ID} needs feeding at ${row.feeding_time}`,
            acknowledged: false, // new flag
          };

          reminders.push(reminder);
          console.log("Reminder created:", reminder);

          // Send to all connected clients
          io.emit("feeding-reminder", reminder);
          // Send push notification for feeding reminder
          try {
            sendFeedingPush(reminder).catch(err => console.error('[FCM-worker] sendFeedingPush error:', err));
          } catch (e) {
            console.error('[FCM-worker] Error invoking sendFeedingPush:', e && e.message ? e.message : e);
          }
        }
      });
    }
  });
});

// API to get all current reminders
router.get("/reminder", (req, res) => {
  res.json(reminders);
});

// API to acknowledge a reminder (clear after feeding is done)
router.post("/acknowledge", (req, res) => {
  const { feeding_ID } = req.body;

  if (!feeding_ID) {
    return res.status(400).json({ error: "feeding_ID is required" });
  }

  reminders = reminders.filter((rem) => rem.feeding_ID !== feeding_ID);

  res.json({ success: true, message: `Reminder ${feeding_ID} acknowledged` });
});

// Register device token and optionally associate with a worker
router.post('/register-token', async (req, res) => {
  const { token, worker_id } = req.body || {};

  if (!token) return res.status(400).json({ error: 'token is required' });

  // Ensure device_tokens table exists
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS device_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      worker_id INT NULL,
      token VARCHAR(255) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  db.query(createTableSql, (err) => {
    if (err) {
      console.error('[Tokens] Failed to ensure device_tokens table:', err);
    }

    const upsertSql = `INSERT INTO device_tokens (worker_id, token) VALUES (?, ?) ON DUPLICATE KEY UPDATE worker_id = VALUES(worker_id)`;
    db.query(upsertSql, [worker_id || null, token], async (err2) => {
      if (err2) {
        console.error('[Tokens] Failed to insert token:', err2);
        return res.status(500).json({ error: 'Failed to save token' });
      }

      // Subscribe token to feeding topic
      if (admin.apps && admin.apps.length > 0) {
        try {
          await admin.messaging().subscribeToTopic([token], 'feeding');
          console.log('[FCM-worker] Token subscribed to topic feeding');
        } catch (subErr) {
          console.error('[FCM-worker] Failed to subscribe token to topic:', subErr && subErr.message ? subErr.message : subErr);
        }
      }

      res.json({ success: true });
    });
  });
});

// Test endpoint to send feeding notification to topic 'feeding'
router.get('/notify/feeding-test', async (req, res) => {
  const testMsg = {
    notification: { title: 'Feeding Test', body: 'This is a test feeding reminder' },
    data: { test: '1' },
    topic: 'feeding'
  };

  if (!admin.apps || admin.apps.length === 0) {
    return res.status(500).json({ error: 'FCM not initialized' });
  }

  try {
    const resp = await admin.messaging().send(testMsg);
    res.json({ success: true, result: resp });
  } catch (err) {
    console.error('[FCM-worker] notify test error:', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Failed to send test notification', details: err && err.message });
  }
});

// Socket.IO connection setup
io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Initialize Firebase Admin (if not already initialized elsewhere)
function initFirebaseAdminForWorker() {
  try {
    if (admin.apps && admin.apps.length > 0) return;

    // Prefer explicit env var, then GOOGLE_APPLICATION_CREDENTIALS, then backend/google-services.json
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(svc) });
      console.log('[FCM-worker] Firebase Admin initialized from FIREBASE_SERVICE_ACCOUNT');
      return;
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const gacPath = path.resolve(__dirname, '..', '..', '..', process.env.GOOGLE_APPLICATION_CREDENTIALS);
      if (fs.existsSync(gacPath)) {
        const svc = require(gacPath);
        admin.initializeApp({ credential: admin.credential.cert(svc) });
        console.log('[FCM-worker] Firebase Admin initialized from GOOGLE_APPLICATION_CREDENTIALS');
        return;
      }
    }

    const defaultServicePath = path.join(__dirname, '..', '..', '..', 'google-services.json');
    if (fs.existsSync(defaultServicePath)) {
      const svc = require(defaultServicePath);
      admin.initializeApp({ credential: admin.credential.cert(svc) });
      console.log('[FCM-worker] Firebase Admin initialized from backend/google-services.json');
      return;
    }

    try {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
      console.log('[FCM-worker] Firebase Admin initialized using application default credentials');
      return;
    } catch (e) {
      console.warn('[FCM-worker] Application default credentials not available');
    }

    console.warn('[FCM-worker] No firebase credentials found; FCM features will be disabled');
  } catch (err) {
    console.error('[FCM-worker] Failed to init Firebase Admin:', err && err.message ? err.message : err);
  }
}

initFirebaseAdminForWorker();

// Send feeding reminder via FCM (topic-based)
async function sendFeedingPush(reminder) {
  if (!admin.apps || admin.apps.length === 0) {
    console.warn('[FCM-worker] Firebase Admin not initialized; skipping feeding push');
    return;
  }

  const message = {
    notification: {
      title: 'Feeding Reminder',
      body: reminder.message || `Feeding needed at Pond ${reminder.pond_ID}`
    },
    data: {
      feeding_ID: String(reminder.feeding_ID || ''),
      pond_ID: String(reminder.pond_ID || ''),
      reminder_time: String(reminder.reminder_time || '')
    },
    topic: 'feeding'
  };

  try {
    const resp = await admin.messaging().send(message);
    console.log('[FCM-worker] Feeding push sent:', resp);
  } catch (err) {
    console.error('[FCM-worker] Error sending feeding push:', err && err.message ? err.message : err);
  }
}

router.get("/tasks", authenticateToken, (req, res) => {
  const userEmail = req.user.email;
  if (!userEmail) {
    return res.status(400).json({ error: 'Invalid user email in token' });
  }

  // Fetch worker_id from database using email
  const getWorkerIdSql = "SELECT id FROM worker WHERE email = ?";
  db.query(getWorkerIdSql, [userEmail], (err, workerResults) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching worker ID' });
    }
    if (workerResults.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const workerId = workerResults[0].worker_id || workerResults[0].id;
    const sql = "SELECT * FROM task WHERE worker_id = ? ORDER BY created_date ASC";
    db.query(sql, [workerId], (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'Error fetching tasks' });
      }
      res.json(results);
    });
  });
});

// Update task status to completed
router.patch("/update-task-status", authenticateToken, (req, res) => {
  const { task_id } = req.body;
  const userEmail = req.user.email;

  if (task_id === undefined || task_id === null || task_id === '') {
    return res.status(400).json({ error: 'Task ID is required' });
  }

  // Fetch worker_id from database using email
  const getWorkerIdSql = "SELECT id FROM worker WHERE email = ?";
  db.query(getWorkerIdSql, [userEmail], (err, workerResults) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching worker ID' });
    }
    if (workerResults.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const workerId = workerResults[0].worker_id || workerResults[0].id;

    // Update task status to 'completed' only if it belongs to the worker
    const updateSql = "UPDATE task SET status = 'completed' WHERE task_id = ? AND worker_id = ?";
    db.query(updateSql, [task_id, workerId], (err, results) => {
      if (err) {
        console.error('Error updating task status: ', err);
        return res.status(500).json({ error: 'Error updating task status' });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'Task not found or not assigned to this worker' });
      }

      // Fetch the current status of the task
      const selectSql = "SELECT status FROM task WHERE task_id = ? AND worker_id = ?";
      db.query(selectSql, [task_id, workerId], (err, taskResults) => {
        if (err) {
          console.error('Error fetching task status: ', err);
          return res.status(500).json({ error: 'Error fetching task status' });
        }

        const currentStatus = taskResults[0] ? taskResults[0].status :
         'completed';

        // Send email notification
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          }
        });

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: 'anjulac2006@gmail.com',
          subject: 'Task Status Updated',
          text: `Task ID: ${task_id}\nStatus: ${currentStatus}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.error('Error sending email: ', error);
          } else {
            console.log('Email sent: ' + info.response);
          }
        });

        res.json({
          message: 'Task status updated to completed successfully',
          current_status: currentStatus,
          notification: {
            text: 'Task update',
            status: currentStatus,
            task_id: task_id
          }
        });
      });
    });
  });
});



return router;
};
