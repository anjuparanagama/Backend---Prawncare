const express = require("express");
const cron = require("node-cron");
const router = express.Router();
const db = require("../../db");
const pdf = require('html-pdf');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Constants
// NOTE: If ESP IP address changes, update the ESP_IP value in the .env file
const ESP_IP = process.env.ESP_IP || "192.168.1.127";
const FETCH_TIMEOUT_MS = 30000; // 30 seconds
const ALERT_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// Email Configuration
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


// Parsed sensor data
async function fetchSensorDataFromESP() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(`http://${ESP_IP}/sensors`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// Helper function to execute SQL queries with Promises
function executeQuery(sql, values = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, values, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

// Save sensor data to database every 6 hours
async function saveSensorsData() {
    try {
        const data = await fetchSensorDataFromESP();
        const sql = 'INSERT INTO sensors_data (Pond_ID, Water_Level, WaterTemp, TDS, pH) VALUES (?, ?, ?, ?, ?)';
        const values = [1, data.waterLevelInside, data.waterTemp, data.tds];
        
        await executeQuery(sql, values);
        console.log('[Sensors] Data inserted successfully');
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('[Sensors] Fetch request timed out after 30 seconds');
        } else {
            console.error('[Sensors] Error saving sensor data:', error.message);
        }
    }
}

// Schedule sensor data collection every 6 hours
cron.schedule('0 */6 * * *', () => {
    console.log('[Cron] Running scheduled task: Sensor data collection');
    saveSensorsData();
});

// Fetch real-time sensor data from ESP
router.get('/sensorsdatacome', async (req, res) => {
    try {
        const data = await fetchSensorDataFromESP();
        res.json(data);
    } catch (error) {
        if (error.name === 'AbortError') {
            return res.status(504).json({ error: 'Request timed out after 30 seconds' });
        }
        res.status(500).json({ error: 'Failed to fetch sensor data', details: error.message });
    }
});

// Base SQL query to get latest sensor readings per pond
const LATEST_SENSORS_QUERY = `
    SELECT s.Pond_ID, s.Water_Level, s.pH, s.WaterTemp, s.TDS
    FROM sensors_data s
    INNER JOIN (
        SELECT Pond_ID, MAX(Updated_at) AS latest_time
        FROM sensors_data
        GROUP BY Pond_ID
    ) latest
    ON s.Pond_ID = latest.Pond_ID AND s.Updated_at = latest.latest_time
`;

// ============================================
// Average Metrics Routes
// ============================================

function getAverageMetric(columnName, responseKey) {
    return (req, res) => {
        const sql = `SELECT AVG(t.${columnName}) AS avg_value FROM (${LATEST_SENSORS_QUERY}) t`;
        
        db.query(sql, (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Database query failed' });
            }
            
            const avg = result[0]?.avg_value;
            res.json({ 
                [responseKey]: avg !== null ? Number(avg).toFixed(2) : null 
            });
        });
    };
}

//GET /average-water-level - Get average water level
router.get('/average-water-level', getAverageMetric('Water_Level', 'average_water_level'));

//GET /average-ph - Get average pH level
router.get('/average-ph', getAverageMetric('pH', 'average_ph'));

//GET /average-temperature - Get average temperature
router.get('/average-temperature', getAverageMetric('WaterTemp', 'average_temperature'));

//GET /average-tds - Get average TDS (Total Dissolved Solids)
router.get('/average-tds', getAverageMetric('TDS', 'average_tds'));


//Generate HTML for water quality report
function generateReportHTML(results) {
    const tableRows = results.map(sensor => `
        <tr>
            <td>${sensor.Pond_ID}</td>
            <td>${sensor.Date}</td>
            <td>${sensor.Time}</td>
            <td>${sensor.Water_Level}</td>
            <td>${sensor.pH}</td>
            <td>${sensor.TDS}</td>
            <td>${sensor.WaterTemp}</td>
        </tr>
    `).join('');

    return `
        <html>
            <head>
                <title>Water Quality Report</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #333; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                    th { background-color: #f2f2f2; font-weight: bold; }
                </style>
            </head>
            <body>
                <h1>Water Quality Report</h1>
                <table>
                    <thead>
                        <tr>
                            <th>Pond ID</th>
                            <th>Date</th>
                            <th>Time</th>
                            <th>Water Level</th>
                            <th>pH Level</th>
                            <th>Salinity Level</th>
                            <th>Temperature</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </body>
        </html>
    `;
}

