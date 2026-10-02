const currentPage = document.body.dataset.page;
const currency = new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' });
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function readPreference(key, fallback = '') {
  try { return localStorage.getItem(`tubanco.${key}`) ?? fallback; } catch { return fallback; }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(`tubanco.${key}`, value);
    const status = $('[data-preference-status]');
    if (status) status.textContent = 'Preferencia guardada en este dispositivo.';
  } catch {
    const status = $('[data-preference-status]');
    if (status) status.textContent = 'El navegador no permitió guardar esta preferencia.';
  }
}

const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(theme) {
  const themePreference = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  const selectedTheme = themePreference === 'system' ? (systemColorScheme.matches ? 'dark' : 'light') : themePreference;
  document.documentElement.dataset.theme = selectedTheme;
  document.documentElement.dataset.themePreference = themePreference;
  $$('[data-theme-choice]').forEach((button) => {
    const selected = button.dataset.themeChoice === themePreference;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

function applyAccent(accent) {
  const selectedAccent = ['blue', 'coral', 'green'].includes(accent) ? accent : 'blue';
  document.documentElement.dataset.accent = selectedAccent;
  $$('[data-accent-choice]').forEach((button) => {
    const selected = button.dataset.accentChoice === selectedAccent;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
}

function applyAnimationStyle(style) {
  const selectedStyle = ['none', 'subtle', 'expressive'].includes(style) ? style : 'subtle';
  document.documentElement.dataset.motion = selectedStyle;
  $$('[data-animation-choice]').forEach((button) => {
    const selected = button.dataset.animationChoice === selectedStyle;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
}

function applyDensity(density) {
  const selectedDensity = density === 'compact' ? 'compact' : 'comfortable';
  document.documentElement.dataset.density = selectedDensity;
  $$('[data-density-choice]').forEach((button) => {
    const selected = button.dataset.densityChoice === selectedDensity;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
}

applyTheme(readPreference('theme', 'system'));
applyAccent(readPreference('accent', 'blue'));
applyAnimationStyle(readPreference('animation-style', readPreference('reduced-motion', 'off') === 'on' ? 'none' : 'subtle'));
applyDensity(readPreference('density', 'comfortable'));
systemColorScheme.addEventListener('change', () => {
  if (readPreference('theme', 'system') === 'system') applyTheme('system');
});

async function requestApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('El servidor respondió con datos inválidos. Recarga la página e inténtalo de nuevo.');
  }
  if (!response.ok) throw new Error(result.error ?? 'No se pudo completar la solicitud.');
  return result;
}

function showMessage(message, success = false) {
  const element = $('[data-page-message]');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-error', Boolean(message) && !success);
  element.classList.toggle('is-success', Boolean(message) && success);
}

function transactionLink(transaction) {
  const debit = ['withdraw', 'transfer_out', 'payment', 'purchase', 'card_funding'].includes(transaction.type);
  const link = document.createElement('a');
  link.className = `transaction-row ${debit ? 'is-debit' : 'is-credit'}`;
  link.href = `/HTML/receipt.html?id=${encodeURIComponent(transaction.id)}`;
  const marker = document.createElement('span');
  marker.className = 'transaction-marker';
  marker.textContent = debit ? '↙' : '↗';
  marker.setAttribute('aria-hidden', 'true');
  const details = document.createElement('span');
  details.className = 'transaction-details';
  const title = document.createElement('span');
  title.className = 'transaction-title';
  title.textContent = transaction.description;
  const date = document.createElement('time');
  date.className = 'transaction-date';
  date.dateTime = transaction.createdAt;
  date.textContent = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(transaction.createdAt));
  details.append(title, date);
  const amount = document.createElement('span');
  amount.className = 'transaction-amount';
  amount.textContent = `${debit ? '−' : '+'}${currency.format(transaction.amountCents / 100)}`;
  link.append(marker, details, amount);
  return link;
}

function updateAccount(user) {
  $$('[data-user-name]').forEach((element) => { element.textContent = user.fullName; });
  $$('[data-account-number]').forEach((element) => { element.textContent = user.accountNumber; });
  $$('[data-user-initial]').forEach((element) => { element.textContent = user.fullName.trim().charAt(0).toLocaleUpperCase() || 'C'; });
  $$('[data-balance]').forEach((element) => {
    element.dataset.balanceValue = currency.format(user.balanceCents / 100);
    element.textContent = readPreference('hide-balance', 'false') === 'true' ? '••••••' : element.dataset.balanceValue;
  });
}

function initializeNavigation() {
  const primaryNavigation = $('.dashboard-nav');
  if (primaryNavigation && !primaryNavigation.querySelector('[data-page-link="card"]')) {
    const cardLink = document.createElement('a');
    cardLink.className = 'dashboard-nav-link';
    cardLink.dataset.pageLink = 'card';
    cardLink.href = '/HTML/card.html';
    cardLink.textContent = 'Tarjeta';
    primaryNavigation.append(cardLink);
  }
  if (primaryNavigation && !primaryNavigation.querySelector('[data-page-link="store"]')) {
    const storeLink = document.createElement('a');
    storeLink.className = 'dashboard-nav-link';
    storeLink.dataset.pageLink = 'store';
    storeLink.href = '/HTML/store.html';
    storeLink.textContent = 'Tienda';
    primaryNavigation.append(storeLink);
  }
  $$('[data-page-link]').forEach((link) => {
    if (link.dataset.pageLink === currentPage) link.setAttribute('aria-current', 'page');
  });
  const menu = $('#account-menu');
  if (menu) {
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') menu.open = false;
    });
  }
  $('[data-logout]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      await requestApi('/api/logout', { method: 'POST' });
      window.location.assign('/HTML/');
    } catch (error) {
      showMessage(error.message);
      event.currentTarget.disabled = false;
    }
  });
}

function initializeDashboard(transactions) {
  const balanceToggle = $('[data-toggle-balance]');
  balanceToggle?.addEventListener('click', () => {
    const hide = readPreference('hide-balance', 'false') !== 'true';
    writePreference('hide-balance', String(hide));
    $$('[data-balance]').forEach((element) => { element.textContent = hide ? '••••••' : element.dataset.balanceValue; });
    balanceToggle.setAttribute('aria-pressed', String(hide));
    balanceToggle.setAttribute('aria-label', hide ? 'Mostrar saldo' : 'Ocultar saldo');
  });
  const list = $('[data-recent-transactions]');
  if (list) {
    const recent = transactions.slice(0, 5);
    if (!recent.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-history';
      empty.textContent = 'Todavía no hay movimientos en esta cuenta.';
      list.replaceChildren(empty);
    } else list.replaceChildren(...recent.map(transactionLink));
  }
}

function initializeOperations() {
  const form = $('#transaction-form');
  if (!form) return;
  const targetField = $('[data-field="target"]', form);
  const serviceField = $('[data-field="service"]', form);
  const referenceField = $('[data-field="reference"]', form);
  const targetInput = $('[name="targetAccountNumber"]', form);
  const serviceSummary = $('[data-selected-service]', form);
  const serviceBackLink = $('[data-service-back]', form);
  const referenceInput = $('[name="serviceReference"]', form);
  const params = new URLSearchParams(window.location.search);
  const requestedType = params.get('type');
  const type = ['deposit', 'withdraw', 'transfer', 'payment'].includes(requestedType) ? requestedType : 'deposit';
  const allowedServices = new Set(['Agua', 'Electricidad', 'Gas', 'Internet', 'Telefonía móvil']);
  const selectedService = allowedServices.has(params.get('service')) ? params.get('service') : '';
  const operationNames = { deposit: 'Depósito', withdraw: 'Retiro', transfer: 'Transferencia', payment: 'Pago de servicio' };
  $('[data-operation-name]').textContent = operationNames[type];
  serviceSummary.textContent = selectedService || 'No seleccionaste un servicio.';
  serviceBackLink.hidden = Boolean(selectedService);
  const submitButton = $('button[type="submit"]', form);
  submitButton.disabled = type === 'payment' && !selectedService;
  if (type === 'payment' && !selectedService) showMessage('Vuelve a Servicios y elige el pago que quieres realizar.');
  const updateFields = () => {
    const transfer = type === 'transfer';
    const payment = type === 'payment';
    targetField.hidden = !transfer;
    serviceField.hidden = !payment;
    referenceField.hidden = !payment;
    targetInput.required = transfer;
    referenceInput.required = payment;
  };
  updateFields();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    const data = Object.fromEntries(new FormData(form));
    const body = { type, amount: data.amount };
    if (type === 'transfer') body.targetAccountNumber = data.targetAccountNumber.trim();
    if (type === 'payment') {
      body.serviceName = selectedService;
      body.serviceReference = data.serviceReference.trim();
    }
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    try {
      const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-local`;
      const result = await requestApi('/api/transactions', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      });
      const amountField = $('[name="amount"]', form);
      amountField.value = '';
      showMessage(result.message, true);
      const balance = $('[data-balance]');
      if (balance) {
        balance.dataset.balanceValue = currency.format(result.user.balanceCents / 100);
        balance.textContent = readPreference('hide-balance', 'false') === 'true' ? '••••••' : balance.dataset.balanceValue;
      }
    } catch (error) {
      showMessage(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function initializeStore() {
  const productGrid = $('[data-store-products]');
  const cartItemsElement = $('[data-cart-items]');
  const cartCountElement = $('[data-cart-count]');
  const cartTotalElement = $('[data-cart-total]');
  const checkoutButton = $('[data-checkout]');
  const storeContent = $('[data-store-content]');
  const paymentStep = $('[data-payment-step]');
  const paymentTotal = $('[data-payment-total]');
  const virtualCardForm = $('[data-virtual-card-form]');
  const cardFields = $('[data-virtual-card-fields]');
  const virtualCardCvvInput = $('#virtual-card-cvv');
  const confirmPurchaseButton = $('[data-confirm-purchase]');
  const purchaseComplete = $('[data-purchase-complete]');
  const cart = new Map();
  let products = [];
  let virtualCard = null;
  let purchaseAttempt = null;

  function cartEntries() {
    return [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  }

  function renderCart() {
    const entries = cartEntries();
    const itemsById = new Map(products.map((product) => [product.id, product]));
    const totalQuantity = entries.reduce((total, item) => total + item.quantity, 0);
    const totalCents = entries.reduce((total, item) => total + itemsById.get(item.productId).priceCents * item.quantity, 0);
    cartCountElement.textContent = `${totalQuantity} ${totalQuantity === 1 ? 'producto' : 'productos'}`;
    cartTotalElement.textContent = currency.format(totalCents / 100);
    paymentTotal.textContent = currency.format(totalCents / 100);
    checkoutButton.disabled = entries.length === 0;

    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-history';
      empty.textContent = 'Tu carrito está vacío.';
      cartItemsElement.replaceChildren(empty);
      return;
    }

    const lines = entries.map((item) => {
      const product = itemsById.get(item.productId);
      const line = document.createElement('div');
      line.className = 'store-cart-line';
      const description = document.createElement('div');
      description.className = 'store-cart-description';
      const name = document.createElement('strong');
      name.textContent = product.name;
      const price = document.createElement('span');
      price.textContent = currency.format(product.priceCents * item.quantity / 100);
      description.append(name, price);

      const controls = document.createElement('div');
      controls.className = 'store-quantity-controls';
      const decrease = document.createElement('button');
      decrease.type = 'button';
      decrease.textContent = '−';
      decrease.setAttribute('aria-label', `Quitar una unidad de ${product.name}`);
      decrease.addEventListener('click', () => {
        if (item.quantity === 1) cart.delete(item.productId);
        else cart.set(item.productId, item.quantity - 1);
        purchaseAttempt = null;
        renderCart();
      });
      const quantity = document.createElement('span');
      quantity.textContent = String(item.quantity);
      const increase = document.createElement('button');
      increase.type = 'button';
      increase.textContent = '+';
      increase.setAttribute('aria-label', `Añadir una unidad de ${product.name}`);
      increase.disabled = item.quantity >= 10;
      increase.addEventListener('click', () => {
        cart.set(item.productId, item.quantity + 1);
        purchaseAttempt = null;
        renderCart();
      });
      controls.append(decrease, quantity, increase);
      line.append(description, controls);
      return line;
    });
    cartItemsElement.replaceChildren(...lines);
  }

  async function refreshVirtualCard() {
    const { card } = await requestApi('/api/card');
    virtualCard = card;
    $('[data-store-card-last-four]').textContent = card.cardNumber.slice(-4);
    $('[data-store-card-balance]').textContent = currency.format(card.balanceCents / 100);
    $('[data-store-current-cvv]').textContent = card.cvv;
    $('[data-store-cvv-countdown]').textContent = String(Math.max(0, Math.ceil((card.cvvValidUntil - Date.now()) / 1000)));
  }

  async function updatePaymentMethod() {
    const useVirtualCard = $('[name="paymentMethod"]:checked')?.value === 'virtual-card';
    cardFields.hidden = !useVirtualCard;
    if (useVirtualCard && (!virtualCard || virtualCard.cvvValidUntil <= Date.now())) {
      try {
        await refreshVirtualCard();
        virtualCardCvvInput.value = '';
      } catch (error) {
        showMessage(error.message);
      }
    }
  }

  function renderProduct(product) {
    const card = document.createElement('article');
    card.className = 'store-product';
    const category = document.createElement('p');
    category.className = 'store-product-category';
    category.textContent = product.category;
    const name = document.createElement('h3');
    name.textContent = product.name;
    const description = document.createElement('p');
    description.className = 'store-product-description';
    description.textContent = product.description;
    const footer = document.createElement('div');
    footer.className = 'store-product-footer';
    const price = document.createElement('strong');
    price.textContent = currency.format(product.priceCents / 100);
    const addButton = document.createElement('button');
    addButton.className = 'button button-quiet';
    addButton.type = 'button';
    addButton.textContent = 'Agregar';
    addButton.addEventListener('click', () => {
      cart.set(product.id, Math.min(10, (cart.get(product.id) ?? 0) + 1));
      purchaseAttempt = null;
      renderCart();
      showMessage('');
    });
    footer.append(price, addButton);
    card.append(category, name, description, footer);
    return card;
  }

  try {
    ({ products } = await requestApi('/api/store/products'));
    productGrid.replaceChildren(...products.map(renderProduct));
    renderCart();
    const mainBalance = $('[data-store-main-balance]');
    const balanceElement = $('[data-balance]');
    if (mainBalance && balanceElement) mainBalance.textContent = balanceElement.dataset.balanceValue;
  } catch (error) {
    showMessage(error.message);
    checkoutButton.disabled = true;
    return;
  }

  $$('[name="paymentMethod"]').forEach((input) => input.addEventListener('change', () => { void updatePaymentMethod(); }));
  void updatePaymentMethod();
  window.setInterval(() => {
    if ($('[name="paymentMethod"]:checked')?.value !== 'virtual-card' || !virtualCard) return;
    const remaining = Math.max(0, Math.ceil((virtualCard.cvvValidUntil - Date.now()) / 1000));
    $('[data-store-cvv-countdown]').textContent = String(remaining);
    if (remaining === 0) {
      refreshVirtualCard().then(() => { virtualCardCvvInput.value = ''; }).catch((error) => showMessage(error.message));
    }
  }, 1000);

  checkoutButton.addEventListener('click', () => {
    if (!cart.size) return;
    paymentTotal.textContent = cartTotalElement.textContent;
    storeContent.hidden = true;
    paymentStep.hidden = false;
    paymentStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('[data-back-to-cart]').addEventListener('click', () => {
    virtualCardForm.reset();
    paymentStep.hidden = true;
    storeContent.hidden = false;
  });

  confirmPurchaseButton.addEventListener('click', async () => {
    const items = cartEntries();
    if (!items.length) return;
    const paymentMethod = $('[name="paymentMethod"]:checked')?.value;
    if (!['wallet', 'virtual-card'].includes(paymentMethod)) {
      showMessage('Selecciona un método de pago.');
      return;
    }
    let cardCvv;
    if (paymentMethod === 'virtual-card') {
      if (!virtualCard || virtualCard.cvvValidUntil <= Date.now()) {
        await updatePaymentMethod();
        showMessage('El CVV se actualizó. Confirma con el código vigente de tu tarjeta.');
        return;
      }
      cardCvv = virtualCardCvvInput.value.trim();
      if (!/^\d{3}$/.test(cardCvv) || cardCvv !== virtualCard.cvv) {
        showMessage('Escribe el CVV vigente que aparece en tu tarjeta virtual.');
        return;
      }
    }

    const fingerprint = JSON.stringify({ items, paymentMethod });
    if (!purchaseAttempt || purchaseAttempt.fingerprint !== fingerprint) {
      const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-purchase`;
      purchaseAttempt = { fingerprint, key };
    }
    confirmPurchaseButton.disabled = true;
    showMessage('');
    try {
      const result = await requestApi('/api/transactions', {
        method: 'POST',
        headers: { 'Idempotency-Key': purchaseAttempt.key },
        body: JSON.stringify({ type: 'purchase', paymentMethod, items, ...(cardCvv ? { cardCvv } : {}) }),
      });
      const balance = $('[data-balance]');
      if (balance) {
        balance.dataset.balanceValue = currency.format(result.user.balanceCents / 100);
        balance.textContent = readPreference('hide-balance', 'false') === 'true' ? '••••••' : balance.dataset.balanceValue;
      }
      if (Number.isSafeInteger(result.cardBalanceCents) && virtualCard) {
        virtualCard.balanceCents = result.cardBalanceCents;
        $('[data-store-card-balance]').textContent = currency.format(virtualCard.balanceCents / 100);
      }
      $('[data-purchase-reference]').textContent = `TB-${String(result.transactionId).padStart(8, '0')}`;
      $('[data-purchase-receipt]').href = `/HTML/receipt.html?id=${encodeURIComponent(result.transactionId)}`;
      virtualCardForm.reset();
      paymentStep.hidden = true;
      storeContent.hidden = true;
      purchaseComplete.hidden = false;
      purchaseAttempt = null;
    } catch (error) {
      showMessage(error.message);
      confirmPurchaseButton.disabled = false;
    }
  });
}

