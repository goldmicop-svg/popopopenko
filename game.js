import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const saved = JSON.parse(localStorage.getItem('potapenko-save') || '{}');
let authToken = localStorage.getItem('potapenko-token') || '';
let account = null;
let saveTimer = null;
let authMode = 'login';
const heroes = [
  ['Шумыч','ОБЫЧНЫЙ','character_01.jpg','🛴','Электросамокат','Мчись на самокате 5 секунд','scooter',5,'#55bca4'],
  ['Бабки-гонки','РЕДКИЙ','character_02.jpg','💨','Двойной рывок','Сделай молниеносный рывок','dash',1.5,'#e5a942'],
  ['Тапок','ОБЫЧНЫЙ','character_03.jpg','🪤','Манок','Отвлеки Потапенко приманкой','decoy',3,'#7e8cf3'],
  ['Неон','РЕДКИЙ','character_04.jpg','⚡','Суперзаряд','На время ускорься и свети ярче','surge',3.5,'#62d9d0'],
  ['Банда','ЭПИЧЕСКИЙ','character_05.jpg','🛡','Щит команды','Защита от столкновения на 3 секунды','shield',3,'#ed8d67'],
  ['Сторис','ОБЫЧНЫЙ','character_06.jpg','🧲','Шуми-магнит','Притяни ближайшие монеты','magnet',4,'#bd85ff'],
  ['Тихон','РЕДКИЙ','character_07.jpg','❄','Заморозка','Останови Потапенко на 2 секунды','stun',2,'#7ecbff'],
  ['Фонарик','ОБЫЧНЫЙ','character_08.jpg','🌀','Телепорт','Переместись подальше от монстра','blink',1,'#86d58b'],
  ['Профессор','РЕДКИЙ','character_09.jpg','🌟','Суперскорость','Беги быстрее 4 секунды','surge',4,'#e2cd76'],
  ['Снежок','ЭПИЧЕСКИЙ','character_10.jpg','🫥','Тихий шаг','Потапенко замедлится на время','slow',4,'#7db7f5'],
  ['Пиксель','ОБЫЧНЫЙ','character_11.jpg','✨','Притяжение','Собери монеты вокруг себя','magnet',3,'#f38cb7'],
  ['Гигант','ЭПИЧЕСКИЙ','character_12.jpg','🛡','Крепкий панцирь','Игнорируй столкновение 4 секунды','shield',4,'#b29aee'],
  ['Малыш','ОБЫЧНЫЙ','character_13.jpg','💨','Турбо-рывок','Быстрый рывок вперёд','dash',1.8,'#f2a367'],
  ['Потапенко','ЛЕГЕНДАРНЫЙ','character_14.jpg','⚡','Электрошок','Оглуши преследователя','stun',2.8,'#ee7489'],
  ['Монетка','РЕДКИЙ','character_15.jpg','🧲','Магнитный дождь','Притяни шумилики поблизости','magnet',4.5,'#f4c855'],
  ['Ника','ЭПИЧЕСКИЙ','character_16.jpg','🪤','Ложный след','Отправь Потапенко за приманкой','decoy',4,'#84c7a2'],
  ['Саня','РЕДКИЙ','character_17.jpg','🛴','Скутер-буст','Разгонись на короткий срок','scooter',3.5,'#75d8df'],
  ['Команда','ЭПИЧЕСКИЙ','character_18.jpg','🌪','Ураган','Сильно замедли Потапенко','slow',5,'#f185aa'],
].map((x, i) => ({ id:i, name:x[0], rarity:x[1], file:`assets/brawlers/${x[2]}`, icon:x[3], ability:x[4], desc:x[5], kind:x[6], duration:x[7], color:x[8] }));
const state = {
  coins: saved.coins ?? 0,
  unlocked: Math.max(1, saved.unlocked || 1),
  level: Math.max(1, saved.unlocked || 1),
  best: saved.best || 0,
  volume: saved.volume ?? 45,
  device: saved.device || (matchMedia('(pointer: coarse)').matches ? 'phone' : 'pc'),
  mode: saved.mode === 'arcade' ? 'arcade' : 'levels',
  collected: 0, elapsed: 0, running: false, paused: false, started: false,
  keys: new Set(), touch: new Set(), touchX: 0, touchZ: 0, toastTimer: null, soundContext: null,
  heroes: saved.heroes || [0], selectedHero: Number(saved.selectedHero || 0), upgrades: saved.upgrades || {},
  abilityUntil: 0, cooldownUntil: 0, shieldUntil: 0, stunUntil: 0, slowUntil: 0, decoyUntil: 0,
};
if (!saved.caseWelcome) { state.coins += 120; state.caseWelcome = true; }
const ARENA = 7.4;
const LEVEL_GOAL = 8;
const LEVEL_TIME = 35;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function persist() {
  const game = serializeGame(); localStorage.setItem('potapenko-save', JSON.stringify(game));
  if (authToken) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const response = await fetch('/api/save', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`}, body:JSON.stringify({game}) });
        if (response.status === 403) invalidateSession('Аккаунт заблокирован или сессия завершилась. Войди снова.');
      } catch { /* Keep the local cache; the server can sync again on the next change. */ }
    }, 250);
  }
}
function serializeGame() { return { coins:state.coins, unlocked:state.unlocked, best:state.best, volume:state.volume, device:state.device, mode:state.mode, heroes:state.heroes, selectedHero:state.selectedHero, upgrades:state.upgrades, caseWelcome:state.caseWelcome }; }
function applyGameData(game) {
  if (!game) return;
  state.coins = Number(game.coins ?? state.coins); state.unlocked = Math.max(1, Number(game.unlocked || 1)); state.level = state.unlocked;
  state.best = Number(game.best || 0); state.heroes = Array.isArray(game.heroes) && game.heroes.length ? game.heroes.map(Number) : [0];
  state.selectedHero = Number(game.selectedHero || 0); if (!state.heroes.includes(state.selectedHero)) state.selectedHero = state.heroes[0];
  state.upgrades = game.upgrades || {}; state.volume = Number(game.volume ?? 45); state.device = game.device || state.device; state.mode = game.mode === 'arcade' ? 'arcade' : 'levels';
  state.caseWelcome = game.caseWelcome !== false; $('volume').value = state.volume; $('volumeValue').textContent = `${state.volume}%`;
  setDevice(state.device); document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('selected', b.dataset.mode === state.mode));
  updateHud(); selectHero(state.selectedHero);
}
function selectedHero() { return heroes[state.selectedHero] || heroes[0]; }
function heroUpgrade() { return Number(state.upgrades[state.selectedHero] || 0); }
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type':'application/json', ...(authToken ? {Authorization:`Bearer ${authToken}`} : {}), ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Ошибка ${response.status}`);
  return payload;
}
function invalidateSession(message) {
  clearTimeout(saveTimer);
  authToken = ''; account = null; localStorage.removeItem('potapenko-token');
  $('authScreen').classList.remove('hidden'); $('authError').textContent = message || '';
  $('accountName').textContent = 'Гость'; $('adminOpen').classList.add('hidden');
  state.running = false; $('sceneWrap').classList.remove('playing'); $('touchControls').classList.remove('visible');
}
function updateAccountBadge() {
  $('accountName').textContent = account?.username || 'Гость';
  $('adminOpen').classList.toggle('hidden', !account?.admin);
  $('logoutButton').textContent = account ? 'Выйти' : 'Вход';
}
async function connectSession(data) {
  authToken = data.token; localStorage.setItem('potapenko-token', authToken); account = data.user;
  $('authScreen').classList.add('hidden'); $('authError').textContent = ''; updateAccountBadge();
  applyGameData(data.user.game);
}
function setAuthMode(mode) {
  authMode = mode; const registering = mode === 'register';
  $('authTitle').textContent = registering ? 'Создать аккаунт' : 'Вход в игру';
  $('authSubmit').innerHTML = registering ? 'Зарегистрироваться <span>→</span>' : 'Войти <span>→</span>';
  $('authSwitch').textContent = registering ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
  $('authPassword').autocomplete = registering ? 'new-password' : 'current-password';
}
function clockText(value) { const n = Math.floor(value); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
function updateHud() {
  $('coinCount').textContent = state.coins;
  $('bestTime').textContent = clockText(state.best);
  $('levelLabel').textContent = `УРОВЕНЬ ${String(state.level).padStart(2, '0')}`;
  $('timer').textContent = clockText(state.elapsed);
  $('objectiveText').textContent = state.mode === 'arcade' ? 'АРКАДА · Продержись 60 секунд — босс ускоряется!' : `Собери ${LEVEL_GOAL} шумиликов и продержись ${LEVEL_TIME} секунд · ${state.collected}/${LEVEL_GOAL}`;
  renderLevels();
  renderLobby();
  $('abilityCooldown').textContent = state.cooldownUntil <= state.elapsed ? 'ГОТОВО' : `${Math.ceil(state.cooldownUntil - state.elapsed)}С`;
}
function showToast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}
function tone(freq = 650, duration = .07, type = 'sine') {
  if (!state.volume) return;
  try {
    state.soundContext ||= new AudioContext();
    const ctx = state.soundContext, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq; gain.gain.setValueAtTime(state.volume / 100 * .09, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + duration);
  } catch { /* Sound is optional; the game remains playable when audio is unavailable. */ }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#111a2b');
scene.fog = new THREE.Fog('#111a2b', 19, 38);
const camera = new THREE.OrthographicCamera(-9, 9, 9, -9, .1, 100);
camera.position.set(0, 19, 9.5); camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.22;
$('scene').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight('#c9e4ff', '#2b3342', 2.1));
const sun = new THREE.DirectionalLight('#fff0d5', 3.1); sun.position.set(-6, 13, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#172235', roughness: .95 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.17; ground.receiveShadow = true; scene.add(ground);
const floor = new THREE.Mesh(new THREE.CircleGeometry(8.25, 80), new THREE.MeshStandardMaterial({ color: '#26344a', roughness: .88, metalness: .05 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -.08; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(16.5, 22, '#536a7e', '#3d4d61'); grid.position.y = -.065;
grid.material.transparent = true; grid.material.opacity = .35; scene.add(grid);
const border = new THREE.Mesh(new THREE.TorusGeometry(8.12, .08, 10, 90), new THREE.MeshStandardMaterial({ color: '#6c8d99', emissive: '#17443e', emissiveIntensity: .42, roughness: .35 }));
border.rotation.x = Math.PI / 2; border.position.y = .03; scene.add(border);
const platform = new THREE.Mesh(new THREE.CylinderGeometry(8.23, 8.55, .34, 64), new THREE.MeshStandardMaterial({ color: '#182335', roughness: .65 }));
platform.position.y = -.28; platform.receiveShadow = true; platform.castShadow = true; scene.add(platform);

// Rounded, low-poly scenery gives the arena a small 3D diorama feel.
for (let i = 0; i < 14; i++) {
  const angle = i / 14 * Math.PI * 2, radius = 9.7 + (i % 3) * .55;
  const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.1, .15, .55, 8), new THREE.MeshStandardMaterial({ color: '#64503d', roughness: 1 }));
  trunk.position.set(x, .05, z); trunk.castShadow = true; scene.add(trunk);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(.47 + (i % 2) * .12, 1), new THREE.MeshStandardMaterial({ color: i % 3 ? '#274c4c' : '#45654e', roughness: .9 }));
  crown.position.set(x, .55, z); crown.castShadow = true; scene.add(crown);
}

const portraitTextures = new Map();
function makePortraitTexture(src, borderColor) {
  const key = `${src}|${borderColor}`;
  if (portraitTextures.has(key)) return portraitTextures.get(key);
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = borderColor; ctx.beginPath(); ctx.arc(128, 128, 125, 0, Math.PI * 2); ctx.fill();
  const img = new Image(); img.src = src;
  img.onload = () => {
    ctx.save(); ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.clip();
    const scale = Math.max(224 / img.width, 224 / img.height), w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, 128 - w / 2, 128 - h / 2, w, h); ctx.restore(); texture.needsUpdate = true;
  };
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; portraitTextures.set(key, texture); return texture;
}
function shadowDisc(radius, opacity = .24) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), new THREE.MeshBasicMaterial({ color: '#030610', transparent: true, opacity, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = .035; return mesh;
}
function makeCharacter(src, ringColor, size, name) {
  const group = new THREE.Group(); scene.add(group);
  const shade = shadowDisc(size * .76); group.add(shade);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(size * .53, size * .6, .28, 32), new THREE.MeshStandardMaterial({ color: ringColor, roughness: .35, metalness: .22 }));
  base.position.y = .22; base.castShadow = true; base.receiveShadow = true; group.add(base);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(size * .46, .045, 10, 40), new THREE.MeshStandardMaterial({ color: '#f1e7c9', metalness: .55, roughness: .3 }));
  collar.rotation.x = Math.PI / 2; collar.position.y = .38; group.add(collar);
  const portrait = new THREE.Sprite(new THREE.SpriteMaterial({ map: makePortraitTexture(src, '#f9ecd2'), transparent: true, depthTest: true }));
  portrait.position.y = .96; portrait.scale.set(size * 1.35, size * 1.35, 1); group.add(portrait);
  const tagCanvas = document.createElement('canvas'); tagCanvas.width = 512; tagCanvas.height = 90;
  const c = tagCanvas.getContext('2d'); c.font = '700 40px Manrope, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#10182a';
  c.beginPath(); c.roundRect(66, 13, 380, 64, 24); c.fill(); c.strokeStyle = '#ffffff45'; c.lineWidth = 3; c.stroke();
  c.fillStyle = '#f6f7fc'; c.fillText(name, 256, 57);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tagCanvas), transparent: true, depthTest: false }));
  tag.position.y = 1.9; tag.scale.set(2.2, .39, 1); group.add(tag);
  return { group, base, portrait, shade, tag };
}
const player = makeCharacter(heroes[0].file, heroes[0].color, .85, heroes[0].name); player.group.position.set(-2.9, 0, 2.5);
const monster = makeCharacter('assets/potapenko.jpg', '#cf687d', 1.05, 'ПОТАПЕНКО'); monster.group.position.set(3.5, 0, -3.7);
player.group.position.set(0, 0, 1.4); monster.group.visible = false;
const scooter = new THREE.Group(); player.group.add(scooter); scooter.position.set(0, .18, .58); scooter.visible = false;
const scooterBoard = new THREE.Mesh(new THREE.BoxGeometry(.28, .12, .92), new THREE.MeshStandardMaterial({ color: '#66f0cb', metalness: .5, roughness: .24, emissive: '#138c72', emissiveIntensity: .8 }));
scooterBoard.position.y = .12; scooterBoard.castShadow = true; scooter.add(scooterBoard);
for (const z of [-.42, .42]) { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .09, 18), new THREE.MeshStandardMaterial({ color: '#151927', roughness: .55 })); wheel.rotation.z = Math.PI / 2; wheel.position.set(0, -.02, z); wheel.castShadow = true; scooter.add(wheel); }
const stem = new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, .63, 10), new THREE.MeshStandardMaterial({ color: '#e8f7fa', metalness: .6, roughness: .3 })); stem.position.set(0, .43, -.36); scooter.add(stem);
const handle = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .5, 10), new THREE.MeshStandardMaterial({ color: '#ffe271', metalness: .35, roughness: .28 })); handle.rotation.z = Math.PI / 2; handle.position.set(0, .73, -.36); scooter.add(handle);
const abilityAura = new THREE.Mesh(new THREE.TorusGeometry(.82, .035, 8, 48), new THREE.MeshBasicMaterial({ color: '#ffe36e', transparent: true, opacity: .9 }));
abilityAura.rotation.x = Math.PI / 2; abilityAura.position.y = .17; abilityAura.visible = false; player.group.add(abilityAura);
const stunAura = new THREE.Mesh(new THREE.TorusGeometry(1.15, .05, 8, 40), new THREE.MeshBasicMaterial({ color: '#a9e8ff', transparent: true, opacity: .9 }));
stunAura.rotation.x = Math.PI / 2; stunAura.position.y = .2; stunAura.visible = false; monster.group.add(stunAura);
function updateActorLabel(actor, text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 90; const ctx = c.getContext('2d');
  ctx.font = '700 40px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#10182a'; ctx.beginPath(); ctx.roundRect(66, 13, 380, 64, 24); ctx.fill();
  ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = '#f6f7fc'; ctx.fillText(text, 256, 57);
  actor.tag.material.map.dispose(); actor.tag.material.map = new THREE.CanvasTexture(c); actor.tag.material.needsUpdate = true;
}
function selectHero(id) {
  if (!state.heroes.includes(id)) { showToast('Открой бойца из кейса!'); return; }
  if (state.running) { showToast('Выбрать бойца можно в лобби'); return; }
  state.selectedHero = id; const h = selectedHero();
  player.portrait.material.map = makePortraitTexture(h.file, '#f9ecd2'); player.portrait.material.needsUpdate = true;
  player.base.material.color.set(h.color); updateActorLabel(player, h.name);
  persist(); renderLobby(); tone(600, .08);
}

