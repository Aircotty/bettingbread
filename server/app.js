const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const passport = require('passport');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
require('dotenv').config();
const { validateConfig } = require('./utils/configCheck');
validateConfig();

const { pool } = require('./db/index');

const { initCronJobs } = require('./services/cronJobs');
const logger = require('./utils/logger');
const { doubleCsrfProtection, generateCsrfToken } = require('./middleware/csrf');
const { errorHandler } = require('./middleware/error');
const requestLogger = require('./middleware/logging');

const morgan = require('morgan');
const crypto = require('crypto');

const app = express();

// Add Request ID to every request for tracing
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Global Rate Limiter: Protects against DDoS and brute force
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

app.use(requestLogger);
app.use(compression()); // Compress all responses

// Configure Morgan to use our Winston logger
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.info(message.trim(), { service: 'http' })
  }
}));

// Initialize background cron tasks
initCronJobs();


// Trust proxy is required for Railway/Vercel to relay IP addresses correctly
app.set('trust proxy', 1); 

// Health Check Endpoint (for monitoring services)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'UP', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Stripe Webhook MUST remain outside global body parsers and CSRF protection
// Path: /api/payment/webhook (kept same path but moved up for isolation)
const { router: paymentRoutes, stripeWebhookHandler } = require('./routes/payment');
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(helmet());
app.use(cookieParser(process.env.SESSION_SECRET));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(cors({
  origin: [
    'https://www.bettingbread.com',
    'https://bettingbread.com'
  ],
  credentials: true
}));

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
  const token = generateCsrfToken(req, res);
  res.json({ token });
});

app.use('/api/dashboard', globalLimiter, doubleCsrfProtection, require('./routes/dashboard'));
app.use('/api/payment', globalLimiter, doubleCsrfProtection, paymentRoutes);
app.use('/api/admin', globalLimiter, doubleCsrfProtection, require('./routes/admin'));

app.get('/', (req, res) => res.send('BettingBread Backend is running'));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));

// Graceful Shutdown Handler
const gracefulShutdown = () => {
  logger.info('SIGTERM/SIGINT received. Shutting down gracefully...');
  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await pool.end();
      logger.info('Database pool closed.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during database shutdown', { error: err.message });
      process.exit(1);
    }
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
