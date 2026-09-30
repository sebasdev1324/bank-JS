const authScreen = document.querySelector('#auth-screen');
const dashboardScreen = document.querySelector('#dashboard-screen');
const loginForm = document.querySelector('#login-panel');
const registerForm = document.querySelector('#register-panel');
const registerPassword = document.querySelector('#register-password');
const registerConfirmPassword = document.querySelector('#register-confirm-password');
const rememberAccount = document.querySelector('#remember-account');
const accountNumberInput = document.querySelector('#login-account');
const transactionForm = document.querySelector('#transaction-form');
const changePasswordForm = document.querySelector('#change-password-form');
const authMessage = document.querySelector('#auth-message');
const dashboardMessage = document.querySelector('#dashboard-message');
const operationMessage = document.querySelector('#operation-message');
const passwordMessage = document.querySelector('#password-message');
const loginTab = document.querySelector('#login-tab');
const registerTab = document.querySelector('#register-tab');
const transactionType = document.querySelector('#transaction-type');
const targetAccount = document.querySelector('#target-account');
const serviceName = document.querySelector('#service-name');
const serviceReference = document.querySelector('#service-reference');
const currency = new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' });
const transactionDialog = document.querySelector('#transaction-dialog');
const transactionConfirmation = document.querySelector('#transaction-confirmation');
const themeChoiceButtons = [...document.querySelectorAll('[data-theme-choice]')];
let dashboardRefreshTimer = null;
let currentTransactions = [];
let activeTransactionFilter = 'all';
let transactionSearchTerm = '';
let pendingTransaction = null;
let lastTransactionAttempt = null;
let balanceIsVisible = true;

function applyTheme(theme, persist = true) {
	const selectedTheme = theme === 'dark' ? 'dark' : 'light';
	document.documentElement.dataset.theme = selectedTheme;
	for (const button of themeChoiceButtons) {
		const isSelected = button.dataset.themeChoice === selectedTheme;
		button.classList.toggle('is-selected', isSelected);
		button.setAttribute('aria-checked', String(isSelected));
		button.tabIndex = isSelected ? 0 : -1;
	}
	if (!persist) return;
	try {
		localStorage.setItem('tubanco.theme', selectedTheme);
		document.querySelector('#theme-save-status').textContent = 'Preferencia guardada en este dispositivo.';
	} catch {
		document.querySelector('#theme-save-status').textContent = 'No se pudo guardar la preferencia en este navegador.';
	}
}

try {
	applyTheme(localStorage.getItem('tubanco.theme') ?? 'light', false);
} catch {
	applyTheme('light', false);
}

try {
	const rememberedAccountNumber = localStorage.getItem('tubanco.account-number');
	if (/^\d{10}$/.test(rememberedAccountNumber ?? '')) {
		accountNumberInput.value = rememberedAccountNumber;
		rememberAccount.checked = true;
	}
} catch {
	rememberAccount.checked = false;
}

