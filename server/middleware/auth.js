const logger = require('../utils/logger');

/**
 * Middleware to ensure the request is authenticated via Passport.
 * Returns 401 if the user is not logged in.
 */
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  
  logger.warn('Unauthorized access attempt', {
    path: req.originalUrl,
    ip: req.ip,
    method: req.method
  });
  
  return res.status(401).json({ 
    error: 'Unauthorized - please sign in with Discord' 
  });
};

module.exports = { isAuthenticated };