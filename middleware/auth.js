const fail = (res, status, code, message) =>
  res.status(status).json({ error: { code, message } });

export function createAuth({ sessionsCollection, usersCollection }) {
  const verifySession = async (req, res, next) => {
    try {
      const [scheme, raw] = (req.headers.authorization || '').split(' ');
      if (scheme !== 'Bearer' || !raw) {
        return fail(res, 401, 'UNAUTHENTICATED', 'Login required.');
      }

      // frontend sends "<token>.<signature>", DB-te shudhu prothom ongsho thake
      const token = raw.split('.')[0];

      const session = await sessionsCollection.findOne({ token });
      if (!session || session.expiresAt < new Date()) {
        return fail(res, 401, 'SESSION_INVALID', 'Session expired or invalid. Please log in again.');
      }

      const user = await usersCollection.findOne({ _id: session.userId });
      if (!user) {
        return fail(res, 401, 'SESSION_INVALID', 'Account not found.');
      }

      req.user = {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: String(user.role || '').toLowerCase(), // "Student" -> "student"
      };
      next();
    } catch (err) {
      console.error('verifySession error:', err.message);
      return fail(res, 500, 'SERVER_ERROR', 'Something went wrong.');
    }
  };

  const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) return fail(res, 401, 'UNAUTHENTICATED', 'Login required.');
    if (!roles.includes(req.user.role)) {
      return fail(res, 403, 'FORBIDDEN', 'You do not have permission to do this.');
    }
    next();
  };

  return { verifySession, requireRole, fail };
}