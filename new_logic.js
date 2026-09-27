// ==================== 应用状态 ====================
let appState = {
    // 用户数据
    userData: {
        profile: { nickname: '', avatar: '' },
        streakDays: 0,
        lastStudyDate: null,
        studyRecords: {},      // { '2026-09-27': { minutes: 30, words: 20 } }
        wordStatus: {},        // { 'hola': 'known'/'fuzzy'/'unknown' }
        libraryProgress: {},   // { 'level:A1': { words, index, results, poolOffset, chapterIndex } }
        poolOffsets: {},       // { 'level:A1': 40 } 已学到词池的位置
        textbookCursor: {},    // { 'textbook:xxx': 1 } 课本下一课游标
        settings: {
            autoSpeak: true,
            showPhonetic: true,
            showExample: true,
            dailyGoal: 20
        }
    },

    // 当前学习状态
    currentLibrary: null,
    currentWords: [],
    fullWordPool: [],
    poolOffset: 0,
    currentChapters: null,
    currentChapterIndex: 0,
    currentIndex: 0,
    typingAttempts: 0,
    studyResults: { known: 0, fuzzy: 0, unknown: 0 },
    studying: false,
    studyLabel: '',
    modalLibrary: null,
    wordIndex: {},

    // 测试状态
    testWords: [],
    testIndex: 0,
    testResults: { correct: 0, wrong: 0 },

    // 计时器
    studyStartTime: null,
    todayMinutes: 0,
    timerInterval: null,

    // 日历
    currentCalendarDate: new Date()
};

