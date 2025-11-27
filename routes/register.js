const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const connection = require('../db');

router.post('/', async (req, res) => {
    try {
        const { serviceId, email, password, phone } = req.body;

        if (!serviceId || !email || !password || !phone) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long"
            });
        }

        connection.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
            if (err) {
                console.error("Database error:", err);
                return res.status(500).json({
                    success: false,
                    message: "Database error"
                });
            }

            if (results.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: "Email already exists"
                });
            }

            bcrypt.hash(password, 10, (err, hashedPassword) => {
                if (err) {
                    console.error("Hashing error:", err);
                    return res.status(500).json({
                        success: false,
                        message: "Error processing password"
                    });
                }

                connection.query(
                    'INSERT INTO users (serviceId, email, password, phone) VALUES (?, ?, ?, ?)',
                    [serviceId, email, hashedPassword, phone],
                    (err, result) => {
                        if (err) {
                            console.error("Database error:", err);
                            return res.status(500).json({
                                success: false,
                                message: "Error creating user"
                            });
                        }

                        res.status(201).json({
                            success: true,
                            message: "User registered successfully"
                        });
                    }
                );
            });
        });

    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});

module.exports = router;
