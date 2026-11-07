const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digit: '0123456789',
  symbol: '!@#$=+-_'
};
const AMBIGUOUS = '0Oo1lIi|`\'"\\';
const STORAGE_KEY = 'pwd-vault-v1';
const MIN_LEN = 15;
const MAX_LEN = 20;

const $ = id => document.getElementById(id);
const lengthEl = $('length');
const lenText = $('lenText');
const passwordEl = $('password');
const errorEl = $('error');
const nameInput = $('keyName');
const listEl = $('list');
const emptyEl = $('empty');
const countEl = $('count');
const boxes = {
  lower: $('optLower'),
  upper: $('optUpper'),
  digit: $('optDigit'),
  symbol: $('optSymbol')
};
const exclusiveEl = $('optExclusive');
const searchInput = $('search');

let entries = [];
let storageOk = true;
let currentPwd = '';
let currentPoolSize = 0;
const shownIds = new Set();

// 加密状态：不保存任何加密密钥在内存里，每次查看/解密都要当场输入
let selectedIds = new Set();

/* ---------------- random数 ---------------- */

// 加密安全random整数 [0, max)
function randomInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0xFFFFFFFF / max) * max;
  const buf = new Uint32Array(1);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % max;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function activeSets() {
  return Object.keys(SETS).filter(k => boxes[k].checked);
}

function buildPool(key) {
  let chars = SETS[key];
  if (exclusiveEl.checked) {
    chars = [...chars].filter(c => !AMBIGUOUS.includes(c)).join('');
  }
  return chars;
}

function clampLength() {
  let length = parseInt(lengthEl.value, 10);
  if (isNaN(length)) length = 16;
  length = Math.min(MAX_LEN, Math.max(MIN_LEN, length));
  lengthEl.value = length;
  lenText.textContent = length;
  return length;
}

/* ---------------- 生成 ---------------- */

function generate() {
  errorEl.textContent = '';
  const length = clampLength();
  const keys = activeSets().map(k => ({ key: k, pool: buildPool(k) })).filter(o => o.pool.length > 0);

  if (keys.length === 0) {
    showError('请至少勾选一种字符集');
    return;
  }
  if (length < keys.length) {
    showError('密码长度不能小于已选字符集数量（' + keys.length + '）');
    return;
  }

  // 每个已选字符集至少出现一次
  const chars = keys.map(o => o.pool[randomInt(o.pool.length)]);
  const all = keys.map(o => o.pool).join('');
  while (chars.length < length) chars.push(all[randomInt(all.length)]);

  const pwd = shuffle(chars).join('');
  currentPwd = pwd;
  currentPoolSize = all.length;
  passwordEl.textContent = pwd;
  passwordEl.classList.remove('placeholder');
  updateStrength(pwd, all.length);

  // 填了名称就自动归档
  const name = nameInput.value.trim();
  if (name) {
    addEntry(name, pwd, all.length);
    nameInput.value = '';
    nameInput.blur();
    showToast('已保存到密钥列表：' + name);
  }
}

// 保存当前（未命名）密码
function saveCurrent() {
  if (!currentPwd) {
    showToast('请先生成一条密码');
    return;
  }
  const name = nameInput.value.trim() || nextAutoName();
  addEntry(name, currentPwd, { poolSize: currentPoolSize });
  nameInput.value = '';
  showToast('已保存到密钥列表：' + name);
}

function updateStrength(pwd, poolSize) {
  const entropy = pwd.length * Math.log2(poolSize || 1);
  const bars = document.querySelectorAll('.bars i');
  let level, label, color;
  if (entropy < 40) { level = 1; label = '很弱'; color = '#ff6b6b'; }
  else if (entropy < 60) { level = 2; label = '较弱'; color = '#ffa94d'; }
  else if (entropy < 90) { level = 3; label = '中等'; color = '#ffd43b'; }
  else if (entropy < 128) { level = 4; label = '强'; color = '#33d69f'; }
  else { level = 4; label = '非常强'; color = '#33d69f'; }
  bars.forEach((b, i) => { b.style.background = i < level ? color : '#2a2f3c'; });
  $('strengthText').textContent = label + ' · ' + Math.round(entropy) + ' bit';
  $('strengthText').style.color = color;
}

function showError(msg) {
  errorEl.textContent = msg;
  currentPwd = '';
  passwordEl.textContent = msg;
  passwordEl.classList.add('placeholder');
  document.querySelectorAll('.bars i').forEach(b => { b.style.background = '#2a2f3c'; });
  $('strengthText').textContent = '—';
  $('strengthText').style.color = 'var(--muted)';
}

/* ---------------- AES 加密 ---------------- */

const MASTER_MAX = 20;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function unb64(str) {
  const s = atob(str);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// AES-256-GCM，SHA-256(口令) 派生 256 位密钥；每次加密使用新的随机 IV
async function aesEncrypt(text, pass) {
  if (!window.crypto || !crypto.subtle) throw new Error('当前环境不支持 Web Crypto，无法加密');
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(pass));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(text));
  return 'v1:' + b64(iv) + ':' + b64(ct);
}

