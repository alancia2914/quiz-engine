// Governance Study Engine
// Supports: multi-select modules, category grouping, spaced repetition, localStorage

const STORAGE_KEY = 'governance-study-engine';

// CONFIG: Set to true to show category umbrellas on home screen
// Set to false for flat module list (better when you have fewer than ~8 modules)
const USE_CATEGORIES = true;

class StudyEngine {
    constructor() {
        this.modules = [];
        this.manifest = null;
        this.state = this.loadState();
        this.selectedModuleIds = new Set();
        this.currentQuestions = [];
        this.currentIndex = 0;
        this.sessionCorrect = 0;
        this.sessionTotal = 0;
        this.matchState = {};

        this.init();
    }

    // --- State Management ---

    loadState() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return { questions: {}, streak: 0, totalAnswered: 0, totalCorrect: 0 };
    }

    saveState() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch (e) {}
    }

    getQuestionState(id) {
        if (!this.state.questions[id]) {
            this.state.questions[id] = { attempts: 0, correct: 0, lastSeen: null, lastCorrect: null };
        }
        return this.state.questions[id];
    }

    recordAnswer(id, isCorrect) {
        const qs = this.getQuestionState(id);
        qs.attempts++;
        if (isCorrect) qs.correct++;
        qs.lastSeen = Date.now();
        qs.lastCorrect = isCorrect;
        this.state.totalAnswered++;
        if (isCorrect) { this.state.totalCorrect++; this.state.streak++; }
        else { this.state.streak = 0; }
        this.saveState();
    }

    // --- Initialization ---

    async init() {
        try {
            const res = await fetch('data/manifest.json');
            this.manifest = await res.json();

            const modulePromises = this.manifest.modules.map(async (slug) => {
                const r = await fetch(`data/${slug}.json`);
                return r.json();
            });
            this.modules = await Promise.all(modulePromises);
            this.renderHome();
        } catch (e) {
            console.error('Failed to load:', e);
            document.getElementById('module-list').innerHTML =
                '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Failed to load questions.</p>';
        }
    }

    // --- Home Rendering ---

    renderHome() {
        const list = document.getElementById('module-list');
        list.innerHTML = '';
        this.selectedModuleIds.clear();
        this.updateStartBar();

        if (USE_CATEGORIES && this.manifest.categories) {
            this.renderCategorized(list);
        } else {
            this.renderFlat(list);
        }

        this.renderGlobalStats();
        this.showView('home-view');
    }

    renderCategorized(container) {
        // Group modules by category
        const categorizedIds = new Set();
        this.manifest.categories.forEach(cat => {
            cat.modules.forEach(id => categorizedIds.add(id));
        });

        this.manifest.categories.forEach(cat => {
            const group = document.createElement('div');
            group.className = 'category-group';

            const header = document.createElement('div');
            header.className = 'category-header';
            header.innerHTML = `<span class="category-chevron">▼</span><h2>${cat.title}</h2>`;

            const modulesDiv = document.createElement('div');
            modulesDiv.className = 'category-modules';

            cat.modules.forEach(moduleId => {
                const module = this.modules.find(m => m.id === moduleId);
                if (module) modulesDiv.appendChild(this.createModuleCard(module));
            });

            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
                modulesDiv.classList.toggle('hidden');
            });

            group.appendChild(header);
            group.appendChild(modulesDiv);
            container.appendChild(group);
        });

        // Any uncategorized modules
        const uncategorized = this.modules.filter(m => !categorizedIds.has(m.id));
        if (uncategorized.length > 0) {
            const group = document.createElement('div');
            group.className = 'category-group';
            const modulesDiv = document.createElement('div');
            modulesDiv.className = 'category-modules';
            uncategorized.forEach(module => {
                modulesDiv.appendChild(this.createModuleCard(module));
            });
            group.appendChild(modulesDiv);
            container.appendChild(group);
        }
    }

    renderFlat(container) {
        const grid = document.createElement('div');
        grid.className = 'category-modules';
        this.modules.forEach(module => {
            grid.appendChild(this.createModuleCard(module));
        });
        container.appendChild(grid);
    }

    createModuleCard(module) {
        const stats = this.getModuleStats(module);
        const card = document.createElement('div');
        card.className = 'module-card';
        card.dataset.moduleId = module.id;

        card.innerHTML = `
            <div class="module-checkbox"></div>
            <div class="module-info">
                <h3>${module.title}</h3>
                <p>${module.description}</p>
                <div class="stats">
                    <span>${module.questions.length} questions</span>
                    ${stats.attempted > 0 ? `<span class="score">${stats.accuracy}% accuracy</span>` : ''}
                    ${stats.weakCount > 0 ? `<span style="color: var(--warning);">${stats.weakCount} weak</span>` : ''}
                </div>
            </div>
        `;

        card.addEventListener('click', () => this.toggleModule(module.id, card));
        return card;
    }

    toggleModule(moduleId, card) {
        if (this.selectedModuleIds.has(moduleId)) {
            this.selectedModuleIds.delete(moduleId);
            card.classList.remove('selected');
        } else {
            this.selectedModuleIds.add(moduleId);
            card.classList.add('selected');
        }
        this.updateStartBar();
    }

    updateStartBar() {
        const bar = document.getElementById('start-bar');
        const btn = document.getElementById('start-quiz-btn');
        const count = this.selectedModuleIds.size;

        if (count > 0) {
            bar.classList.add('show');
            const totalQ = this.modules
                .filter(m => this.selectedModuleIds.has(m.id))
                .reduce((sum, m) => sum + m.questions.length, 0);
            btn.textContent = `Start Quiz (${totalQ} questions)`;
            btn.disabled = false;
        } else {
            bar.classList.remove('show');
        }
    }

    getModuleStats(module) {
        let attempted = 0, totalAttempts = 0, totalCorrect = 0, weakCount = 0;
        module.questions.forEach(q => {
            const qs = this.state.questions[q.id];
            if (qs && qs.attempts > 0) {
                attempted++;
                totalAttempts += qs.attempts;
                totalCorrect += qs.correct;
                if (qs.correct / qs.attempts < 0.5) weakCount++;
            }
        });
        return {
            attempted,
            accuracy: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
            weakCount
        };
    }

    renderGlobalStats() {
        const panel = document.getElementById('global-stats');
        if (this.state.totalAnswered > 0) {
            panel.style.display = 'block';
            document.getElementById('total-answered').textContent = this.state.totalAnswered;
            document.getElementById('total-accuracy').textContent =
                Math.round((this.state.totalCorrect / this.state.totalAnswered) * 100) + '%';
            document.getElementById('total-streak').textContent = this.state.streak;
        }
    }

    // --- Quiz Flow ---

    startQuiz(weakOnly = false) {
        this.sessionCorrect = 0;
        this.sessionTotal = 0;

        // Collect questions from all selected modules
        let allQuestions = [];
        this.modules
            .filter(m => this.selectedModuleIds.has(m.id))
            .forEach(m => allQuestions.push(...m.questions));

        if (weakOnly) {
            const weak = allQuestions.filter(q => {
                const qs = this.state.questions[q.id];
                return qs && qs.attempts > 0 && (qs.correct / qs.attempts) < 0.6;
            });
            if (weak.length > 0) allQuestions = weak;
        }

        this.currentQuestions = this.prioritizeQuestions(allQuestions);
        this.currentIndex = 0;

        this.showView('quiz-view');
        document.getElementById('start-bar').classList.remove('show');
        this.renderQuestion();
    }

    prioritizeQuestions(questions) {
        const scored = questions.map(q => {
            const qs = this.state.questions[q.id];
            let priority = 0;
            if (!qs || qs.attempts === 0) { priority = 1; }
            else {
                const accuracy = qs.correct / qs.attempts;
                if (accuracy < 0.5) priority = 0;
                else if (accuracy < 0.8) priority = 2;
                else priority = 3;
            }
            return { question: q, priority, rand: Math.random() };
        });
        scored.sort((a, b) => a.priority - b.priority || a.rand - b.rand);
        return scored.map(s => s.question);
    }

    renderQuestion() {
        if (this.currentIndex >= this.currentQuestions.length) {
            this.showResults();
            return;
        }

        const q = this.currentQuestions[this.currentIndex];
        const area = document.getElementById('question-area');
        const counter = document.getElementById('question-counter');
        const progress = document.getElementById('progress-fill');
        const explanation = document.getElementById('explanation');
        const nextBtn = document.getElementById('next-btn');

        counter.textContent = `${this.currentIndex + 1} / ${this.currentQuestions.length}`;
        progress.style.width = `${(this.currentIndex / this.currentQuestions.length) * 100}%`;
        explanation.classList.remove('show');
        nextBtn.classList.remove('show');

        if (q.type === 'mcq') this.renderMCQ(q, area);
        else if (q.type === 'matching') this.renderMatching(q, area);
    }

    // --- MCQ ---

    renderMCQ(q, area) {
        area.innerHTML = `
            <div class="question-card">
                <div class="question-label">Multiple Choice</div>
                <div class="question-text">${q.question}</div>
                <div class="options">
                    ${q.options.map((opt, i) => `
                        <button class="option-btn" data-index="${i}">${opt}</button>
                    `).join('')}
                </div>
            </div>
        `;
        const buttons = area.querySelectorAll('.option-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => this.handleMCQAnswer(q, parseInt(btn.dataset.index), buttons));
        });
    }

    handleMCQAnswer(q, selectedIndex, buttons) {
        const isCorrect = selectedIndex === q.correct;
        buttons.forEach(btn => {
            btn.disabled = true;
            const idx = parseInt(btn.dataset.index);
            if (idx === q.correct) btn.classList.add('correct');
            else if (idx === selectedIndex && !isCorrect) btn.classList.add('incorrect');
        });
        this.sessionTotal++;
        if (isCorrect) this.sessionCorrect++;
        this.recordAnswer(q.id, isCorrect);
        this.showExplanation(q.explanation);
        this.showNextButton();
    }

    // --- Matching ---

    renderMatching(q, area) {
        this.matchState = { selectedLeft: null, selectedRight: null, matched: [], pairs: q.pairs, hadError: false };
        const shuffledRight = [...q.pairs].sort(() => Math.random() - 0.5);

        area.innerHTML = `
            <div class="question-card">
                <div class="question-label">Matching</div>
                <div class="question-text">${q.question}</div>
                <div class="matching-container">
                    <div class="match-column">
                        <div class="match-column-label">Terms</div>
                        ${q.pairs.map((p, i) => `
                            <div class="match-item match-left" data-index="${i}">${p.left}</div>
                        `).join('')}
                    </div>
                    <div class="match-column">
                        <div class="match-column-label">Definitions</div>
                        ${shuffledRight.map((p) => `
                            <div class="match-item match-right" data-right="${p.right}">${p.right}</div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        area.querySelectorAll('.match-left').forEach(item => {
            item.addEventListener('click', () => this.handleMatchSelect('left', item, area.querySelectorAll('.match-left')));
        });
        area.querySelectorAll('.match-right').forEach(item => {
            item.addEventListener('click', () => this.handleMatchSelect('right', item, area.querySelectorAll('.match-right')));
        });
    }

    handleMatchSelect(side, item, sameItems) {
        if (item.classList.contains('matched')) return;
        sameItems.forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');

        if (side === 'left') this.matchState.selectedLeft = item;
        else this.matchState.selectedRight = item;

        if (this.matchState.selectedLeft && this.matchState.selectedRight) this.checkMatch();
    }

    checkMatch() {
        const leftIndex = parseInt(this.matchState.selectedLeft.dataset.index);
        const rightValue = this.matchState.selectedRight.dataset.right;
        const correctRight = this.matchState.pairs[leftIndex].right;

        if (rightValue === correctRight) {
            this.matchState.selectedLeft.classList.remove('selected');
            this.matchState.selectedLeft.classList.add('matched');
            this.matchState.selectedRight.classList.remove('selected');
            this.matchState.selectedRight.classList.add('matched');
            this.matchState.matched.push(leftIndex);
            this.matchState.selectedLeft = null;
            this.matchState.selectedRight = null;

            if (this.matchState.matched.length === this.matchState.pairs.length) {
                const q = this.currentQuestions[this.currentIndex];
                const isCorrect = !this.matchState.hadError;
                this.sessionTotal++;
                if (isCorrect) this.sessionCorrect++;
                this.recordAnswer(q.id, isCorrect);
                this.showExplanation(q.explanation);
                this.showNextButton();
            }
        } else {
            this.matchState.hadError = true;
            const left = this.matchState.selectedLeft;
            const right = this.matchState.selectedRight;
            left.classList.add('incorrect');
            right.classList.add('incorrect');
            setTimeout(() => {
                left.classList.remove('selected', 'incorrect');
                right.classList.remove('selected', 'incorrect');
            }, 400);
            this.matchState.selectedLeft = null;
            this.matchState.selectedRight = null;
        }
    }

    // --- Shared UI ---

    showExplanation(text) {
        const el = document.getElementById('explanation');
        el.textContent = text;
        el.classList.add('show');
    }

    showNextButton() {
        const btn = document.getElementById('next-btn');
        btn.classList.add('show');
        btn.textContent = this.currentIndex >= this.currentQuestions.length - 1 ? 'See Results' : 'Next';
    }

    nextQuestion() { this.currentIndex++; this.renderQuestion(); }

    // --- Results ---

    showResults() {
        const pct = this.sessionTotal > 0 ? Math.round((this.sessionCorrect / this.sessionTotal) * 100) : 0;
        document.getElementById('results-score').textContent = `${pct}%`;
        document.getElementById('results-detail').textContent =
            `${this.sessionCorrect} of ${this.sessionTotal} correct`;
        document.getElementById('progress-fill').style.width = '100%';
        this.showView('results-view');
    }

    // --- Navigation ---

    showView(viewId) {
        ['home-view', 'quiz-view', 'results-view'].forEach(id => {
            document.getElementById(id).style.display = id === viewId ? 'block' : 'none';
        });
        if (viewId === 'home-view') {
            document.getElementById('start-bar').classList.remove('show');
            this.selectedModuleIds.clear();
        }
        window.scrollTo(0, 0);
    }

    // --- Events ---

    bindEvents() {
        document.getElementById('back-btn').addEventListener('click', () => this.renderHome());
        document.getElementById('next-btn').addEventListener('click', () => this.nextQuestion());
        document.getElementById('start-quiz-btn').addEventListener('click', () => this.startQuiz());
        document.getElementById('retry-weak-btn').addEventListener('click', () => this.startQuiz(true));
        document.getElementById('retry-all-btn').addEventListener('click', () => this.startQuiz(false));
        document.getElementById('back-home-btn').addEventListener('click', () => this.renderHome());
    }
}

const engine = new StudyEngine();
engine.bindEvents();
