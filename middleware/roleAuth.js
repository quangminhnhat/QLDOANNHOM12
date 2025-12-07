function authenticateRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).send("Please login first");
    }
    
    // Convert roles parameter to array if it's a single string
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).send("Not authorized");
    }
    next();
  };
}

module.exports = { authenticateRole };