const coinGeometry = new THREE.CylinderGeometry(.29, .29, .13, 32);
const coinMaterial = new THREE.MeshStandardMaterial({ color: '#ffc34d', metalness: .7, roughness: .24, emissive: '#633508', emissiveIntensity: .25 });
const coinTopMaterial = new THREE.MeshStandardMaterial({ color: '#f9dc86', metalness: .45, roughness: .27 });
const coinPortrait = new THREE.SpriteMaterial({ map: makePortraitTexture('assets/brawlers/character_15.jpg', '#ffd665'), transparent: true, depthTest: true });
const coinGroup = new THREE.Group(); scene.add(coinGroup);
const coinMeshes = [];
function randomPoint(minRadius = 1.4, avoidPosition = null, minimumDistance = 0) {
  let point;
  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = Math.random() * Math.PI * 2, r = minRadius + Math.random() * (6.35 - minRadius);
    point = new THREE.Vector3(Math.cos(angle) * r, .3, Math.sin(angle) * r);
    if (!avoidPosition || Math.hypot(point.x - avoidPosition.x, point.z - avoidPosition.z) >= minimumDistance) break;
  }
  return point;
}
function makeCoin() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(coinGeometry, coinMaterial); body.castShadow = true; g.add(body);
  const top = new THREE.Mesh(new THREE.CircleGeometry(.205, 32), coinTopMaterial); top.rotation.x = -Math.PI / 2; top.position.y = .075; g.add(top);
  const textCanvas = document.createElement('canvas'); textCanvas.width = 128; textCanvas.height = 128;
  const c = textCanvas.getContext('2d'); c.fillStyle = '#8b5815'; c.font = 'bold 86px Manrope'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Ш', 64, 68);
  const letter = new THREE.Mesh(new THREE.PlaneGeometry(.25, .25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas), transparent: true, side: THREE.DoubleSide }));
  letter.rotation.x = -Math.PI / 2; letter.position.y = .081; g.add(letter);
  const face = new THREE.Sprite(coinPortrait); face.position.y = .34; face.scale.set(.42, .42, 1); g.add(face);
  const s = shadowDisc(.36, .2); s.position.y = .02; g.add(s); g.userData.seed = Math.random() * 7;
  coinGroup.add(g); coinMeshes.push(g); return g;
}
for (let i = 0; i < 8; i++) { const c = makeCoin(); c.position.copy(randomPoint(2)); c.visible = false; }

