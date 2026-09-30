const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const AppError = require('./utils/AppError');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/mahasiswa', require('./routes/mahasiswaRoutes'));
app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint tidak ditemukan')));
app.use(errorHandler);

module.exports = app;
