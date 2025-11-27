const express = require("express");
const router = express.Router();
const db = require("../../db");
const path = require("path");
const fs = require("fs");
const nodemailer = require('nodemailer');

// Configure Nodemailer transporter
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

router.get('/order-table', (req, res) => {
    const query = `
        SELECT
            o.order_id,
            c.customer_name AS Customer,
            o.prawn_type AS PrawnType,
            o.quantity AS Quantity,
            o.price AS Amount,
            o.status AS Status,
            o.created_at AS Date
        FROM customer_order o
        JOIN customer c ON o.customer_id = c.customer_id
        ORDER BY o.created_at DESC
    `;

    db.query(query, (err, result) => {
        if (err) {
            console.error('Error fetching orders:', err.sqlMessage || err.message || err);
            res.status(500).json({ error: 'Error fetching orders', details: err.sqlMessage || err.message || err });
        } else {
            res.json(result);
        }
    });
});


// POST endpoint to add new orders
router.post('/orders', (req, res) => {
    const { Order_ID, Customer, Date, Status, Amount, Quantity } = req.body;

    if (!Order_ID || !Customer || !Date || !Status || !Amount || !Quantity) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const sqlQuery = `
        INSERT INTO customer_order (customer_id, prawn_type, quantity, price, status)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sqlQuery, [Order_ID, Customer, Date, Status, Amount, Quantity], (err, result) => {
        if (err) {
            console.error('Error adding order:', err);
            res.status(500).json({ error: 'Error adding order' });
        } else {
            res.json(result);
        }
    });
});



// POST endpoint to add new orders
router.post('/order', (req, res) => {
    const { customer_id, prawn_type, quantity, price, status } = req.body;
    
    if (!customer_id || !prawn_type || !quantity || !price) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const sqlQuery = `
        INSERT INTO customer_order (customer_id, prawn_type, quantity, price, status)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sqlQuery, [customer_id, prawn_type, quantity, price, status || 'Processing'], (err, result) => {
        if (err) {
            console.error('Error adding order:', err);
            res.status(500).json({ error: 'Error adding order' });
        } else {
            res.json({ message: 'Order added successfully', orderId: result.insertId });
        }
    });
});


