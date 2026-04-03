const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const passport = require('passport');
require('dotenv').config();

const { pool } = require('./db/index');

const { initCronJobs } = require('./services/cronJobs');
const { errorHandler } = require('./middleware/error');


const app = express();

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
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/admin', require('./routes/admin'));

app.get('/', (req, res) => res.send('BettingBread Backend is running'));

// Global Error Handler (must be last)
app.use(errorHandler);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));