async function initializeCard(user) {
  const cardButton = $('[data-card-flip]');
  const transferForm = $('[data-card-transfer-form]');
  const amountInput = $('[name="amount"]', transferForm);
  let cardData;
  let transferAttempt = null;
  let isRefreshing = false;

  function updateCardView() {
    const hideBalance = readPreference('hide-balance', 'false') === 'true';
    const formattedBalance = currency.format(cardData.balanceCents / 100);
    $('[data-card-balance]').textContent = hideBalance ? '••••••' : formattedBalance;
    $('[data-card-balance-summary]').textContent = hideBalance ? '••••••' : formattedBalance;
    $('[data-card-number]').textContent = cardData.cardNumber.replace(/(.{4})/g, '$1 ').trim();
    $('[data-card-issued]').textContent = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(cardData.issuedAt));
    $('[data-card-expiry]').textContent = cardData.expiresAt;
    $('[data-card-cvv]').textContent = cardData.cvv;
    $('[data-card-holder]').textContent = cardData.cardholder.toLocaleUpperCase();
    $('[data-card-holder-back]').textContent = cardData.cardholder.toLocaleUpperCase();
    const mainBalance = $('[data-main-balance]');
    if (mainBalance) {
      mainBalance.textContent = readPreference('hide-balance', 'false') === 'true'
        ? '••••••'
        : currency.format(user.balanceCents / 100);
    }
  }

  async function refreshCard() {
    const result = await requestApi('/api/card');
    cardData = result.card;
    updateCardView();
  }

  function renderCountdown() {
    const remaining = Math.max(0, Math.ceil((cardData.cvvValidUntil - Date.now()) / 1000));
    $('[data-cvv-countdown]').textContent = String(remaining);
    if (remaining === 0 && !isRefreshing) {
      isRefreshing = true;
      refreshCard().catch((error) => showMessage(error.message)).finally(() => { isRefreshing = false; });
    }
  }

  try {
    await refreshCard();
  } catch (error) {
    showMessage(error.message);
    return;
  }

  cardButton.addEventListener('click', () => {
    const flipped = cardButton.dataset.flipped !== 'true';
    cardButton.dataset.flipped = String(flipped);
    cardButton.setAttribute('aria-pressed', String(flipped));
    cardButton.setAttribute('aria-label', flipped ? 'Girar tarjeta para volver al saldo' : 'Girar tarjeta para ver los datos');
    $('[data-card-flip-hint]').textContent = flipped ? 'Selecciona la tarjeta para volver al saldo' : 'Selecciona la tarjeta para girarla';
  });

  window.setInterval(renderCountdown, 1000);
  amountInput.addEventListener('input', () => { transferAttempt = null; });
  transferForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    const amount = String(new FormData(transferForm).get('amount') ?? '');
    const fingerprint = amount.trim();
    if (!transferAttempt || transferAttempt.fingerprint !== fingerprint) {
      const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-card`;
      transferAttempt = { fingerprint, key };
    }
    const submitButton = $('button[type="submit"]', transferForm);
    submitButton.disabled = true;
    try {
      const result = await requestApi('/api/card/transfers', {
        method: 'POST',
        headers: { 'Idempotency-Key': transferAttempt.key },
        body: JSON.stringify({ amount }),
      });
      user = result.user;
      cardData.balanceCents = result.cardBalanceCents;
      updateAccount(user);
      updateCardView();
      transferForm.reset();
      transferAttempt = null;
      showMessage(result.message, true);
    } catch (error) {
      showMessage(error.message);
    } finally {
      submitButton.disabled = false;
    }
  });
}

function initializeActivity(transactions) {
  const list = $('[data-transaction-list]');
  const search = $('[data-transaction-search]');
  const count = $('[data-transaction-count]');
  let filter = 'all';
  const render = () => {
    const term = (search?.value ?? '').trim().toLocaleLowerCase();
    const matches = transactions.filter((transaction) => {
      const debit = ['withdraw', 'transfer_out', 'payment', 'purchase', 'card_funding'].includes(transaction.type);
      const reference = `TB-${String(transaction.id).padStart(8, '0')}`;
      const text = `${reference} ${transaction.description} ${currency.format(transaction.amountCents / 100)}`.toLocaleLowerCase();
      return (filter === 'all' || (filter === 'debit') === debit) && (!term || text.includes(term));
    });
    if (count) count.textContent = `${matches.length} de ${transactions.length} movimientos`;
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-history';
      empty.textContent = transactions.length ? 'No hay movimientos que coincidan con la búsqueda.' : 'Todavía no hay movimientos en esta cuenta.';
      list.replaceChildren(empty);
    } else list.replaceChildren(...matches.map(transactionLink));
  };
  $$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    $$('[data-filter]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    render();
  }));
  search?.addEventListener('input', render);
  render();
}

function initializeSecurity() {
  const form = $('#change-password-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    const values = Object.fromEntries(new FormData(form));
    if (values.newPassword !== values.confirmPassword) return showMessage('La confirmación no coincide con la nueva contraseña.');
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    try {
      const result = await requestApi('/api/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
      });
      form.reset();
      showMessage(result.message, true);
    } catch (error) {
      showMessage(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

function initializeSettings(user, transactions) {
  $$('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => {
    applyTheme(button.dataset.themeChoice);
    writePreference('theme', button.dataset.themeChoice);
  }));
  $$('[data-accent-choice]').forEach((button) => button.addEventListener('click', () => {
    applyAccent(button.dataset.accentChoice);
    writePreference('accent', button.dataset.accentChoice);
  }));
  const hideBalance = $('[name="hideBalance"]');
  if (hideBalance) {
    hideBalance.checked = readPreference('hide-balance', 'false') === 'true';
    hideBalance.addEventListener('change', () => writePreference('hide-balance', String(hideBalance.checked)));
  }
  const remember = $('[name="rememberAccount"]');
  if (remember) {
    remember.checked = readPreference('remember-account', 'false') === 'true';
    remember.addEventListener('change', () => {
      writePreference('remember-account', String(remember.checked));
      try {
        if (remember.checked) localStorage.setItem('tubanco.account-number', user.accountNumber);
        else localStorage.removeItem('tubanco.account-number');
      } catch {
        showMessage('No se pudo guardar el número de cuenta en este navegador.');
      }
    });
  }
  $$('[data-animation-choice]').forEach((button) => button.addEventListener('click', () => {
    applyAnimationStyle(button.dataset.animationChoice);
    writePreference('animation-style', button.dataset.animationChoice);
  }));
  $$('[data-density-choice]').forEach((button) => button.addEventListener('click', () => {
    applyDensity(button.dataset.densityChoice);
    writePreference('density', button.dataset.densityChoice);
  }));
  const startPage = readPreference('start-page', 'dashboard');
  $$('[data-start-page]').forEach((button) => {
    const selected = button.dataset.startPage === startPage;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-checked', String(selected));
    button.addEventListener('click', () => {
      $$('[data-start-page]').forEach((item) => {
        const isSelected = item === button;
        item.classList.toggle('is-selected', isSelected);
        item.setAttribute('aria-checked', String(isSelected));
      });
      writePreference('start-page', button.dataset.startPage);
    });
  });
  $('[data-export-transactions]')?.addEventListener('click', () => {
    const rows = [['Fecha', 'Tipo', 'Descripción', 'Importe']];
    transactions.forEach((item) => rows.push([item.createdAt, item.type, item.description, (item.amountCents / 100).toFixed(2)]));
    const csv = rows.map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `tubanco-movimientos-${user.accountNumber}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showMessage('Se descargó el archivo de movimientos.', true);
  });
  $('[data-reset-settings]')?.addEventListener('click', () => {
    for (const key of ['theme', 'accent', 'animation-style', 'reduced-motion', 'hide-balance', 'remember-account', 'account-number', 'density', 'start-page']) {
      try { localStorage.removeItem(`tubanco.${key}`); } catch { break; }
    }
    window.location.reload();
  });
}