async function requestApi(url, options = {}) {
	const response = await fetch(url, {
		...options,
		headers: { 'Content-Type': 'application/json', ...options.headers },
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.error ?? 'No se pudo completar la solicitud.');
	return result;
}

function showMessage(element, message = '', type = 'error') {
	element.textContent = message;
	element.classList.toggle('is-error', Boolean(message) && type === 'error');
	element.classList.toggle('is-success', Boolean(message) && type === 'success');
}

function setFormBusy(form, busy) {
	const button = form.querySelector('button[type="submit"]');
	button.disabled = busy;
	button.setAttribute('aria-busy', String(busy));
}

function createIdempotencyKey() {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function resetPasswordVisibility(form) {
	for (const button of form.querySelectorAll('.visibility-toggle')) {
		const input = document.getElementById(button.getAttribute('aria-controls'));
		input.type = 'password';
		button.textContent = 'Mostrar';
		button.setAttribute('aria-pressed', 'false');
	}
}

function updatePasswordStrength() {
	const password = registerPassword.value;
	const checks = [
		password.length >= 12,
		password.length >= 16,
		/[a-z]/.test(password) && /[A-Z]/.test(password),
		/\d/.test(password) || /[^A-Za-z0-9]/.test(password),
	];
	const strength = checks.filter(Boolean).length;
	const meter = document.querySelector('.strength-track');
	meter.dataset.strength = String(strength);
	meter.setAttribute('aria-valuenow', String(strength));
	const descriptions = ['Usa 12 caracteres o más.', 'Necesita más variedad', 'Puede ser más fuerte', 'Buena combinación', 'Contraseña robusta'];
	document.querySelector('#password-strength-copy').textContent = descriptions[strength];
}

for (const button of document.querySelectorAll('.visibility-toggle')) {
	button.addEventListener('click', () => {
		const input = document.getElementById(button.getAttribute('aria-controls'));
		const visible = input.type === 'password';
		input.type = visible ? 'text' : 'password';
		button.textContent = visible ? 'Ocultar' : 'Mostrar';
		button.setAttribute('aria-pressed', String(visible));
	});
}

registerPassword.addEventListener('input', updatePasswordStrength);

function selectAuthTab(selectedTab) {
	const showLogin = selectedTab === loginTab;
	loginTab.classList.toggle('is-active', showLogin);
	registerTab.classList.toggle('is-active', !showLogin);
	loginTab.setAttribute('aria-selected', String(showLogin));
	registerTab.setAttribute('aria-selected', String(!showLogin));
	loginForm.hidden = !showLogin;
	registerForm.hidden = showLogin;
	document.querySelector('#auth-panel-title').textContent = showLogin ? 'Bienvenido' : 'Abre tu cuenta';
	document.querySelector('#auth-panel-copy').textContent = showLogin
		? 'Entra a tu cuenta o solicita una nueva.'
		: 'Completa tus datos para empezar.';
	showMessage(authMessage);
}

function createTransactionRow(transaction) {
	const isDebit = transaction.type === 'withdraw' || transaction.type === 'transfer_out' || transaction.type === 'payment';
	const row = document.createElement('button');
	row.type = 'button';
	row.className = `transaction-row ${isDebit ? 'is-debit' : 'is-credit'}`;
	row.setAttribute('aria-label', `Abrir comprobante ${transaction.id}: ${transaction.description}`);
	row.addEventListener('click', () => openTransactionReceipt(transaction.id));

	const marker = document.createElement('span');
	marker.className = 'transaction-marker';
	marker.textContent = isDebit ? '↙' : '↗';
	marker.setAttribute('aria-hidden', 'true');

	const details = document.createElement('div');
	details.className = 'transaction-details';
	const title = document.createElement('p');
	title.className = 'transaction-title';
	title.textContent = transaction.description;
	const date = document.createElement('time');
	date.className = 'transaction-date';
	date.dateTime = transaction.createdAt;
	date.textContent = new Intl.DateTimeFormat('es', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(new Date(transaction.createdAt));
	details.append(title, date);

	const amount = document.createElement('span');
	amount.className = 'transaction-amount';
	amount.textContent = `${isDebit ? '−' : '+'}${currency.format(transaction.amountCents / 100)}`;
	row.append(marker, details, amount);
	return row;
}

function renderTransactions(transactions) {
	currentTransactions = transactions;
	renderFilteredTransactions();
}

function renderFilteredTransactions() {
	const historyList = document.querySelector('#history-list');
	const searchTerm = transactionSearchTerm.trim().toLocaleLowerCase();
	const transactions = currentTransactions.filter((transaction) => {
		const isDebit = transaction.type === 'withdraw' || transaction.type === 'transfer_out' || transaction.type === 'payment';
		const matchesFilter = activeTransactionFilter === 'all'
			|| (activeTransactionFilter === 'debit' && isDebit)
			|| (activeTransactionFilter === 'credit' && !isDebit);
		const reference = `TB-${String(transaction.id).padStart(8, '0')}`;
		const searchableText = `${reference} ${transaction.description} ${currency.format(transaction.amountCents / 100)}`.toLocaleLowerCase();
		return matchesFilter && (!searchTerm || searchableText.includes(searchTerm));
	});
	const isFiltered = activeTransactionFilter !== 'all' || Boolean(searchTerm);
	document.querySelector('#transaction-count').textContent = isFiltered
		? `${transactions.length} de ${currentTransactions.length} movimientos`
		: `${transactions.length} ${transactions.length === 1 ? 'movimiento' : 'movimientos'}`;
	if (transactions.length === 0) {
		const emptyState = document.createElement('p');
		emptyState.className = 'empty-history';
		emptyState.textContent = currentTransactions.length === 0
			? 'Todavía no hay movimientos en esta cuenta.'
			: 'No hay movimientos que coincidan con la búsqueda.';
		historyList.replaceChildren(emptyState);
		return;
	}
	historyList.replaceChildren(...transactions.map(createTransactionRow));
}

function renderNotifications(transactions) {
	const notificationList = document.querySelector('#notification-list');
	const recentTransactions = transactions.slice(0, 3);
	document.querySelector('#notification-count').textContent = String(recentTransactions.length);
	document.querySelector('#notification-dot').hidden = recentTransactions.length === 0;
	if (recentTransactions.length === 0) {
		const emptyState = document.createElement('p');
		emptyState.className = 'notification-empty';
		emptyState.textContent = 'No tienes actividad reciente.';
		notificationList.replaceChildren(emptyState);
		return;
	}

	const items = recentTransactions.map((transaction) => {
		const item = document.createElement('button');
		item.className = 'notification-item';
		item.type = 'button';
		item.addEventListener('click', () => {
			document.querySelector('#notifications-menu').open = false;
			showDashboardView('activity');
			openTransactionReceipt(transaction.id);
		});
		const description = document.createElement('span');
		description.textContent = transaction.description;
		const amount = document.createElement('strong');
		amount.textContent = currency.format(transaction.amountCents / 100);
		item.append(description, amount);
		return item;
	});
	notificationList.replaceChildren(...items);
}

function showDashboardView(viewName) {
	for (const view of document.querySelectorAll('[data-dashboard-view]')) {
		view.hidden = view.dataset.dashboardView !== viewName;
	}
	document.querySelector('.security-settings').open = viewName === 'security';
	for (const button of document.querySelectorAll('[data-view-target]')) {
		const isSelected = button.dataset.viewTarget === viewName;
		button.classList.toggle('is-active', isSelected);
		button.setAttribute('aria-selected', String(isSelected));
	}
	for (const menu of document.querySelectorAll('.header-menu')) menu.open = false;
}

function renderBalance() {
	const balance = document.querySelector('#user-balance');
	balance.textContent = balanceIsVisible ? balance.dataset.formattedValue : '••••••';
	const toggle = document.querySelector('#balance-visibility');
	toggle.setAttribute('aria-pressed', String(!balanceIsVisible));
	toggle.setAttribute('aria-label', balanceIsVisible ? 'Ocultar saldo' : 'Mostrar saldo');
	toggle.querySelector('span').textContent = balanceIsVisible ? '◉' : '◎';
}

async function openTransactionReceipt(transactionId) {
	try {
		const { transaction } = await requestApi(`/api/transactions/${transactionId}`);
		const operationNames = {
			opening: 'Apertura de cuenta',
			deposit: 'Depósito',
			withdraw: 'Retiro',
			transfer_in: 'Transferencia recibida',
			transfer_out: 'Transferencia enviada',
			payment: 'Pago de servicio',
		};
		const isDebit = transaction.type === 'withdraw' || transaction.type === 'transfer_out' || transaction.type === 'payment';
		document.querySelector('#receipt-reference').textContent = `TB-${String(transaction.id).padStart(8, '0')}`;
		document.querySelector('#receipt-type').textContent = operationNames[transaction.type] ?? 'Movimiento';
		document.querySelector('#receipt-date').textContent = new Intl.DateTimeFormat('es', {
			dateStyle: 'full',
			timeStyle: 'short',
		}).format(new Date(transaction.createdAt));
		document.querySelector('#receipt-description').textContent = transaction.description;
		const amount = document.querySelector('#receipt-amount');
		amount.textContent = `${isDebit ? '−' : '+'}${currency.format(transaction.amountCents / 100)}`;
		amount.className = isDebit ? 'receipt-debit' : 'receipt-credit';
		transactionDialog.showModal();
	} catch (error) {
		showMessage(dashboardMessage, error.message);
	}
}

function updateAccountSummary(user) {
	document.querySelector('#user-name').textContent = user.fullName;
	document.querySelector('#user-account-number').textContent = user.accountNumber;
	document.querySelector('#topbar-user-name').textContent = user.fullName;
	document.querySelector('#topbar-account-number').textContent = `Cuenta ${user.accountNumber}`;
	document.querySelector('#account-avatar').textContent = user.fullName.trim().charAt(0).toLocaleUpperCase() || 'C';
	const balance = document.querySelector('#user-balance');
	balance.dataset.formattedValue = currency.format(user.balanceCents / 100);
	renderBalance();
}

async function refreshDashboard() {
	try {
		const { user } = await requestApi('/api/me');
		if (!user) {
			clearInterval(dashboardRefreshTimer);
			dashboardRefreshTimer = null;
			dashboardScreen.hidden = true;
			document.querySelector('#dashboard-tools').hidden = true;
			document.querySelector('#environment-label').hidden = false;
			authScreen.hidden = false;
			showMessage(authMessage, 'La sesión terminó. Vuelve a iniciar sesión.');
		return;
		}
		const { transactions } = await requestApi('/api/transactions');
		updateAccountSummary(user);
		renderTransactions(transactions);
		renderNotifications(transactions);
	} catch (error) {
		showMessage(dashboardMessage, error.message);
	}
}

async function showDashboard(user, successMessage = '') {
	authScreen.hidden = true;
	dashboardScreen.hidden = false;
	document.querySelector('#dashboard-tools').hidden = false;
	document.querySelector('#environment-label').hidden = true;
	showDashboardView('overview');
	updateAccountSummary(user);
	showMessage(dashboardMessage, successMessage, 'success');
	showMessage(operationMessage);
	showMessage(passwordMessage);

	try {
		const { transactions } = await requestApi('/api/transactions');
		renderTransactions(transactions);
		renderNotifications(transactions);
	} catch (error) {
		showMessage(dashboardMessage, error.message);
	}

	if (dashboardRefreshTimer === null) dashboardRefreshTimer = setInterval(refreshDashboard, 5000);
}

function updateTransactionFields() {
	const isTransfer = transactionType.value === 'transfer';
	const isPayment = transactionType.value === 'payment';
	document.querySelector('#target-account-field').hidden = !isTransfer;
	document.querySelector('#service-name-field').hidden = !isPayment;
	document.querySelector('#service-reference-field').hidden = !isPayment;
	document.querySelector('#confirmation-service-row').hidden = !isPayment;
	document.querySelector('#confirmation-reference-row').hidden = !isPayment;
	targetAccount.required = isTransfer;
	serviceName.required = isPayment;
	serviceReference.required = isPayment;
	if (!isTransfer) targetAccount.value = '';
	if (!isPayment) {
		serviceName.value = '';
		serviceReference.value = '';
	}
}

loginTab.addEventListener('click', () => selectAuthTab(loginTab));
registerTab.addEventListener('click', () => selectAuthTab(registerTab));
transactionType.addEventListener('change', updateTransactionFields);
themeChoiceButtons.forEach((button, index) => {
	button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
	button.addEventListener('keydown', (event) => {
		if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		event.preventDefault();
		const direction = event.key === 'ArrowRight' ? 1 : -1;
		const nextIndex = (index + direction + themeChoiceButtons.length) % themeChoiceButtons.length;
		themeChoiceButtons[nextIndex].focus();
		themeChoiceButtons[nextIndex].click();
	});
});
document.querySelectorAll('[data-view-target]').forEach((button) => {
	button.addEventListener('click', () => showDashboardView(button.dataset.viewTarget));
});
document.querySelectorAll('[data-open-view]').forEach((button) => {
	button.addEventListener('click', () => showDashboardView(button.dataset.openView));
});
document.querySelectorAll('[data-quick-action]').forEach((button) => {
	button.addEventListener('click', () => {
		const action = button.dataset.quickAction;
		if (action === 'payment') {
			showDashboardView('services');
			return;
		}
		transactionType.value = action;
		updateTransactionFields();
		showDashboardView('overview');
		document.querySelector('#operations-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
		if (action === 'transfer') targetAccount.focus({ preventScroll: true });
		if (action !== 'transfer') document.querySelector('#transaction-amount').focus({ preventScroll: true });
	});
});
document.querySelectorAll('[data-service-picker]').forEach((button) => {
	button.addEventListener('click', () => {
		transactionType.value = 'payment';
		updateTransactionFields();
		serviceName.value = button.dataset.servicePicker;
		showDashboardView('overview');
		document.querySelector('#operations-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
		serviceReference.focus({ preventScroll: true });
	});
});
document.querySelector('#balance-visibility').addEventListener('click', () => {
	balanceIsVisible = !balanceIsVisible;
	renderBalance();
});
document.querySelectorAll('.filter-button').forEach((button) => {
	button.addEventListener('click', () => {
		activeTransactionFilter = button.dataset.filter;
		document.querySelectorAll('.filter-button').forEach((filterButton) => {
			const isSelected = filterButton === button;
			filterButton.classList.toggle('is-active', isSelected);
			filterButton.setAttribute('aria-pressed', String(isSelected));
		});
		renderFilteredTransactions();
	});
});
document.querySelector('#history-search').addEventListener('input', (event) => {
	transactionSearchTerm = event.currentTarget.value;
	renderFilteredTransactions();
});

loginForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	showMessage(authMessage);
	setFormBusy(loginForm, true);
	const formData = new FormData(loginForm);
	const accountNumber = String(formData.get('accountNumber') ?? '').trim();
	const password = String(formData.get('password') ?? '');
	try {
		if (rememberAccount.checked) localStorage.setItem('tubanco.account-number', accountNumber);
		else localStorage.removeItem('tubanco.account-number');
	} catch {
		showMessage(authMessage, 'No se pudo recordar la cuenta en este navegador.');
	}

	try {
		const result = await requestApi('/api/login', {
			method: 'POST',
			body: JSON.stringify({ accountNumber, password }),
		});
		loginForm.reset();
		resetPasswordVisibility(loginForm);
		await showDashboard(result.user);
	} catch (error) {
		showMessage(authMessage, error.message);
	} finally {
		setFormBusy(loginForm, false);
	}
});

registerForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	showMessage(authMessage);
	const formData = new FormData(registerForm);
	const password = String(formData.get('password') ?? '');
	const confirmPassword = String(formData.get('confirmPassword') ?? '');
	if (password !== confirmPassword) {
		showMessage(authMessage, 'Las contraseñas no coinciden.');
		registerConfirmPassword.focus();
		return;
	}
	setFormBusy(registerForm, true);

	try {
		const result = await requestApi('/api/register', {
			method: 'POST',
			body: JSON.stringify({
				fullName: formData.get('fullName'),
				password,
				initialBalance: formData.get('initialBalance'),
				inviteCode: formData.get('inviteCode'),
			}),
		});
		registerForm.reset();
		resetPasswordVisibility(registerForm);
		updatePasswordStrength();
		await showDashboard(result.user, `Cuenta ${result.user.accountNumber} creada correctamente.`);
	} catch (error) {
		showMessage(authMessage, error.message);
	} finally {
		setFormBusy(registerForm, false);
	}
});

transactionForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	pendingTransaction = Object.fromEntries(new FormData(transactionForm));
	const operationNames = { deposit: 'Depósito', withdraw: 'Retiro', transfer: 'Transferencia', payment: 'Pago de servicio' };
	const isDebit = pendingTransaction.type !== 'deposit';
	document.querySelector('#confirmation-type').textContent = operationNames[pendingTransaction.type];
	document.querySelector('#confirmation-source').textContent = document.querySelector('#user-account-number').textContent;
	const targetRow = document.querySelector('#confirmation-target-row');
	targetRow.hidden = pendingTransaction.type !== 'transfer';
	if (pendingTransaction.type === 'transfer') {
		document.querySelector('#confirmation-target').textContent = pendingTransaction.targetAccountNumber;
	}
	const serviceRow = document.querySelector('#confirmation-service-row');
	const referenceRow = document.querySelector('#confirmation-reference-row');
	serviceRow.hidden = pendingTransaction.type !== 'payment';
	referenceRow.hidden = pendingTransaction.type !== 'payment';
	if (pendingTransaction.type === 'payment') {
		document.querySelector('#confirmation-service').textContent = pendingTransaction.serviceName;
		document.querySelector('#confirmation-reference').textContent = pendingTransaction.serviceReference;
	}
	const amount = document.querySelector('#confirmation-amount');
	amount.textContent = `${isDebit ? '−' : '+'}${currency.format(Number(pendingTransaction.amount))}`;
	amount.className = isDebit ? 'receipt-debit' : 'receipt-credit';
	showMessage(operationMessage);
	transactionConfirmation.showModal();
});

