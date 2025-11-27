const express = require("express");
const router = express.Router();
const db = require("../../db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const nodemailer = require('nodemailer');

const JWT_SECRET = process.env.JWT_SECRET || "8f3d2c9b6a1e4f7d9c0b3a6e5d4f1a2b7c9e0d4f6b8a1c3e2f0d9b6a4c8e7f1";

// Generate JWT
function generateToken(user, role) {
    return jwt.sign(
        {
            id: user.id,
            name: user.name,
            email: user.email,
            role: role
        },
        JWT_SECRET,  
        { expiresIn: "7d" } // Token valid for 7 days
    );
}

// CUSTOMER SIGNUP
router.post("/customer-signup", async (req, res) => {
    const { name, email, password, confirmPassword, mobile_no } = req.body;

    // Trim inputs
    const trimmedName = name?.trim();
    const trimmedEmail = email?.trim();
    const trimmedPassword = password?.trim();
    const trimmedConfirmPassword = confirmPassword?.trim();

    if (!trimmedName || !trimmedEmail || !trimmedPassword || !trimmedConfirmPassword || !mobile_no) {
        return res.status(400).json({ message: "All fields are required" });
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
        return res.status(400).json({ message: "Passwords do not match" });
    }

    // Check if email exists
    db.query("SELECT * FROM customer WHERE email = ?", [trimmedEmail], async (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (results.length > 0) return res.status(400).json({ message: "Email already exists" });

        const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

        const sql = "INSERT INTO customer (customer_name, email, password, mobile_no) VALUES (?, ?, ?, ?)";
        db.query(sql, [trimmedName, trimmedEmail, hashedPassword, mobile_no], (error, result) => {
            if (error) {
                console.error("Signup error (customer):", error);
                return res.status(500).json({ error: "Database insert failed" });
            }

            const user = { id: result.insertId, name, email };
            const token = generateToken(user, "customer");

            // Configure Nodemailer
            let transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false, // use TLS
                auth: {
                    user: process.env.EMAIL_USER, // store in .env for security
                    pass: process.env.EMAIL_PASS
                },
                tls: {
                    rejectUnauthorized: false
                }
            });

            // Email content
            let mailOptions = {
                from: process.env.EMAIL_USER,
                to: trimmedEmail,
                subject: 'Welcome to PrawnCare!',
                text: `Hello ${trimmedName},

Welcome to PrawnCare! Your account has been created successfully.

Username: ${trimmedName}

Please login using your email and password. Keep your credentials safe.

Best regards,
PrawnCare Team`
            };

            // Send email
            transporter.sendMail(mailOptions, (err, info) => {
                if (err) {
                    console.error('Email send error details:', {
                        code: err.code,
                        errno: err.errno,
                        syscall: err.syscall,
                        hostname: err.hostname,
                        message: err.message,
                        stack: err.stack
                    });
                    // Still return success even if email fails
                } else {
                    console.log('Welcome email sent successfully:', info.messageId);
                }

                res.status(201).json({
                    message: "Customer registered successfully",
                    token,
                    user
                });
            });
        });
    });
});



// SUPPLIER SIGNUP
router.post("/supplier-signup", async (req, res) => {
    const { name, email, password, confirmPassword, mobile_no } = req.body;

    // Trim inputs
    const trimmedName = name?.trim();
    const trimmedEmail = email?.trim();
    const trimmedPassword = password?.trim();
    const trimmedConfirmPassword = confirmPassword?.trim();

    if (!trimmedName || !trimmedEmail || !trimmedPassword || !trimmedConfirmPassword || !mobile_no) {
        return res.status(400).json({ message: "All fields are required" });
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
        return res.status(400).json({ message: "Passwords do not match" });
    }

    db.query("SELECT * FROM supplier WHERE email = ?", [trimmedEmail], async (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (results.length > 0) return res.status(400).json({ message: "Email already exists" });

        const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

        const sql = "INSERT INTO supplier (name, email, password, mobile_no) VALUES (?, ?, ?, ?)";
        db.query(sql, [trimmedName, trimmedEmail, hashedPassword, mobile_no], (error, result) => {
            if (error) {
                console.error("Signup error (supplier):", error);
                return res.status(500).json({ error: "Database insert failed" });
            }

            const user = { id: result.insertId, name, email };
            const token = generateToken(user, "supplier");

            // Configure Nodemailer
            let transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false, // use TLS
                auth: {
                    user: process.env.EMAIL_USER, // store in .env for security
                    pass: process.env.EMAIL_PASS
                },
                tls: {
                    rejectUnauthorized: false
                }
            });

            // Email content
            let mailOptions = {
                from: process.env.EMAIL_USER,
                to: trimmedEmail,
                subject: 'Welcome to PrawnCare!',
                text: `Hello ${trimmedName},

Welcome to PrawnCare! Your supplier account has been created successfully.

Username: ${trimmedName}

Please login using your email and password. Keep your credentials safe.

Best regards,
PrawnCare Team`
            };

            // Send email
            transporter.sendMail(mailOptions, (err, info) => {
                if (err) {
                    console.error('Email send error details:', {
                        code: err.code,
                        errno: err.errno,
                        syscall: err.syscall,
                        hostname: err.hostname,
                        message: err.message,
                        stack: err.stack
                    });
                    // Still return success even if email fails
                } else {
                    console.log('Welcome email sent successfully:', info.messageId);
                }

                res.status(201).json({
                    message: "Supplier registered successfully",
                    token,
                    user
                });
            });
        });
    });
});

//Worker registration from Admin panel
router.post('/register-worker', async (req, res) => {
    const { name, email, password, mobile_no } = req.body;

    // Trim inputs
    const trimmedName = name?.trim();
    const trimmedEmail = email?.trim();
    const trimmedPassword = password?.trim();

    // Check if mobile number exists
    db.query("SELECT * FROM worker WHERE mobile_no = ?", [mobile_no], async (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (results.length > 0) return res.status(400).json({ message: "Mobile number already exists" });

        // 1. Hash password
        const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

        // 2. Insert worker into DB
        const sql = "INSERT INTO worker (name, email, password, mobile_no) VALUES (?, ?, ?, ?)";
        db.query(sql, [name, email, hashedPassword, mobile_no], (error, result) => {
            if (error) {
                console.error("Signup error (worker):", error);
                if (error.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ message: "Email already registered as a user" });
                }
                return res.status(500).json({ message: "Database insert failed" });
            }

            const workerId = "PF" + result.insertId; // Add PF in front of ID

            // 3. Configure Nodemailer
            let transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false, // use TLS
                auth: {
                    user: process.env.EMAIL_USER, // store in .env for security
                    pass: process.env.EMAIL_PASS
                },
                tls: {
                    rejectUnauthorized: false
                }
            });

            // 4. Email content
            let mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Your Worker Account Details',
                text: `Hello ${name},

                    Your account has been created successfully.

                    Username: ${name}
                    Password: ${password}
                    User ID: ${workerId}

                    Please login using this credentials and dont forget these things.
                    `
            };

            // 5. Send email
            transporter.sendMail(mailOptions, (err, info) => {
                if (err) {
                    console.error('Email send error details:', {
                        code: err.code,
                        errno: err.errno,
                        syscall: err.syscall,
                        hostname: err.hostname,
                        message: err.message,
                        stack: err.stack
                    });
                    return res.status(500).json({ message: 'Worker registered but email failed', error: err.message });
                }

                console.log('Email sent successfully:', info.messageId);
                res.json({ message: 'Worker registered and email sent', workerId });
            });
        });
    });
});

module.exports = router;