function resize() {
  const box = $('scene').getBoundingClientRect();
  const aspect = box.width / box.height, viewHeight = Math.max(16.5, 16.5 / aspect);
  camera.left = -viewHeight * aspect / 2; camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2; camera.updateProjectionMatrix();
  renderer.setSize(box.width, box.height, false);
}
new ResizeObserver(resize).observe($('scene'));
window.addEventListener('resize', resize); resize();

function renderLevels() {
  const parent = $('levelList'); parent.replaceChildren();
  for (let n = 1; n <= 4; n++) {
    const b = document.createElement('button');
    b.className = `level-tile ${n <= state.unlocked ? 'unlocked' : 'locked'} ${n === state.level ? 'active' : ''}`;
    b.textContent = n <= state.unlocked ? String(n).padStart(2, '0') : '🔒';
    b.title = n <= state.unlocked ? `Уровень ${n}` : 'Сначала пройди предыдущий уровень';
    b.addEventListener('click', () => {
      if (n > state.unlocked) { showToast('Сначала пройди предыдущий уровень'); tone(180, .1, 'triangle'); return; }
      if (state.running) finish(false, 'Выбери уровень после забега');
      state.level = n; updateHud(); showToast(`Выбран уровень ${n}`); tone(540);
    });
    parent.appendChild(b);
  }
}
const toRoman = n => ['I','II','III','IV','V','VI'][Math.min(n, 5)];
function renderLobby() {
  const hero = selectedHero(), rank = heroUpgrade(), cost = 80 + rank * 80;
  $('heroName').textContent = hero.name; $('heroLevel').textContent = `УР. ${rank + 1}`;
  $('lobbyPortrait').src = hero.file; $('lobbyPortrait').alt = hero.name;
  $('rarityTag').textContent = hero.rarity; $('abilityIcon').textContent = hero.icon;
  $('abilityName').textContent = hero.ability; $('abilityDesc').textContent = hero.desc;
  $('mobileAbilityIcon').textContent = hero.icon; $('abilityKey').textContent = 'E';
  $('upgradeCost').textContent = rank >= 5 ? 'MAX' : cost;
  $('upgradeButton').disabled = rank >= 5;
  $('sidePortrait').src = hero.file; $('sideHeroName').textContent = hero.name; $('sideAbility').textContent = hero.ability;
  $('levelBadge').textContent = `УР. ${rank + 1}`; $('upgradeRank').textContent = toRoman(rank + 1);
  $('upgradeProgress').style.width = `${rank * 20}%`;
  $('rosterCount').textContent = `${state.heroes.length}/${heroes.length}`;
  const shelf = $('characterShelf'); shelf.replaceChildren();
  heroes.forEach(h => {
    const unlocked = state.heroes.includes(h.id), button = document.createElement('button');
    button.className = `brawler-card ${unlocked ? '' : 'locked'} ${h.id === state.selectedHero ? 'selected' : ''}`;
    button.title = unlocked ? `${h.name} · ${h.ability}` : 'Заперто в кейсе';
    const img = document.createElement('img'); img.src = h.file; img.alt = h.name;
    const label = document.createElement('span'); label.textContent = unlocked ? h.name : '🔒';
    button.append(img, label);
    if (unlocked) button.addEventListener('click', () => selectHero(h.id));
    else button.addEventListener('click', () => showToast('Открой кейс — внутри новый боец!'));
    shelf.append(button);
  });
}
function buyUpgrade() {
  const rank = heroUpgrade(), cost = 80 + rank * 80;
  if (rank >= 5) { showToast('У этого бойца максимальный уровень'); return; }
  if (state.coins < cost) { showToast(`Для улучшения нужно ${cost} шумиликов`); tone(180, .1, 'triangle'); return; }
  state.coins -= cost; persist(); updateHud();
  $('upgradeSpinTitle').textContent = `Улучшаем ${selectedHero().name}`;
  $('upgradeSpinResult').textContent = 'Колесо выбирает усиление...';
  const wheel = $('upgradeWheel'); wheel.style.transition = 'none'; wheel.style.transform = 'rotate(0deg)';
  $('upgradeModal').classList.remove('hidden');
  const rewards = ['Скорость +', 'Защита +', 'Бонус монет +', 'Способность +'];
  const selected = Math.floor(Math.random() * rewards.length), segment = 360 / rewards.length;
  const rotation = 7 * 360 + (360 - selected * segment - segment / 2);
  requestAnimationFrame(() => { wheel.style.transition = 'transform 3.6s cubic-bezier(.08,.78,.13,1)'; wheel.style.transform = `rotate(${rotation}deg)`; });
  setTimeout(() => {
    state.upgrades[state.selectedHero] = rank + 1; persist(); updateHud(); tone(960, .2);
    $('upgradeSpinResult').textContent = `Усиление «${rewards[selected]}» получено! ${selectedHero().name} теперь ${toRoman(rank + 2)} уровня.`;
    $('upgradeSpinTitle').textContent = 'Улучшение готово!';
  }, 3700);
}
function setDevice(device) {
  state.device = device;
  document.querySelectorAll('[data-device]').forEach(b => b.classList.toggle('selected', b.dataset.device === device));
  $('touchControls').classList.toggle('visible', device === 'phone' && state.running);
  persist();
}
function resetActors() {
  player.group.position.set(-2.9, 0, 2.5);
  monster.group.position.set(3.5, 0, -3.7); monster.group.visible = true;
  coinMeshes.forEach((c, i) => { c.visible = true; c.position.copy(randomPoint(i < 3 ? 2.2 : 1.3)); });
}
function startGame() {
  state.elapsed = 0; state.collected = 0; state.running = true; state.paused = false; state.started = true;
  state.abilityUntil = 0; state.cooldownUntil = 0; state.shieldUntil = 0; state.stunUntil = 0; state.slowUntil = 0; state.decoyUntil = 0;
  resetActors(); $('sceneWrap').classList.add('playing'); $('sceneWrap').classList.remove('paused'); $('endCard').classList.add('hidden'); $('centerCard').classList.add('hidden');
  $('touchControls').classList.toggle('visible', state.device === 'phone');
  updateHud(); tone(660, .1); showToast(`Уровень ${state.level} начался!`);
}
function finish(win, customMessage) {
  state.running = false; state.paused = false; state.touch.clear(); state.keys.clear();
  $('sceneWrap').classList.remove('playing', 'paused'); $('touchControls').classList.remove('visible'); $('endCard').classList.remove('hidden'); $('centerCard').classList.add('hidden');
  const card = $('endCard'); card.classList.toggle('lost', !win);
  if (win) {
    const bonus = 30 + state.level * 10; state.coins += bonus; state.best = Math.max(state.best, state.elapsed);
    if (state.level >= state.unlocked && state.unlocked < 20) state.unlocked++;
    $('endIcon').textContent = '✦'; $('endEyebrow').textContent = 'УРОВЕНЬ ПРОЙДЕН'; $('endTitle').textContent = 'Ты убежал!';
    $('endText').textContent = `Отличная работа — +${bonus} шумиликов. ${state.level < state.unlocked ? 'Открылся новый уровень!' : 'Продолжай в том же духе!'}`;
    state.level = Math.min(state.level + 1, state.unlocked); tone(880, .2);
  } else {
    state.best = Math.max(state.best, state.elapsed); $('endIcon').textContent = '↻'; $('endEyebrow').textContent = 'ЗАБЕГ ОКОНЧЕН';
    $('endTitle').textContent = customMessage || 'Потапенко догнал!'; $('endText').textContent = `Ты продержался ${clockText(state.elapsed)} и собрал ${state.collected} шумиликов. Попробуй ещё раз!`;
    tone(170, .25, 'sawtooth');
  }
  persist(); updateHud();
}
function pauseToggle() {
  if (!state.running) return;
  state.paused = !state.paused; $('sceneWrap').classList.toggle('paused', state.paused);
  $('pauseButton').textContent = state.paused ? '▶' : 'Ⅱ';
  if (state.paused) showToast('Пауза'); else showToast('Продолжаем!');
}
function activateAbility() {
  if (!state.running || state.paused) return;
  if (state.cooldownUntil > state.elapsed) { showToast(`Подожди ${Math.ceil(state.cooldownUntil - state.elapsed)} сек.`); return; }
  const h = selectedHero(), rank = heroUpgrade(), length = h.duration * (1 + rank * .12);
  state.cooldownUntil = state.elapsed + Math.max(7, 13 - rank * .7); state.abilityUntil = state.elapsed + length;
  if (h.kind === 'shield') state.shieldUntil = state.abilityUntil;
  if (h.kind === 'stun') state.stunUntil = state.abilityUntil;
  if (h.kind === 'slow') state.slowUntil = state.abilityUntil;
  if (h.kind === 'decoy') {
    const px = player.group.position.x, pz = player.group.position.z, dx = monster.group.position.x - px, dz = monster.group.position.z - pz, d = Math.hypot(dx, dz) || 1;
    state.decoyPoint = { x: clamp(px + dx / d * 3.2, -ARENA, ARENA), z: clamp(pz + dz / d * 3.2, -ARENA, ARENA) }; state.decoyUntil = state.abilityUntil;
  }
  if (h.kind === 'blink') {
    const dx = player.group.position.x - monster.group.position.x, dz = player.group.position.z - monster.group.position.z, d = Math.hypot(dx, dz) || 1;
    player.group.position.x = clamp(player.group.position.x + dx / d * 3.4, -ARENA, ARENA);
    player.group.position.z = clamp(player.group.position.z + dz / d * 3.4, -ARENA, ARENA);
  }
  $('abilityCooldown').textContent = `${Math.ceil(state.cooldownUntil - state.elapsed)}С`;
  tone(h.kind === 'stun' ? 920 : 680, .16, h.kind === 'stun' ? 'square' : 'sine'); showToast(`${h.icon} ${h.ability}!`);
}