// ==================== 工具函数 ====================
// 归一化答案：忽略大小写、重音符号和多余空格（方便键盘打字）
function normalizeAnswer(s) {
    return (s || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function getTodayString() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function isActiveDay(dateStr) {
    const rec = appState.userData.studyRecords[dateStr];
    return rec && ((rec.minutes || 0) >= 1 || (rec.words || 0) >= 1);
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showNotification(message, type = 'info') {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = `notification ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2500);
}

// ==================== 语音 ====================
function speakWord(word) {
    if (!('speechSynthesis' in window)) {
        showNotification('当前浏览器不支持语音播放', 'error');
        return;
    }
    try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(word);
        u.lang = 'es-ES';
        u.rate = 0.85;
        const voices = window.speechSynthesis.getVoices();
        const esVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('es'));
        if (esVoice) u.voice = esVoice;
        window.speechSynthesis.speak(u);
    } catch (e) {
        console.warn('语音播放失败', e);
    }
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
}

// ==================== 初始化 ====================
function init() {
    loadUserData();
    buildWordIndex();
    renderLibrary();
    initNavigation();
    initCalendar();
    initSettings();
    initAccount();
    updateStats();
    updateLibraryView();
}

function loadUserData() {
    try {
        const saved = localStorage.getItem('spanishLearningData');
        if (saved) {
            const data = JSON.parse(saved);
            appState.userData = { ...appState.userData, ...data };
            appState.userData.profile = { nickname: '', avatar: '', ...(data.profile || {}) };
            appState.userData.settings = {
                autoSpeak: true, showPhonetic: true, showExample: true, dailyGoal: 20,
                ...(data.settings || {})
            };
            appState.userData.libraryProgress = data.libraryProgress || {};
            appState.userData.poolOffsets = data.poolOffsets || {};
            appState.userData.textbookCursor = data.textbookCursor || {};
            if (!appState.userData.studyRecords) appState.userData.studyRecords = {};
            if (!appState.userData.wordStatus) appState.userData.wordStatus = {};
        }
    } catch (e) {
        console.warn('读取本地数据失败，将使用新数据', e);
    }

    const today = getTodayString();
    if (appState.userData.studyRecords[today]) {
        appState.todayMinutes = appState.userData.studyRecords[today].minutes || 0;
    }
    calculateStreak();
}

function saveUserData() {
    try {
        localStorage.setItem('spanishLearningData', JSON.stringify(appState.userData));
    } catch (e) {
        console.warn('保存数据失败（可能处于隐私/沙箱模式）', e);
    }
}

function calculateStreak() {
    let streak = 0;
    const date = new Date();
    const today = getTodayString();
    if (!isActiveDay(today)) date.setDate(date.getDate() - 1);
    while (true) {
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (isActiveDay(dateStr)) {
            streak++;
            date.setDate(date.getDate() - 1);
        } else {
            break;
        }
    }
    appState.userData.streakDays = streak;
}

function calcMaxStreak() {
    const dates = Object.keys(appState.userData.studyRecords).filter(isActiveDay).sort();
    let max = 0, cur = 0, prev = null;
    for (const d of dates) {
        if (prev) {
            const diff = (new Date(d) - new Date(prev)) / 86400000;
            cur = (diff === 1) ? cur + 1 : 1;
        } else {
            cur = 1;
        }
        max = Math.max(max, cur);
        prev = d;
    }
    return max;
}

function updateStats() {
    updateTodayTimeDisplay();
    document.getElementById('totalWords').textContent = Object.keys(appState.userData.wordStatus).length;
    document.getElementById('streakDays').textContent = appState.userData.streakDays;
}

// ==================== 词条索引 ====================
function buildWordIndex() {
    appState.wordIndex = {};
    const add = w => { if (w && w.spanish && !appState.wordIndex[w.spanish]) appState.wordIndex[w.spanish] = w; };
    Object.values(vocabularyData.levels).forEach(lv => lv.words.forEach(add));
    Object.values(vocabularyData.topics).forEach(tp => tp.words.forEach(add));
    Object.values(vocabularyData.textbooks).forEach(bk => Object.values(bk.chapters).forEach(ws => ws.forEach(add)));
}

function findWord(spanish) {
    return appState.wordIndex[spanish] || null;
}

// ==================== 导航 ====================
function initNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const section = tab.dataset.section;
            if (section === 'test' && !appState.currentWords.length) {
                showNotification('请先在「词库」选择内容并开始学习', 'info');
                switchSection('library');
                return;
            }
            switchSection(section);
        });
    });

    // 学习视图按钮
    document.getElementById('exit-study-btn').addEventListener('click', exitStudy);
    document.getElementById('next-chapter-btn').addEventListener('click', nextChapter);
    document.getElementById('start-test-btn').addEventListener('click', () => {
        switchSection('test');
        startTest();
    });
    document.getElementById('review-btn').addEventListener('click', beginRound);

    // 测试完成按钮
    document.getElementById('retest-btn').addEventListener('click', startTest);
    document.getElementById('back-study-btn').addEventListener('click', () => switchSection('library'));

    // 弹窗按钮
    document.getElementById('library-modal-close').addEventListener('click', closeAllModals);
    document.getElementById('word-modal-close').addEventListener('click', () => {
        document.getElementById('word-modal').classList.add('hidden');
    });
    document.getElementById('modal-start-btn').addEventListener('click', () => {
        if (!appState.modalLibrary) return;
        const { type, key } = appState.modalLibrary;
        closeAllModals();
        startStudyFor(type, key);
    });
    document.getElementById('library-modal').addEventListener('click', (e) => {
        if (e.target.id === 'library-modal') closeAllModals();
    });
    document.getElementById('word-modal').addEventListener('click', (e) => {
        if (e.target.id === 'word-modal') e.currentTarget.classList.add('hidden');
    });
}

function switchSection(sectionName) {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.section === sectionName);
    });
    document.querySelectorAll('.section').forEach(section => {
        section.classList.toggle('active', section.id === `${sectionName}-section`);
    });
    if (sectionName === 'library') updateLibraryView();
    if (sectionName === 'calendar') renderCalendar();
}

function updateLibraryView() {
    document.getElementById('library-grid-view').classList.toggle('hidden', appState.studying);
    document.getElementById('library-study-view').classList.toggle('hidden', !appState.studying);
}

// ==================== 词库渲染 ====================
function renderLibrary() {
    const levelContainer = document.getElementById('level-library');
    levelContainer.innerHTML = '';
    Object.entries(vocabularyData.levels).forEach(([key, level]) => {
        const badge = `<span class="level-badge level-${key.toLowerCase()}">${key}</span>`;
        levelContainer.appendChild(createLibraryCard('level', key, level.name, level.icon, level.words.length, badge));
    });

    const textbookContainer = document.getElementById('textbook-library');
    textbookContainer.innerHTML = '';
    Object.entries(vocabularyData.textbooks).forEach(([key, book]) => {
        const total = Object.values(book.chapters).flat().length;
        textbookContainer.appendChild(createLibraryCard('textbook', key, book.name, book.icon, total, ''));
    });

    const topicContainer = document.getElementById('topic-library');
    topicContainer.innerHTML = '';
    Object.entries(vocabularyData.topics).forEach(([key, topic]) => {
        topicContainer.appendChild(createLibraryCard('topic', key, topic.name, topic.icon, topic.words.length, ''));
    });
}

function hasProgress(libId) {
    const p = appState.userData.libraryProgress[libId];
    return p && p.index < p.words.length;
}

function createLibraryCard(type, key, name, icon, wordCount, badge) {
    const card = document.createElement('div');
    card.className = 'library-card';
    card.dataset.type = type;
    card.dataset.key = key;

    const libId = type + ':' + key;
    const resumable = hasProgress(libId);

    card.innerHTML = `
        <h3>${icon} ${escapeHtml(name)} ${badge}</h3>
        <p>双击卡片查看词汇列表</p>
        <span class="word-count">${wordCount} 个单词</span>
        <div class="card-actions">
            <button class="card-btn ${resumable ? 'btn-continue' : 'btn-start'}">${resumable ? '▶ 继续学习' : '▶ 开始学习'}</button>
        </div>
    `;

    const btn = card.querySelector('.card-btn');
    btn.addEventListener('click', (e) => { e.stopPropagation(); startStudyFor(type, key); });
    btn.addEventListener('dblclick', (e) => e.stopPropagation());
    card.addEventListener('click', () => selectLibrary(card));
    card.addEventListener('dblclick', () => openLibraryModal(type, key));

    return card;
}

// 单击卡片：选中（作为测试范围）
function selectLibrary(card) {
    document.querySelectorAll('.library-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');

    const type = card.dataset.type;
    const key = card.dataset.key;
    appState.currentLibrary = { type, key };

    const goal = appState.userData.settings.dailyGoal || 20;
    if (type === 'level') {
        appState.currentWords = vocabularyData.levels[key].words.slice(0, goal);
        appState.currentChapters = null;
    } else if (type === 'topic') {
        appState.currentWords = vocabularyData.topics[key].words.slice(0, goal);
        appState.currentChapters = null;
    } else {
        const chapters = vocabularyData.textbooks[key].chapters;
        appState.currentWords = [...Object.values(chapters)[0]];
        appState.currentChapters = null;
    }
}

// ==================== 学习流程 ====================
function startStudyFor(type, key) {
    const libId = type + ':' + key;
    if (hasProgress(libId)) {
        resumeRound(libId);
        return;
    }

    appState.currentLibrary = { type, key };
    if (type === 'level' || type === 'topic') {
        const pool = type === 'level' ? vocabularyData.levels[key].words : vocabularyData.topics[key].words;
        appState.fullWordPool = [...pool];
        appState.poolOffset = appState.userData.poolOffsets[libId] || 0;
        if (appState.poolOffset >= appState.fullWordPool.length) appState.poolOffset = 0;
        appState.currentWords = takePoolChunk();
        appState.currentChapters = null;
        appState.currentChapterIndex = 0;
    } else {
        const book = vocabularyData.textbooks[key];
        appState.currentChapters = Object.keys(book.chapters).map(name => ({ name, words: book.chapters[name] }));
        let ci = appState.userData.textbookCursor[libId] || 0;
        if (ci >= appState.currentChapters.length) ci = 0;
        appState.currentChapterIndex = ci;
        appState.currentWords = [...appState.currentChapters[ci].words];
        appState.fullWordPool = [];
        appState.poolOffset = 0;
    }
    beginRound();
}

function resumeRound(libId) {
    const prog = appState.userData.libraryProgress[libId];
    if (!prog) return;
    const idx = libId.indexOf(':');
    const type = libId.slice(0, idx);
    const key = libId.slice(idx + 1);

    appState.currentLibrary = { type, key };
    appState.currentWords = prog.words.map(s => findWord(s)).filter(Boolean);
    appState.currentIndex = prog.index;
    appState.studyResults = prog.results || { known: 0, fuzzy: 0, unknown: 0 };
    appState.studying = true;

    if (type === 'level' || type === 'topic') {
        const pool = type === 'level' ? vocabularyData.levels[key].words : vocabularyData.topics[key].words;
        appState.fullWordPool = [...pool];
        appState.poolOffset = prog.poolOffset || 0;
        appState.currentChapters = null;
        appState.currentChapterIndex = 0;
    } else {
        const book = vocabularyData.textbooks[key];
        appState.currentChapters = Object.keys(book.chapters).map(name => ({ name, words: book.chapters[name] }));
        appState.currentChapterIndex = prog.chapterIndex || 0;
        appState.fullWordPool = [];
        appState.poolOffset = 0;
    }

    switchSection('library');
    startTimer();
    document.getElementById('study-completion').classList.add('hidden');
    document.getElementById('study-area').classList.remove('hidden');
    document.getElementById('typing-area').classList.add('hidden');
    closeAllModals();
    setStudyLabel();
    showCurrentWord();
    showNotification('已恢复上次进度，继续加油！', 'info');
}

function beginRound() {
    appState.currentIndex = 0;
    appState.typingAttempts = 0;
    appState.studyResults = { known: 0, fuzzy: 0, unknown: 0 };
    appState.studying = true;
    setStudyLabel();
    saveRoundProgress();
    switchSection('library');
    startTimer();
    document.getElementById('study-completion').classList.add('hidden');
    document.getElementById('study-area').classList.remove('hidden');
    document.getElementById('typing-area').classList.add('hidden');
    closeAllModals();
    showCurrentWord();
}

function setStudyLabel() {
    const { type, key } = appState.currentLibrary;
    let label = '';
    if (type === 'level') label = vocabularyData.levels[key].name;
    else if (type === 'topic') label = vocabularyData.topics[key].name;
    else {
        const book = vocabularyData.textbooks[key];
        label = `${book.name} · ${appState.currentChapters[appState.currentChapterIndex].name}`;
    }
    appState.studyLabel = label;
    document.getElementById('study-lib-name').textContent = label;
}

function takePoolChunk() {
    const goal = appState.userData.settings.dailyGoal || 20;
    const chunk = appState.fullWordPool.slice(appState.poolOffset, appState.poolOffset + goal);
    appState.poolOffset += chunk.length;
    return chunk;
}

function saveRoundProgress() {
    if (!appState.currentLibrary || !appState.currentWords.length) return;
    const libId = appState.currentLibrary.type + ':' + appState.currentLibrary.key;
    appState.userData.libraryProgress[libId] = {
        words: appState.currentWords.map(w => w.spanish),
        index: appState.currentIndex,
        results: appState.studyResults,
        poolOffset: appState.poolOffset,
        chapterIndex: appState.currentChapterIndex,
        updatedAt: Date.now()
    };
    saveUserData();
    renderLibrary();
}

function exitStudy() {
    stopAndSaveTimer();
    if (appState.studying) saveRoundProgress();
    appState.studying = false;
    switchSection('library');
    showNotification('进度已保存，随时可以继续学习', 'info');
}

function showCurrentWord() {
    const word = appState.currentWords[appState.currentIndex];
    if (!word) {
        showStudyCompletion();
        return;
    }

    appState.typingAttempts = 0;
    const settings = appState.userData.settings;
    const studyArea = document.getElementById('study-area');

    studyArea.innerHTML = `
        <div class="word-card">
            <div class="spanish-word">${word.spanish}</div>
            ${word.phonetic && settings.showPhonetic ? `<div class="word-phonetic">${word.phonetic}</div>` : ''}
            <button class="audio-btn" onclick="speakWord('${word.spanish}')">🔊</button>
            <div class="chinese-meaning">${word.chinese}</div>
            ${word.example && settings.showExample ? `<div class="word-example">"${word.example}"</div>` : ''}
        </div>
        <div class="study-buttons">
            <button class="study-btn btn-known" onclick="markWord('known')">✓ 学过了</button>
            <button class="study-btn btn-fuzzy" onclick="markWord('fuzzy')">~ 模糊</button>
            <button class="study-btn btn-unknown" onclick="markWord('unknown')">✗ 不认识</button>
        </div>
    `;

    document.getElementById('typing-area').classList.add('hidden');
    updateStudyProgress();

    if (settings.autoSpeak) {
        setTimeout(() => speakWord(word.spanish), 500);
    }
}

function updateStudyProgress() {
    const total = appState.currentWords.length;
    const cur = Math.min(appState.currentIndex, total);
    document.getElementById('study-progress-text').textContent = `${cur} / ${total}`;
    document.getElementById('study-progress').style.width = total ? `${(cur / total) * 100}%` : '0%';
}

function markWord(status) {
    const word = appState.currentWords[appState.currentIndex];

    appState.userData.wordStatus[word.spanish] = status;
    appState.studyResults[status]++;

    const today = getTodayString();
    if (!appState.userData.studyRecords[today]) {
        appState.userData.studyRecords[today] = { minutes: 0, words: 0 };
    }
    appState.userData.studyRecords[today].words++;

    saveRoundProgress();

    if (status === 'known') {
        appState.currentIndex++;
        showCurrentWord();
    } else {
        appState.typingAttempts = 0;
        showTypingPractice(word);
    }
}

function showTypingPractice(word) {
    const studyArea = document.getElementById('study-area');
    studyArea.innerHTML = `
        <div class="word-card">
            <div class="chinese-meaning" style="font-size: 2.5rem;">${word.chinese}</div>
            <button class="audio-btn" onclick="speakWord('${word.spanish}')">🔊</button>
            ${word.phonetic ? `<div class="word-phonetic">${word.phonetic}</div>` : ''}
        </div>
    `;

    const typingArea = document.getElementById('typing-area');
    typingArea.classList.remove('hidden');

    const input = document.getElementById('typing-input');
    input.value = '';
    input.className = 'typing-input';

    const feedback = document.getElementById('typing-feedback');
    feedback.textContent = '输入西语单词，按回车确认';
    feedback.style.color = '';

    const newInput = input.cloneNode(true);
    input.replaceWith(newInput);

    newInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            checkTyping(word, newInput.value.trim().toLowerCase());
        }
    });

    newInput.focus();
}

function checkTyping(word, value) {
    const input = document.getElementById('typing-input');
    const feedback = document.getElementById('typing-feedback');
    if (!value || input.disabled) return;

    appState.typingAttempts++;

    if (normalizeAnswer(value) === normalizeAnswer(word.spanish)) {
        input.className = 'typing-input correct';
        feedback.textContent = '✅ 正确！继续加油';
        feedback.style.color = 'var(--success)';
        if (appState.userData.settings.autoSpeak) speakWord(word.spanish);
        setTimeout(() => {
            appState.currentIndex++;
            showCurrentWord();
        }, 700);
    } else if (appState.typingAttempts >= 2) {
        input.className = 'typing-input';
        input.value = '';
        feedback.innerHTML = `正确答案：<strong style="color:var(--primary);font-size:1.2rem;">${word.spanish}</strong>，请照着输入`;
        input.focus();
    } else {
        input.className = 'typing-input incorrect';
        feedback.textContent = '❌ 不对哦，再试一次（回车确认）';
        feedback.style.color = 'var(--primary)';
        input.select();
    }
}

function showStudyCompletion() {
    stopAndSaveTimer();
    appState.studying = false;

    // 本轮完成：清除进行中进度，推进游标
    if (appState.currentLibrary) {
        const libId = appState.currentLibrary.type + ':' + appState.currentLibrary.key;
        delete appState.userData.libraryProgress[libId];
        if (appState.currentLibrary.type === 'textbook') {
            appState.userData.textbookCursor[libId] = (appState.currentChapterIndex + 1) % appState.currentChapters.length;
        } else {
            appState.userData.poolOffsets[libId] = appState.poolOffset;
        }
    }
    saveUserData();
    renderLibrary();
    updateStats();

    document.getElementById('study-area').classList.add('hidden');
    document.getElementById('typing-area').classList.add('hidden');
    document.getElementById('study-completion').classList.remove('hidden');

    document.getElementById('learned-count').textContent = appState.studyResults.known;
    document.getElementById('fuzzy-count').textContent = appState.studyResults.fuzzy;
    document.getElementById('unknown-count').textContent = appState.studyResults.unknown;
}

// 学习下一组 / 下一课
function nextChapter() {
    if (appState.currentChapters && appState.currentChapterIndex < appState.currentChapters.length - 1) {
        appState.currentChapterIndex++;
        const ch = appState.currentChapters[appState.currentChapterIndex];
        appState.currentWords = [...ch.words];
        showNotification(`进入「${ch.name}」`, 'info');
        beginRound();
        return;
    }

    if (!appState.currentChapters && appState.poolOffset < appState.fullWordPool.length) {
        appState.currentWords = takePoolChunk();
        beginRound();
        return;
    }

    // 没有新内容：用没掌握的单词再来一轮
    const pool = appState.currentChapters
        ? appState.currentChapters.flatMap(c => c.words)
        : appState.fullWordPool;
    const weak = pool.filter(w => appState.userData.wordStatus[w.spanish] !== 'known');

    if (weak.length > 0) {
        appState.currentWords = shuffle(weak);
        showNotification(`用 ${weak.length} 个没掌握的单词再来一轮！`, 'info');
        beginRound();
    } else {
        showNotification('太厉害了，本内容已全部掌握！去测试检验一下吧 🎉', 'success');
        switchSection('test');
        startTest();
    }
}

// ==================== 计时器 ====================
function startTimer() {
    if (!appState.studyStartTime) {
        appState.studyStartTime = Date.now();
    }
    if (appState.timerInterval) {
        clearInterval(appState.timerInterval);
    }
    appState.timerInterval = setInterval(() => {
        const elapsed = Date.now() - appState.studyStartTime;
        if (elapsed >= 60000) {
            const mins = Math.floor(elapsed / 60000);
            appState.studyStartTime += mins * 60000;
            addStudyMinutes(mins);
        }
        updateTodayTimeDisplay();
    }, 1000);
    updateTodayTimeDisplay();
}

function addStudyMinutes(mins) {
    const today = getTodayString();
    if (!appState.userData.studyRecords[today]) {
        appState.userData.studyRecords[today] = { minutes: 0, words: 0 };
    }
    appState.userData.studyRecords[today].minutes += mins;
    appState.todayMinutes = appState.userData.studyRecords[today].minutes;
    saveUserData();
    calculateStreak();
}

function updateTodayTimeDisplay() {
    let running = 0;
    if (appState.studyStartTime) {
        running = Math.floor((Date.now() - appState.studyStartTime) / 60000);
    }
    document.getElementById('todayTime').textContent = appState.todayMinutes + running;
}

function stopAndSaveTimer() {
    if (appState.studyStartTime) {
        const mins = Math.floor((Date.now() - appState.studyStartTime) / 60000);
        if (mins > 0) addStudyMinutes(mins);
        appState.studyStartTime = null;
    }
    if (appState.timerInterval) {
        clearInterval(appState.timerInterval);
        appState.timerInterval = null;
    }
    updateTodayTimeDisplay();
}

window.addEventListener('beforeunload', () => {
    if (appState.studyStartTime) {
        const mins = Math.floor((Date.now() - appState.studyStartTime) / 60000);
        if (mins > 0) {
            const today = getTodayString();
            if (!appState.userData.studyRecords[today]) {
                appState.userData.studyRecords[today] = { minutes: 0, words: 0 };
            }
            appState.userData.studyRecords[today].minutes += mins;
            try {
                localStorage.setItem('spanishLearningData', JSON.stringify(appState.userData));
            } catch (e) { /* 忽略 */ }
        }
    }
});

// ==================== 测试模式 ====================
function startTest() {
    if (!appState.currentWords.length) {
        showNotification('请先在「词库」选择内容并开始学习', 'error');
        switchSection('library');
        return;
    }

    appState.testWords = shuffle(appState.currentWords);
    appState.testIndex = 0;
    appState.testResults = { correct: 0, wrong: 0 };

    document.getElementById('test-completion').classList.add('hidden');
    document.getElementById('test-area').classList.remove('hidden');

    showTestQuestion();
}

function showTestQuestion() {
    const word = appState.testWords[appState.testIndex];
    if (!word) {
        showTestCompletion();
        return;
    }

    updateTestProgress();

    const area = document.getElementById('test-area');
    area.innerHTML = `
        <p class="test-question">“${word.chinese}” 的西语是？</p>
        <input type="text" class="test-input" id="test-input" placeholder="输入西语单词..." autocomplete="off" spellcheck="false" autocapitalize="off">
        <div id="test-feedback" style="margin-bottom: 15px;"></div>
        <div>
            <button class="hint-btn" id="hint-btn">💡 听发音提示</button>
            <button class="submit-btn" id="submit-test-btn">提交答案</button>
        </div>
    `;

    document.getElementById('hint-btn').addEventListener('click', function () {
        this.style.display = 'none';
        document.getElementById('test-feedback').innerHTML =
            `<button class="audio-btn" onclick="speakWord('${word.spanish}')">🔊</button>`;
        speakWord(word.spanish);
    });

    const input = document.getElementById('test-input');
    const submitBtn = document.getElementById('submit-test-btn');

    submitBtn.addEventListener('click', () => submitTestAnswer(word));
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitTestAnswer(word);
    });
    input.focus();
}

function submitTestAnswer(word) {
    const input = document.getElementById('test-input');
    const feedback = document.getElementById('test-feedback');
    const value = input.value.trim();
    if (!value || input.disabled) return;

    input.disabled = true;
    document.getElementById('submit-test-btn').disabled = true;

    if (normalizeAnswer(value) === normalizeAnswer(word.spanish)) {
        appState.testResults.correct++;
        feedback.innerHTML = '<span style="color: var(--success); font-weight: bold; font-size: 1.2rem;">✅ 回答正确！</span>';
        setTimeout(nextTestQuestion, 800);
    } else {
        appState.testResults.wrong++;
        feedback.innerHTML = `
            <div style="color: var(--primary); font-weight: bold; margin-bottom: 5px;">❌ 正确答案：${word.spanish}</div>
            <button class="audio-btn" onclick="speakWord('${word.spanish}')">🔊</button>
        `;
        speakWord(word.spanish);
        setTimeout(nextTestQuestion, 2500);
    }
}

function nextTestQuestion() {
    appState.testIndex++;
    if (appState.testIndex >= appState.testWords.length) {
        showTestCompletion();
    } else {
        showTestQuestion();
    }
}

function updateTestProgress() {
    const total = appState.testWords.length;
    const cur = Math.min(appState.testIndex + 1, total);
    document.getElementById('test-progress-text').textContent = `${cur} / ${total}`;
    document.getElementById('test-progress').style.width = total ? `${((appState.testIndex) / total) * 100}%` : '0%';
}

function showTestCompletion() {
    document.getElementById('test-area').classList.add('hidden');
    document.getElementById('test-completion').classList.remove('hidden');

    const { correct, wrong } = appState.testResults;
    const total = correct + wrong;
    const rate = total ? Math.round((correct / total) * 100) : 0;

    document.getElementById('correct-count').textContent = correct;
    document.getElementById('wrong-count').textContent = wrong;
    document.getElementById('accuracy-rate').textContent = rate + '%';

    const icon = document.getElementById('test-result-icon');
    const title = document.getElementById('test-result-title');
    if (rate >= 80) {
        icon.textContent = '🏆';
        title.textContent = '太棒了，完美通过！';
    } else if (rate >= 60) {
        icon.textContent = '👍';
        title.textContent = '不错哦，继续努力！';
    } else {
        icon.textContent = '💪';
        title.textContent = '再接再厉，回炉复习吧！';
    }
}

// ==================== 词库弹窗（双击卡片） ====================
function openLibraryModal(type, key) {
    let meta;
    if (type === 'level') {
        const lv = vocabularyData.levels[key];
        meta = { name: lv.name, icon: lv.icon, groups: [{ name: '', words: lv.words }] };
    } else if (type === 'topic') {
        const tp = vocabularyData.topics[key];
        meta = { name: tp.name, icon: tp.icon, groups: [{ name: '', words: tp.words }] };
    } else {
        const bk = vocabularyData.textbooks[key];
        meta = { name: bk.name, icon: bk.icon, groups: Object.keys(bk.chapters).map(n => ({ name: n, words: bk.chapters[n] })) };
    }

    appState.modalLibrary = { type, key };

    const libId = type + ':' + key;
    const resumable = hasProgress(libId);
    document.getElementById('library-modal-title').innerHTML = `${meta.icon} ${escapeHtml(meta.name)}`;
    document.getElementById('modal-start-btn').textContent = resumable ? '▶ 继续学习' : '▶ 开始学习';

    const total = meta.groups.reduce((a, g) => a + g.words.length, 0);
    let html = `<p style="color: var(--gray); font-size: 0.9rem; margin-bottom: 6px;">共 ${total} 个单词 · 点击单词查看详情（读音 / 音标 / 含义 / 例句）</p>`;
    meta.groups.forEach(g => {
        if (g.name) html += `<div class="chapter-subtitle">📖 ${escapeHtml(g.name)}</div>`;
        g.words.forEach(w => {
            html += `<div class="word-row" data-spanish="${escapeHtml(w.spanish)}"><span class="wr-spanish">${w.spanish}</span><span class="wr-chinese">${w.chinese}</span></div>`;
        });
    });
    const listEl = document.getElementById('word-list');
    listEl.innerHTML = html;
    listEl.scrollTop = 0;
    listEl.querySelectorAll('.word-row').forEach(row => {
        row.addEventListener('click', () => openWordModal(row.dataset.spanish));
    });

    document.getElementById('library-modal').classList.remove('hidden');
}

function openWordModal(spanish) {
    const w = findWord(spanish);
    if (!w) return;
    const detail = document.getElementById('word-detail');
    detail.innerHTML = `
        <div class="word-detail">
            <div class="detail-spanish">${w.spanish}</div>
            <div class="detail-phonetic">${w.phonetic || '（暂无音标）'}</div>
            <button class="audio-btn" onclick="speakWord('${w.spanish}')">🔊</button>
            <div class="detail-chinese">${w.chinese}</div>
            ${w.example ? `<div class="detail-example">"${w.example}"</div>` : '<div class="detail-example detail-empty">暂无例句</div>'}
        </div>
    `;
    document.getElementById('word-modal').classList.remove('hidden');
    if (appState.userData.settings.autoSpeak) {
        setTimeout(() => speakWord(w.spanish), 300);
    }
}

function closeAllModals() {
    document.getElementById('library-modal').classList.add('hidden');
    document.getElementById('word-modal').classList.add('hidden');
}

// ==================== 日历打卡 ====================
function initCalendar() {
    document.getElementById('prev-month').addEventListener('click', () => {
        appState.currentCalendarDate.setMonth(appState.currentCalendarDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        appState.currentCalendarDate.setMonth(appState.currentCalendarDate.getMonth() + 1);
        renderCalendar();
    });
    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = `
        <div class="calendar-day-header">日</div>
        <div class="calendar-day-header">一</div>
        <div class="calendar-day-header">二</div>
        <div class="calendar-day-header">三</div>
        <div class="calendar-day-header">四</div>
        <div class="calendar-day-header">五</div>
        <div class="calendar-day-header">六</div>
    `;

    const y = appState.currentCalendarDate.getFullYear();
    const m = appState.currentCalendarDate.getMonth();
    document.getElementById('calendar-title').textContent = `${y}年${m + 1}月`;

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const daysInPrevMonth = new Date(y, m, 0).getDate();
    const todayStr = getTodayString();

    const cells = [];
    for (let i = firstDay - 1; i >= 0; i--) {
        cells.push({ day: daysInPrevMonth - i, other: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ day: d, other: false });
    }
    let nextMonthDay = 1;
    while (cells.length % 7 !== 0) {
        cells.push({ day: nextMonthDay++, other: true });
    }

    cells.forEach(c => {
        const div = document.createElement('div');
        div.className = 'calendar-day';

        if (c.other) {
            div.classList.add('other-month');
            div.innerHTML = `<span>${c.day}</span>`;
        } else {
            const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
            const rec = appState.userData.studyRecords[dateStr];
            if (rec && isActiveDay(dateStr)) {
                div.classList.add('checked');
                div.innerHTML = `<span>${c.day}</span><span class="check-icon">✓</span><span class="day-minutes">${rec.minutes || 0}分钟</span>`;
            } else {
                div.innerHTML = `<span>${c.day}</span>`;
            }
            if (dateStr === todayStr) div.classList.add('today');

            div.addEventListener('click', () => {
                if (rec && isActiveDay(dateStr)) {
                    showNotification(`${dateStr}：学习 ${rec.minutes || 0} 分钟，${rec.words || 0} 个单词`, 'info');
                } else if (dateStr === todayStr) {
                    showNotification('今天还没打卡，快去学习吧！', 'info');
                } else {
                    showNotification(`${dateStr}：还没有学习记录`, 'info');
                }
            });
        }

        grid.appendChild(div);
    });

    updateMonthStats(y, m);
}

function updateMonthStats(y, m) {
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
    let days = 0, minutes = 0, words = 0;

    Object.entries(appState.userData.studyRecords).forEach(([date, rec]) => {
        if (date.startsWith(prefix) && isActiveDay(date)) {
            days++;
            minutes += rec.minutes || 0;
            words += rec.words || 0;
        }
    });

    document.getElementById('month-days').textContent = days;
    document.getElementById('month-time').textContent = minutes;
    document.getElementById('month-words').textContent = words;
    document.getElementById('max-streak').textContent = calcMaxStreak();
}

// ==================== 设置 ====================
function initSettings() {
    const s = appState.userData.settings;
    const autoSpeak = document.getElementById('auto-speak');
    const showPhonetic = document.getElementById('show-phonetic');
    const showExample = document.getElementById('show-example');
    const dailyGoal = document.getElementById('daily-goal');

    autoSpeak.checked = s.autoSpeak;
    showPhonetic.checked = s.showPhonetic;
    showExample.checked = s.showExample;
    dailyGoal.value = String(s.dailyGoal);

    autoSpeak.addEventListener('change', () => { s.autoSpeak = autoSpeak.checked; saveUserData(); });
    showPhonetic.addEventListener('change', () => { s.showPhonetic = showPhonetic.checked; saveUserData(); });
    showExample.addEventListener('change', () => { s.showExample = showExample.checked; saveUserData(); });
    dailyGoal.addEventListener('change', () => {
        s.dailyGoal = parseInt(dailyGoal.value, 10) || 20;
        saveUserData();
    });

    document.getElementById('reset-progress').addEventListener('click', () => {
        if (confirm('确定要重置所有学习进度吗？此操作不可恢复！（账号昵称头像会保留）')) {
            const profile = appState.userData.profile;
            try { localStorage.removeItem('spanishLearningData'); } catch (e) { /* 忽略 */ }
            appState.userData = {
                profile,
                streakDays: 0, lastStudyDate: null, studyRecords: {}, wordStatus: {},
                libraryProgress: {}, poolOffsets: {}, textbookCursor: {},
                settings: { autoSpeak: true, showPhonetic: true, showExample: true, dailyGoal: 20 }
            };
            saveUserData();
            location.reload();
        }
    });
}

// ==================== 账号（可选） ====================
const AVATARS = ['🙂', '😊', '😎', '🐱', '🐶', '🦊', '🐼', '🌸', '🌵', '🍊', '☕', '⚽', '🎸', '🎧', '📚', '🚀'];

function initAccount() {
    const grid = document.getElementById('avatar-grid');
    AVATARS.forEach(a => {
        const d = document.createElement('div');
        d.className = 'avatar-option';
        d.textContent = a;
        d.addEventListener('click', () => {
            grid.querySelectorAll('.avatar-option').forEach(x => x.classList.remove('selected'));
            d.classList.add('selected');
        });
        grid.appendChild(d);
    });
    document.getElementById('save-profile-btn').addEventListener('click', saveProfile);
    renderProfile();
}

function renderProfile() {
    const p = appState.userData.profile || {};
    const badge = document.getElementById('user-badge');
    badge.innerHTML = `<span class="avatar">${p.avatar || '🙂'}</span><span>${p.nickname ? escapeHtml(p.nickname) : '访客'}</span>`;
    document.getElementById('avatar-preview').textContent = p.avatar || '🙂';
    document.getElementById('nickname-input').value = p.nickname || '';
    document.querySelectorAll('.avatar-option').forEach(o => {
        o.classList.toggle('selected', o.textContent === p.avatar);
    });
}

function saveProfile() {
    const nickname = document.getElementById('nickname-input').value.trim();
    const selected = document.querySelector('.avatar-option.selected');
    appState.userData.profile = { nickname, avatar: selected ? selected.textContent : '' };
    saveUserData();
    renderProfile();
    showNotification(nickname ? `¡Hola, ${nickname}! 资料已保存` : '资料已保存', 'success');
}

// ==================== 启动 ====================
init();
