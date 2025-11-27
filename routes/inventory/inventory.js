const express = require('express');
const router = express.Router();
const db = require('../../db.js');
const pdf = require('html-pdf'); //use html-pdf to create pdf from html

// Add new inventory items to database
router.post('/add', (req, res) => {
    const { itemName, type, qty } = req.body;
    
    // Input validation
    if (!itemName || !type || !qty) {
        return res.status(400).json({ 
            success: false, 
            message: "All fields are required" 
        });
    }

    if (isNaN(qty) || parseInt(qty) < 0) {
        return res.status(400).json({ 
            success: false, 
            message: "Quantity must be a positive number" 
        });
    }

    const sql = 'INSERT INTO inventory (name, type, quantity) VALUES (?, ?, ?)';
    
    db.query(sql, [itemName, type, parseInt(qty)], (err, result) => {
        if (err) {
            console.error('SQL ERROR:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Database error occurred while adding item" 
            });
        }
        
        res.json({
            success: true,
            message: `New Item = ${itemName} successfully added to Database`,
            id: result.insertId
        });
    });
});


//get all items to inventory table 
router.get("/items", (req, res) => {
    const sql = "SELECT item_id, name, quantity FROM inventory";
    db.query(sql, (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    });
});

//create download pdf api to inventory items.
router.get("/downloadpdf", (req, res) => {
  const sql = "  SELECT item_id, name, quantity, DATE_FORMAT(date, '%W %e %M %Y') AS formatted_date FROM inventory";

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    const html = `
      <html>
        <head>
          <title>Items List</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <h1>Items List</h1>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Item Name</th>
                <th>Quantity</th>
                <th>Last Update</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(item => `
                <tr>
                  <td>${item.item_id}</td>
                  <td>${item.name}</td>
                  <td>${item.quantity}</td>
                  <td>${item.formatted_date}</td>
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
      res.setHeader('Content-Disposition', 'attachment; filename="items.pdf"');
      res.send(buffer);
    });
  });
});

//get all inventory items to display in table
router.get('/table', (req, res) => {
    const sql = 'SELECT * FROM inventory';

    db.query(sql, (err, results) => {
      if (err) {
        console.log('SQL ERROR:', err);
        return res.status(500).json({
          error: 'Database error',
          message: err.message || 'Unknown error',
          code: err.code || 'NO_CODE'
        });
      }
      res.status(200).json(results);
    });
  });


//update inventory items table when if inventory items adding to previous stock
router.put('/issue/:id', (req,res) =>{
  const { id } = req.params;
  const itemId = parseInt(id);
  const { qty, date } = req.body || {};

  // Input validation
  if (!id || id === 'undefined' || isNaN(itemId)) {
      return res.status(400).json({
          success: false,
          message: "Valid item ID is required"
      });
  }

  if (!qty || qty === '' || isNaN(qty) || parseInt(qty) < 0) {
      return res.status(400).json({
          success: false,
          message: "Valid quantity is required (must be a positive number)"
      });
  }

  if (!date) {
      return res.status(400).json({
          success: false,
          message: "Date is required"
      });
  }

  // First, fetch the current quantity to check if subtraction would go negative
  const checkSql = "SELECT quantity FROM inventory WHERE item_id = ?";
  
  db.query(checkSql, [itemId], (err, result) => {
      if (err) {
          console.error('SQL ERROR:', err);
          return res.status(500).json({
              success: false,
              message: "Database error occurred while checking item",
              error: err.message
          });
      }

      if (!result || result.length === 0) {
          return res.status(404).json({
              success: false,
              message: "Item not found"
          });
      }

      const currentQty = result[0].quantity;
      const qtyToIssue = parseInt(qty);

      // Check if issuing this quantity would make stock negative
      if (currentQty < qtyToIssue) {
          return res.status(400).json({
              success: false,
              message: `Insufficient stock. Current quantity: ${currentQty}, Requested: ${qtyToIssue}`
          });
      }

      // Proceed with the update since stock won't go negative
      const updateSql = "UPDATE inventory SET quantity = quantity - ?, date = ? WHERE item_id = ?";

      db.query(updateSql, [qtyToIssue, date, itemId], (err, updateResult) => {
          if (err) {
              console.error('SQL ERROR:', err);
              return res.status(500).json({
                  success: false,
                  message: "Database error occurred while updating item",
                  error: err.message
              });
          }

          if (updateResult.affectedRows === 0) {
              return res.status(404).json({
                  success: false,
                  message: "Item not found"
              });
          }

          res.json({
              success: true,
              message: "Item Issued Successfully and Stock Updated"
          });
      });
  });
})


//update inventory items table when if inventory items using
router.put('/update/:id', (req,res) =>{
  const { id } = req.params;
  const itemId = parseInt(id);
  const { qty, date } = req.body || {};

  // Input validation
  if (!id || id === 'undefined' || isNaN(itemId)) {
      return res.status(400).json({
          success: false,
          message: "Valid item ID is required"
      });
  }

  if (!qty || qty === '' || isNaN(qty) || parseInt(qty) < 0) {
      return res.status(400).json({
          success: false,
          message: "Valid quantity is required (must be a positive number)"
      });
  }

  if (!date) {
      return res.status(400).json({
          success: false,
          message: "Date is required"
      });
  }

  const sql = "UPDATE inventory SET quantity = quantity + ?, date = ? WHERE item_id = ?";

  db.query(sql, [parseInt(qty), date, itemId], (err, result) => {
      if (err) {
          console.error('SQL ERROR:', err);
          return res.status(500).json({
              success: false,
              message: "Database error occurred while updating item",
              error: err.message
          });
      }

      if (result.affectedRows === 0) {
          return res.status(404).json({
              success: false,
              message: "Item not found"
          });
      }

      res.json({
          success: true,
          message: "Item updated successfully"
      });
  })
})



module.exports = router;
