const express = require("express");
const router = express.Router();
const db = require("../../../db");
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const resetTokens = new Map();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

//display order details
router.get('/order-details', (req,res) => {
  const sql = "SELECT * FROM supply_orders ORDER BY order_date DESC";

  db.query(sql, (err, results) => {
      if (err) {
          console.error('Error fetching supplier order details: ', err);
          return res.status(500).json({ error: 'Error fetching supplier order data' });
      }
      res.json(results);
  });
});

// Update order status by supplier
router.patch('/update-order', (req,res) => {
  const { order_id, status } = req.body;

  if (!order_id || !status) {
      return res.status(400).json({ error: 'Order ID and status are required' });
  }

  const sql = "UPDATE supply_orders SET status = ? WHERE supply_order_id = ?";

  db.query(sql, [status, order_id], (err, results) => {
      if (err) {
          console.error('Error updating order status: ', err);
          return res.status(500).json({ error: 'Error updating order status' });
      }
      res.json({ message: 'Order status updated successfully' });
  });
});

// Update order status for specific supplier
router.patch('/update-order-status', (req, res) => {
  const { supplier_id, order_id, status } = req.body;

  if (!supplier_id || !order_id || !status) {
      return res.status(400).json({ error: 'Supplier ID, Order ID, and status are required' });
  }

  const sql = "UPDATE supply_orders SET status = ? WHERE supply_order_id = ? AND supplier_id = ?";

  db.query(sql, [status, order_id, supplier_id], (err, results) => {
      if (err) {
          console.error('Error updating order status: ', err);
          return res.status(500).json({ error: 'Error updating order status' });
      }
      if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Order not found or not owned by this supplier' });
      }
      // Fetch order details for email content
      const orderSql = `
        SELECT so.*, i.name AS item_name, s.name AS supplier_name
        FROM supply_orders so
        LEFT JOIN inventory i ON so.item_id = i.item_id
        LEFT JOIN supplier s ON so.supplier_id = s.supplier_id
        WHERE so.supply_order_id = ?
      `;

      db.query(orderSql, [order_id], (err2, orderRows) => {
          if (err2) {
              console.error('Error fetching order after update: ', err2);
              return res.json({ message: 'Order status updated successfully (failed to fetch order for notification)' });
          }
          const order = orderRows && orderRows[0];

          const managerEmail = 'anjulac2006@gmail.com';

          const transporter = nodemailer.createTransport({
              host: process.env.EMAIL_HOST || 'smtp.gmail.com',
              port: process.env.EMAIL_PORT || 587,
              secure: false,
              auth: {
                  user: process.env.EMAIL_USER,
                  pass: process.env.EMAIL_PASS
              }
          });

          const subject = `Supply order #${order_id} status updated to "${status}"`;
          const text = `Order ID: ${order_id}\nItem: ${order ? order.item_name : 'N/A'}\nSupplier: ${order ? order.supplier_name : 'N/A'}\nNew status: ${status}\nOrder date: ${order ? order.order_date : 'N/A'}`;

          const mailOptions = {
              from: process.env.FROM_EMAIL || process.env.SMTP_USER,
              to: managerEmail,
              subject,
              text,
          };

          transporter.sendMail(mailOptions, (mailErr, info) => {
              if (mailErr) {
                  console.error('Error sending notification email: ', mailErr);
                  return res.json({ message: 'Order status updated successfully (failed to send notification email)' });
              }
              return res.json({ message: 'Order status updated successfully; manager notified' });
          });
        });
    });
});

// Get supply orders for specific supplier
router.get('/supply-orders', (req, res) => {
  const supplier_id = req.query.supplier_id;

  if (!supplier_id) {
      return res.status(400).json({ error: 'Supplier ID is required' });
  }

  const sql = "SELECT so.*, i.name AS item_name FROM supply_orders so JOIN inventory i ON so.item_id = i.item_id WHERE so.supplier_id = ? ORDER BY so.order_date DESC";

  db.query(sql, [supplier_id], (err, results) => {
      if (err) {
          console.error('Error fetching supplier orders: ', err);
          return res.status(500).json({ error: 'Error fetching supplier orders' });
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
      "SELECT supplier_id, email FROM supplier WHERE email = ?",
      [email]
    );

    if (customerRows.length === 0) {
      return res.json({ message: "If an account with that email exists, reset instructions have been sent." });
    }

    const customer = customerRows[0];

    // Generate 5-character reset token
    const resetToken = crypto.randomBytes(3).toString('hex').substring(0, 5).toUpperCase();

    resetTokens.set(resetToken, { customerId: customer.supplier_id, expires: Date.now() + 3600000 });

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
      "UPDATE supplier SET password = ? WHERE supplier_id = ?",
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

module.exports = router;