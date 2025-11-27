const express = require('express');
const db = require('../../db');

const router = express.Router();


// Fetch all registered workers

router.get('/registered-workers', (req, res) => {
  const sql = 'SELECT id, name, email, mobile_no FROM worker';

  db.query(sql, (err, result) => {
    if (err) {
      console.error('Error fetching workers:', err);
      return res.status(500).json({ error: 'Error fetching workers' });
    }
    res.json(result);
  });
});


// Update worker details

router.put('/registered-workers/:id', (req, res) => {
  const { id } = req.params;
  const { name, email, mobile_no } = req.body;

  // Validate required fields
  if (!name || !email || !mobile_no) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Name, email, and mobile_no are required'
    });
  }

  const sql = 'UPDATE worker SET name = ?, email = ?, mobile_no = ? WHERE id = ?';
  
  db.query(sql, [name, email, mobile_no, id], (err, result) => {
    if (err) {
      console.error('Error updating worker:', err);
      return res.status(500).json({ error: 'Error updating worker' });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    
    res.json({ message: 'Worker updated successfully' });
  });
});

// Delete a worker by ID

router.delete('/registered-workers/:id', (req, res) => {
  const { id } = req.params;

  const sql = 'DELETE FROM worker WHERE id = ?';
  
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error('Error deleting worker:', err);
      return res.status(500).json({ error: 'Error deleting worker' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    console.log(`Worker with ID ${id} deleted successfully`);
    res.json({ message: 'Worker deleted successfully' });
  });
});

module.exports = router;