//GET /downloadpdf - Download water quality report as PDF
router.get('/downloadpdf', (req, res) => {
    const { start, end } = req.query;
    let sql = `
        SELECT 
            s.Pond_ID, s.Water_Level, s.pH, s.WaterTemp, s.TDS,
            DATE_FORMAT(s.Updated_at, '%W, %d %M %Y') AS Date,
            CONCAT(LPAD(HOUR(s.Updated_at), 2, '0'), '.00') AS Time
        FROM sensors_data s
    `;
    
    const params = [];
    
    if (start && end) {
        sql += ` WHERE DATE(s.Updated_at) BETWEEN ? AND ?`;
        params.push(start, end);
    }
    
    sql += ` ORDER BY s.Updated_at DESC`;

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('[PDF] Database query error:', err);
            return res.status(500).json({ error: 'Database query failed' });
        }

        const html = generateReportHTML(results);
        const pdfOptions = { format: 'A4', orientation: 'portrait' };

        pdf.create(html, pdfOptions).toBuffer((err, buffer) => {
            if (err) {
                console.error('[PDF] Generation error:', err);
                return res.status(500).json({ error: 'Failed to generate PDF' });
            }

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="water_quality_report.pdf"');
            res.send(buffer);
        });
    });
});

//Send alert emails to workers when pond conditions are abnormal
function sendAlertEmails(alerts, workerEmails) {
    const message = alerts.join('\n');
    
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: workerEmails.join(', '),
        subject: '🚨 Pond Condition Alert',
        text: message
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('[Email] Failed to send alert:', error.message);
        } else {
            console.log('[Email] Alert sent successfully:', info.response);
        }
    });
}

// Initialize Firebase Admin SDK for FCM
function initFirebaseAdmin() {
    try {
        if (admin.apps && admin.apps.length > 0) return;

        // 1) If a full service account JSON is provided in env var, use it
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
            console.log('[FCM] Firebase Admin initialized from FIREBASE_SERVICE_ACCOUNT');
            return;
        }

        // 2) If GOOGLE_APPLICATION_CREDENTIALS env points to a file, and it exists, use it
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            const gacPath = path.resolve(__dirname, '..', '..', process.env.GOOGLE_APPLICATION_CREDENTIALS);
            if (fs.existsSync(gacPath)) {
                const serviceAccount = require(gacPath);
                admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
                console.log('[FCM] Firebase Admin initialized from GOOGLE_APPLICATION_CREDENTIALS file');
                return;
            }
        }

        // 3) Prefer a local google-services.json in backend folder (relative to this file)
        const defaultServicePath = path.join(__dirname, '..', '..', 'google-services.json');
        if (fs.existsSync(defaultServicePath)) {
            const serviceAccount = require(defaultServicePath);
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
            console.log('[FCM] Firebase Admin initialized from backend/google-services.json');
            return;
        }

        // 4) As a last resort try application default credentials (useful in GCP environments)
        try {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
            console.log('[FCM] Firebase Admin initialized using application default credentials');
            return;
        } catch (adErr) {
            console.warn('[FCM] Application default credentials not available');
        }

        console.warn('[FCM] No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS or place google-services.json in backend folder');
    } catch (err) {
        console.error('[FCM] Failed to initialize Firebase Admin:', err && err.message ? err.message : err);
    }
}

initFirebaseAdmin();

// Send push notifications via Firebase Admin
async function sendPushNotificationFCM(alerts) {
    if (!admin.apps || admin.apps.length === 0) {
        console.warn('[FCM] Firebase Admin not initialized; skipping push');
        return;
    }

    const title = '🚨 Pond Condition Alert';
    const body = alerts.join('\n');

    const message = {
        notification: { title, body },
        data: { alerts: JSON.stringify(alerts) },
        topic: 'all' // default topic; change if you target specific tokens or topics
    };

    try {
        const response = await admin.messaging().send(message);
        console.log('[FCM] Message sent:', response);
    } catch (err) {
        console.error('[FCM] Error sending message:', err && err.message ? err.message : err);
    }
}

