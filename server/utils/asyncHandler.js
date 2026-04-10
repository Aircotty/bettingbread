/**
 * A wrapper for asynchronous express route handlers to catch errors and pass them to the global error handler.
 * Avoids the need for try/catch blocks in every route.
 * 
 * @param {Function} fn - The asynchronous function to wrap.
 * @returns {Function} - An Express route handler.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
