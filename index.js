const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
require('dotenv').config();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);
const io = socketIo(server);

const inventoryRoutes      = require('./routes/inventory/inventory');
const registerRoutes       = require('./routes/register');
const dashboardRoutes      = require('./routes/dashboard/dashboard');
const loginRoutes          = require('./routes/login/login');
const orderRoutes          = require('./routes/orders/order');
const salesRoutes          = require('./routes/sales/sales');
const signupRoutes         = require('./routes/signup/signup');
const settingsRoutes       = require('./routes/settings/settings');
const purchaseRoutes       = require('./routes/purchase/purchase');
const mobileCustomerRoutes = require('./routes/mobile/customer/customer');
const mobileWorkerRoutes   = require('./routes/mobile/worker/worker')(io);
const mobileSupplierRoutes = require('./routes/mobile/supplier/supplier');
const waterQualityRoutes   = require('./routes/waterquality/waterquality');

app.use('/api/register', registerRoutes);

app.use('/api/login', loginRoutes);
app.use('/api/signup', signupRoutes);

app.use('/api/inventory', inventoryRoutes);

app.use('/api/dashboard', dashboardRoutes);

app.use('/api/orders', orderRoutes);

app.use('/api/sales', salesRoutes);

app.use('/api/settings', settingsRoutes);

app.use('/api/purchase', purchaseRoutes);

app.use('/api/mobile/customer', mobileCustomerRoutes);

app.use('/api/mobile/worker', mobileWorkerRoutes);

app.use('/api/mobile/supplier', mobileSupplierRoutes);

app.use('/api/waterquality' , waterQualityRoutes);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = { io };