$('playButton').addEventListener('click', startGame); $('againButton').addEventListener('click', startGame); $('pauseButton').addEventListener('click', pauseToggle);
for (const id of ['settingsOpen', 'settingsOpen2']) $(id).addEventListener('click', () => $('settingsModal').classList.remove('hidden'));
$('howButton').addEventListener('click', () => $('infoModal').classList.remove('hidden'));
$('allLevels').addEventListener('click', () => showToast(`Открыто уровней: ${state.unlocked}`));
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => el.closest('.modal').classList.add('hidden')));
document.querySelectorAll('[data-device]').forEach(el => el.addEventListener('click', () => setDevice(el.dataset.device)));
$('logoutButton').addEventListener('click', async () => {
  if (!authToken) { $('authScreen').classList.remove('hidden'); return; }
  clearTimeout(saveTimer);
  try { await apiFetch('/api/save', {method:'POST', body:JSON.stringify({game:serializeGame()})}); } catch { }
  try { await apiFetch('/api/logout', {method:'POST', body:'{}'}); } catch { }
  invalidateSession('Ты вышел из аккаунта.'); setAuthMode('login');
});
$('authSwitch').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
$('authForm').addEventListener('submit', async e => {
  e.preventDefault(); $('authError').textContent = ''; $('authSubmit').disabled = true;
  try {
    const path = authMode === 'register' ? '/api/register' : '/api/login';
    const payload = await apiFetch(path, {method:'POST', body:JSON.stringify({username:$('authUsername').value, password:$('authPassword').value})});
    await connectSession(payload); $('authPassword').value = '';
  } catch (error) { $('authError').textContent = error.message; }
  finally { $('authSubmit').disabled = false; }
});
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  state.mode = button.dataset.mode; document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('selected', b === button));
  persist(); updateHud(); showToast(state.mode === 'arcade' ? 'Аркада: продержись 60 секунд!' : 'Режим уровней выбран');
}));
$('adminOpen').addEventListener('click', async () => { $('adminModal').classList.remove('hidden'); await refreshAdmin(); });
for (const id of ['adminGiveCoins','adminTakeCoins','adminGiveHero','adminBan','adminUnban']) $(id).addEventListener('click', () => runAdminAction(id));
$('volume').value = state.volume; $('volumeValue').textContent = `${state.volume}%`;
$('volume').addEventListener('input', e => { state.volume = Number(e.target.value); $('volumeValue').textContent = `${state.volume}%`; persist(); });
setDevice(state.device); updateHud();
selectHero(state.heroes.includes(state.selectedHero) ? state.selectedHero : state.heroes[0]);
$('upgradeButton').addEventListener('click', buyUpgrade); $('quickUpgrade').addEventListener('click', buyUpgrade);
$('abilityButton').addEventListener('pointerdown', e => { e.preventDefault(); activateAbility(); });

