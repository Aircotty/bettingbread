/**
 * Global error handling middleware.
 */
const errorHandler = (err, req, res, next) => {
  // If it's a known operational error from Zod or similar
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.flatten()
    });
  }

  console.error(`[SERVER ERROR] ${req.method} ${req.url}:`, err.stack || err);

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    error: message,
    status,
    timestamp: new Date().toISOString()
  });
};

module.exports = { errorHandler };