async function executePendingTransaction() {
	const transaction = pendingTransaction;
	pendingTransaction = null;
	if (!transaction) return;
	const transactionFingerprint = JSON.stringify({
		type: transaction.type,
		amountCents: Math.round(Number(transaction.amount) * 100),
		targetAccountNumber: transaction.type === 'transfer' ? transaction.targetAccountNumber.trim() : null,
		serviceName: transaction.type === 'payment' ? transaction.serviceName : null,
		serviceReference: transaction.type === 'payment' ? transaction.serviceReference.trim() : null,
	});
	if (!lastTransactionAttempt || lastTransactionAttempt.fingerprint !== transactionFingerprint) {
		lastTransactionAttempt = { fingerprint: transactionFingerprint, key: createIdempotencyKey() };
	}

	showMessage(operationMessage);
	setFormBusy(transactionForm, true);
	transactionConfirmation.close('confirm');
	try {
		const result = await requestApi('/api/transactions', {
			method: 'POST',
			headers: { 'Idempotency-Key': lastTransactionAttempt.key },
			body: JSON.stringify(transaction),
		});
		lastTransactionAttempt = null;
		transactionForm.reset();
		updateTransactionFields();
		await showDashboard(result.user);
		showMessage(operationMessage, result.message, 'success');
	} catch (error) {
		showMessage(operationMessage, error.message);
	} finally {
		setFormBusy(transactionForm, false);
	}
}