async function refreshAdmin() {
  try {
    const data = await apiFetch('/api/admin/users'); const select = $('adminTarget'), old = select.value; select.replaceChildren();
    const list = $('adminUsers'); list.replaceChildren();
    for (const user of data.users) {
      const option = document.createElement('option'); option.value = user.username; option.textContent = user.username; select.append(option);
      const row = document.createElement('div'); row.className = `admin-user ${user.banned ? 'banned' : ''}`;
      row.textContent = `${user.username}${user.admin ? ' · owner' : ''} · ${user.game?.coins || 0} шумиликов${user.banned ? ' · БАН' : ''}`; list.append(row);
    }
    if ([...select.options].some(option => option.value === old)) select.value = old;
  } catch (error) { $('adminMessage').textContent = error.message; }
}
async function runAdminAction(buttonId) {
  const target = $('adminTarget').value, amount = Number($('adminAmount').value || 0);
  const action = buttonId === 'adminGiveCoins' ? 'adjust_coins' : buttonId === 'adminTakeCoins' ? 'adjust_coins' : buttonId === 'adminGiveHero' ? 'grant_hero' : buttonId === 'adminBan' ? 'ban' : 'unban';
  const payload = {action, target};
  if (action === 'adjust_coins') payload.amount = buttonId === 'adminGiveCoins' ? Math.abs(amount) : -Math.abs(amount);
  if (action === 'grant_hero') payload.heroId = Number($('adminHero').value);
  try {
    await apiFetch('/api/admin/action', {method:'POST', body:JSON.stringify(payload)});
    $('adminMessage').textContent = 'Готово. Изменения сохранены.'; tone(780);
    await refreshAdmin();
    if (target === account?.username) {
      const current = await apiFetch('/api/me'); account = current.user; applyGameData(current.user.game); updateAccountBadge();
    }
  } catch (error) { $('adminMessage').textContent = error.message; }
}

