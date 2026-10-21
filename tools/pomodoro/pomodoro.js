(function () {
  const FOCUS = 25 * 60;
  const SHORT_BREAK = 5 * 60;
  const LONG_BREAK = 15 * 60;
  const CIRCUMFERENCE = 2 * Math.PI * 88;
  const STORAGE_KEY = 'pomodoroCount';

  window.registerTool({
    iconId: 'pomodoroIcon',
    iconText: '🍅',
    iconTitle: '番茄钟',
    panelId: 'pomodoroPanel',
    panelHTML: `
      <div class="panel-header">
        <h2>番茄钟</h2>
        <button class="close-btn" data-close>✕</button>
      </div>
      <div class="pomodoro-wrap">
        <div class="pomodoro-ring">
          <svg viewBox="0 0 200 200">
            <defs>
              <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#a78bfa" />
                <stop offset="100%" stop-color="#f472b6" />
              </linearGradient>
            </defs>
            <circle class="ring-bg" cx="100" cy="100" r="88"></circle>
            <circle class="ring-progress" id="ringProgress" cx="100" cy="100" r="88"></circle>
          </svg>
          <div class="pomodoro-time" id="pomodoroTime">25:00</div>
        </div>
        <div class="pomodoro-mode" id="pomodoroMode">专注</div>
        <div class="pomodoro-actions">
          <button class="pomo-btn primary" id="pomoStartBtn">开始</button>
          <button class="pomo-btn" id="pomoResetBtn">重置</button>
        </div>
        <div class="pomodoro-stats">已完成番茄：<span id="pomoCount">0</span> 个</div>
      </div>
    `,
    onReady(panel) {
      const timeEl = panel.querySelector('#pomodoroTime');
      const modeEl = panel.querySelector('#pomodoroMode');
      const ring = panel.querySelector('#ringProgress');
      const startBtn = panel.querySelector('#pomoStartBtn');
      const resetBtn = panel.querySelector('#pomoResetBtn');
      const countEl = panel.querySelector('#pomoCount');

      let mode = 'focus';
      let remaining = FOCUS;
      let timerId = null;
      let running = false;
      let finishedCount = Number(localStorage.getItem(STORAGE_KEY) || 0);

      ring.style.strokeDasharray = CIRCUMFERENCE;
      ring.style.strokeDashoffset = 0;
      countEl.textContent = finishedCount;

      function getDuration(m) {
        if (m === 'focus') return FOCUS;
        if (m === 'short') return SHORT_BREAK;
        return LONG_BREAK;
      }

      function formatTime(sec) {
        const m = Math.floor(sec / 60).toString().padStart(2, '0');
        const s = Math.floor(sec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
      }

      function updateDisplay() {
        timeEl.textContent = formatTime(remaining);
        const progress = remaining / getDuration(mode);
        ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
      }

      function setMode(newMode) {
        mode = newMode;
        remaining = getDuration(mode);
        modeEl.textContent = mode === 'focus' ? '专注' : (mode === 'short' ? '短休' : '长休');
        updateDisplay();
      }

      function tick() {
        remaining -= 1;
        if (remaining <= 0) {
          stop();
          onComplete();
        } else {
          updateDisplay();
        }
      }

      function start() {
        if (running) return;
        running = true;
        startBtn.textContent = '暂停';
        timerId = setInterval(tick, 1000);
      }

      function stop() {
        running = false;
        startBtn.textContent = '开始';
        clearInterval(timerId);
        timerId = null;
      }

      function reset() {
        stop();
        setMode('focus');
      }

      function playBeep() {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
          osc.start();
          osc.stop(ctx.currentTime + 0.8);
        } catch (e) {}
      }

      function onComplete() {
        playBeep();
        if (mode === 'focus') {
          finishedCount += 1;
          localStorage.setItem(STORAGE_KEY, finishedCount);
          countEl.textContent = finishedCount;
          setMode(finishedCount % 4 === 0 ? 'long' : 'short');
        } else {
          setMode('focus');
        }
        start();
      }

      startBtn.addEventListener('click', () => {
        if (running) stop();
        else start();
      });
      resetBtn.addEventListener('click', reset);

      setMode('focus');
    }
  });
})();