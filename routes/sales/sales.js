const express = require('express');
const db = require('../../db.js');
const { log } = require('node:console');
const pdf = require('html-pdf');

const router = express.Router();

//Fetch all sales records with status 'Completed' or 'Delivered'
router.get('/sales', (req, res) => {
  const fetchQuery = `
    SELECT
      o.order_id AS Order_ID,
      c.customer_name AS Customer,
      o.created_at AS Order_Date,
      o.status AS Status,
      o.price AS Amount,
      o.quantity AS Quantity
    FROM customer_order o
    JOIN customer c ON o.customer_id = c.customer_id
    WHERE o.status IN ('Completed', 'Delivered')
    ORDER BY o.created_at DESC
  `;

  log('Executing query:', fetchQuery);

  db.query(fetchQuery, (err, results) => {
    if (err) {
      log('Error fetching sales data:', err);
      return res.status(500).json({ error: 'Database query error', details: err.message });
    }
    res.json(results);
  });
});

//get sales count where status = completed or delivered to update totalsales to sales graph
router.get('/sales/count', (req, res) => {
  const countQuery = `
    SELECT COUNT(*) AS totalSales
    FROM customer_order
    WHERE status IN ('Completed', 'Delivered')
  `;

  db.query(countQuery, (err, results) => {
    if (err) {
      log('Error fetching sales count:', err);
      return res.status(500).json({ error: 'Database query error', details: err.message });
    }
    res.json(results[0]);
  });
});

//get sum of revenues in sales where status = completed or delivered to update totalsales to sales graph and dashboard cards
router.get('/revenue', (req, res) => {
  const revenueQuery = `
    SELECT SUM(price) AS totalRevenue
    FROM customer_order
    WHERE status IN ('Completed', 'Delivered')
  `;

  db.query(revenueQuery, (err, results) => {
    if (err) {
      log('Error fetching revenue data:', err);
      return res.status(500).json({ error: 'Database query error', details: err.message });
    }
    res.json(results[0]);
  });
});

//get monthly revenue data for sales graph
router.get('/revenue/monthly', (req, res) => {
  const monthlyRevenueQuery = `
    SELECT
      DATE_FORMAT(created_at, '%M') AS month,
      COUNT(*) AS revenue
    FROM customer_order
    WHERE status IN ('Completed', 'Delivered')
    GROUP BY MONTH(created_at), DATE_FORMAT(created_at, '%M')
    ORDER BY MONTH(created_at)
  `;

  db.query(monthlyRevenueQuery, (err, results) => {
    if (err) {
      log('Error fetching monthly revenue data:', err);
      return res.status(500).json({ error: 'Database query error', details: err.message });
    }
    res.json({ results });
  });
});

//Generate and download a PDF report of sales data

router.get('/downloadpdf', (req, res) => {
  const { start, end } = req.query;
  
  let sql = `
    SELECT
      o.order_id AS Order_ID,
      c.customer_name AS Customer,
      DATE_FORMAT(o.created_at, '%W %e %M %Y') AS Order_Date,
      o.status AS Status,
      o.price AS Amount,
      o.quantity AS Quantity
    FROM customer_order o
    JOIN customer c ON o.customer_id = c.customer_id
    WHERE o.status IN ('Completed', 'Delivered')
  `;
  
  const params = [];
  
  if (start && end) {
    sql += ` AND DATE(o.created_at) BETWEEN ? AND ?`;
    params.push(start, end);
  }
  
  sql += ` ORDER BY o.created_at DESC`;

  db.query(sql, params, (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Generate HTML content
    const html = generateSalesReportHTML(results);
    
    // PDF generation options
    const pdfOptions = {
      format: 'A4',
      orientation: 'portrait'
    };

    pdf.create(html, pdfOptions).toBuffer((err, buffer) => {
      if (err) {
        console.error('PDF generation error:', err);
        return res.status(500).json({ error: 'Failed to generate PDF' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="sales_report.pdf"');
      res.send(buffer);
    });
  });
});

// Helper function to generate HTML content for sales report

function generateSalesReportHTML(salesData) {
  const tableRows = salesData.map(sales => `
    <tr>
      <td>${sales.Order_ID}</td>
      <td>${sales.Customer}</td>
      <td>${sales.Order_Date}</td>
      <td>${sales.Status}</td>
      <td>${sales.Amount}</td>
      <td>${sales.Quantity}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Sales List</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 20px;
          }
          h1 {
            color: #333;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #ddd;
          }
          th {
            background-color: #f2f2f2;
          }
        </style>
      </head>
      <body>
        <h1>Sales Report</h1>
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Quantity</th>
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

module.exports = router;
