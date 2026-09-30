import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const sessionCookie = 'bank_session';
const sessionLifetime = process.env.NODE_ENV === 'production' ? 12 * 60 * 60 : 7 * 24 * 60 * 60;
const maximumOpeningBalance = 100_000_000;
const paymentServiceNames = new Set(['Agua', 'Electricidad', 'Gas', 'Internet', 'Telefonía móvil']);

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readSessionToken(request) {
  const cookies = request.headers.cookie?.split(';') ?? [];
  const session = cookies.find((cookie) => cookie.trim().startsWith(`${sessionCookie}=`));
  return session?.trim().slice(sessionCookie.length + 1) ?? null;
}

function parseAmount(value) {
  const amount = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(amount)) return null;

  const [whole, fraction = ''] = amount.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function publicUser(user) {
  return {
    accountNumber: user.account_number,
    fullName: user.full_name,
    balanceCents: user.balance_cents,
  };
}

function verifyPassword(password, saltHex, hashHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const expectedHash = Buffer.from(hashHex, 'hex');
  const actualHash = scryptSync(String(password).slice(0, 128), salt, 64);
  return timingSafeEqual(actualHash, expectedHash);
}

function matchesSecret(candidate, expected) {
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function createDatabase(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      account_number TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_requests (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, idempotency_key)
    );
  `);

  return database;
}

export function createApp({
  dbPath = process.env.BANK_DB_PATH ?? path.join(appDirectory, 'data', 'bank.sqlite'),
  registrationCode = process.env.REGISTRATION_CODE ?? '',
} = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (isProduction && !registrationCode) {
    throw new Error('En producción debes configurar REGISTRATION_CODE para limitar el registro de clientes.');
  }
  if (isProduction && !trustProxy) {
    throw new Error('En producción debes configurar TRUST_PROXY para validar HTTPS y las IP reales.');
  }

  const database = createDatabase(dbPath);
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use((request, response, next) => {
    if (isProduction && !request.secure) {
      return response.status(426).json({ error: 'Este entorno requiere una conexión HTTPS.' });
    }
    if (request.method === 'POST' && request.path.startsWith('/api/')) {
      const origin = request.get('Origin');
      if (origin) {
        let originHost;
        try {
          originHost = new URL(origin).host;
        } catch {
          return response.status(403).json({ error: 'Origen de solicitud no permitido.' });
        }
        if (originHost !== request.get('host')) {
          return response.status(403).json({ error: 'Origen de solicitud no permitido.' });
        }
      }
    }
    next();
  });
  app.use((request, response, next) => {
    if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
    next();
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.' },
  });
  const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Se alcanzó el límite temporal de registros. Inténtalo más tarde.' },
  });
  const transactionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiadas operaciones. Espera un momento antes de continuar.' },
  });
  const secureCookieAttribute = isProduction ? '; Secure' : '';

  const findUserBySession = database.prepare(`
    SELECT users.id, users.account_number, users.full_name, users.balance_cents
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `);

  function requireUser(request, response, next) {
    const token = readSessionToken(request);
    if (!token) return response.status(401).json({ error: 'Inicia sesión para continuar.' });

    const user = findUserBySession.get(hashSessionToken(token), Date.now());
    if (!user) return response.status(401).json({ error: 'La sesión caducó. Inicia sesión de nuevo.' });

    request.user = user;
    next();
  }

  function issueSession(userId, response) {
    const token = randomBytes(32).toString('base64url');
    database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashSessionToken(token), userId, Date.now() + sessionLifetime * 1000);
    response.setHeader('Set-Cookie', `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime}${secureCookieAttribute}`);
  }

  app.post('/api/register', registrationLimiter, (request, response) => {
    const fullName = String(request.body?.fullName ?? '').trim();
    const password = String(request.body?.password ?? '');
    const balanceCents = parseAmount(request.body?.initialBalance);
    const suppliedRegistrationCode = String(request.body?.inviteCode ?? '');

    if (registrationCode && !matchesSecret(suppliedRegistrationCode, registrationCode)) {
      return response.status(403).json({ error: 'Se requiere un código de invitación válido.' });
    }

    if (fullName.length < 2 || fullName.length > 80) {
      return response.status(400).json({ error: 'Escribe un nombre de entre 2 y 80 caracteres.' });
    }
    if (password.length < 12 || password.length > 128) {
      return response.status(400).json({ error: 'La contraseña debe tener entre 12 y 128 caracteres.' });
    }
    if (balanceCents === null || balanceCents > maximumOpeningBalance) {
      return response.status(400).json({ error: 'El saldo inicial debe estar entre $0 y $1,000,000.' });
    }

    const salt = randomBytes(16);
    const passwordHash = scryptSync(password, salt, 64);
    const createdAt = new Date().toISOString();
    let accountNumber;
    let userId;

    try {
      database.exec('BEGIN IMMEDIATE;');
      do {
        accountNumber = String(randomInt(1_000_000_000, 10_000_000_000));
      } while (database.prepare('SELECT 1 FROM users WHERE account_number = ?').get(accountNumber));

      const result = database.prepare(`
        INSERT INTO users (account_number, full_name, password_salt, password_hash, balance_cents, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(accountNumber, fullName, salt.toString('hex'), passwordHash.toString('hex'), balanceCents, createdAt);
      userId = Number(result.lastInsertRowid);

      if (balanceCents > 0) {
        database.prepare(`
          INSERT INTO transactions (user_id, type, amount_cents, description, created_at)
          VALUES (?, 'opening', ?, 'Saldo inicial ficticio', ?)
        `).run(userId, balanceCents, createdAt);
      }
      database.exec('COMMIT;');
    } catch {
      database.exec('ROLLBACK;');
      return response.status(500).json({ error: 'No se pudo crear la cuenta. Inténtalo de nuevo.' });
    }

    issueSession(userId, response);
    return response.status(201).json({
      user: { accountNumber, fullName, balanceCents },
      message: 'Cuenta de demostración creada.',
    });
  });

  app.post('/api/login', loginLimiter, (request, response) => {
    const accountNumber = String(request.body?.accountNumber ?? '').trim();
    const password = String(request.body?.password ?? '');
    const user = database.prepare(`
      SELECT id, account_number, full_name, password_salt, password_hash, balance_cents
      FROM users WHERE account_number = ?
    `).get(accountNumber);

    const passwordMatches = user
      ? verifyPassword(password, user.password_salt, user.password_hash)
      : verifyPassword(password, '00'.repeat(16), '00'.repeat(64));
    if (!passwordMatches) {
      return response.status(401).json({ error: 'Número de cuenta o contraseña incorrectos.' });
    }

    issueSession(user.id, response);
    return response.json({ user: publicUser(user), message: 'Sesión iniciada.' });
  });

  app.post('/api/change-password', requireUser, (request, response) => {
    const currentPassword = String(request.body?.currentPassword ?? '');
    const newPassword = String(request.body?.newPassword ?? '');
    const user = database.prepare('SELECT password_salt, password_hash FROM users WHERE id = ?').get(request.user.id);

    if (!verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
      return response.status(401).json({ error: 'La contraseña actual es incorrecta.' });
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      return response.status(400).json({ error: 'La nueva contraseña debe tener entre 12 y 128 caracteres.' });
    }
    if (newPassword === currentPassword) {
      return response.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual.' });
    }

    const salt = randomBytes(16);
    const passwordHash = scryptSync(newPassword, salt, 64);
    try {
      database.exec('BEGIN IMMEDIATE;');
      database.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?')
        .run(salt.toString('hex'), passwordHash.toString('hex'), request.user.id);
      database.prepare('DELETE FROM sessions WHERE user_id = ?').run(request.user.id);
      database.exec('COMMIT;');
    } catch {
      database.exec('ROLLBACK;');
      return response.status(500).json({ error: 'No se pudo actualizar la contraseña.' });
    }

    issueSession(request.user.id, response);
    return response.json({ message: 'Contraseña actualizada.' });
  });

  app.post('/api/logout', (request, response) => {
    const token = readSessionToken(request);
    if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token));
    response.setHeader('Set-Cookie', `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookieAttribute}`);
    return response.json({ message: 'Sesión cerrada.' });
  });

  app.get('/api/me', (request, response) => {
    const token = readSessionToken(request);
    if (!token) return response.json({ user: null });

    const user = findUserBySession.get(hashSessionToken(token), Date.now());
    return response.json({ user: user ? publicUser(user) : null });
  });

  app.get('/api/transactions', requireUser, (request, response) => {
    const transactions = database.prepare(`
      SELECT id, type, amount_cents AS amountCents, description, created_at AS createdAt
      FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100
    `).all(request.user.id);
    response.json({ transactions });
  });

  app.get('/api/transactions/:id', requireUser, (request, response) => {
    const transactionId = Number(request.params.id);
    if (!Number.isSafeInteger(transactionId) || transactionId <= 0) {
      return response.status(404).json({ error: 'No se encontró el movimiento.' });
    }

    const transaction = database.prepare(`
      SELECT id, type, amount_cents AS amountCents, description, created_at AS createdAt
      FROM transactions WHERE id = ? AND user_id = ?
    `).get(transactionId, request.user.id);
    if (!transaction) return response.status(404).json({ error: 'No se encontró el movimiento.' });
    return response.json({ transaction });
  });

  app.post('/api/transactions', transactionLimiter, requireUser, (request, response) => {
    const type = String(request.body?.type ?? '');
    const amountCents = parseAmount(request.body?.amount);
    const targetAccountNumber = String(request.body?.targetAccountNumber ?? '').trim();
    const serviceName = String(request.body?.serviceName ?? '').trim();
    const serviceReference = String(request.body?.serviceReference ?? '').trim();
    const idempotencyKey = String(request.get('Idempotency-Key') ?? '');

    if (!/^[A-Za-z0-9_-]{16,80}$/.test(idempotencyKey)) {
      return response.status(400).json({ error: 'Falta una clave válida para identificar esta operación.' });
    }
    if (!['deposit', 'withdraw', 'transfer', 'payment'].includes(type)) {
      return response.status(400).json({ error: 'Selecciona una operación válida.' });
    }
    if (amountCents === null || amountCents <= 0 || amountCents > maximumOpeningBalance) {
      return response.status(400).json({ error: 'El importe debe ser mayor que $0 y no superar $1,000,000.' });
    }

    try {
      database.exec('BEGIN IMMEDIATE;');
      const sender = database.prepare('SELECT id, account_number, full_name, balance_cents FROM users WHERE id = ?')
        .get(request.user.id);
      if (!sender) {
        database.exec('ROLLBACK;');
        return response.status(401).json({ error: 'Inicia sesión para continuar.' });
      }

      const requestHash = createHash('sha256').update(JSON.stringify({
        type,
        amountCents,
        targetAccountNumber: type === 'transfer' ? targetAccountNumber : null,
        serviceName: type === 'payment' ? serviceName : null,
        serviceReference: type === 'payment' ? serviceReference : null,
      })).digest('hex');
      const previousRequest = database.prepare(`
        SELECT request_hash, response_json FROM idempotency_requests
        WHERE user_id = ? AND idempotency_key = ?
      `).get(sender.id, idempotencyKey);
      if (previousRequest) {
        database.exec('ROLLBACK;');
        if (previousRequest.request_hash !== requestHash) {
          return response.status(409).json({ error: 'Esta clave ya se usó con datos distintos. Inicia una nueva operación.' });
        }

        const previousResponse = JSON.parse(previousRequest.response_json);
        const currentUser = database.prepare(`
          SELECT id, account_number, full_name, balance_cents FROM users WHERE id = ?
        `).get(sender.id);
        return response.status(200).json({
          ...previousResponse,
          user: publicUser(currentUser),
          message: 'La operación ya estaba registrada; no se duplicó.',
        });
      }

      let recipient = null;
      if (type === 'payment') {
        if (!paymentServiceNames.has(serviceName)) {
          database.exec('ROLLBACK;');
          return response.status(400).json({ error: 'Selecciona un servicio disponible.' });
        }
        if (!/^[A-Za-z0-9-]{4,32}$/.test(serviceReference)) {
          database.exec('ROLLBACK;');
          return response.status(400).json({ error: 'Escribe una referencia válida de 4 a 32 caracteres.' });
        }
      }
      if (type === 'transfer') {
        if (!/^\d{10}$/.test(targetAccountNumber)) {
          database.exec('ROLLBACK;');
          return response.status(400).json({ error: 'Escribe un número de cuenta de 10 dígitos.' });
        }
        recipient = database.prepare(`
          SELECT id, account_number, full_name, balance_cents FROM users WHERE account_number = ?
        `).get(targetAccountNumber);
        if (!recipient) {
          database.exec('ROLLBACK;');
          return response.status(404).json({ error: 'No se encontró la cuenta de destino.' });
        }
        if (recipient.id === sender.id) {
          database.exec('ROLLBACK;');
          return response.status(400).json({ error: 'Elige una cuenta distinta a la tuya.' });
        }
      }

      if (type !== 'deposit' && sender.balance_cents < amountCents) {
        database.exec('ROLLBACK;');
        return response.status(400).json({ error: 'El saldo disponible no alcanza para esta operación.' });
      }

      const createdAt = new Date().toISOString();
      const updateBalance = database.prepare('UPDATE users SET balance_cents = ? WHERE id = ?');
      const addTransaction = database.prepare(`
        INSERT INTO transactions (user_id, type, amount_cents, description, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      let updatedBalance = sender.balance_cents;

      if (type === 'deposit') {
        updatedBalance += amountCents;
        updateBalance.run(updatedBalance, sender.id);
        addTransaction.run(sender.id, 'deposit', amountCents, 'Depósito', createdAt);
      } else if (type === 'withdraw') {
        updatedBalance -= amountCents;
        updateBalance.run(updatedBalance, sender.id);
        addTransaction.run(sender.id, 'withdraw', amountCents, 'Retiro', createdAt);
      } else if (type === 'payment') {
        updatedBalance -= amountCents;
        updateBalance.run(updatedBalance, sender.id);
        addTransaction.run(sender.id, 'payment', amountCents, `Pago ${serviceName} · ${serviceReference}`, createdAt);
      } else {
        updatedBalance -= amountCents;
        updateBalance.run(updatedBalance, sender.id);
        updateBalance.run(recipient.balance_cents + amountCents, recipient.id);
        addTransaction.run(sender.id, 'transfer_out', amountCents, `Transferencia a ${recipient.account_number}`, createdAt);
        addTransaction.run(recipient.id, 'transfer_in', amountCents, `Transferencia de ${sender.account_number}`, createdAt);
      }

      const result = {
        user: publicUser({ ...sender, balance_cents: updatedBalance }),
        message: 'Operación registrada.',
      };
      database.prepare(`
        INSERT INTO idempotency_requests (user_id, idempotency_key, request_hash, response_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(sender.id, idempotencyKey, requestHash, JSON.stringify(result), createdAt);
      database.exec('COMMIT;');
      return response.status(201).json(result);
    } catch {
      database.exec('ROLLBACK;');
      return response.status(500).json({ error: 'No se pudo completar la operación.' });
    }
  });

  app.get('/', (request, response) => response.redirect(302, '/HTML/'));
  app.use('/api', (request, response) => response.status(404).json({ error: 'Operación no encontrada.' }));
  app.use(express.static(appDirectory));
  app.use((error, request, response, next) => {
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({ error: 'La solicitud contiene JSON inválido.' });
    }
    return response.status(500).json({ error: 'Ocurrió un error inesperado.' });
  });

  app.locals.database = database;
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  const app = createApp();
  app.listen(port, host, () => {
    console.log(`TuBanco está disponible en http://localhost:${port}`);
    if (host === '0.0.0.0') console.log('Para otro dispositivo de tu red, usa http://<IP-LOCAL-DE-ESTE-EQUIPO>:' + port);
  });
}