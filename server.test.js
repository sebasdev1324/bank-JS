import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { createApp } from './server.js';

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'tubanco-test-'));
const databasePath = path.join(temporaryDirectory, 'bank.sqlite');
const registrationCode = 'private-beta-test-code';
const app = createApp({ dbPath: databasePath, registrationCode });
const server = createServer(app);
let baseUrl;

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
  app.locals.database.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function api(route, { method = 'GET', body, cookie, idempotencyKey, origin } = {}) {
  const requestBody = route === '/api/register' && body && !Object.hasOwn(body, 'inviteCode')
    ? { ...body, inviteCode: registrationCode }
    : body;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(requestBody ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
  });
  return {
    response,
    data: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}

test('routes the app entry to separate login and registration pages', async () => {
  for (const route of ['/', '/HTML/']) {
    const response = await fetch(`${baseUrl}${route}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/HTML/login.html');
  }

  const loginPage = await fetch(`${baseUrl}/HTML/login.html`);
  const registrationPage = await fetch(`${baseUrl}/HTML/register.html`);
  const storePage = await fetch(`${baseUrl}/HTML/store.html`);
  assert.equal(loginPage.status, 200);
  assert.equal(registrationPage.status, 200);
  assert.equal(storePage.status, 200);
  assert.match(await loginPage.text(), /data-auth-page="login"/);
  assert.match(await registrationPage.text(), /data-auth-page="register"/);
  assert.match(await storePage.text(), /data-page="store"/);
});

test('registers a demo account and records the opening balance', async () => {
  const { response, data, cookie } = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Ada Lovelace', password: 'aprendo-seguro', initialBalance: '1250.75' },
  });

  assert.equal(response.status, 201);
  assert.match(data.user.accountNumber, /^\d{10}$/);
  assert.equal(data.user.balanceCents, 125075);
  assert.ok(cookie.startsWith('bank_session='));
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);

  const profile = await api('/api/me', { cookie });
  assert.equal(profile.data.user.fullName, 'Ada Lovelace');

  const history = await api('/api/transactions', { cookie });
  assert.equal(history.data.transactions.length, 1);
  assert.equal(history.data.transactions[0].type, 'opening');
  assert.equal(history.data.transactions[0].amountCents, 125075);
  assert.equal(history.data.transactions[0].description, 'Saldo inicial ficticio');
});

test('rejects invalid registration values and unauthenticated account access', async () => {
  const invalid = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'B', password: '1234', initialBalance: '-1' },
  });
  assert.equal(invalid.response.status, 400);

  const privateHistory = await api('/api/transactions');
  assert.equal(privateHistory.response.status, 401);

  const anonymousProfile = await api('/api/me');
  assert.equal(anonymousProfile.response.status, 200);
  assert.equal(anonymousProfile.data.user, null);
});

test('protects private-beta registration and rejects cross-origin state changes', async () => {
  const missingCode = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Sin invitación', password: 'clave-segura-123', initialBalance: '0', inviteCode: '' },
  });
  assert.equal(missingCode.response.status, 403);

  const incorrectCode = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Código incorrecto', password: 'clave-segura-123', initialBalance: '0', inviteCode: 'incorrecto' },
  });
  assert.equal(incorrectCode.response.status, 403);

  const crossOrigin = await api('/api/register', {
    method: 'POST',
    origin: 'https://sitio-ajeno.example',
    body: { fullName: 'Origen externo', password: 'clave-segura-123', initialBalance: '0', inviteCode: registrationCode },
  });
  assert.equal(crossOrigin.response.status, 403);

  const accepted = await api('/api/register', {
    method: 'POST',
    origin: baseUrl,
    body: { fullName: 'Cliente Invitado', password: 'clave-segura-123', initialBalance: '0', inviteCode: registrationCode },
  });
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(accepted.response.headers.get('content-security-policy'), /default-src 'self'/);
});

test('keeps each account history private to its own session', async () => {
  const firstAccount = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cuenta Uno', password: 'clave-primera', initialBalance: '12.00' },
  });
  const secondAccount = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cuenta Dos', password: 'clave-segunda', initialBalance: '34.00' },
  });

  const firstHistory = await api('/api/transactions', { cookie: firstAccount.cookie });
  const secondHistory = await api('/api/transactions', { cookie: secondAccount.cookie });
  assert.deepEqual(firstHistory.data.transactions.map((item) => item.amountCents), [1200]);
  assert.deepEqual(secondHistory.data.transactions.map((item) => item.amountCents), [3400]);

  const ownReceipt = await api(`/api/transactions/${firstHistory.data.transactions[0].id}`, { cookie: firstAccount.cookie });
  assert.equal(ownReceipt.response.status, 200);
  assert.equal(ownReceipt.data.transaction.id, firstHistory.data.transactions[0].id);

  const privateReceipt = await api(`/api/transactions/${firstHistory.data.transactions[0].id}`, { cookie: secondAccount.cookie });
  assert.equal(privateReceipt.response.status, 404);
});

test('records deposits, withdrawals and transfers with consistent balances', async () => {
  const sender = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cliente Emisor', password: 'clave-emisor-1', initialBalance: '100.00' },
  });
  const recipient = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cliente Receptor', password: 'clave-receptor-1', initialBalance: '25.00' },
  });

  const deposit = await api('/api/transactions', {
    method: 'POST',
    cookie: sender.cookie,
    idempotencyKey: 'deposit-test-key-0001',
    body: { type: 'deposit', amount: '10.50' },
  });
  assert.equal(deposit.response.status, 201);
  assert.equal(deposit.data.user.balanceCents, 11050);

  const withdrawal = await api('/api/transactions', {
    method: 'POST',
    cookie: sender.cookie,
    idempotencyKey: 'withdraw-test-key-01',
    body: { type: 'withdraw', amount: '40.00' },
  });
  assert.equal(withdrawal.data.user.balanceCents, 7050);

  const transfer = await api('/api/transactions', {
    method: 'POST',
    cookie: sender.cookie,
    idempotencyKey: 'transfer-test-key-001',
    body: { type: 'transfer', amount: '30.00', targetAccountNumber: recipient.data.user.accountNumber },
  });
  assert.equal(transfer.response.status, 201);
  assert.equal(transfer.data.user.balanceCents, 4050);

  const recipientProfile = await api('/api/me', { cookie: recipient.cookie });
  assert.equal(recipientProfile.data.user.balanceCents, 5500);

  const insufficientFunds = await api('/api/transactions', {
    method: 'POST',
    cookie: sender.cookie,
    idempotencyKey: 'insufficient-test-key',
    body: { type: 'withdraw', amount: '40.51' },
  });
  assert.equal(insufficientFunds.response.status, 400);
  assert.equal((await api('/api/me', { cookie: sender.cookie })).data.user.balanceCents, 4050);

  const senderHistory = await api('/api/transactions', { cookie: sender.cookie });
  const recipientHistory = await api('/api/transactions', { cookie: recipient.cookie });
  assert.ok(senderHistory.data.transactions.some((item) => item.type === 'transfer_out' && item.amountCents === 3000));
  assert.ok(recipientHistory.data.transactions.some((item) => item.type === 'transfer_in' && item.amountCents === 3000));
});

test('pays an allowed service and rejects invalid or unaffordable payments', async () => {
  const account = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cliente Servicios', password: 'servicios-seguros', initialBalance: '80.00' },
  });
  const payment = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'service-payment-key-01',
    body: { type: 'payment', serviceName: 'Internet', serviceReference: 'CLI-40218', amount: '29.99' },
  });
  assert.equal(payment.response.status, 201);
  assert.equal(payment.data.user.balanceCents, 5001);

  const replayWithChangedReference = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'service-payment-key-01',
    body: { type: 'payment', serviceName: 'Internet', serviceReference: 'CLI-40219', amount: '29.99' },
  });
  assert.equal(replayWithChangedReference.response.status, 409);

  const invalidService = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'service-payment-key-02',
    body: { type: 'payment', serviceName: 'Servicio desconocido', serviceReference: 'CLI-40220', amount: '1.00' },
  });
  assert.equal(invalidService.response.status, 400);

  const insufficientFunds = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'service-payment-key-03',
    body: { type: 'payment', serviceName: 'Electricidad', serviceReference: 'CLI-40221', amount: '50.02' },
  });
  assert.equal(insufficientFunds.response.status, 400);
  assert.equal((await api('/api/me', { cookie: account.cookie })).data.user.balanceCents, 5001);

  const history = await api('/api/transactions', { cookie: account.cookie });
  assert.equal(history.data.transactions.filter((item) => item.type === 'payment').length, 1);
  assert.equal(history.data.transactions[0].description, 'Pago Internet · CLI-40218');
});

test('sells demo products using server prices and prevents duplicate or invalid purchases', async () => {
  const account = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cliente Tienda', password: 'tienda-segura-123', initialBalance: '100.00' },
  });

  const anonymousCatalog = await api('/api/store/products');
  assert.equal(anonymousCatalog.response.status, 401);

  const catalog = await api('/api/store/products', { cookie: account.cookie });
  assert.equal(catalog.response.status, 200);
  assert.ok(catalog.data.products.some((product) => product.id === 'taza-termica'));

  const purchaseRequest = {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'store-purchase-cart-0001',
    body: {
      type: 'purchase',
      amount: '0.01',
      items: [{ productId: 'taza-termica', quantity: 2 }],
    },
  };
  const purchase = await api('/api/transactions', purchaseRequest);
  assert.equal(purchase.response.status, 201);
  assert.equal(purchase.data.user.balanceCents, 5002);
  assert.ok(Number.isSafeInteger(purchase.data.transactionId));

  const retry = await api('/api/transactions', purchaseRequest);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.user.balanceCents, 5002);

  const reusedKey = await api('/api/transactions', {
    ...purchaseRequest,
    body: { type: 'purchase', items: [{ productId: 'taza-termica', quantity: 1 }] },
  });
  assert.equal(reusedKey.response.status, 409);

  const invalidProduct = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'store-purchase-invalid-01',
    body: { type: 'purchase', items: [{ productId: 'producto-inventado', quantity: 1 }] },
  });
  assert.equal(invalidProduct.response.status, 400);

  const unaffordable = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'store-purchase-expensive-1',
    body: { type: 'purchase', items: [{ productId: 'audifonos-bluetooth', quantity: 2 }] },
  });
  assert.equal(unaffordable.response.status, 400);

  const history = await api('/api/transactions', { cookie: account.cookie });
  const purchases = history.data.transactions.filter((item) => item.type === 'purchase');
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].id, purchase.data.transactionId);
  assert.equal(purchases[0].amountCents, 4998);
  assert.match(purchases[0].description, /2 × Taza térmica/);

  const cardFunding = await api('/api/card/transfers', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'store-card-funding-demo-01',
    body: { amount: '30.00' },
  });
  assert.equal(cardFunding.response.status, 201);
  const fundedCard = await api('/api/card', { cookie: account.cookie });

  const cardPurchase = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'store-virtual-card-test-01',
    body: {
      type: 'purchase',
      paymentMethod: 'virtual-card',
      cardCvv: fundedCard.data.card.cvv,
      items: [{ productId: 'taza-termica', quantity: 1 }],
    },
  });
  assert.equal(cardPurchase.response.status, 201);
  assert.equal(cardPurchase.data.user.balanceCents, 2002);
  assert.equal(cardPurchase.data.cardBalanceCents, 501);
  const cardReceipt = await api(`/api/transactions/${cardPurchase.data.transactionId}`, { cookie: account.cookie });
  assert.equal(cardReceipt.response.status, 200);
  assert.match(cardReceipt.data.transaction.description, /tarjeta virtual/);
  assert.doesNotMatch(JSON.stringify(cardReceipt.data), new RegExp(fundedCard.data.card.cvv));

  const invalidCardCvv = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'store-virtual-card-invalid-1',
    body: {
      type: 'purchase',
      paymentMethod: 'virtual-card',
      cardCvv: '000',
      items: [{ productId: 'cuaderno-viaje', quantity: 1 }],
    },
  });
  assert.equal(invalidCardCvv.response.status, 400);

  const insufficientCardFunds = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'store-virtual-card-low-01',
    body: {
      type: 'purchase',
      paymentMethod: 'virtual-card',
      cardCvv: (await api('/api/card', { cookie: account.cookie })).data.card.cvv,
      items: [{ productId: 'taza-termica', quantity: 2 }],
    },
  });
  assert.equal(insufficientCardFunds.response.status, 400);

  const invalidMethod = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'store-payment-method-01',
    body: { type: 'purchase', paymentMethod: 'unknown', items: [{ productId: 'taza-termica', quantity: 1 }] },
  });
  assert.equal(invalidMethod.response.status, 400);

  const receipt = await api(`/api/transactions/${purchase.data.transactionId}`, { cookie: account.cookie });
  assert.equal(receipt.response.status, 200);
  assert.equal(receipt.data.transaction.type, 'purchase');
  assert.equal((await api('/api/me', { cookie: account.cookie })).data.user.balanceCents, 2002);
});

test('keeps virtual-card balance separate and rotates its demo CVV', async () => {
  const account = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cliente Tarjeta', password: 'tarjeta-segura-123', initialBalance: '50.00' },
  });
  const anonymousCard = await api('/api/card');
  assert.equal(anonymousCard.response.status, 401);

  const initialCard = await api('/api/card', { cookie: account.cookie });
  assert.equal(initialCard.response.status, 200);
  assert.match(initialCard.data.card.cardNumber, /^9999\d{12}$/);
  assert.equal(initialCard.data.card.balanceCents, 0);
  assert.match(initialCard.data.card.cvv, /^\d{3}$/);
  assert.equal(initialCard.data.card.isDemo, true);

  const originalNow = Date.now;
  let cardAtNextMinute;
  try {
    const minute = Math.floor(originalNow() / 60_000) * 60_000;
    Date.now = () => minute + 1000;
    const firstMinute = await api('/api/card', { cookie: account.cookie });
    Date.now = () => minute + 60_000;
    cardAtNextMinute = await api('/api/card', { cookie: account.cookie });
    assert.notEqual(firstMinute.data.card.cvv, cardAtNextMinute.data.card.cvv);
  } finally {
    Date.now = originalNow;
  }

  const transferRequest = {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'card-funding-transfer-01',
    body: { amount: '12.34' },
  };
  const transfer = await api('/api/card/transfers', transferRequest);
  assert.equal(transfer.response.status, 201);
  assert.equal(transfer.data.user.balanceCents, 3766);
  assert.equal(transfer.data.cardBalanceCents, 1234);

  const retry = await api('/api/card/transfers', transferRequest);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.user.balanceCents, 3766);
  assert.equal(retry.data.cardBalanceCents, 1234);

  const insufficient = await api('/api/card/transfers', {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'card-funding-insufficient-1',
    body: { amount: '40.00' },
  });
  assert.equal(insufficient.response.status, 400);

  const history = await api('/api/transactions', { cookie: account.cookie });
  const currentCard = await api('/api/card', { cookie: account.cookie });
  assert.equal(currentCard.data.card.balanceCents, 1234);
  assert.equal(currentCard.data.card.cardNumber, initialCard.data.card.cardNumber);
  assert.equal((await api('/api/me', { cookie: account.cookie })).data.user.balanceCents, 3766);
  const cardTransfers = history.data.transactions.filter((item) => item.type === 'card_funding');
  assert.equal(cardTransfers.length, 1);
  assert.equal(history.data.transactions.filter((item) => item.type === 'purchase').length, 0);
  const transferReceipt = await api(`/api/transactions/${cardTransfers[0].id}`, { cookie: account.cookie });
  assert.equal(transferReceipt.response.status, 200);
  assert.match(transferReceipt.data.transaction.description, /tarjeta virtual/);
});

test('deduplicates concurrent transaction retries and rejects key reuse with different data', async () => {
  const account = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cliente Reintento', password: 'reintento-seguro', initialBalance: '100.00' },
  });
  const missingKey = await api('/api/transactions', {
    method: 'POST',
    cookie: account.cookie,
    body: { type: 'deposit', amount: '15.00' },
  });
  assert.equal(missingKey.response.status, 400);

  const request = {
    method: 'POST',
    cookie: account.cookie,
    idempotencyKey: 'same-retry-key-00001',
    body: { type: 'deposit', amount: '15.00' },
  };
  const [first, retry] = await Promise.all([
    api('/api/transactions', request),
    api('/api/transactions', request),
  ]);
  assert.deepEqual([first.response.status, retry.response.status].sort(), [200, 201]);
  assert.equal(first.data.user.balanceCents, 11500);
  assert.equal(retry.data.user.balanceCents, 11500);

  const changedPayload = await api('/api/transactions', {
    ...request,
    body: { type: 'deposit', amount: '25.00' },
  });
  assert.equal(changedPayload.response.status, 409);

  const profile = await api('/api/me', { cookie: account.cookie });
  const history = await api('/api/transactions', { cookie: account.cookie });
  assert.equal(profile.data.user.balanceCents, 11500);
  assert.equal(history.data.transactions.filter((item) => item.type === 'deposit').length, 1);
});

test('changes password only after current-password verification and revokes old sessions', async () => {
  const account = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cliente Contraseña', password: 'clave-anterior-1', initialBalance: '1.00' },
  });

  const rejectedChange = await api('/api/change-password', {
    method: 'POST',
    cookie: account.cookie,
    body: { currentPassword: 'incorrecta', newPassword: 'clave-nueva-2026' },
  });
  assert.equal(rejectedChange.response.status, 401);

  const changed = await api('/api/change-password', {
    method: 'POST',
    cookie: account.cookie,
    body: { currentPassword: 'clave-anterior-1', newPassword: 'clave-nueva-2026' },
  });
  assert.equal(changed.response.status, 200);

  const revokedSession = await api('/api/me', { cookie: account.cookie });
  assert.equal(revokedSession.data.user, null);

  const oldPasswordLogin = await api('/api/login', {
    method: 'POST',
    body: { accountNumber: account.data.user.accountNumber, password: 'clave-anterior-1' },
  });
  assert.equal(oldPasswordLogin.response.status, 401);

  const newPasswordLogin = await api('/api/login', {
    method: 'POST',
    body: { accountNumber: account.data.user.accountNumber, password: 'clave-nueva-2026' },
  });
  assert.equal(newPasswordLogin.response.status, 200);
});

test('preserves the account in SQLite and supports login and logout', async () => {
  const reopenedDatabase = new DatabaseSync(databasePath);
  const account = reopenedDatabase.prepare('SELECT account_number FROM users WHERE full_name = ?').get('Ada Lovelace');
  const openingMovement = reopenedDatabase.prepare(`
    SELECT transactions.amount_cents FROM transactions
    JOIN users ON users.id = transactions.user_id
    WHERE users.account_number = ?
  `).get(account.account_number);
  reopenedDatabase.close();
  assert.ok(account.account_number);
  assert.equal(openingMovement.amount_cents, 125075);

  const login = await api('/api/login', {
    method: 'POST',
    body: { accountNumber: account.account_number, password: 'aprendo-seguro' },
  });
  assert.equal(login.response.status, 200);

  const invalidLogin = await api('/api/login', {
    method: 'POST',
    body: { accountNumber: account.account_number, password: 'incorrecta' },
  });
  assert.equal(invalidLogin.response.status, 401);

  const logout = await api('/api/logout', { method: 'POST', cookie: login.cookie });
  assert.equal(logout.response.status, 200);
  const closedSession = await api('/api/me', { cookie: login.cookie });
  assert.equal(closedSession.response.status, 200);
  assert.equal(closedSession.data.user, null);
});

test('limits repeated failed login attempts', async () => {
  const account = await api('/api/register', {
    method: 'POST',
    body: { fullName: 'Cliente Protegido', password: 'clave-valida-123', initialBalance: '0' },
  });
  const responses = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await api('/api/login', {
      method: 'POST',
      body: { accountNumber: account.data.user.accountNumber, password: 'incorrecta' },
    });
    responses.push(result.response.status);
  }
  assert.ok(responses.includes(429));
});

test('requires an invite and trusted HTTPS proxy in production mode', async () => {
  const environmentKeys = ['NODE_ENV', 'REGISTRATION_CODE', 'TRUST_PROXY'];
  const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  let productionServer;
  let productionApp;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.REGISTRATION_CODE;
    delete process.env.TRUST_PROXY;
    assert.throws(() => createApp({ dbPath: ':memory:' }), /REGISTRATION_CODE/);

    process.env.REGISTRATION_CODE = 'private-test-code';
    assert.throws(() => createApp({ dbPath: ':memory:' }), /TRUST_PROXY/);

    process.env.TRUST_PROXY = 'loopback';
    productionApp = createApp({ dbPath: ':memory:' });
    productionServer = createServer(productionApp);
    productionServer.listen(0, '127.0.0.1');
    await once(productionServer, 'listening');
    const productionUrl = `http://127.0.0.1:${productionServer.address().port}`;

    const insecureResponse = await fetch(`${productionUrl}/api/me`);
    assert.equal(insecureResponse.status, 426);

    const secureRegistration = await fetch(`${productionUrl}/api/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        Origin: productionUrl.replace('http://', 'https://'),
      },
      body: JSON.stringify({
        fullName: 'Cliente Producción',
        password: 'clave-produccion-2026',
        initialBalance: '0',
        inviteCode: 'private-test-code',
      }),
    });
    assert.equal(secureRegistration.status, 201);
    assert.match(secureRegistration.headers.get('set-cookie'), /Secure/);
  } finally {
    if (productionServer) {
      productionServer.closeAllConnections();
      productionServer.close();
      await once(productionServer, 'close');
    }
    productionApp?.locals.database.close();
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});