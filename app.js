// PF Reader — App Logic

let toc = [];
let searchData = [];
let currentFile = null;
let sidebarVisible = true;

// --- Init ---
async function init() {
  try {
    const [tocResp, searchResp] = await Promise.all([
      fetch('./toc.json'),
      fetch('./search-data.json')
    ]);
    toc = await tocResp.json();
    searchData = await searchResp.json();
  } catch(e) {
    console.error('Failed to load data:', e);
    return;
  }

  renderTOC(toc, document.getElementById('toc-tree'));
  updateBadges();
  document.getElementById('search-input').addEventListener('input', debounce(onSearch, 200));
  document.getElementById('search-input').addEventListener('focus', () => {
    if (document.getElementById('search-input').value) onSearch();
  });

  // Click outside search results to close
  document.getElementById('search-results').addEventListener('click', (e) => {
    if (e.target.id === 'search-results') closeSearch();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      document.getElementById('search-input').focus();
    }
    if (e.key === 'Escape') closeSearch();
  });

  // Load page from hash
  const hash = location.hash.slice(1);
  if (hash) loadPage(hash);
}

// --- TOC Rendering ---
function renderTOC(nodes, container, depth = 0) {
  for (const node of nodes) {
    const hasChildren = node.children && node.children.length > 0;

    const item = document.createElement('div');
    item.className = 'toc-item';

    const toggle = document.createElement('span');
    toggle.className = 'toggle ' + (hasChildren ? '' : 'leaf');
    toggle.textContent = hasChildren ? '▶' : '';
    if (hasChildren) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle.classList.toggle('open');
        const children = item.nextElementSibling;
        if (children && children.classList.contains('toc-children')) {
          children.style.display = children.style.display === 'none' ? '' : 'none';
        }
      });
    }

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.name;

    item.appendChild(toggle);
    item.appendChild(label);

    if (node.file) {
      item.addEventListener('click', () => loadPage(node.file, node.name));
    }

    container.appendChild(item);

    if (hasChildren) {
      const childContainer = document.createElement('div');
      childContainer.className = 'toc-children';
      renderTOC(node.children, childContainer, depth + 1);
      container.appendChild(childContainer);
    }
  }
}

function updateBadges() {
  // Count pages per top-level section
  // Simple: just show total count
}

// Highlight active TOC item
function highlightTOC(file) {
  document.querySelectorAll('.toc-item.active').forEach(el => el.classList.remove('active'));
  // Find and highlight the matching toc item
  document.querySelectorAll('.toc-item .label').forEach(el => {
    // Check click handler by traversing
  });
}

// --- Page Loading ---
async function loadPage(file, title) {
  currentFile = file;
  location.hash = file;

  const contentArea = document.getElementById('content');
  contentArea.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const resp = await fetch(`./pages/${file}`);
    if (!resp.ok) throw new Error('Page not found');
    const html = await resp.text();

    // Extract body content
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const article = doc.querySelector('article.content');

    // Update page title
    const pageTitle = doc.title || title || file;
    document.title = pageTitle + ' — PF规则书';

    if (article) {
      contentArea.innerHTML = `<div class="page-title">${pageTitle}</div>`;
      contentArea.appendChild(article);

      // Make internal links work within the app
      article.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href');
        if (href && href.startsWith('./pages/')) {
          const targetFile = href.replace('./pages/', '');
          a.addEventListener('click', (e) => {
            e.preventDefault();
            loadPage(targetFile);
          });
        }
      });
    } else {
      contentArea.innerHTML = `<div class="page-title">${pageTitle}</div><div class="content">${html}</div>`;
    }

    contentArea.scrollTop = 0;
    closeSearch();
    highlightTOC(file);

    // On mobile, close sidebar
    if (window.innerWidth <= 768) {
      closeSidebar();
    }
  } catch(e) {
    contentArea.innerHTML = `<div class="welcome"><h2>无法加载页面</h2><p>${e.message}</p></div>`;
  }
}

