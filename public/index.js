(function () {
  const form = document.getElementById('shareForm');
  const cookieInput = document.getElementById('cookie');
  const urlInput = document.getElementById('url');
  const amountInput = document.getElementById('amount');
  const intervalInput = document.getElementById('interval');
  const submitBtn = document.getElementById('submitBtn');
  const statusMsg = document.getElementById('statusMsg');
  const sessionTable = document.getElementById('sessionTable');
  const sessionBody = document.getElementById('sessionBody');
  const emptyState = document.getElementById('emptyState');
  const refreshBtn = document.getElementById('refreshBtn');

  function setStatus(message, type = 'success') {
    statusMsg.className = `status-msg ${type}`;
    statusMsg.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i> ${message}`;
    statusMsg.style.display = 'flex';
    clearTimeout(window.statusTimeout);
    window.statusTimeout = setTimeout(() => {
      statusMsg.style.display = 'none';
    }, 6000);
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function fetchSessions() {
    try {
      const response = await fetch('/total');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      if (!data || data.length === 0) {
        emptyState.style.display = 'block';
        sessionTable.style.display = 'none';
        return;
      }

      emptyState.style.display = 'none';
      sessionTable.style.display = 'table';

      sessionBody.innerHTML = data.map((item, index) => {
        const shortUrl = item.url.length > 38 ? item.url.slice(0, 35) + '…' : item.url;
        const errorDisplay = item.error
          ? `<span class="error-badge" title="${escapeHtml(item.error)}">${escapeHtml(item.error.slice(0, 18))}${item.error.length > 18 ? '…' : ''}</span>`
          : '<span style="color:#94a3b8;">—</span>';

        return `
          <tr>
            <td style="font-weight:500; color:#64748b;">${index + 1}</td>
            <td>
              <span class="url-cell" title="${escapeHtml(item.url)}">${escapeHtml(shortUrl)}</span>
              <div style="font-size:0.65rem; color:#94a3b8; margin-top:2px;">ID: ${escapeHtml(item.id || '—')}</div>
            </td>
            <td><span class="badge-count">${item.count}</span></td>
            <td><span class="badge-target">${item.target}</span></td>
            <td>${errorDisplay}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load sessions:', err);
      emptyState.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#ef4444;"></i><div>Could not load sessions</div>`;
      emptyState.style.display = 'block';
      sessionTable.style.display = 'none';
    }
  }

  fetchSessions();
  setInterval(fetchSessions, 5000);
  refreshBtn.addEventListener('click', fetchSessions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const cookie = cookieInput.value.trim();
    const url = urlInput.value.trim();
    const amount = Number(amountInput.value);
    const interval = Number(intervalInput.value);

    if (!cookie || !url || !amount || !interval) {
      setStatus('Please fill all fields.', 'error');
      return;
    }
    if (amount < 1 || interval < 1) {
      setStatus('Amount and interval must be at least 1.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Starting…`;
    statusMsg.style.display = 'none';

    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie, url, amount, interval })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

      if (data.status === 200) {
        setStatus('Session started successfully!', 'success');
        fetchSessions();
      } else {
        throw new Error(data.error || 'Unexpected response');
      }
    } catch (err) {
      setStatus(err.message || 'Network error', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fas fa-play"></i> Start sharing`;
    }
  });

  if (window.location.protocol === 'file:') {
    setStatus('⚠️ Open via http://localhost:5000 — not as a file.', 'error');
  }
})();
