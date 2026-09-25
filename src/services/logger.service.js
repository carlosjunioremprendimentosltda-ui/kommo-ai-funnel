/**
 * Serviço de Logs em memória para exibição em tempo real no Frontend
 */
const logs = [];
const MAX_LOGS = 150;

function log(level, message, details = null) {
  const time = new Date().toLocaleTimeString('pt-BR');
  const iso = new Date().toISOString();

  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    time,
    iso,
    level, // 'info' | 'success' | 'warn' | 'error' | 'ai' | 'kommo'
    message: typeof message === 'object' ? JSON.stringify(message) : String(message),
    details: details ? (typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details)) : null,
  };

  logs.unshift(entry); // Mais recente no topo
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }

  // Também imprime no terminal
  const prefix = `[${time}] [${level.toUpperCase()}]`;
  if (level === 'error') {
    console.error(prefix, message, details || '');
  } else if (level === 'warn') {
    console.warn(prefix, message, details || '');
  } else {
    console.log(prefix, message, details || '');
  }
}

function getLogs() {
  return logs;
}

function clearLogs() {
  logs.length = 0;
  log('info', 'Logs limpos pelo usuário.');
}

module.exports = {
  log,
  getLogs,
  clearLogs,
};
