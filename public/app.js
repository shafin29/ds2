/* =============================================
   Email Warmup Tool — Frontend App
   ============================================= */

const API = '';

// ── Utilities ──────────────────────────────────

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function fmt(n) { return n?.toLocaleString() ?? '—'; }

// ── Routing / Pages ───────────────────────────

let currentPage = 'dashboard';
let chartInstance = null;

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(link.dataset.page);
  });
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  document.getElementById('campaign-detail').classList.add('hidden');
  if (page === 'dashboard') loadDashboard();
  if (page === 'accounts')  loadAccounts();
  if (page === 'campaigns') loadCampaigns();
  if (page === 'templates') loadTemplates(currentTemplateType);
}

// ── Dashboard ─────────────────────────────────

async function loadDashboard() {
  const [overview, health] = await Promise.all([
    api('/api/analytics/overview'),
    api('/api/analytics/health'),
  ]);

  document.getElementById('stat-accounts').textContent   = fmt(overview.total_accounts);
  document.getElementById('stat-campaigns').textContent  = fmt(overview.total_campaigns);
  document.getElementById('stat-sent').textContent       = fmt(overview.total_sent);
  document.getElementById('stat-reply-rate').textContent = overview.reply_rate + '%';
  document.getElementById('stat-rescued').textContent    = fmt(overview.total_rescued);

  const list = document.getElementById('health-list');
  list.innerHTML = '';
  if (health.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted)">No campaigns yet. Create a campaign to start warming up.</p>';
    return;
  }
  health.forEach(c => {
    list.insertAdjacentHTML('beforeend', `
      <div class="health-card">
        <div class="health-score-ring grade-${c.grade}">${c.health_score}</div>
        <div class="health-info">
          <div class="health-name">${c.name}</div>
          <div class="health-meta">${c.account_email} &bull; Day ${c.current_day} &bull; ${c.daily_target} emails/day &bull;
            <span class="badge badge-${c.status}">${c.status}</span>
          </div>
        </div>
        <div class="health-bars">
          <div class="health-bar-item">
            <div class="health-bar-label">Reply Rate</div>
            <div class="health-bar-value" style="color:var(--green)">${c.reply_rate}%</div>
          </div>
          <div class="health-bar-item">
            <div class="health-bar-label">Spam Rate</div>
            <div class="health-bar-value" style="color:${c.spam_rate > 5 ? 'var(--red)' : 'var(--text-muted)'}">${c.spam_rate}%</div>
          </div>
          <div class="health-bar-item">
            <div class="health-bar-label">Rescued</div>
            <div class="health-bar-value">${fmt(c.total_rescued)}</div>
          </div>
        </div>
      </div>
    `);
  });
}

// ── Accounts ──────────────────────────────────

function accountCardHTML(acc) {
  const roleTag = acc.role === 'sender'
    ? '<span class="badge badge-active">Sender</span>'
    : '<span class="badge badge-completed">Pool</span>';
  return `
    <div class="account-card">
      <div class="card-icon">${acc.role === 'sender' ? '&#128640;' : '&#9993;'}</div>
      <div class="card-info">
        <div class="card-title">${acc.name} &lt;${acc.email}&gt; ${roleTag}</div>
        <div class="card-meta">SMTP: ${acc.smtp_host}:${acc.smtp_port} &bull; IMAP: ${acc.imap_host}:${acc.imap_port} &bull; ${acc.active ? 'Active' : 'Disabled'}</div>
      </div>
      <div class="card-actions">
        <button class="btn btn-secondary btn-sm" onclick="testAccount('${acc.id}')">Test</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleAccount('${acc.id}', ${acc.active})">
          ${acc.active ? 'Disable' : 'Enable'}
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteAccount('${acc.id}')">Delete</button>
      </div>
    </div>
  `;
}

async function loadAccounts() {
  const accounts = await api('/api/accounts');
  const senders = accounts.filter(a => a.role === 'sender');
  const pool    = accounts.filter(a => a.role === 'pool' || !a.role);

  const senderList = document.getElementById('senders-list');
  const poolList   = document.getElementById('pool-list');

  senderList.innerHTML = senders.length === 0
    ? '<p style="color:var(--text-muted)">No sender accounts yet. Add the email address you want to warm up.</p>'
    : senders.map(accountCardHTML).join('');

  poolList.innerHTML = pool.length === 0
    ? '<p style="color:var(--text-muted)">No pool accounts yet. Add personal Gmail or Outlook accounts here.</p>'
    : pool.map(accountCardHTML).join('');

  window._accounts = accounts;
}

