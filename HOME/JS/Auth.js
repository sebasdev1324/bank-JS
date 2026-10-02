const authPage = document.body.dataset.authPage;
const authMessage = document.querySelector('[data-auth-message]');

function readAuthPreference(key, fallback) {
  try { return localStorage.getItem(`tubanco.${key}`) ?? fallback; } catch { return fallback; }
}

const authColorScheme = window.matchMedia('(prefers-color-scheme: dark)');
const authTheme = readAuthPreference('theme', 'system');
document.documentElement.dataset.themePreference = authTheme;
document.documentElement.dataset.theme = authTheme === 'system'
  ? (authColorScheme.matches ? 'dark' : 'light')
  : (authTheme === 'dark' ? 'dark' : 'light');
document.documentElement.dataset.accent = readAuthPreference('accent', 'blue');
document.documentElement.dataset.motion = readAuthPreference('animation-style', 'subtle');
document.documentElement.dataset.density = readAuthPreference('density', 'comfortable');
authColorScheme.addEventListener('change', (event) => {
  if (readAuthPreference('theme', 'system') === 'system') {
    document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
  }
});

function preferredStartPage() {
  const destinations = {
    dashboard: '/HTML/dashboard.html',
    activity: '/HTML/activity.html',
    operations: '/HTML/operations.html',
  };
  return destinations[readAuthPreference('start-page', 'dashboard')] ?? destinations.dashboard;
}

function showAuthMessage(message, success = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle('is-error', Boolean(message) && !success);
  authMessage.classList.toggle('is-success', Boolean(message) && success);
}

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

for (const button of document.querySelectorAll('.visibility-toggle')) {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.getAttribute('aria-controls'));
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Ocultar' : 'Mostrar';
    button.setAttribute('aria-pressed', String(visible));
  });
}

if (authPage === 'login') {
  const loginForm = document.querySelector('#login-form');
  const accountInput = document.querySelector('#login-account');
  const rememberAccount = document.querySelector('#remember-account');
  const savedAccount = new URLSearchParams(window.location.search).get('account');
  try {
    const rememberedAccount = localStorage.getItem('tubanco.account-number');
    const account = /^\d{10}$/.test(savedAccount ?? '') ? savedAccount : rememberedAccount;
    if (/^\d{10}$/.test(account ?? '')) {
      accountInput.value = account;
      rememberAccount.checked = true;
    }
  } catch {
    rememberAccount.checked = false;
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showAuthMessage('');
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    const formData = new FormData(loginForm);
    const accountNumber = String(formData.get('accountNumber') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    try {
      await requestApi('/api/login', {
        method: 'POST',
        body: JSON.stringify({ accountNumber, password }),
      });
      try {
        if (rememberAccount.checked) localStorage.setItem('tubanco.account-number', accountNumber);
        else localStorage.removeItem('tubanco.account-number');
      } catch {
        showAuthMessage('Sesión iniciada. El navegador no permitió guardar el número de cuenta.', true);
      }
      window.location.assign(preferredStartPage());
    } catch (error) {
      showAuthMessage(error.message);
    } finally {
      button.disabled = false;
    }
  });

  requestApi('/api/me').then(({ user }) => {
    if (user) window.location.replace(preferredStartPage());
  }).catch(() => showAuthMessage('No se pudo establecer conexión con el servidor.'));
}

if (authPage === 'register') {
  const registerForm = document.querySelector('#register-form');
  const passwordInput = document.querySelector('#register-password');
  const confirmPassword = document.querySelector('#register-confirm-password');
  const strengthMeter = document.querySelector('.strength-track');
  const strengthCopy = document.querySelector('[data-password-strength-copy]');
  const registrationSuccess = document.querySelector('[data-registration-success]');

  passwordInput.addEventListener('input', () => {
    const password = passwordInput.value;
    const checks = [
      password.length >= 12,
      password.length >= 16,
      /[a-z]/.test(password) && /[A-Z]/.test(password),
      /\d/.test(password) || /[^A-Za-z0-9]/.test(password),
    ];
    const strength = checks.filter(Boolean).length;
    strengthMeter.dataset.strength = String(strength);
    strengthMeter.setAttribute('aria-valuenow', String(strength));
    strengthCopy.textContent = ['Usa 12 caracteres o más.', 'Añade más longitud.', 'Combina mayúsculas y minúsculas.', 'Buena combinación.', 'Contraseña robusta.'][strength];
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showAuthMessage('');
    const formData = new FormData(registerForm);
    const password = String(formData.get('password') ?? '');
    if (password !== String(formData.get('confirmPassword') ?? '')) {
      showAuthMessage('Las contraseñas no coinciden.');
      confirmPassword.focus();
      return;
    }
    const button = registerForm.querySelector('button[type="submit"]');
    button.disabled = true;
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
      document.querySelector('[data-new-account-number]').textContent = result.user.accountNumber;
      registerForm.hidden = true;
      document.querySelector('[data-login-link]').hidden = true;
      document.querySelector('#register-title').textContent = 'Cuenta lista';
      document.querySelector('.auth-heading > p:last-child').textContent = 'Tu número de cuenta es único. Guárdalo para iniciar sesión después.';
      registrationSuccess.hidden = false;
    } catch (error) {
      showAuthMessage(error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('[data-copy-account]').addEventListener('click', async (event) => {
    const accountNumber = document.querySelector('[data-new-account-number]').textContent;
    try {
      await navigator.clipboard.writeText(accountNumber);
      document.querySelector('[data-copy-status]').textContent = 'Número copiado.';
      event.currentTarget.textContent = 'Copiado';
    } catch {
      document.querySelector('[data-copy-status]').textContent = `Anota este número: ${accountNumber}`;
    }
  });
}
