const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db = require("../../../db"); // MySQL connection

const resetTokens = new Map();

const JWT_SECRET = process.env.JWT_SECRET || "8f3d2c9b6a1e4f7d9c0b3a6e5d4f1a2b7c9e0d4f6b8a1c3e2f0d9b6a4c8e7f1";

//create nodemailer connection with gmail smtp using .env file credentials.
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
  }
});

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../../uploads/');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'application/octet-stream'];
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];

  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    console.log(`Rejected file: ${file.originalname}, mimetype: ${file.mimetype}`);
    cb(new Error('Invalid file type. Only PDF, JPG, and PNG are allowed.'), false);
  }
};

const upload = multer({ storage: storage, fileFilter: fileFilter });

function authenticateCustomer(req, res, next) {

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
    // Decode without verifying to inspect header (alg) for diagnostics
    let decodedHeader = null;
    try {
      decodedHeader = jwt.decode(token, { complete: true });
      if (decodedHeader && decodedHeader.header) {
        console.info('Incoming JWT alg:', decodedHeader.header.alg, 'kid:', decodedHeader.header.kid || 'none');
      }
    } catch (decErr) {
      console.warn('Failed to decode token for diagnostics:', decErr && decErr.message ? decErr.message : decErr);
    }
    
    // Also decode payload (non-verified) and log a few identifying claims to help debug signature/source
    try {
      const decodedPayload = jwt.decode(token) || {};
      const safeClaims = {
        iss: decodedPayload.iss,
        sub: decodedPayload.sub,
        aud: decodedPayload.aud,
        role: decodedPayload.role || decodedPayload.user_role || decodedPayload.role_name,
        id: decodedPayload.id || decodedPayload.user_id || decodedPayload.sub,
        exp: decodedPayload.exp
      };
      console.info('Incoming JWT claims (non-verified):', safeClaims);
    } catch (decPayErr) {
      console.warn('Failed to decode JWT payload for diagnostics:', decPayErr && decPayErr.message ? decPayErr.message : decPayErr);
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role && decoded.role !== "customer") {
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

router.post("/place-order", authenticateCustomer, upload.single('payment_receipt'), async (req, res) => {
  const { prawn_type, quantity, price, location } = req.body;
  const customer_id = req.user.id;

  // 1. Validate required fields
  if (!prawn_type || !quantity || !price || !location) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Payment receipt is required" });
  }

  try {
    const [customerRows] = await db.promise().query(
      "SELECT customer_id, customer_name, email FROM customer WHERE customer_id = ?",
      [customer_id]
    );

    if (customerRows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const customer = customerRows[0];

    const [result] = await db.promise().query(
      "INSERT INTO customer_order (customer_id, address, prawn_type, quantity, payment_receipt, approved_or_rejected, status, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        customer.customer_id,
        location,
        prawn_type,
        quantity,
        `uploads/${req.file.filename}`,
        null,
        "New",
        price
      ]
    );

    const orderId = result.insertId;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || 'anjulac2006@gmail.com',
      subject: 'New Order Placed',
      text:
        `New order (ID: ${orderId}) from ${customer.customer_name} (${customer.email}):\nProduct: ${prawn_type}\nQuantity: ${quantity}\nPrice: ${price}\nLocation: ${location}\nStatus: New\nApproved/Rejected: Pending\nReceipt filename: ${req.file.filename}`
    });

    res.json({ message: "Order placed successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});


router.get("/available-prawn-types" , (req,res) => {
    const sql = "SELECT DISTINCT name FROM inventory WHERE quantity > 10 AND type = 'prawns'";

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching prawn types:", err);
            return res.status(500).json({ error: "Server error" });
        }
        const prawnTypes = results.map(row => row.name);
        res.json({ prawnTypes });
    });
});

//Display Order Details of Customer
router.get("/Order-Status", authenticateCustomer, (req,res) => {
    const customer_id = req.user.id;

    const sql = "SELECT order_id, prawn_type, quantity, price, status, approved_or_rejected, created_at, updated_at FROM customer_order WHERE customer_id = ? ORDER BY created_at DESC";

    db.query(sql, [customer_id], (err, results) => {
        if (err) {
            console.error("Error fetching order status:", err);
            return res.status(500).json({ error: "Server error" });
        }
        res.json(results);
    });
});

// Forgot Password: Request reset token via email
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const [customerRows] = await db.promise().query(
      "SELECT customer_id, email FROM customer WHERE email = ?",
      [email]
    );

    if (customerRows.length === 0) {
      return res.json({ message: "If an account with that email exists, reset instructions have been sent." });
    }

    const customer = customerRows[0];

    // Generate 5-character reset token
    const resetToken = crypto.randomBytes(3).toString('hex').substring(0, 5).toUpperCase();

    // Store token with customer_id (expires in 1 hour)
    resetTokens.set(resetToken, { customerId: customer.customer_id, expires: Date.now() + 3600000 });

    // Send email with reset token
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: customer.email,
      subject: 'Password Reset Request',
      text: `You requested a password reset. Use this token to reset your password: ${resetToken}\n\nThis token expires in 1 hour. If you did not request this, please ignore this email.`
    });

    res.json({ message: "If an account with that email exists, reset instructions have been sent." });
  } catch (err) {
    console.error("Error in forgot-password:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Reset Password: Use token to set new password
router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required" });
  }

  try {
    // Check if token exists in Map
    const tokenData = resetTokens.get(token);
    if (!tokenData) {
      return res.status(400).json({ error: "Invalid reset token." });
    }

    // Check if token has expired
    if (Date.now() > tokenData.expires) {
      resetTokens.delete(token);
      return res.status(400).json({ error: "Reset token has expired." });
    }

    const customerId = tokenData.customerId;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.promise().query(
      "UPDATE customer SET password = ? WHERE customer_id = ?",
      [hashedPassword, customerId]
    );

    // Remove token after successful reset
    resetTokens.delete(token);

    res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("Error in reset-password:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Send notification to customer when order status is updated by worker
router.get("/send-order-update-notification", async (req, res) => {
  const { order_id } = req.query;

  if (!order_id) {
    return res.status(400).json({ error: "Order ID is required" });
  }

  try {
    const [orderRows] = await db.promise().query(
      `SELECT co.order_id, co.prawn_type, co.quantity, co.price, co.status, co.approved_or_rejected, co.created_at, co.updated_at, c.email, c.customer_name
       FROM customer_order co
       JOIN customer c ON co.customer_id = c.customer_id
       WHERE co.order_id = ?`,
      [order_id]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderRows[0];

    // Return notification message as JSON
    const notificationMessage = `Dear ${order.customer_name},\n\nYour order (ID: ${order.order_id}) status has been updated.\n\nDetails:\n- Product: ${order.prawn_type}\n- Quantity: ${order.quantity}\n- Price: ${order.price}\n- Status: ${order.status}\n- Approved/Rejected: ${order.approved_or_rejected || 'N/A'}\n- Created At: ${order.created_at}\n- Updated At: ${order.updated_at}\n\nThank you for your business!\n\nBest regards,\nPrawnCare Team`;

    res.json({ message: notificationMessage });
  } catch (err) {
    console.error("Error in send-order-update-notification:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