function showAccountModal(role) {
  const title = role === 'sender' ? 'Add Sender Account' : 'Add Pool Account';
  const hostPlaceholder = role === 'sender' ? 'smtp.gmail.com' : 'smtp.gmail.com';
  showModal(title, `
    <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:16px">
      ${role === 'sender'
        ? 'This is the account you want to warm up. Campaigns will send emails from this address.'
        : 'This account will receive warmup emails and auto-reply. Use a personal Gmail or Outlook account.'}
    </p>
    <div class="form-group"><label>Display Name</label><input id="f-name" placeholder="John Smith" /></div>
    <div class="form-group"><label>Email Address</label><input id="f-email" type="email" placeholder="john@example.com" /></div>
    <div class="form-group"><label>Username (usually same as email)</label><input id="f-user" placeholder="john@example.com" /></div>
    <div class="form-group"><label>Password / App Password</label><input id="f-pass" type="password" /></div>
    <div class="form-row">
      <div class="form-group"><label>SMTP Host</label><input id="f-smtp-host" placeholder="${hostPlaceholder}" /></div>
      <div class="form-group"><label>SMTP Port</label><input id="f-smtp-port" type="number" value="465" /></div>
    </div>
    <div class="form-group">
      <label>SMTP Security</label>
      <select id="f-smtp-secure">
        <option value="1" selected>SSL — port 465 (recommended)</option>
        <option value="0">TLS/STARTTLS — port 587</option>
      </select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>IMAP Host</label><input id="f-imap-host" placeholder="imap.gmail.com" /></div>
      <div class="form-group"><label>IMAP Port</label><input id="f-imap-port" type="number" value="993" /></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAccount('${role}')">Add Account</button>
    </div>
  `);
}

document.getElementById('btn-add-sender').addEventListener('click', () => showAccountModal('sender'));
document.getElementById('btn-add-pool').addEventListener('click',   () => showAccountModal('pool'));

async function submitAccount(role) {
  const body = {
    role,
    name:        document.getElementById('f-name').value.trim(),
    email:       document.getElementById('f-email').value.trim(),
    username:    document.getElementById('f-user').value.trim(),
    password:    document.getElementById('f-pass').value,
    smtp_host:   document.getElementById('f-smtp-host').value.trim(),
    smtp_port:   parseInt(document.getElementById('f-smtp-port').value),
    smtp_secure: parseInt(document.getElementById('f-smtp-secure').value),
    imap_host:   document.getElementById('f-imap-host').value.trim(),
    imap_port:   parseInt(document.getElementById('f-imap-port').value),
  };
  try {
    await api('/api/accounts', { method: 'POST', body });
    closeModal();
    toast(`${role === 'sender' ? 'Sender' : 'Pool'} account added!`);
    loadAccounts();
  } catch (err) { toast(err.message, 'error'); }
}

