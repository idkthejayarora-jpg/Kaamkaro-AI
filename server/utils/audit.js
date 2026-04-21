const { v4: uuidv4 } = require('uuid');
const { insertOne } = require('./db');

async function logAudit(userId, userName, action, resource, resourceId = null, details = '') {
  try {
    await insertOne('auditLog', {
      id: uuidv4(),
      userId,
      userName,
      action,         // 'create' | 'update' | 'delete' | 'login' | 'export'
      resource,       // 'staff' | 'customer' | 'vendor' | 'interaction' | 'task' | 'diary'
      resourceId,
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Audit logging should never crash the main request
    console.error('Audit log error:', err.message);
  }
}

module.exports = { logAudit };