async function aesDecrypt(payload, pass) {
  if (!window.crypto || !crypto.subtle) throw new Error('当前环境不支持 Web Crypto，无法解密');
  if (typeof payload !== 'string' || payload.indexOf('v1:') !== 0) throw new Error('密文格式不正确');
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('密文格式不正确');
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(pass));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
  const ct = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[1]) }, key, unb64(parts[2]));
  return dec.decode(ct);
}

/* ---------------- 存储 ---------------- */

function normalizeEntry(e) {
  const encrypted = e.enc === true || (typeof e.password === 'string' && e.password.indexOf('v1:') === 0);
  return {
    id: e.id || uid(),
    name: e.name,
    password: e.password,
    enc: encrypted,
    // 同一批次加密的条目标记相同 batchId，导出时只需输入一次密钥
    batchId: encrypted && typeof e.batchId === 'string' ? e.batchId : '',
    createdAt: Number(e.createdAt) || Date.now(),
    poolSize: Number(e.poolSize) || 0,
    source: e.source === 'manual' || e.source === 'imported' ? e.source : 'generated'
  };
}

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(e => e && typeof e.name === 'string' && typeof e.password === 'string')
      .map(normalizeEntry);
  } catch (err) {
    storageOk = false;
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    storageOk = true;
  } catch (err) {
    storageOk = false;
    showToast('浏览器不允许本地保存，本次记录仅在当前页面有效');
  }
}

// 取明文密码：加密条目每次都要输入加密密钥（同一操作内可复用缓存）
async function reveal(entry) {
  if (!entry.enc) return entry.password;
  if (entry._plain) return entry._plain;
  return null;
}

function nextAutoName() {
  const used = new Set(entries.map(e => e.name));
  let n = 1;
  while (used.has('密钥 ' + n)) n++;
  return '密钥 ' + n;
}

function addEntry(name, password, meta) {
  meta = meta || {};
  entries.unshift({
    id: uid(),
    name: name || nextAutoName(),
    password: password,
    enc: false,
    batchId: '',
    createdAt: meta.createdAt || Date.now(),
    poolSize: meta.poolSize || 0,
    source: meta.source || 'generated'
  });
  persist();
  renderList();
  return entries[0];
}

/* ---------------- 渲染列表 ---------------- */

function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function maskPwd(pwd) {
  return '•'.repeat(pwd.length);
}

function renderList() {
  listEl.textContent = '';
  const q = searchInput.value.trim().toLowerCase();
  const visible = q ? entries.filter(e => e.name.toLowerCase().includes(q)) : entries;

  countEl.textContent = entries.length;
  emptyEl.style.display = visible.length ? 'none' : 'block';
  emptyEl.textContent = entries.length
    ? '没有匹配「' + searchInput.value.trim() + '」的密钥。'
    : '还没有保存的密钥。生成时填写名称、手动记录或批量导入，都会出现在这里。';
  $('clearAll').disabled = entries.length === 0;

  // 清理已不存在的选中项
  const allIds = new Set(entries.map(e => e.id));
  [...selectedIds].forEach(id => { if (!allIds.has(id)) selectedIds.delete(id); });

  const encCount = entries.filter(e => e.enc).length;
  $('encStat').textContent = encCount ? '已加密 ' + encCount + '/' + entries.length : '';
  $('selCount').textContent = selectedIds.size ? '已选 ' + selectedIds.size + ' 项' : '未选择';
  $('selAll').checked = visible.length > 0 && visible.every(e => selectedIds.has(e.id));
  $('btnEncryptSel').disabled = selectedIds.size === 0;
  $('btnDecryptSel').disabled = !entries.some(e => e.enc && selectedIds.has(e.id));
  $('btnExportSel').disabled = selectedIds.size === 0;

  visible.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'item' + (selectedIds.has(entry.id) ? ' selected' : '');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'item-check';
    check.checked = selectedIds.has(entry.id);
    check.dataset.id = entry.id;
    check.title = '选择这条密钥';

    const main = document.createElement('div');
    main.className = 'item-main';

    const row = document.createElement('div');
    row.className = 'item-row';

    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = entry.name;
    name.title = '点击可重命名';
    name.dataset.id = entry.id;

    const badges = document.createElement('span');
    badges.className = 'item-badges';
    const time = document.createElement('span');
    time.className = 'item-time' + (entry.source === 'generated' ? '' : ' custom');
    time.textContent = fmtTime(entry.createdAt);
    time.title = entry.source === 'generated' ? '由本程序生成' : (entry.source === 'imported' ? '导入的记录' : '手动记录');
    badges.appendChild(time);
    if (entry.enc) {
      const lock = document.createElement('span');
      lock.className = 'item-lock';
      lock.textContent = 'AES 加密';
      lock.title = '查看明文需要输入加密密钥';
      badges.appendChild(lock);
    }

    row.appendChild(name);
    row.appendChild(badges);

    const pwd = document.createElement('div');
    pwd.className = 'item-pwd';
    pwd.dataset.id = entry.id;
    pwd.title = entry.enc ? '点击输入加密密钥查看明文' : '点击复制';
    pwd.textContent = shownIds.has(entry.id)
      ? (entry._plain || entry.password)
      : (entry.enc ? '🔒 ' + '•'.repeat(12) : maskPwd(entry.password));

    main.appendChild(row);
    main.appendChild(pwd);

    const btns = document.createElement('div');
    btns.className = 'item-btns';
    btns.appendChild(miniBtn(shownIds.has(entry.id) ? '隐藏' : '显示', 'toggle', entry.id));
    btns.appendChild(miniBtn('复制', 'copy', entry.id));
    // 明文未锁 → 显示「加密」；已加密（锁定）→ 显示「解密」
    btns.appendChild(miniBtn(entry.enc ? '解密' : '加密', 'enc', entry.id));
    const delBtn = miniBtn('删除', 'del', entry.id);
    delBtn.classList.add('del');
    btns.appendChild(delBtn);

    item.appendChild(check);
    item.appendChild(main);
    item.appendChild(btns);
    listEl.appendChild(item);
  });
}

