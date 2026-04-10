const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const passport = require('passport');
require('dotenv').config();

const { pool } = require('./db/index');

const { initCronJobs } = require('./services/cronJobs');
const logger = require('./utils/logger');
const { doubleCsrfProtection, generateToken } = require('./middleware/csrf');

const morgan = require('morgan');
const crypto = require('crypto');

const app = express();

// Add Request ID to every request for tracing
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Configure Morgan to use our Winston logger
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.info(message.trim(), { service: 'http' })
  }
}));

// Initialize background cron tasks
initCronJobs();


app.set('trust proxy', 1); // Trust first proxy for Render/Vercel load balancers
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));

app.use(session({
  store: new PgSession({ pool }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true, // Required for secure cookies to work behind Render/Vercel proxies
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/auth', require('./routes/auth'));

// CSRF Protected API Routes
app.get('/api/csrf-token', (req, res) => {
  const token = generateToken(req, res);
  res.json({ token });
});

app.use('/api/dashboard', doubleCsrfProtection, require('./routes/dashboard'));
app.use('/api/payment', doubleCsrfProtection, require('./routes/payment'));
app.use('/api/admin', doubleCsrfProtection, require('./routes/admin'));

app.get('/', (req, res) => res.send('BettingBread Backend is running'));

/**
 * Global Error Handler.
 * Logs detailed error information and sends sanitized responses to the client.
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  // Log the error with full context
  logger.error('Unhandled Application Error', {
    status: statusCode,
    message: err.message,
    stack: !isProduction ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    user_id: req.user?.discord_id,
    request_id: req.id
  });

  res.status(statusCode).json({
    error: isProduction ? 'An unexpected error occurred. Please try again later.' : err.message,
    request_id: req.id // Provide request ID for user support
  });
};


app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));