// --- Search ---
const SEARCH_PAGE_SIZE = 100;
let allSearchResults = [];
let searchDisplayCount = 0;
let currentSearchQuery = '';

function onSearch() {
  const query = document.getElementById('search-input').value.trim().toLowerCase();
  const resultsContainer = document.getElementById('search-results');
  const listEl = document.getElementById('search-list');

  if (!query || query.length < 1) {
    resultsContainer.classList.remove('open');
    allSearchResults = [];
    searchDisplayCount = 0;
    currentSearchQuery = '';
    return;
  }

  // Don't re-search if query hasn't changed
  if (query === currentSearchQuery) return;
  currentSearchQuery = query;

  // Search in titles and text
  const results = [];
  for (const entry of searchData) {
    const titleMatch = entry.title.toLowerCase();
    const textMatch = entry.text.toLowerCase();
    const titleScore = titleMatch.includes(query) ? 100 : 0;
    const textScore = textMatch.includes(query) ? computeRelevance(query, entry.text.toLowerCase()) : 0;
    const totalScore = titleScore + textScore;

    if (totalScore > 0) {
      let snippet = '';
      const idx = textMatch.indexOf(query);
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(entry.text.length, idx + query.length + 120);
        snippet = (start > 0 ? '...' : '') + entry.text.slice(start, end) + (end < entry.text.length ? '...' : '');
      } else {
        snippet = entry.text.slice(0, 150);
      }

      results.push({
        file: entry.file,
        title: entry.title,
        snippet,
        score: totalScore,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  allSearchResults = results;
  searchDisplayCount = 0;

  renderSearchResults(listEl, query);
  resultsContainer.classList.add('open');
}

function renderSearchResults(listEl, query) {
  const nextBatch = allSearchResults.slice(searchDisplayCount, searchDisplayCount + SEARCH_PAGE_SIZE);
  if (searchDisplayCount === 0) listEl.innerHTML = '';

  if (allSearchResults.length === 0) {
    listEl.innerHTML = '<div class="no-results">无匹配结果</div>';
    return;
  }

  for (const r of nextBatch) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-title">${escapeHTML(r.title)}</div>
      <div class="result-snippet">${highlightMatch(escapeHTML(r.snippet), query)}</div>
    `;
    item.addEventListener('click', () => loadPage(r.file, r.title));
    listEl.appendChild(item);
  }

  searchDisplayCount += nextBatch.length;

  // Add "load more" button if there are more results
  const remaining = allSearchResults.length - searchDisplayCount;
  if (remaining > 0) {
    // Remove old load-more if exists
    const oldBtn = listEl.querySelector('.load-more');
    if (oldBtn) oldBtn.remove();

    const moreBtn = document.createElement('div');
    moreBtn.className = 'load-more';
    moreBtn.innerHTML = `显示更多 (剩余 ${remaining} 条)`;
    moreBtn.addEventListener('click', () => renderSearchResults(listEl, query));
    listEl.appendChild(moreBtn);
  } else {
    const oldBtn = listEl.querySelector('.load-more');
    if (oldBtn) oldBtn.remove();
  }
}

function computeRelevance(query, text) {
  let score = 0;
  let idx = 0;
  while ((idx = text.indexOf(query, idx)) !== -1) {
    score += 1;
    idx += query.length;
  }
  return score;
}

function closeSearch() {
  document.getElementById('search-results').classList.remove('open');
  document.getElementById('search-input').value = '';
}

function highlightMatch(text, query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<b style="color:#e74c3c">$1</b>');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Sidebar ---
function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  document.getElementById('sidebar').classList.toggle('open', sidebarVisible);
  document.getElementById('sidebar-overlay').classList.toggle('open', sidebarVisible);
}

function closeSidebar() {
  sidebarVisible = false;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// --- Utilities ---
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// --- Start ---
document.addEventListener('DOMContentLoaded', init);

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