$('openCase').addEventListener('click', () => {
  if ($('openCase').disabled) return;
  const price = 120;
  if (state.coins < price) { showToast(`Нужно ${price} шумиликов для кейса`); tone(180, .1, 'triangle'); return; }
  $('openCase').disabled = true; state.coins -= 120;
  const available = heroes.filter(h => !state.heroes.includes(h.id));
  $('openCase').classList.add('opening'); tone(340, .18, 'triangle');
  setTimeout(() => {
    $('openCase').classList.remove('opening'); $('openCase').disabled = false;
    if (available.length) {
      const prize = available[Math.floor(Math.random() * available.length)]; state.heroes.push(prize.id);
      $('rewardPortrait').src = prize.file; $('rewardTitle').textContent = `Новый боец: ${prize.name}!`;
      $('rewardDesc').textContent = `${prize.rarity} · способность «${prize.ability}». Теперь он доступен в коллекции.`;
      selectHero(prize.id);
    } else {
      state.coins += 150; $('rewardPortrait').src = selectedHero().file; $('rewardTitle').textContent = 'Дубликат превращён в монеты!';
      $('rewardDesc').textContent = 'Все бойцы уже в коллекции — получи 150 шумиликов.';
    }
    persist(); updateHud(); $('rewardModal').classList.remove('hidden'); tone(740, .2);
  }, 1250);
});

