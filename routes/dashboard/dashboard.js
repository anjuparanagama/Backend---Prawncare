const express = require('express');
const router = express.Router();
const db = require('../../db.js');
const { log } = require('node:console');

//get total revenue of customer orders to dispaly dashboard graph
router.get('/revenue', (req, res) => {
  try {
    db.query('SELECT SUM(price) AS totalRevenue FROM customer_order', (err, results) => {
      if (err) {
        log('Error in revenue query:', err);
        return res.status(500).json({ error: 'Database query failed' });
      }
      res.json({ totalRevenue: results[0].totalRevenue });
    });
  } catch (error) {
    log('sync error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// ✅ Orders API
router.get('/orders', (req, res) => {
    db.query('SELECT COUNT(*) AS newOrders FROM customer_order WHERE status = ?', ['New'], (err, results) => {
      if (err) {
        log('Error in orders query:', err);
        return res.status(500).json({ error: 'Database query failed' });
      }
      res.json({ newOrders: results[0].newOrders });
    });
});

// ✅ Low Stock API
router.get('/low-stock', (req, res) => {
  const query = `
    SELECT COUNT(*) AS total_items
    FROM inventory
    WHERE quantity < (threshold + 25);
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error in low stock query:', err);
      return res.status(500).json({ error: err.message });
    }

    res.json({
      lowStockItems: results[0].total_items
    });
  });
});

// Revenue Data for Chart
router.get('/data', (req, res) => {
    const sql = `SELECT
      DATE_FORMAT(created_at, '%M') AS month,
      SUM(price) AS revenue
      FROM customer_order
      GROUP BY MONTH(created_at), DATE_FORMAT(created_at, '%M')
      ORDER BY MONTH(created_at);`;
      
    db.query(sql, (err, results) => {
      if (err) {
        console.error('Error fetching orders:', err);
        res.status(500).json({ error: 'Database query failed' });
      } else {
        res.json(results);
      }
    });
});

// Assign task to worker by individually.
router.put('/assign-task/:id', (req,res) => {
  const { id } = req.params;
  const { title, description } = req.body;
  const sql = 'INSERT INTO task (title, description, worker_id) VALUES (?, ?, ?)';

  try {
    db.query(sql, [title, description, id], (err,result) => {
      if (err) {
        console.error('error adding data:', err);
        res.status(500).json({error:'database query failed'});
      } else {
        res.json({message: 'Task assigned successfully', taskId: result.insertId});
      }
    });
  } catch (error) {
    console.error('sync error:', error);
    res.status(500).json({error: 'database connection failed'});
  }
});

// Get worker details for task assignment
router.get('/getworkerdetails', (req,res) => {
  db.query('SELECT id, name FROM worker', (err, results) => {
    if (err) {
      console.error('error fetching data:', err);
      res.status(500).json({error:'database query failed'});
    } else {
      res.json(results);
    }
  });
});

module.exports = router;
