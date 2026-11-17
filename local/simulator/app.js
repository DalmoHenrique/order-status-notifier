const STATUSES = ['ORDER_PLACED', 'PAYMENT_APPROVED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

const OUTCOMES = {
  sent: { label: 'Sent', icon: 'check_circle', color: 'green-text' },
  duplicate: { label: 'Duplicate blocked', icon: 'block', color: 'amber-text' },
  out_of_order: { label: 'Older status ignored', icon: 'history_toggle_off', color: 'blue-text' },
  failed: { label: 'Failed, will retry', icon: 'error', color: 'red-text' },
  disabled: { label: 'Notifications off', icon: 'notifications_off', color: 'grey-text' },
};

const $ = (id) => document.getElementById(id);
let lastEvent = null;
let lastSignature = '';
let chatOrderId = '';
const shownMessages = new Set();

function label(status) {
  return status.replaceAll('_', ' ').toLowerCase();
}

function newOrderId() {
  return `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 4000);
}

function buildEvent(status) {
  return {
    eventId: crypto.randomUUID(),
    orderId: $('orderId').value.trim(),
    status,
    occurredAt: new Date().toISOString(),
    customer: { name: $('customerName').value.trim(), phone: $('customerPhone').value.trim() },
  };
}

async function post(event) {
  const response = await fetch('/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    toast((body.errors || ['Request failed']).join(' · '));
    return false;
  }
  lastEvent = event;
  $('resend').disabled = false;
  $('older').disabled = STATUSES.indexOf(event.status) === 0;
  return true;
}

function renderActivity(items) {
  $('emptyLog').hidden = items.length > 0;
  $('log').innerHTML = items
    .slice()
    .reverse()
    .map((item) => {
      const outcome = OUTCOMES[item.outcome] || { label: item.outcome, icon: 'info', color: '' };
      return `<li>
        <i class="${outcome.color}">${outcome.icon}</i>
        <div class="max">
          <div><b>${label(item.status)}</b> · ${outcome.label}</div>
          <div class="small-text">${item.detail || ''}</div>
        </div>
        <span class="small-text">${new Date(item.at).toLocaleTimeString()}</span>
      </li>`;
    })
    .join('');

  renderChat(items.filter((item) => item.outcome === 'sent'));
}

// I only append bubbles the phone hasn't shown yet. Rebuilding the whole chat
// every poll would replay the arrival animation and make the screen flicker.
function renderChat(sent) {
  const chat = $('chat');
  const orderId = $('orderId').value.trim();
  if (orderId !== chatOrderId) {
    chatOrderId = orderId;
    shownMessages.clear();
    chat.innerHTML = '';
  }

  if (sent.length === 0 && shownMessages.size === 0) {
    chat.innerHTML = '<p class="phone-empty small-text">Messages the customer receives show up here.</p>';
    return;
  }
  chat.querySelector('.phone-empty')?.remove();

  for (const item of sent) {
    const key = `${item.eventId}#${item.at}`;
    if (shownMessages.has(key)) continue;
    shownMessages.add(key);
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = item.message;
    const time = document.createElement('time');
    time.textContent = new Date(item.at).toLocaleTimeString();
    bubble.append(time);
    chat.append(bubble);
    chat.scrollTop = chat.scrollHeight;
  }
}

async function refresh() {
  if (document.hidden) return;
  try {
    const orderId = encodeURIComponent($('orderId').value.trim());
    const [activity, state] = await Promise.all([
      fetch(`/orders/${orderId}/activity`).then((r) => r.json()),
      fetch('/admin/state').then((r) => r.json()),
    ]);
    const items = activity.items || [];
    const signature = `${orderId}|${JSON.stringify(items)}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      renderActivity(items);
    }
    $('queueDepth').textContent = state.queueDepth;
    $('dlqDepth').textContent = state.dlqDepth;
    $('providerDown').checked = state.providerDown;
    $('notificationsEnabled').checked = state.notificationsEnabled;
  } catch {
    // The server may be restarting; the next tick tries again.
  }
}

function setPipeline(change) {
  fetch('/admin/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(change),
  }).then(refresh);
}

function init() {
  $('status').innerHTML = STATUSES.map((s) => `<option value="${s}">${label(s)}</option>`).join('');
  $('orderId').value = new URLSearchParams(location.search).get('order') || newOrderId();

  $('send').onclick = () => post(buildEvent($('status').value));

  $('next').onclick = async () => {
    const index = Math.min(STATUSES.indexOf($('status').value) + (lastEvent ? 1 : 0), STATUSES.length - 1);
    $('status').value = STATUSES[index];
    await post(buildEvent(STATUSES[index]));
  };

  // Same payload, same eventId: what a producer retry or an at-least-once queue looks like.
  $('resend').onclick = () => lastEvent && post(lastEvent);

  $('older').onclick = () => {
    if (!lastEvent) return;
    const previous = STATUSES[Math.max(STATUSES.indexOf(lastEvent.status) - 1, 0)];
    post(buildEvent(previous));
  };

  $('newOrder').onclick = () => {
    $('orderId').value = newOrderId();
    $('status').value = STATUSES[0];
    lastEvent = null;
    $('resend').disabled = true;
    $('older').disabled = true;
    refresh();
  };

  $('providerDown').onchange = (e) => setPipeline({ providerDown: e.target.checked });
  $('notificationsEnabled').onchange = (e) => setPipeline({ notificationsEnabled: e.target.checked });

  // Delivery happens behind a queue, so the page polls to see results land.
  // It stops while the tab is in the background.
  document.addEventListener('visibilitychange', refresh);
  refresh();
  setInterval(refresh, 1000);
}

init();