// POST endpoint to add new orders (alternative)
router.post('/orders', (req, res) => {
    const { Order_ID, Customer, Date, Status, Amount, Quantity } = req.body;

    if (!Order_ID || !Customer || !Date || !Status || !Amount || !Quantity) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const sqlQuery = `
        INSERT INTO customer_order (customer_id, prawn_type, quantity, price, status)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sqlQuery, [Order_ID, Customer, Date, Status, Amount, Quantity], (err, result) => {
        if (err) {
            console.error('Error adding order:', err);
            res.status(500).json({ error: 'Error adding order' });
        } else {
            res.json(result);
        }
    });
});

// ✅ Daily quantity totals with year
router.get('/orders/daily', (req, res) => {
    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;
    
    const sqlQuery = `
        SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, 
               YEAR(created_at) as year,
               SUM(Quantity) AS total_quantity
        FROM customer_order
        WHERE YEAR(created_at) IN (?, ?)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d'), YEAR(created_at)
        ORDER BY day ASC
    `;
    db.query(sqlQuery, [currentYear, prevYear], (err, result) => {
        if (err) {
            console.error('Error fetching daily orders:', err);
            res.status(500).json({ error: 'Error fetching daily orders' });
        } else {
            res.json(result);
        }
    });
});

// ✅ Weekly quantity totals with previous year
router.get('/orders/weekly', (req, res) => {
    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;
    
    const sqlQuery = `
        SELECT YEAR(created_at) AS year, 
               WEEK(created_at) AS week, 
               SUM(Quantity) AS total_quantity
        FROM customer_order
        WHERE YEAR(created_at) IN (?, ?)
        GROUP BY YEAR(created_at), WEEK(created_at)
        ORDER BY year, week
    `;
    db.query(sqlQuery, [currentYear, prevYear], (err, result) => {
        if (err) {
            console.error('Error fetching weekly orders:', err);
            res.status(500).json({ error: 'Error fetching weekly orders' });
        } else {
            res.json(result);
        }
    });
});

// ✅ Monthly quantity totals with previous year
router.get('/orders/monthly', (req, res) => {
    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;
    
    const sqlQuery = `
        SELECT 
            DATE_FORMAT(created_at, '%Y-%m') AS month,
            YEAR(created_at) as year,
            SUM(Quantity) AS total_quantity
        FROM customer_order
        WHERE YEAR(created_at) IN (?, ?)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m'), YEAR(created_at)
        ORDER BY month ASC
    `;

    db.query(sqlQuery, [currentYear, prevYear], (err, result) => {
        if (err) {
            console.error('Error fetching monthly orders:', err);
            res.status(500).json({ error: 'Error fetching monthly orders' });
        } else {
            res.json(result);
        }
    });
});

// GET endpoint to fetch specific order details
router.get('/order/:id', (req, res) => {
    const orderId = req.params.id;
    const query = `
        SELECT
            o.order_id,
            o.prawn_type,
            o.quantity,
            o.price,
            o.status,
            o.approved_or_rejected,
            o.created_at,
            o.payment_receipt,
            c.customer_name,
            o.address AS customer_address,
            c.mobile_no AS customer_phone,
            c.email AS customer_email
        FROM customer_order o
        JOIN customer c ON o.customer_id = c.customer_id
        WHERE o.order_id = ?
    `;

    db.query(query, [orderId], (err, result) => {
        if (err) {
            console.error('Error fetching order details:', err);
            res.status(500).json({ error: 'Error fetching order details' });
        } else if (result.length === 0) {
            res.status(404).json({ error: 'Order not found' });
        } else {
            const order = result[0];
            res.json({
                orderId: order.order_id,
                orderDate: order.created_at,
                paymentStatus: order.status === 'Delivered' ? 'Paid' : 'Pending',
                paymentMethod: 'Online Payment', // You can modify this based on your data
                paymentReceipt: order.payment_receipt,
                status: order.status,
                approved_or_rejected: order.approved_or_rejected
            });
        }
    });
});

// GET endpoint to fetch order items
router.get('/order/:id/items', (req, res) => {
    const orderId = req.params.id;
    const query = `
        SELECT
            prawn_type,
            quantity,
            price
        FROM customer_order
        WHERE order_id = ?
    `;

    db.query(query, [orderId], (err, result) => {
        if (err) {
            console.error('Error fetching order items:', err);
            res.status(500).json({ error: 'Error fetching order items' });
        } else {
            const items = result.map(item => ({
                name: item.prawn_type,
                quantity: `${item.quantity} Kg`,
                price: `Rs. ${Number(item.price).toFixed(2)}`
            }));
            res.json(items);
        }
    });
});

// GET endpoint to fetch customer info for an order
router.get('/order/:id/customer', (req, res) => {
    const orderId = req.params.id;
    const query = `
        SELECT
            c.customer_name,
            o.address AS customer_address,
            c.mobile_no AS customer_phone,
            c.email AS customer_email
        FROM customer_order o
        JOIN customer c ON o.customer_id = c.customer_id
        WHERE o.order_id = ?
    `;

    db.query(query, [orderId], (err, result) => {
        if (err) {
            console.error('Error fetching customer info:', err);
            res.status(500).json({ error: 'Error fetching customer info' });
        } else if (result.length === 0) {
            res.status(404).json({ error: 'Customer not found' });
        } else {
            const customer = result[0];
            res.json({
                name: customer.customer_name,
                address: customer.customer_address,
                phone: customer.customer_phone,
                email: customer.customer_email
            });
        }
    });
});

// GET endpoint to fetch order status
router.get('/order/:id/status', (req, res) => {
    const orderId = req.params.id;
    const query = `
        SELECT status
        FROM customer_order
        WHERE order_id = ?
    `;

    db.query(query, [orderId], (err, result) => {
        if (err) {
            console.error('Error fetching order status:', err);
            res.status(500).json({ error: 'Error fetching order status' });
        } else if (result.length === 0) {
            res.status(404).json({ error: 'Order not found' });
        } else {
            res.json({ status: result[0].status });
        }
    });
});

router.patch('/order/:id/approve_reject', (req, res) => {
    const orderId = req.params.id;
    let { action } = req.body; // expected values: 'approved' or 'rejected'

    if (!action || (action !== 'approved' && action !== 'rejected')) {
        return res.status(400).json({ error: 'Invalid action. Must be "approved" or "rejected".' });
    }

    // Capitalize first letter to match ENUM values in DB
    action = action.charAt(0).toUpperCase() + action.slice(1);

    const sqlQuery = `
        UPDATE customer_order
        SET approved_or_rejected = ?
        WHERE order_id = ?
    `;

    db.query(sqlQuery, [action, orderId], (err, result) => {
        if (err) {
            console.error('Error updating approval status:', err);
            return res.status(500).json({ error: 'Error updating approval status' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Fetch the customer's email
        const emailQuery = `SELECT c.email FROM customer_order o JOIN customer c ON o.customer_id = c.customer_id WHERE o.order_id = ?`;
        db.query(emailQuery, [orderId], (err2, result2) => {
            if (err2) {
                console.error('Error fetching email:', err2);
                return res.json({ message: `Order ${action} successfully` });
            }
            if (result2.length === 0 || !result2[0].email) {
                console.log('No email found for order', orderId);
                return res.json({ message: `Order ${action} successfully` });
            }

            const customerEmail = result2[0].email;

            // Send email notification
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: customerEmail,
                subject: 'Order Approval Update',
                text: `Your order #${orderId} has been ${action.toLowerCase()}. Thank you for your business!`
            };

            transporter.sendMail(mailOptions, (err3, info) => {
                if (err3) {
                    console.error('Error sending email:', err3);
                } else {
                    console.log('Email sent:', info.response);
                }
                // Always return success for approval update
                res.json({ message: `Order ${action} successfully` });
            });
        });
    });
});

