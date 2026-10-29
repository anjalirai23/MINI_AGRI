function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.publicMessage || "Something went wrong. Please try again.",
  });
}

function notFound(req, res) {
  res.status(404).json({ success: false, message: "Route not found" });
}

module.exports = { errorHandler, notFound };
