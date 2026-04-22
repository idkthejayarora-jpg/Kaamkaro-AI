const jwt = require('jsonwebtoken');

const _DEFAULT_SECRET = 'kaamkaro-kamal-secret-2024';
const JWT_SECRET = process.env.JWT_SECRET || _DEFAULT_SECRET;

// Warn loudly in production if no JWT_SECRET is set — tokens can be forged
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn(
    '[Auth] WARNING: JWT_SECRET env var is not set. Using insecure default secret. ' +
    'Set JWT_SECRET in Railway environment variables immediately.',
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authMiddleware, adminOnly, JWT_SECRET };