async function testAccount(id) {
  toast('Testing connection…');
  try {
    const r = await api(`/api/accounts/${id}/test`, { method: 'POST' });
    const smtpOk = r.smtp.ok ? '✓ SMTP' : `✗ SMTP: ${r.smtp.error}`;
    const imapOk = r.imap.ok ? '✓ IMAP' : `✗ IMAP: ${r.imap.error}`;
    const ok = r.smtp.ok && r.imap.ok;
    toast(`${smtpOk}  ${imapOk}`, ok ? 'success' : 'error');
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleAccount(id, active) {
  await api(`/api/accounts/${id}`, { method: 'PATCH', body: { active: active ? 0 : 1 } });
  loadAccounts();
}

async function deleteAccount(id) {
  if (!confirm('Delete this account? This will also delete all associated campaigns.')) return;
  await api(`/api/accounts/${id}`, { method: 'DELETE' });
  toast('Account deleted');
  loadAccounts();
}

// ── Campaigns ─────────────────────────────────

async function loadCampaigns() {
  const [campaigns, accounts] = await Promise.all([api('/api/campaigns'), api('/api/accounts')]);
  const list = document.getElementById('campaigns-list');
  list.innerHTML = '';

  if (campaigns.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted)">No campaigns yet. Create one to start warming up an email account.</p>';
    return;
  }

  campaigns.forEach(c => {
    list.insertAdjacentHTML('beforeend', `
      <div class="campaign-card">
        <div class="card-icon">&#128293;</div>
        <div class="card-info">
          <div class="card-title">${c.name}</div>
          <div class="card-meta">
            ${c.account_email} &bull; Day ${c.current_day} &bull;
            ${c.emails_sent_today}/${c.daily_target} today &bull;
            <span class="badge badge-${c.status}">${c.status}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-secondary btn-sm" onclick="openCampaignDetail('${c.id}', '${c.name}')">Details</button>
          <button class="btn btn-secondary btn-sm" onclick="toggleCampaign('${c.id}', '${c.status}')">
            ${c.status === 'active' ? 'Pause' : 'Resume'}
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteCampaign('${c.id}')">Delete</button>
        </div>
      </div>
    `);
  });

  // Store accounts for campaign form
  window._accounts = accounts;
}

document.getElementById('btn-add-campaign').addEventListener('click', async () => {
  const accounts = await api('/api/accounts');
  const senders = accounts.filter(a => a.role === 'sender');
  if (senders.length === 0) {
    toast('Add at least one Sender account first.', 'error');
    return;
  }
  const options = senders.map(a => `<option value="${a.id}">${a.name} &lt;${a.email}&gt;</option>`).join('');
  showModal('New Warmup Campaign', `
    <div class="form-group"><label>Campaign Name</label><input id="f-cname" placeholder="My Gmail Warmup" /></div>
    <div class="form-group"><label>Account to Warm Up</label><select id="f-account">${options}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Starting emails/day</label><input id="f-target" type="number" value="5" min="1" /></div>
      <div class="form-group"><label>Max emails/day</label><input id="f-max" type="number" value="50" min="1" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Daily ramp-up</label><input id="f-ramp" type="number" value="5" min="1" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Send window start (hour 0-23)</label><input id="f-start" type="number" value="8" min="0" max="23" /></div>
      <div class="form-group"><label>Send window end (hour 0-23)</label><input id="f-end" type="number" value="18" min="1" max="24" /></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitCampaign()">Create Campaign</button>
    </div>
  `);
});

async function submitCampaign() {
  const body = {
    name:            document.getElementById('f-cname').value.trim(),
    account_id:      document.getElementById('f-account').value,
    daily_target:    parseInt(document.getElementById('f-target').value),
    max_per_day:     parseInt(document.getElementById('f-max').value),
    ramp_increment:  parseInt(document.getElementById('f-ramp').value),
    send_hour_start: parseInt(document.getElementById('f-start').value),
    send_hour_end:   parseInt(document.getElementById('f-end').value),
  };
  try {
    await api('/api/campaigns', { method: 'POST', body });
    closeModal();
    toast('Campaign created!');
    loadCampaigns();
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleCampaign(id, status) {
  const newStatus = status === 'active' ? 'paused' : 'active';
  await api(`/api/campaigns/${id}`, { method: 'PATCH', body: { status: newStatus } });
  toast(`Campaign ${newStatus}`);
  loadCampaigns();
}

async function deleteCampaign(id) {
  if (!confirm('Delete this campaign and all its data?')) return;
  await api(`/api/campaigns/${id}`, { method: 'DELETE' });
  toast('Campaign deleted');
  loadCampaigns();
}

// ── Campaign Detail ───────────────────────────

let detailCampaignId = null;

async function openCampaignDetail(id, name) {
  detailCampaignId = id;
  document.getElementById('detail-title').textContent = name;
  document.getElementById('campaign-detail').classList.remove('hidden');

  await refreshCampaignDetail(id);
}

async function refreshCampaignDetail(id) {
  const [campaign, chartData, emails] = await Promise.all([
    api(`/api/campaigns/${id}`),
    api(`/api/analytics/campaigns/${id}?days=30`),
    api(`/api/campaigns/${id}/emails?limit=50`),
  ]);

  // Stats
  const stats = document.getElementById('detail-stats');
  stats.innerHTML = `
    <div class="stat-card"><div class="stat-value">${campaign.current_day}</div><div class="stat-label">Warmup Day</div></div>
    <div class="stat-card"><div class="stat-value">${campaign.daily_target}</div><div class="stat-label">Target Today</div></div>
    <div class="stat-card"><div class="stat-value">${campaign.emails_sent_today}</div><div class="stat-label">Sent Today</div></div>
    <div class="stat-card"><div class="stat-value">${campaign.max_per_day}</div><div class="stat-label">Daily Max</div></div>
  `;

  // Chart
  const labels = chartData.map(d => d.date.slice(5));
  const sent    = chartData.map(d => d.sent);
  const replied = chartData.map(d => d.replied);
  const rescued = chartData.map(d => d.rescued);

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  const ctx = document.getElementById('stats-chart').getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Sent',    data: sent,    backgroundColor: 'rgba(108,99,255,0.7)' },
        { label: 'Replied', data: replied, backgroundColor: 'rgba(34,197,94,0.7)' },
        { label: 'Rescued', data: rescued, backgroundColor: 'rgba(234,179,8,0.7)' },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#8b90a7' } } },
      scales: {
        x: { ticks: { color: '#8b90a7' }, grid: { color: '#2e3347' } },
        y: { ticks: { color: '#8b90a7' }, grid: { color: '#2e3347' } },
      },
    },
  });

  // Emails table
  const tbody = document.getElementById('emails-tbody');
  tbody.innerHTML = emails.length === 0
    ? '<tr><td colspan="5" style="color:var(--text-muted);text-align:center">No emails yet</td></tr>'
    : emails.map(e => `
        <tr>
          <td>${e.sent_at ? new Date(e.sent_at + 'Z').toLocaleString() : '—'}</td>
          <td>${e.from_email}</td>
          <td>${e.to_email}</td>
          <td>${e.subject}</td>
          <td>${e.replied ? '<span class="check">&#10003;</span>' : '<span class="cross">—</span>'}</td>
        </tr>
      `).join('');
}