function miniBtn(text, act, id) {
  const b = document.createElement('button');
  b.className = 'mini';
  b.textContent = text;
  b.dataset.act = act.startsWith('del') ? 'del' : act;
  b.dataset.id = id;
  return b;
}

/* ---------------- 交互 ---------------- */

async function copyText(text, tip) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  showToast(tip || '已复制到剪贴板');
}

function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 1600);
}

// 弹窗输入加密密钥，并用它解开指定密文；成功返回 {pass, plain}，取消/错误返回 null
async function askPlain(cipher, opts) {
  const res = await askPassword({
    title: opts.title,
    tip: opts.tip || '每次查看都需要输入加密密钥，密钥不会保存在任何地方。',
    check: async pass => {
      try {
        await aesDecrypt(cipher, pass);
        return '';
      } catch (err) {
        return '加密密钥不正确';
      }
    }
  });
  if (!res) return null;
  try {
    return { pass: res.pass, plain: await aesDecrypt(cipher, res.pass) };
  } catch (err) {
    showToast('解密失败：加密密钥不正确');
    return null;
  }
}

// 显示明文：每次都要求输入加密密钥，显示期间仅暂存在内存
async function showPlain(entry) {
  const res = await askPlain(entry.password, {
    title: '查看「' + entry.name + '」',
    tip: '输入这条密钥的加密密钥，验证通过后临时显示明文；点「隐藏」或刷新页面即清除。'
  });
  if (!res) return false;
  entry._plain = res.plain;
  shownIds.add(entry.id);
  renderList();
  return true;
}

// 切换显示/隐藏明文
async function toggleShow(entry) {
  if (shownIds.has(entry.id)) {
    shownIds.delete(entry.id);
    delete entry._plain;
    renderList();
    return;
  }
  await showPlain(entry);
}

// 复制密码：加密条目每次都要求输入密钥
async function copyEntryPassword(entry) {
  if (!entry.enc) {
    copyText(entry.password, '已复制「' + entry.name + '」');
    return;
  }
  if (entry._plain && shownIds.has(entry.id)) {
    copyText(entry._plain, '已复制「' + entry.name + '」');
    return;
  }
  const res = await askPlain(entry.password, {
    title: '复制「' + entry.name + '」',
    tip: '输入加密密钥验证后复制到剪贴板；密钥不会被记住。'
  });
  if (!res) return;
  copyText(res.plain, '已复制「' + entry.name + '」');
}

listEl.addEventListener('click', async e => {
  const btn = e.target.closest('button.mini');
  if (btn) {
    const entry = entries.find(x => x.id === btn.dataset.id);
    if (!entry) return;
    const act = btn.dataset.act;
    if (act === 'toggle') {
      await toggleShow(entry);
    } else if (act === 'copy') {
      await copyEntryPassword(entry);
    } else if (act === 'enc') {
      if (entry.enc) await decryptOne(entry);
      else await encryptOne(entry);
    } else if (act === 'del') {
      if (!confirm('删除密钥「' + entry.name + '」？')) return;
      entries = entries.filter(x => x.id !== entry.id);
      shownIds.delete(entry.id);
      selectedIds.delete(entry.id);
      persist();
      renderList();
      showToast('已删除');
    }
    return;
  }

  const check = e.target.closest('.item-check');
  if (check) {
    if (check.checked) selectedIds.add(check.dataset.id);
    else selectedIds.delete(check.dataset.id);
    renderList();
    return;
  }

  const pwd = e.target.closest('.item-pwd');
  if (pwd) {
    const entry = entries.find(x => x.id === pwd.dataset.id);
    if (!entry) return;
    if (entry.enc) await toggleShow(entry);
    else copyText(entry.password, '已复制「' + entry.name + '」');
    return;
  }

  const nameEl = e.target.closest('.item-name');
  if (nameEl && nameEl.getAttribute('contenteditable') !== 'true') startRename(nameEl);
});

function startRename(nameEl) {
  const id = nameEl.dataset.id;
  const entry = entries.find(x => x.id === id);
  if (!entry) return;
  const old = entry.name;

  nameEl.setAttribute('contenteditable', 'true');
  nameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = commit => {
    nameEl.removeAttribute('contenteditable');
    nameEl.removeEventListener('blur', onBlur);
    nameEl.removeEventListener('keydown', onKey);
    if (!commit) { nameEl.textContent = old; return; }
    const val = nameEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!val) { nameEl.textContent = old; return; }
    entry.name = val;
    nameEl.textContent = val;
    persist();
  };
  const onBlur = () => finish(true);
  const onKey = ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
  };

  nameEl.addEventListener('blur', onBlur);
  nameEl.addEventListener('keydown', onKey);
}

