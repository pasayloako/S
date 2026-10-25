const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();

app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const total = new Map();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/total', (req, res) => {
  const data = Array.from(total.values()).map((link, index) => ({
    session: index + 1,
    url: link.url,
    count: link.count,
    id: link.id,
    target: link.target,
    error: link.error || null,
  }));
  res.json(data || []);
});

app.post('/api/submit', async (req, res) => {
  const { cookie, url, amount, interval } = req.body;
  if (!cookie || !url || !amount || !interval) {
    return res.status(400).json({ error: 'Missing cookie, url, amount, or interval' });
  }
  try {
    const cookies = await convertCookie(cookie);
    if (!cookies) {
      return res.status(400).json({ status: 500, error: 'Invalid cookies' });
    }
    await share(cookies, url, amount, interval);
    res.status(200).json({ status: 200 });
  } catch (err) {
    return res.status(500).json({ status: 500, error: err.message || err });
  }
});

async function share(cookies, url, amount, interval) {
  const id = await getPostID(url);
  const accessToken = await getAccessToken(cookies);

  if (!id) {
    throw new Error("Unable to get link id: invalid URL, or post is private or friends-only.");
  }

  const postId = Date.now().toString();
  total.set(postId, { url, id, count: 0, target: amount, error: null, logs: [] });

  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate',
    'connection': 'keep-alive',
    'cookie': cookies,
    'host': 'graph.facebook.com'
  };

  let sharedCount = 0;
  let timer;

  async function sharePost() {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`,
        {},
        { headers }
      );
      if (response.status === 200) {
        const currentSession = total.get(postId);
        const logEntry = `[${new Date().toLocaleTimeString()}] Successfully shared.`;
        total.set(postId, {
          ...currentSession,
          count: currentSession.count + 1,
          error: null,
          logs: [...(currentSession.logs || []), logEntry].slice(-10)
        });
        sharedCount++;
      }
      if (sharedCount >= amount) {
        clearInterval(timer);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message || "Unknown error";
      const currentSession = total.get(postId);
      const logEntry = `[${new Date().toLocaleTimeString()}] Error: ${errorMsg}`;
      total.set(postId, {
        ...currentSession,
        error: errorMsg,
        logs: [...(currentSession.logs || []), logEntry].slice(-10)
      });
      clearInterval(timer);
    }
  }

  timer = setInterval(sharePost, interval * 1000);

  setTimeout(() => {
    clearInterval(timer);
    total.delete(postId);
  }, amount * interval * 1000);
}

async function getPostID(url) {
  try {
    const response = await axios.post(
      'https://id.traodoisub.com/api.php',
      `link=${encodeURIComponent(url)}`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    return response.data.id;
  } catch (error) {
    return null;
  }
}

async function getAccessToken(cookie) {
  try {
    const headers = {
      'authority': 'business.facebook.com',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'cookie': cookie,
      'referer': 'https://www.facebook.com/',
    };
    const response = await axios.get('https://business.facebook.com/content_management', { headers });
    const token = response.data.match(/"accessToken":\s*"([^"]+)"/);
    return token ? token[1] : null;
  } catch (error) {
    return null;
  }
}

async function convertCookie(cookie) {
  return new Promise((resolve, reject) => {
    try {
      const cookies = JSON.parse(cookie);
      const sbCookie = cookies.find((c) => c.key === 'sb');
      const datrCookie = cookies.find((c) => c.key === 'datr');

      if (!sbCookie) {
        return reject('Invalid appstate: missing sb cookie.');
      }

      let formattedCookies = `sb=${sbCookie.value}; `;
      if (datrCookie) {
        formattedCookies += `datr=${datrCookie.value}; `;
      }

      formattedCookies += cookies
        .filter((c) => c.key !== 'sb' && c.key !== 'datr')
        .map((c) => `${c.key}=${c.value}`)
        .join('; ');

      resolve(formattedCookies);
    } catch (error) {
      resolve(cookie);
    }
  });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
