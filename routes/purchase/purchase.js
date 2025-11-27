const express = require("express");
const router = express.Router();
const db = require("../../db");
const nodemailer = require("nodemailer");
const pdf = require('html-pdf');

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


//supplier details fetching to supplier dropdown in purchase form
router.get('/supplier-details', (req, res) => {
    const sql = 'SELECT supplier_id, name FROM supplier';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching suppliers:', err);
            return res.status(500).json({ error: 'Error fetching suppliers' });
        }
        res.json(results);
    });
});

//create and add supply order details to mysql db and send mail to supplier
router.post('/purchase-item-add', (req, res) => {
  const { item_id, supplier_id, quantity, price } = req.body;

  if (!supplier_id || !item_id || !quantity || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
  }

  const status = 'New';
  const sql = `INSERT INTO supply_orders (supplier_id, item_id, quantity, price, status) VALUES (?, ?, ?, ?, ?)`;

  db.query(sql, [supplier_id, item_id, quantity, price, status], (err, result) => {
      if (err) {
          console.error('Error adding purchase item:', err);
          return res.status(500).json({ error: 'Error adding purchase item' });
      }

      const supply_order_id = result.insertId;

      // Fetch supplier email
      db.query("SELECT name, email FROM supplier WHERE supplier_id = ?", [supplier_id], (err2, supplierResult) => {
          if (err2 || supplierResult.length === 0) {
              console.error('Error fetching supplier email:', err2);
              return res.status(500).json({ message: 'Purchase added but failed to fetch supplier email' });
          }

          const supplier = supplierResult[0];

          const mailOptions = {
              from: process.env.EMAIL_USER,
              to: supplier.email,
              subject: "New Purchase Order",
              text: `Hello ${supplier.name},\n\nA new purchase order has been created.\n\nOrder ID: ${supply_order_id}\nItem ID: ${item_id}\nQuantity: ${quantity}\nPrice: ${price}\nStatus: ${status}\n\nThank you.`
          };

          transporter.sendMail(mailOptions, (emailErr, info) => {
              if (emailErr) {
                  console.error("Error sending email:", emailErr);
                  return res.status(500).json({ message: 'Purchase added but email not sent' });
              }

              res.json({ message: 'Purchase item added and email sent successfully', supply_order_id });
          });
      });
  });
});

//fetch purchased items details for display in purchase bottom table
router.get('/purchased-items-details', (req,res) => {
    const sql = `
        SELECT so.supply_order_id, s.name AS supplier_name, i.name, so.quantity, so.price, so.status, so.order_date
        FROM supply_orders so
        JOIN supplier s ON so.supplier_id = s.supplier_id
        JOIN inventory i ON so.item_id = i.item_id
        ORDER BY so.order_date DESC
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching purchased items:', err);
            return res.status(500).json({ error: 'Error fetching purchased items' });
        }
        res.json(results);
    });
})

//download pdf of purchase orders
router.get('/downloadpdf', (req,res) => {
    const { start, end } = req.query;
    let sql = `
        SELECT so.supply_order_id, s.name AS supplier_name, i.name, so.quantity, so.price, so.status, so.order_date
        FROM supply_orders so
        JOIN supplier s ON so.supplier_id = s.supplier_id
        JOIN inventory i ON so.item_id = i.item_id
    `;
    const params = [];
    if (start && end) {
        sql += ` WHERE so.order_date BETWEEN ? AND ?`;
        params.push(start, end);
    }
    sql += ` ORDER BY so.order_date DESC`;

    db.query(sql, params, (err, results) => {
        if (err)
            return res.status(500).json({ error: err.message });

        const html =
                    `
                    <html>
                        <head>
                        <title>Purchase Orders List</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            h1 { color: #333; }
                            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                            th { background-color: #f2f2f2; }
                        </style>
                        </head>
                        <body>
                        <h1>Purchase Orders List</h1>
                        <table>
                            <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>Supplier Name</th>
                                <th>Item Name</th>
                                <th>Quantity</th>
                                <th>Price</th>
                                <th>Status</th>
                                <th>Order Date</th>
                            </tr>
                            </thead>
                            <tbody>
                            ${results.map(order => `
                                <tr>
                                <td>${order.supply_order_id}</td>
                                <td>${order.supplier_name}</td>
                                <td>${order.name}</td>
                                <td>${order.quantity}</td>
                                <td>${order.price}</td>
                                <td>${order.status}</td>
                                <td>${order.order_date}</td>
                                </tr>
                            `).join('')}
                            </tbody>
                        </table>
                        </body>
                    </html>
                    `;

                const options = {
                    format: 'A4',
                    orientation: 'portrait'
                };

                pdf.create(html, options).toBuffer((err, buffer) => {
                    if (err) {
                        console.error('PDF generation error:', err);
                        return res.status(500).json({ error: 'Failed to generate PDF' });
                }

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'attachment; filename="Purchase-orders.pdf"');
                res.send(buffer);
                });
    });
});


module.exports = router;