/* ---------------- 加密操作 ---------------- */

function askPassword(opts) {
  const modal = $('unlockModal');
  modal.hidden = false;
  $('unlockTitle').textContent = opts.title || '输入加密密钥';
  $('unlockTip').textContent = opts.tip || '用于 AES 加密 / 解密，关闭页面后需重新输入。';
  const input = $('unlockInput');
  const input2 = $('unlockInput2');
  const confirmRow = $('unlockConfirmRow');
  input.value = '';
  input.maxLength = MASTER_MAX;
  input2.value = '';
  input2.maxLength = MASTER_MAX;
  confirmRow.hidden = !opts.confirm;
  $('unlockError').textContent = '';
  setTimeout(() => input.focus(), 30);

  return new Promise(resolve => {
    const cleanup = () => {
      $('unlockOk').removeEventListener('click', ok);
      $('unlockCancel').removeEventListener('click', cancel);
      $('unlockClose').removeEventListener('click', cancel);
      input.removeEventListener('keydown', onKey);
      input2.removeEventListener('keydown', onKey);
      modal.removeEventListener('click', onBackdrop);
      modal.hidden = true;
      input.value = '';
      input2.value = '';
    };
    const close = val => { cleanup(); resolve(val); };
    const submit = () => {
      const val = input.value;
      if (!val) { $('unlockError').textContent = '请输入加密密钥'; input.focus(); return; }
      if (val.length > MASTER_MAX) { $('unlockError').textContent = '最多 ' + MASTER_MAX + ' 个字符'; return; }
      if (opts.confirm && input2.value !== val) {
        $('unlockError').textContent = '两次输入的密钥不一致';
        input2.focus();
        return;
      }
      close({ pass: val });
    };
    const ok = () => {
      if (opts.check && input.value) {
        opts.check(input.value).then(err => {
          if (err) { $('unlockError').textContent = err; input.focus(); return; }
          submit();
        });
        return;
      }
      submit();
    };
    const cancel = () => close(null);
    const onKey = ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); ok(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    };
    const onBackdrop = ev => { if (ev.target === modal) cancel(); };

    $('unlockOk').addEventListener('click', ok);
    $('unlockCancel').addEventListener('click', cancel);
    $('unlockClose').addEventListener('click', cancel);
    input.addEventListener('keydown', onKey);
    input2.addEventListener('keydown', onKey);
    modal.addEventListener('click', onBackdrop);
  });
}

// 加密时询问加密密钥（不保存，仅用于本次操作）
async function askNewKey(tip) {
  const res = await askPassword({
    title: '设置加密密钥',
    tip: tip + '密钥不会保存，之后每次查看或解密都要重新输入，请自行牢记。',
    confirm: true
  });
  return res ? res.pass : null;
}

// 让用户先选中加密条目再操作
function needSelection(list, emptyMsg) {
  if (!list.length) {
    showToast(emptyMsg);
    return false;
  }
  return true;
}

async function encryptOne(input) {
  const entry = input && (entries.find(e => e.id === input.id) || input);
  if (!entry || entry.enc) return;
  const pass = await askNewKey('将用 AES-256-GCM 加密这条密钥并保存在本地。');
  if (!pass) return;
  try {
    const plain = entry._plain || entry.password;
    entry.password = await aesEncrypt(plain, pass);
    entry.enc = true;
    entry.batchId = uid();
    delete entry._plain;
    shownIds.delete(entry.id);
    persist();
    renderList();
    showToast('已加密「' + entry.name + '」，需输入密钥才能查看');
  } catch (err) {
    showToast('加密失败：' + err.message);
  }
}

async function decryptOne(input) {
  if (!input || !input.enc) return;
  const entry = entries.find(e => e.id === input.id) || input;
  const cipher = entry.password;
  const plain = await askPlain(cipher, {
    title: '解密「' + entry.name + '」',
    tip: '验证通过后这条密钥将以明文保存，不再需要密钥。'
  });
  if (!plain) return;
  entry.password = plain.plain;
  entry.enc = false;
  entry.batchId = '';
  shownIds.delete(entry.id);
  delete entry._plain;
  persist();
  renderList();
  showToast('已解密「' + entry.name + '」');
}

async function encryptSelected() {
  const targets = entries.filter(e => selectedIds.has(e.id) && !e.enc);
  if (!targets.length) {
    showToast('所选条目都已加密');
    return;
  }
  const pass = await askNewKey('将用同一个密钥加密所选 ' + targets.length + ' 条记录。');
  if (!pass) return;
  // 本批次共用同一个 batchId，导出时只需输入一次密钥就能整体解密
  const batchId = uid();
  try {
    let done = 0;
    for (const e of targets) {
      const plain = e._plain || e.password;
      e.password = await aesEncrypt(plain, pass);
      e.enc = true;
      e.batchId = batchId;
      delete e._plain;
      shownIds.delete(e.id);
      done++;
    }
    persist();
    renderList();
    showToast('已加密 ' + done + ' 条密钥（同批次，导出时输入一次密钥即可）');
  } catch (err) {
    showToast('加密失败：' + err.message);
  }
}