// Send push notifications via Firebase Cloud Messaging (legacy HTTP API)
async function sendPushNotificationFCM(alerts) {
    const serverKey = process.env.FCM_SERVER_KEY; // server key from Firebase console

    if (!serverKey) {
        console.warn('[FCM] FCM_SERVER_KEY not configured; skipping push');
        return;
    }

    const title = '🚨 Pond Condition Alert';
    const body = alerts.join('\n');

    const payload = {
        to: '/topics/all', // change to a topic or specific token(s) as needed
        notification: {
            title,
            body
        },
        data: {
            alerts: JSON.stringify(alerts)
        }
    };

    try {
        const resp = await fetch('https://fcm.googleapis.com/fcm/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `key=${serverKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const txt = await resp.text();
            console.error('[FCM] Push send failed:', resp.status, txt);
            return;
        }

        const result = await resp.json();
        console.log('[FCM] Push sent successfully:', result);
    } catch (err) {
        console.error('[FCM] Error sending push:', err.message);
    }
}

//Check pond conditions against thresholds and send alerts if needed
async function checkConditionsAndSendAlert() {
    try {
        // 1. Fetch real-time sensor data
        const espData = await fetchSensorDataFromESP();

        const thresholds = await executeQuery('SELECT * FROM thresholds LIMIT 1');
        
        if (!thresholds || thresholds.length === 0) {
            console.error('[Alerts] No threshold configuration found');
            return;
        }

        const threshold = thresholds[0];

        const pondData = {
            waterLevel: espData.waterLevelInside,
            temperature: espData.waterTemp,
            tds: espData.tds
        };

        // 4. Check conditions and build alert list
        const alerts = [];

        if (pondData.waterLevel < threshold.min_water_level || 
            pondData.waterLevel > threshold.max_water_level) {
            alerts.push(`⚠️ Water Level: ${pondData.waterLevel} (Range: ${threshold.min_water_level}-${threshold.max_water_level})`);
        }

        if (pondData.temperature < threshold.min_temperature || 
            pondData.temperature > threshold.max_temperature) {
            alerts.push(`⚠️ Temperature: ${pondData.temperature}°C (Range: ${threshold.min_temperature}-${threshold.max_temperature}°C)`);
        }

        if (pondData.tds < threshold.min_tds || 
            pondData.tds > threshold.max_tds) {
            alerts.push(`⚠️ TDS: ${pondData.tds} (Range: ${threshold.min_tds}-${threshold.max_tds})`);
        }

        // 5. If alerts exist, fetch worker emails and send notifications
        if (alerts.length > 0) {
            const workerResults = await executeQuery('SELECT email FROM worker');
            const workerEmails = workerResults.map(row => row.email);

            if (workerEmails.length === 0) {
                console.error('[Alerts] No worker emails found');
            } else {
                sendAlertEmails(alerts, workerEmails);
            }

            // Send push notifications via FCM (topic-based by default)
            await sendPushNotificationFCM(alerts);
        } else {
            console.log('[Alerts] All pond conditions are normal');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('[Alerts] Fetch request timed out');
        } else {
            console.error('[Alerts] Error checking conditions:', error.message);
        }
    }
}

// Run condition checks every 1 minute
setInterval(checkConditionsAndSendAlert, ALERT_CHECK_INTERVAL_MS);

// Test endpoint to trigger the alert check manually
router.get('/alerts/test-push', async (req, res) => {
    try {
        await checkConditionsAndSendAlert();
        res.json({ status: 'triggered' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to trigger alerts', details: err.message });
    }
});

//GET /sensor-data - Retrieve all sensor data for display
router.get('/sensor-data', (req, res) => {
    const sql = `
        SELECT
            s.Pond_ID,
            s.Water_Level,
            s.pH,
            s.WaterTemp,
            s.TDS,
            DATE_FORMAT(s.Updated_at, '%Y/%m/%d') AS Date,
            CONCAT(LPAD(HOUR(s.Updated_at), 2, '0'), '.00') AS Time
        FROM sensors_data s
        ORDER BY s.Updated_at DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('[Sensor Data] Query error:', err);
            return res.status(500).json({ 
                error: 'Failed to retrieve sensor data',
                details: err.message 
            });
        }
        
        res.json(results);
    });
});

module.exports = router;