// GET endpoint to download payment receipt
router.get('/order/:id/receipt', (req, res) => {
    const orderId = req.params.id;
    const query = `SELECT payment_receipt FROM customer_order WHERE order_id = ?`;

    db.query(query, [orderId], (err, result) => {
        if (err) {
            console.error('Error fetching payment receipt:', err);
            res.status(500).json({ error: 'Error fetching payment receipt' });
        } else if (result.length === 0 || !result[0].payment_receipt) {
            res.status(404).json({ error: 'Receipt not found' });
        } else {
                const receiptPath = result[0].payment_receipt || '';

                // Resolve full path safely to avoid duplicated 'uploads/uploads' when
                // DB stores a path like 'uploads/filename.ext'. Also handle absolute paths.
                let fullPath;
                if (path.isAbsolute(receiptPath)) {
                    fullPath = receiptPath;
                } else if (receiptPath.startsWith('uploads/') || receiptPath.startsWith('uploads\\')) {
                    fullPath = path.join(__dirname, '../../', receiptPath);
                } else {
                    fullPath = path.join(__dirname, '../../uploads', receiptPath);
                }

                // Normalize and check file existence before sending
                fullPath = path.normalize(fullPath);
                if (!fs.existsSync(fullPath)) {
                    console.error('Receipt file not found:', fullPath);
                    return res.status(404).json({ error: 'Receipt file not found' });
                }

                res.sendFile(fullPath, (err) => {
                    if (err) {
                        console.error('Error sending file:', err);
                        res.status(500).json({ error: 'Error downloading receipt' });
                    }
                });
        }
    });
});

router.patch('/order/:id/receipt/Assign-By', (req,res) =>{
    const orderId = req.params.id;
    const { assigned_by } = req.body;

    if (!assigned_by) {
        return res.status(400).json({ error: 'Assigned By field is required' });
    }

    const sqlQuery = `
        UPDATE customer_order
        SET assigned_by = ?
        WHERE order_id = ?
    `;

    db.query(sqlQuery, [assigned_by, orderId], (err, result) => {
        if (err) {
            console.error('Error updating Assigned By:', err);
            return res.status(500).json({ error: 'Error updating Assigned By' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        res.json({ message: 'Assigned By updated successfully' });
    });
});

// PATCH endpoint to update order status and send email notification
router.patch('/order/:id/status', (req, res) => {
    const orderId = req.params.id;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ error: 'Status is required' });
    }

    // Update the order status in the database
    const updateQuery = `UPDATE customer_order SET status = ? WHERE order_id = ?`;
    db.query(updateQuery, [status, orderId], (err, result) => {
        if (err) {
            console.error('Error updating status:', err);
            return res.status(500).json({ error: 'Error updating status' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Fetch the customer's email
        const emailQuery = `SELECT c.email FROM customer_order o JOIN customer c ON o.customer_id = c.customer_id WHERE o.order_id = ?`;
        db.query(emailQuery, [orderId], (err2, result2) => {
            if (err2) {
                console.error('Error fetching email:', err2);
                // Still return success, but log error
                return res.json({ message: 'Status updated successfully' });
            }
            if (result2.length === 0 || !result2[0].email) {
                console.log('No email found for order', orderId);
                return res.json({ message: 'Status updated successfully' });
            }

            const customerEmail = result2[0].email;

            // Send email notification
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: customerEmail,
                subject: 'Order Status Update',
                text: `Your order #${orderId} status has been updated to: ${status}. Thank you for your business!`
            };

            transporter.sendMail(mailOptions, (err3, info) => {
                if (err3) {
                    console.error('Error sending email:', err3);
                } else {
                    console.log('Email sent:', info.response);
                }
                // Always return success for status update
                res.json({ message: 'Status updated successfully' });
            });
        });
    });
});

module.exports = router;
 