document.getElementById('btn-back').addEventListener('click', () => {
  document.getElementById('campaign-detail').classList.add('hidden');
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
});

document.getElementById('btn-trigger').addEventListener('click', async () => {
  if (!detailCampaignId) return;
  toast('Triggering warmup cycle…');
  try {
    await api(`/api/campaigns/${detailCampaignId}/trigger`, { method: 'POST' });
    toast('Cycle complete — refreshing…');
    await refreshCampaignDetail(detailCampaignId);
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('btn-process-inbox').addEventListener('click', async () => {
  toast('Processing inboxes…');
  try {
    await api('/api/campaigns/inbox/process', { method: 'POST' });
    toast('Inbox processing complete!');
    if (detailCampaignId) await refreshCampaignDetail(detailCampaignId);
  } catch (err) { toast(err.message, 'error'); }
});

// ── Modal ─────────────────────────────────────

function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ── Templates ─────────────────────────────────

let currentTemplateType = 'subject';

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTemplateType = btn.dataset.type;
    loadTemplates(currentTemplateType);
  });
});

async function loadTemplates(type = 'subject') {
  const templates = await api(`/api/templates?type=${type}`);
  const list = document.getElementById('templates-list');
  list.innerHTML = '';

  if (templates.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted)">No templates yet. Click "+ Add Template" to create one.</p>';
    return;
  }

  templates.forEach(t => {
    list.insertAdjacentHTML('beforeend', `
      <div class="template-card ${t.active ? '' : 'inactive'}">
        <div class="template-content">${t.content.replace(/</g, '&lt;')}</div>
        <div class="template-actions">
          <button class="btn btn-secondary btn-sm" onclick="editTemplate(${t.id}, \`${t.content.replace(/`/g, '\\`')}\`)">Edit</button>
          <button class="btn btn-secondary btn-sm" onclick="toggleTemplate(${t.id}, ${t.active})">
            ${t.active ? 'Disable' : 'Enable'}
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteTemplate(${t.id})">Delete</button>
        </div>
      </div>
    `);
  });
}

document.getElementById('btn-add-template').addEventListener('click', () => {
  const typeLabel = { subject: 'Subject Line', body: 'Email Body', reply: 'Reply Body' }[currentTemplateType];
  showModal(`Add ${typeLabel}`, `
    <div class="form-group">
      <label>${typeLabel}</label>
      ${currentTemplateType === 'subject'
        ? `<input id="f-tcontent" placeholder="Enter subject line..." />`
        : `<textarea id="f-tcontent" placeholder="Enter email body...&#10;&#10;Use natural conversational language."></textarea>`
      }
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitTemplate()">Add</button>
    </div>
  `);
});

async function submitTemplate() {
  const content = document.getElementById('f-tcontent').value.trim();
  if (!content) { toast('Content cannot be empty.', 'error'); return; }
  try {
    await api('/api/templates', { method: 'POST', body: { type: currentTemplateType, content } });
    closeModal();
    toast('Template added!');
    loadTemplates(currentTemplateType);
  } catch (err) { toast(err.message, 'error'); }
}

async function editTemplate(id, currentContent) {
  const typeLabel = { subject: 'Subject Line', body: 'Email Body', reply: 'Reply Body' }[currentTemplateType];
  showModal(`Edit ${typeLabel}`, `
    <div class="form-group">
      <label>${typeLabel}</label>
      ${currentTemplateType === 'subject'
        ? `<input id="f-tedit" value="${currentContent.replace(/"/g, '&quot;')}" />`
        : `<textarea id="f-tedit">${currentContent.replace(/</g, '&lt;')}</textarea>`
      }
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTemplate(${id})">Save</button>
    </div>
  `);
}

async function saveTemplate(id) {
  const content = document.getElementById('f-tedit').value.trim();
  if (!content) { toast('Content cannot be empty.', 'error'); return; }
  try {
    await api(`/api/templates/${id}`, { method: 'PATCH', body: { content } });
    closeModal();
    toast('Template saved!');
    loadTemplates(currentTemplateType);
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleTemplate(id, active) {
  await api(`/api/templates/${id}`, { method: 'PATCH', body: { active: active ? 0 : 1 } });
  loadTemplates(currentTemplateType);
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await api(`/api/templates/${id}`, { method: 'DELETE' });
  toast('Template deleted');
  loadTemplates(currentTemplateType);
}

// ── Init ──────────────────────────────────────

loadDashboard();