const keyMap = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape' || e.code === 'Space') { if (state.running) pauseToggle(); return; }
  if (e.code === 'KeyE' && state.running && !state.paused) { activateAbility(); return; }
  if (keyMap[e.code]) state.keys.add(keyMap[e.code]);
});
window.addEventListener('keyup', e => { if (keyMap[e.code]) state.keys.delete(keyMap[e.code]); });
const joystick = $('joystick'), joyKnob = $('joyKnob'); let joystickPointer = null;
function updateJoystick(e) {
  const rect = joystick.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const max = rect.width * .31, dx = e.clientX - cx, dy = e.clientY - cy, length = Math.hypot(dx, dy), ratio = length > max ? max / length : 1;
  const x = dx * ratio, y = dy * ratio; joyKnob.style.transform = `translate(${x}px, ${y}px)`;
  state.touchX = x / max; state.touchZ = y / max;
}
joystick.addEventListener('pointerdown', e => { e.preventDefault(); joystickPointer = e.pointerId; joystick.setPointerCapture(e.pointerId); updateJoystick(e); });
joystick.addEventListener('pointermove', e => { if (e.pointerId === joystickPointer) updateJoystick(e); });
function clearJoystick() { joystickPointer = null; joyKnob.style.transform = 'translate(0,0)'; state.touchX = 0; state.touchZ = 0; }
for (const type of ['pointerup','pointercancel','lostpointercapture']) joystick.addEventListener(type, clearJoystick);

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), .05), t = performance.now() / 1000;
  for (const c of coinMeshes) if (c.visible) { c.rotation.y += dt * .55; c.position.y = .3 + Math.sin(t * 2.6 + c.userData.seed) * .07; }
  player.group.position.y = Math.sin(t * 3.4) * .045;
  if (state.running && !state.paused) {
    state.elapsed += dt;
    const hero = selectedHero(), rank = heroUpgrade(), boosted = state.elapsed < state.abilityUntil;
    scooter.visible = boosted && hero.kind === 'scooter';
    abilityAura.visible = boosted && hero.kind !== 'scooter'; abilityAura.rotation.z += dt * 2.5;
    abilityAura.scale.setScalar(1 + Math.sin(t * 8) * .06);
    stunAura.visible = state.elapsed < state.stunUntil; stunAura.rotation.z -= dt * 3;
    if (scooter.visible) { scooter.rotation.y = Math.sin(t * 8) * .06; scooter.children.slice(1,3).forEach(w => { w.rotation.x += dt * 13; }); }
    let dx = 0, dz = 0;
    if (state.keys.has('left') || state.touch.has('left')) dx--;
    if (state.keys.has('right') || state.touch.has('right')) dx++;
    if (state.keys.has('up') || state.touch.has('up')) dz--;
    if (state.keys.has('down') || state.touch.has('down')) dz++;
    dx += state.touchX; dz += state.touchZ;
    const len = Math.hypot(dx, dz) || 1;
    let speed = 4.15 + Math.min(state.level, 8) * .12 + rank * .18;
    if (boosted && ['scooter','surge','dash'].includes(hero.kind)) speed *= hero.kind === 'dash' ? 2.8 : 2.15;
    player.group.position.x = clamp(player.group.position.x + dx / len * speed * dt, -ARENA, ARENA);
    player.group.position.z = clamp(player.group.position.z + dz / len * speed * dt, -ARENA, ARENA);
    const target = state.elapsed < state.decoyUntil && state.decoyPoint ? state.decoyPoint : player.group.position;
    const vx = target.x - monster.group.position.x, vz = target.z - monster.group.position.z;
    const distance = Math.hypot(vx, vz) || 1;
    let monsterSpeed = 1.25 + Math.min(state.level, 10) * .16 + state.elapsed * (state.mode === 'arcade' ? .045 : .006);
    if (state.elapsed < state.slowUntil) monsterSpeed *= .42;
    if (state.elapsed < state.stunUntil) monsterSpeed = 0;
    monster.group.position.x = clamp(monster.group.position.x + vx / distance * monsterSpeed * dt, -ARENA, ARENA);
    monster.group.position.z = clamp(monster.group.position.z + vz / distance * monsterSpeed * dt, -ARENA, ARENA);
    monster.group.rotation.y = Math.atan2(vx, vz);
    const magnetActive = boosted && hero.kind === 'magnet';
    for (const c of coinMeshes) {
      const coinDistance = Math.hypot(player.group.position.x - c.position.x, player.group.position.z - c.position.z);
      if (magnetActive && c.visible && coinDistance < 5.4) {
        c.position.x += (player.group.position.x - c.position.x) * dt * 2.5;
        c.position.z += (player.group.position.z - c.position.z) * dt * 2.5;
      }
      if (c.visible && Math.hypot(player.group.position.x - c.position.x, player.group.position.z - c.position.z) < (magnetActive ? .95 : .88)) {
        state.coins++; state.collected++; tone(720 + (state.collected % 4) * 90, .06);
        const wallet = document.querySelector('.wallet'); wallet.classList.remove('coin-pop'); void wallet.offsetWidth; wallet.classList.add('coin-pop');
        c.position.copy(randomPoint(2, player.group.position, 2.8)); c.visible = true; updateHud(); persist();
      }
    }
    const playerDistance = Math.hypot(player.group.position.x - monster.group.position.x, player.group.position.z - monster.group.position.z);
    if (playerDistance < 1.02 && state.elapsed >= state.shieldUntil && state.elapsed >= state.stunUntil) finish(false);
    else if (state.mode === 'arcade' ? state.elapsed >= 60 : (state.elapsed >= LEVEL_TIME && state.collected >= LEVEL_GOAL)) finish(true);
    $('timer').textContent = clockText(state.elapsed);
    $('abilityCooldown').textContent = state.cooldownUntil <= state.elapsed ? 'ГОТОВО' : `${Math.ceil(state.cooldownUntil - state.elapsed)}С`;
    $('abilityButton').classList.toggle('ready', state.cooldownUntil <= state.elapsed);
  }
  renderer.render(scene, camera);
}
frame();