async function initializeReceipt() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!/^\d+$/.test(id ?? '') || Number(id) <= 0) return showMessage('La referencia del movimiento no es válida.');
  try {
    const { transaction } = await requestApi(`/api/transactions/${encodeURIComponent(id)}`);
    const names = { opening: 'Apertura de cuenta', deposit: 'Depósito', withdraw: 'Retiro', transfer_in: 'Transferencia recibida', transfer_out: 'Transferencia enviada', payment: 'Pago de servicio', purchase: 'Compra en tienda de práctica', card_funding: 'Transferencia a tarjeta virtual' };
    const debit = ['withdraw', 'transfer_out', 'payment', 'purchase', 'card_funding'].includes(transaction.type);
    const values = {
      '[data-receipt-reference]': `TB-${String(transaction.id).padStart(8, '0')}`,
      '[data-receipt-type]': names[transaction.type] ?? 'Movimiento',
      '[data-receipt-date]': new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(transaction.createdAt)),
      '[data-receipt-description]': transaction.description,
    };
    Object.entries(values).forEach(([selector, value]) => { $(selector).textContent = value; });
    const amount = $('[data-receipt-amount]');
    amount.textContent = `${debit ? '−' : '+'}${currency.format(transaction.amountCents / 100)}`;
    amount.classList.add(debit ? 'receipt-debit' : 'receipt-credit');
  } catch (error) { showMessage(error.message); }
}

async function start() {
  initializeNavigation();
  let user;
  let transactions;
  try {
    ({ user } = await requestApi('/api/me'));
    if (!user) return window.location.replace('/HTML/');
    updateAccount(user);
    if (['dashboard', 'activity', 'settings'].includes(currentPage)) {
      ({ transactions } = await requestApi('/api/transactions'));
    }
  } catch {
    return window.location.replace('/HTML/');
  }
  if (currentPage === 'dashboard') initializeDashboard(transactions);
  if (currentPage === 'operations') initializeOperations();
  if (currentPage === 'store') await initializeStore();
  if (currentPage === 'card') await initializeCard(user);
  if (currentPage === 'activity') initializeActivity(transactions);
  if (currentPage === 'security') initializeSecurity();
  if (currentPage === 'settings') initializeSettings(user, transactions);
  if (currentPage === 'receipt') await initializeReceipt();
}

start();