function cancelPendingTransaction() {
	pendingTransaction = null;
	if (transactionConfirmation.open) transactionConfirmation.close('cancel');
}

transactionConfirmation.addEventListener('cancel', () => {
	pendingTransaction = null;
});
document.querySelector('#confirm-transaction').addEventListener('click', executePendingTransaction);
document.querySelectorAll('[data-cancel-transaction], #cancel-transaction-confirmation').forEach((button) => {
	button.addEventListener('click', cancelPendingTransaction);
});

changePasswordForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	showMessage(passwordMessage);
	const formData = new FormData(changePasswordForm);
	const values = Object.fromEntries(formData);
	if (values.newPassword !== values.confirmPassword) {
		showMessage(passwordMessage, 'La confirmación no coincide con la nueva contraseña.');
		return;
	}

	setFormBusy(changePasswordForm, true);
	try {
		const result = await requestApi('/api/change-password', {
			method: 'POST',
			body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
		});
		changePasswordForm.reset();
		resetPasswordVisibility(changePasswordForm);
		showMessage(passwordMessage, result.message, 'success');
	} catch (error) {
		showMessage(passwordMessage, error.message);
	} finally {
		setFormBusy(changePasswordForm, false);
	}
});

document.querySelector('#logout-button').addEventListener('click', async (event) => {
	const button = event.currentTarget;
	button.disabled = true;
	try {
		await requestApi('/api/logout', { method: 'POST' });
		clearInterval(dashboardRefreshTimer);
		dashboardRefreshTimer = null;
		lastTransactionAttempt = null;
		dashboardScreen.hidden = true;
		document.querySelector('#dashboard-tools').hidden = true;
		document.querySelector('#environment-label').hidden = false;
		authScreen.hidden = false;
		selectAuthTab(loginTab);
	} catch (error) {
		showMessage(dashboardMessage, error.message);
	} finally {
		button.disabled = false;
	}
});

requestApi('/api/me')
	.then(({ user }) => user && showDashboard(user))
	.catch(() => {
		showMessage(authMessage, 'No se pudo establecer conexión con el servidor.');
	});