async function decryptSelected() {
  const targets = entries.filter(e => selectedIds.has(e.id) && e.enc);
  if (!targets.length) {
    showToast('所选条目没有加密内容');
    return;
  }
  const res = await askPassword({
    title: '解密所选 ' + targets.length + ' 条',
    tip: '输入加密密钥；只有能成功解密的条目会被还原为明文，其余保持不变。'
  });
  if (!res) return;

  let okCount = 0;
  let failCount = 0;
  for (const e of targets) {
    try {
      e.password = await aesDecrypt(e.password, res.pass);
      e.enc = false;
      e.batchId = '';
      shownIds.delete(e.id);
      delete e._plain;
      okCount++;
    } catch (err) {
      failCount++;
    }
  }
  persist();
  renderList();
  showToast('已解密 ' + okCount + ' 条' + (failCount ? '，' + failCount + ' 条因密钥不符跳过' : ''));
}

/* ---------------- 导出 ---------------- */

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 导出批量解密：同 batchId 的条目共用一个密钥，每组只弹一次窗
async function decryptForExport(source) {
  const out = [];
  // 明文条目直接取
  for (const e of source) {
    if (!e.enc) out.push({ entry: e, plain: e.password });
  }

  // 已在本页展开过的加密条目，直接复用内存里的明文
  const locked = [];
  for (const e of source) {
    if (!e.enc) continue;
    if (e._plain && shownIds.has(e.id)) out.push({ entry: e, plain: e._plain });
    else locked.push(e);
  }

  // 按批次分组：有 batchId 的归一组，没有的各自独立成组
  const groups = new Map();
  for (const e of locked) {
    const key = e.batchId || 'single:' + e.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  for (const list of groups.values()) {
    const first = list[0];
    const res = await askPlain(first.password, {
      title: list.length > 1
        ? '导出：解密「' + first.name + '」等 ' + list.length + ' 条'
        : '导出「' + first.name + '」',
      tip: list.length > 1
        ? '这 ' + list.length + ' 条是同一批次加密的，输入一次密钥即可全部解密导出。'
        : '这条密钥已加密，输入密钥验证后才能导出明文。'
    });
    if (!res) return null;
    out.push({ entry: first, plain: res.plain });
    for (let i = 1; i < list.length; i++) {
      const e = list[i];
      try {
        out.push({ entry: e, plain: await aesDecrypt(e.password, res.pass) });
      } catch (err) {
        showToast('「' + e.name + '」密钥不符，已跳过');
      }
    }
  }

  // 保持与列表一致的顺序
  const order = new Map(source.map((e, i) => [e.id, i]));
  out.sort((a, b) => order.get(a.entry.id) - order.get(b.entry.id));
  return out;
}

// 导出记录：mode = 'enc' 保持密文；mode = 'plain' 解密成明文
async function buildExportList(source, mode) {
  if (mode === 'plain') return decryptForExport(source);
  return source.map(e => ({
    entry: e,
    // 明文条目原样导出，加密条目导出密文
    plain: e.enc ? null : e.password,
    cipher: e.enc ? e.password : null
  }));
}

function csvCell(v) {
  return '"' + String(v).replace(/"/g, '""') + '"';
}

function exportPayload(list) {
  const keys = list.map(o => {
    const e = o.entry;
    const item = {
      name: e.name,
      // 保持加密时写入密文，并标记 enc 与 batchId，重新导入后仍能整批解密
      password: o.cipher ? o.cipher : o.plain,
      length: o.cipher ? 0 : String(o.plain).length,
      createdAt: new Date(e.createdAt).toISOString(),
      source: SOURCE_LABEL[e.source] || SOURCE_LABEL.generated
    };
    if (o.cipher) {
      item.enc = true;
      if (e.batchId) item.batchId = e.batchId;
    }
    return item;
  });
  return { app: 'random-key-manager', version: 1, exportedAt: new Date().toISOString(), count: keys.length, keys };
}

async function doExport(source, fmt, mode, filename) {
  const list = await buildExportList(source, mode);
  if (!list || !list.length) return false;
  if (fmt === 'csv') {
    const lines = ['名称,密码,长度,创建时间,来源'];
    list.forEach(o => {
      const e = o.entry;
      lines.push([
        csvCell(e.name),
        // 密文用引号包裹，逗号分隔导入时可原样还原
        csvCell(o.cipher ? o.cipher : o.plain),
        o.cipher ? 0 : String(o.plain).length,
        csvCell(new Date(e.createdAt).toLocaleString('zh-CN', { hour12: false })),
        csvCell(SOURCE_LABEL[e.source] || SOURCE_LABEL.generated)
      ].join(','));
    });
    download(filename + '.csv', '\ufeff' + lines.join('\r\n'), 'text/csv');
  } else {
    download(filename + '.json', JSON.stringify(exportPayload(list), null, 2), 'application/json');
  }
  const encKept = list.filter(o => o.cipher).length;
  showToast('已导出 ' + list.length + ' 条（' + fmt.toUpperCase() +
    (mode === 'plain' ? '，明文' : encKept ? '，' + encKept + ' 条保持密文' : '，明文') + '）');
  return true;
}

/* ---------------- 导出弹窗 ---------------- */

let exportSource = null; // 当前要导出的条目；null 时取自「全部」
let exportScope = 'all'; // 'all' | 'sel'

// 打开导出弹窗；scope = 'all' 全量，'sel' 所选
function openExport(scope) {
  const source = scope === 'sel' ? entries.filter(e => selectedIds.has(e.id)) : entries;
  if (!source.length) {
    showToast(scope === 'sel' ? '请先勾选要导出的密钥' : '没有可导出的密钥');
    return;
  }
  exportSource = source;
  exportScope = scope;
  const encCount = source.filter(e => e.enc).length;
  $('exportTitle').textContent = (scope === 'sel' ? '导出所选 ' : '导出全部 ') + source.length + ' 条';
  $('exportError').textContent = '';
  // 没有任何加密条目时，「保持加密」与「解密后导出」等价，默认明文并禁用加密项
  const encOpt = document.querySelector('#exportModal input[name="exportMode"][value="enc"]');
  encOpt.disabled = encCount === 0;
  document.querySelector('#exportModal input[name="exportMode"][value="' + (encCount ? 'enc' : 'plain') + '"]').checked = true;
  $('exportModal').hidden = false;
}

function closeExport() {
  $('exportModal').hidden = true;
  exportSource = null;
}

async function runExport() {
  if (!exportSource || !exportSource.length) return;
  const fmt = (document.querySelector('#exportModal input[name="exportFmt"]:checked') || {}).value || 'json';
  const mode = (document.querySelector('#exportModal input[name="exportMode"]:checked') || {}).value || 'enc';
  const btn = $('exportRun');
  btn.disabled = true;
  try {
    const base = (exportScope === 'sel' ? 'keys-selected-' : 'keys-') + stamp();
    const done = await doExport(exportSource, fmt, mode, base);
    if (done) closeExport();
  } catch (err) {
    $('exportError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- 手动记录 ---------------- */

function addManual() {
  const name = $('manualName').value.replace(/\s+/g, ' ').trim();
  const pwd = $('manualPwd').value;
  if (!name) {
    showToast('请填写名称');
    $('manualName').focus();
    return;
  }
  if (!pwd) {
    showToast('请填写要记录的密码');
    $('manualPwd').focus();
    return;
  }
  const dup = entries.find(e => e.name === name);
  if (dup && !confirm('已存在同名记录「' + name + '」，仍要添加吗？')) return;
  addEntry(name, pwd, { source: 'manual' });
  $('manualName').value = '';
  $('manualPwd').value = '';
  $('manualName').focus();
  showToast('已添加：' + name);
}

/* ---------------- 批量导入 ---------------- */

const SOURCE_LABEL = { generated: '生成', manual: '手动', imported: '导入' };

// 删除 BOM 与零宽字符（手机/聊天软件复制常见）
function cleanText(s) {
  return String(s).replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function parseCsvLine(line, delim) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"' && !cur) {
      quoted = true;
    } else if (c === delim) {
      cells.push(cur);
      cur = '';
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

function splitCsv(text) {
  return text.split(/\r?\n/).filter(l => l.trim() !== '');
}

// 支持 JSON（本程序导出或 {name,password} 数组）、CSV、纯文本 "名称,密码"
// 每条记录统一返回 { name, password, enc, batchId }，enc 表示 password 是不是密文
function parseImport(text) {
  const raw = cleanText(text).trim();
  if (!raw) return [];

  const isCipher = v => typeof v === 'string' && v.indexOf('v1:') === 0;

  if (raw[0] === '{' || raw[0] === '[') {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error('JSON 格式错误：' + err.message);
    }
    let list = Array.isArray(data) ? data : (data.keys || data.list || data.items || []);
    if (!Array.isArray(list)) throw new Error('JSON 中没有找到密钥数组');
    return list.map(item => {
      const password = String(item.password || item.pwd || item.secret || item.value || '');
      // 导出的密文带 enc: true，也兼容只写了 v1: 前缀的记录，以及批次号
      const enc = (item.enc === true || isCipher(password)) && isCipher(password);
      return {
        name: String(item.name || item.title || item.site || '').trim(),
        password: password,
        enc: enc,
        batchId: enc && typeof item.batchId === 'string' ? item.batchId : ''
      };
    }).filter(o => o.name || o.password);
  }

  const lines = splitCsv(raw);
  if (!lines.length) return [];

  // 统一全角符号，便于从聊天/笔记里复制过来的内容也能解析
  const norm = s => s.replace(/，/g, ',').replace(/＝/g, '=').replace(/\u3000/g, ' ');

  const isHeader = l => {
    const h = norm(l).toLowerCase();
    const commaHeader = h.indexOf(',') > -1 && (h.indexOf('名称') > -1 || /\bname\b/.test(h)) && /password|密码|pwd/.test(h);
    const tabHeader = h.indexOf('\t') > -1 && (h.indexOf('名称') > -1 || /\bname\b/.test(h)) && /password|密码|pwd/.test(h);
    return commaHeader || tabHeader;
  };

  // 逐行判断分隔符，兼容表头用逗号、数据用 Tab 的导出文件
  let delim = ',';
  if (lines.length && lines[0].indexOf('\t') > -1) delim = '\t';
  else if (lines.length && lines[0].indexOf(',') === -1) delim = null;

  if (isHeader(lines[0])) lines.shift();
  if (lines.length) {
    if (lines[0].indexOf('\t') > -1) delim = '\t';
    else if (lines[0].indexOf(',') > -1) delim = ',';
    else delim = null;
  }

  const out = [];
  lines.forEach(rawLine => {
    const line = norm(rawLine);
    let name = '';
    let password = '';
    if (delim) {
      const cells = parseCsvLine(line, delim);
      // 整行没有分隔符但含等号时，回退到 "名称 = 密码" 解析
      if (cells.length === 1 && line.indexOf('=') > -1) {
        const i = line.indexOf('=');
        name = line.slice(0, i);
        password = line.slice(i + 1);
      } else {
        name = cells[0];
        password = cells.length > 1 ? cells[1] : '';
      }
    } else if (line.indexOf('=') > -1) {
      const i = line.indexOf('=');
      name = line.slice(0, i);
      password = line.slice(i + 1);
    } else {
      // 空格分隔：先尝试“名称 密码”，失败则整行视为名称
      const m = line.match(/^(\S+)\s+(.+)$/);
      if (m && !/\s/.test(m[1])) { name = m[1]; password = m[2]; }
      else { name = line; }
    }
    name = name.trim().replace(/^["']|["']$/g, '');
    password = password.trim().replace(/^["']|["']$/g, '');
    if (name || password) {
      const enc = isCipher(password);
      out.push({ name: name, password: password, enc: enc, batchId: '' });
    }
  });
  return out;
}

// 导入时统计加密记录，给出明确提示
function updateImportTip(list) {
  const tipEl = $('importTip');
  const encCount = list.filter(o => o.enc).length;
  const plainCount = list.filter(o => !o.enc).length;
  const keepEnc = $('importKeepEnc').checked;
  $('importKeepEnc').disabled = encCount === 0;
  if (!encCount) {
    tipEl.hidden = true;
    tipEl.textContent = '';
    return;
  }
  tipEl.hidden = false;
  tipEl.textContent = '识别到 ' + encCount + ' 条加密记录' + (plainCount ? '、' + plainCount + ' 条明文记录' : '') +
    '，将' + (keepEnc ? '以密文形式原样导入，导入后仍需输入原密钥才能查看' : '先解密成明文再保存，需要输入加密密钥') + '。';
  if (!keepEnc) $('importKeepEnc').parentElement.classList.add('warn');
  else $('importKeepEnc').parentElement.classList.remove('warn');
}

function previewImport() {
  const area = $('importText');
  const btn = $('importRun');
  const errEl = $('importError');
  errEl.textContent = '';
  if (!area.value.trim()) {
    btn.disabled = true;
    $('importCount').textContent = '';
    updateImportTip([]);
    return [];
  }
  let list;
  try {
    list = parseImport(area.value);
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = true;
    $('importCount').textContent = '';
    updateImportTip([]);
    return [];
  }
  btn.disabled = list.length === 0;
  $('importCount').textContent = list.length ? '（' + list.length + ' 条）' : '';
  updateImportTip(list);
  return list;
}

// 把导入列表里的加密记录解密成明文；同批次只问一次，返回新的列表
async function decryptImportList(list) {
  const out = list.map(o => ({ name: o.name, password: o.password, enc: false, batchId: '' }));
  const idx = [];
  out.forEach((o, i) => { if (list[i].enc) idx.push(i); });
  // 同一批次的记录共用密钥，按批次聚合；没有批次号的逐条输入
  const groups = new Map();
  idx.forEach(i => {
    const key = list[i].batchId || 'single:' + i;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });

  for (const ids of groups.values()) {
    const first = out[ids[0]];
    const res = await askPlain(list[ids[0]].password, {
      title: ids.length > 1 ? '导入：解密「' + first.name + '」等 ' + ids.length + ' 条' : '导入「' + first.name + '」',
      tip: ids.length > 1
        ? '这 ' + ids.length + ' 条属于同一批次，输入一次密钥即可全部解密导入。'
        : '这条记录是加密的，输入原加密密钥后以明文导入。'
    });
    if (!res) return null;
    // 整组尝试用同一个密钥解，解不开的保留密文并计数
    let failed = 0;
    for (const i of ids) {
      try {
        out[i].password = await aesDecrypt(list[i].password, res.pass);
      } catch (err) {
        out[i].password = list[i].password;
        out[i].enc = true;
        out[i].batchId = list[i].batchId;
        failed++;
      }
    }
    if (failed) showToast('有 ' + failed + ' 条密钥不符，保留为密文');
  }
  return out;
}

async function runImport() {
  let list = previewImport();
  if (!list.length) {
    $('importError').textContent = '没有可导入的有效记录';
    return;
  }
  const keepEnc = $('importKeepEnc').checked;
  const hasEnc = list.some(o => o.enc);

  if (hasEnc && !keepEnc) {
    const btn = $('importRun');
    btn.disabled = true;
    try {
      list = await decryptImportList(list);
    } finally {
      btn.disabled = false;
    }
    if (!list) return; // 用户取消了密钥输入
  }

  const overwrite = $('overwrite').checked;
  const stamp = new Date().toISOString().slice(0, 10);
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let unnamed = 0;
  let encImported = 0;

  const batchNames = new Set();
  list.forEach(o => {
    let name = o.name;
    if (!name) {
      unnamed++;
      name = nextAutoName();
    } else if (batchNames.has(name) && !overwrite) {
      // 同一批内重名（entries 中已包含前一条导入结果，这里仅作保险）
      skipped++;
      return;
    }
    batchNames.add(name);
    const dup = entries.find(e => e.name === name);
    const apply = target => {
      target.password = o.password;
      target.enc = !!o.enc;
      target.batchId = o.enc ? (o.batchId || uid()) : '';
      target.poolSize = 0;
      if (o.enc) encImported++;
      shownIds.delete(target.id);
      delete target._plain;
    };
    if (dup) {
      if (!overwrite) { skipped++; return; }
      if (!o.password) { skipped++; return; }
      apply(dup);
      updated++;
      return;
    }
    if (!o.password) { skipped++; return; }
    const created = {
      id: uid(),
      name: name,
      password: o.password,
      enc: false,
      batchId: '',
      createdAt: new Date(stamp).getTime(),
      poolSize: 0,
      source: 'imported'
    };
    entries.unshift(created);
    apply(created);
    added++;
  });

  persist();
  renderList();
  closeImport();
  const parts = [];
  if (added) parts.push('新增 ' + added);
  if (updated) parts.push('覆盖 ' + updated);
  if (skipped) parts.push('跳过 ' + skipped);
  if (unnamed) parts.push('自动命名 ' + unnamed);
  if (encImported) parts.push(encImported + ' 条保持加密');
  showToast('导入完成：' + (parts.join('，') || '无变化'));
}

function openImport() {
  $('importModal').hidden = false;
  $('importError').textContent = '';
  $('importCount').textContent = '';
  $('importText').focus();
  previewImport();
}

// 清空导入表单：文本框、已选文件、两个勾选项、错误与提示
function resetImportForm() {
  $('importText').value = '';
  $('fileInput').value = '';
  $('importKeepEnc').checked = true;
  $('overwrite').checked = false;
  $('importKeepEnc').parentElement.classList.remove('warn');
  previewImport();
}

function closeImport() {
  $('importModal').hidden = true;
  resetImportForm();
}

function readImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    $('importText').value = String(reader.result || '');
    previewImport();
  };
  reader.onerror = () => { $('importError').textContent = '文件读取失败'; };
  reader.readAsText(file, 'UTF-8');
}

/* ---------------- 事件绑定 ---------------- */

lengthEl.addEventListener('input', () => { lenText.textContent = lengthEl.value; });
$('genBtn').addEventListener('click', generate);
$('refreshBtn').addEventListener('click', generate);
$('copyBtn').addEventListener('click', () => {
  if (currentPwd) copyText(currentPwd);
});
passwordEl.addEventListener('click', () => {
  if (currentPwd) copyText(currentPwd);
});
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); generate(); }
});
$('saveBtn').addEventListener('click', saveCurrent);
$('manualAdd').addEventListener('click', addManual);
$('manualPwd').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addManual(); }
});
searchInput.addEventListener('input', renderList);
$('importBtn').addEventListener('click', openImport);
$('modalClose').addEventListener('click', closeImport);
$('importRun').addEventListener('click', runImport);
$('importFileBtn').addEventListener('click', () => $('fileInput').click());
$('importText').addEventListener('input', previewImport);
$('importKeepEnc').addEventListener('change', previewImport);
$('fileInput').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) readImportFile(file);
});
$('importModal').addEventListener('click', e => {
  if (e.target === $('importModal')) closeImport();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('importModal').hidden) closeImport();
  else if (!$('exportModal').hidden) closeExport();
});
$('exportBtn').addEventListener('click', () => openExport('all'));
$('exportRun').addEventListener('click', runExport);
$('exportClose').addEventListener('click', closeExport);
$('exportCancel').addEventListener('click', closeExport);
$('exportModal').addEventListener('click', e => {
  if (e.target === $('exportModal')) closeExport();
});
$('clearAll').addEventListener('click', () => {
  if (!entries.length) return;
  if (!confirm('确定清空全部 ' + entries.length + ' 条密钥？此操作不可恢复。')) return;
  entries = [];
  shownIds.clear();
  selectedIds.clear();
  persist();
  renderList();
  showToast('已清空密钥列表');
});

$('selAll').addEventListener('change', e => {
  const q = searchInput.value.trim().toLowerCase();
  const visible = q ? entries.filter(x => x.name.toLowerCase().includes(q)) : entries;
  visible.forEach(x => {
    if (e.target.checked) selectedIds.add(x.id);
    else selectedIds.delete(x.id);
  });
  renderList();
});
$('btnEncryptSel').addEventListener('click', encryptSelected);
$('btnDecryptSel').addEventListener('click', decryptSelected);
$('btnClearSel').addEventListener('click', () => {
  selectedIds.clear();
  renderList();
});
$('btnExportSel').addEventListener('click', () => openExport('sel'));

/* ---------------- 启动 ---------------- */

entries = loadEntries();
renderList();
if (!storageOk) showToast('无法访问本地存储，列表不会跨会话保留');
const encOnLoad = entries.filter(e => e.enc).length;
if (encOnLoad) showToast('有 ' + encOnLoad + ' 条密钥已加密，查看时需输入加密密钥');
generate();
