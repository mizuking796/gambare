// 呼吸数推定アプリケーション（周波数解析版）
// 文献ベース：0.1–0.4 Hz（6–24 bpm）帯域のみを使用
// 息止め時は "--" を表示（パワー閾値）

class BreathingRateEstimator {
    constructor() {
        // DOM要素
        this.video = document.getElementById('video');
        this.overlay = document.getElementById('overlay');
        this.analysisCanvas = document.getElementById('analysis');
        this.roiBox = document.getElementById('roi-box');
        this.bpmDisplay = document.getElementById('bpm');
        this.statusDisplay = document.getElementById('status');
        this.graphCanvas = document.getElementById('graph');
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.resetBtn = document.getElementById('resetBtn');

        // Canvas contexts
        this.overlayCtx = this.overlay.getContext('2d');
        this.analysisCtx = this.analysisCanvas.getContext('2d');
        this.graphCtx = this.graphCanvas.getContext('2d');

        // 状態
        this.isRunning = false;
        this.roi = null;
        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;

        // データ
        this.brightnessHistory = [];   // {value, time}
        this.smoothedHistory = [];     // {value, time}
        this.maxHistoryLength = 900;   // 約30秒（30fps想定）
        this.movingAverageWindow = 5;

        // 周波数解析パラメータ（文献準拠）
        this.sampleRate = 30;          // fps想定（後で実測可）
        this.fftWindowSec = 10;        // 10秒窓
        this.minBandHz = 0.1;          // 6 bpm
        this.maxBandHz = 0.4;          // 24 bpm
        this.powerThreshold = 0.002;   // 無呼吸/不確実の閾値（調整可）

        this.init();
    }

    async init() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' }
            });
            this.video.srcObject = stream;
            await this.video.play();

            this.setupCanvas();
            this.setupEventListeners();
            this.statusDisplay.textContent = 'カメラ準備完了。ROIを選択してください';
        } catch (error) {
            this.statusDisplay.textContent = 'カメラへのアクセスが拒否されました';
            console.error('Camera error:', error);
        }
    }

    setupCanvas() {
        const rect = this.video.getBoundingClientRect();
        this.overlay.width = rect.width;
        this.overlay.height = rect.height;
        this.analysisCanvas.width = this.video.videoWidth || 640;
        this.analysisCanvas.height = this.video.videoHeight || 480;

        // グラフ
        this.graphCanvas.width = this.graphCanvas.offsetWidth;
        this.graphCanvas.height = 150;
    }

    setupEventListeners() {
        // ROI選択（マウス）
        this.overlay.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.overlay.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.overlay.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.overlay.addEventListener('mouseleave', (e) => this.onMouseUp(e));

        // タッチ
        this.overlay.addEventListener('touchstart', (e) => this.onTouchStart(e));
        this.overlay.addEventListener('touchmove', (e) => this.onTouchMove(e));
        this.overlay.addEventListener('touchend', (e) => this.onTouchEnd(e));

        // ボタン
        this.startBtn.addEventListener('click', () => this.start());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.resetBtn.addEventListener('click', () => this.reset());

        // リサイズ
        window.addEventListener('resize', () => this.setupCanvas());
    }

    // ===== ROI選択 =====
    getMousePos(e) {
        const rect = this.overlay.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    onMouseDown(e) {
        if (this.isRunning) return;
        const pos = this.getMousePos(e);
        this.isDrawing = true;
        this.startX = pos.x;
        this.startY = pos.y;
        this.roiBox.style.display = 'block';
    }

    onMouseMove(e) {
        if (!this.isDrawing) return;
        const pos = this.getMousePos(e);
        this.updateRoiBox(pos.x, pos.y);
    }

    onMouseUp(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        const pos = this.getMousePos(e);
        this.finalizeRoi(pos.x, pos.y);
    }

    onTouchStart(e) {
        e.preventDefault();
        const t = e.touches[0];
        this.onMouseDown({ clientX: t.clientX, clientY: t.clientY });
    }

    onTouchMove(e) {
        e.preventDefault();
        const t = e.touches[0];
        this.onMouseMove({ clientX: t.clientX, clientY: t.clientY });
    }

    onTouchEnd(e) {
        e.preventDefault();
        const t = e.changedTouches[0];
        this.onMouseUp({ clientX: t.clientX, clientY: t.clientY });
    }

    updateRoiBox(endX, endY) {
        const left = Math.min(this.startX, endX);
        const top = Math.min(this.startY, endY);
        const width = Math.abs(endX - this.startX);
        const height = Math.abs(endY - this.startY);

        this.roiBox.style.left = left + 'px';
        this.roiBox.style.top = top + 'px';
        this.roiBox.style.width = width + 'px';
        this.roiBox.style.height = height + 'px';
    }

    finalizeRoi(endX, endY) {
        const rect = this.overlay.getBoundingClientRect();
        const scaleX = this.analysisCanvas.width / rect.width;
        const scaleY = this.analysisCanvas.height / rect.height;

        const left = Math.min(this.startX, endX);
        const top = Math.min(this.startY, endY);
        const width = Math.abs(endX - this.startX);
        const height = Math.abs(endY - this.startY);

        if (width < 20 || height < 20) {
            this.roiBox.style.display = 'none';
            this.statusDisplay.textContent = '領域が小さすぎます。もう一度選択してください';
            return;
        }

        this.roi = {
            x: Math.round(left * scaleX),
            y: Math.round(top * scaleY),
            width: Math.round(width * scaleX),
            height: Math.round(height * scaleY)
        };

        this.startBtn.disabled = false;
        this.statusDisplay.textContent = 'ROI選択完了。「開始」を押してください';
    }

    // ===== 制御 =====
    start() {
        if (!this.roi) return;
        this.isRunning = true;
        this.startBtn.disabled = true;
        this.stopBtn.disabled = false;
        this.brightnessHistory = [];
        this.smoothedHistory = [];
        this.bpmDisplay.textContent = '--';
        this.statusDisplay.textContent = '計測中...';
        this.analyze();
    }

    stop() {
        this.isRunning = false;
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        this.statusDisplay.textContent = '停止しました';
    }

    reset() {
        this.stop();
        this.roi = null;
        this.roiBox.style.display = 'none';
        this.bpmDisplay.textContent = '--';
        this.brightnessHistory = [];
        this.smoothedHistory = [];
        this.startBtn.disabled = true;
        this.statusDisplay.textContent = 'ROIを選択してください';
        this.clearGraph();
    }

    // ===== メインループ =====
    analyze() {
        if (!this.isRunning) return;

        this.analysisCtx.drawImage(this.video, 0, 0);

        const brightness = this.calculateBrightness();
        const now = Date.now();

        this.brightnessHistory.push({ value: brightness, time: now });
        if (this.brightnessHistory.length > this.maxHistoryLength) {
            this.brightnessHistory.shift();
        }

        this.applyMovingAverage();
        this.calculateBPM();
        this.drawGraph();

        requestAnimationFrame(() => this.analyze());
    }

    // ===== 信号処理 =====
    calculateBrightness() {
        const img = this.analysisCtx.getImageData(
            this.roi.x, this.roi.y, this.roi.width, this.roi.height
        );
        const d = img.data;
        let sum = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
            sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        }
        return sum / n;
    }

    applyMovingAverage() {
        this.smoothedHistory = [];
        const w = this.movingAverageWindow;
        for (let i = 0; i < this.brightnessHistory.length; i++) {
            let s = 0, c = 0;
            for (let j = Math.max(0, i - w); j <= Math.min(this.brightnessHistory.length - 1, i + w); j++) {
                s += this.brightnessHistory[j].value;
                c++;
            }
            this.smoothedHistory.push({
                value: s / c,
                time: this.brightnessHistory[i].time
            });
        }
    }

    // ===== 周波数解析 =====
    preprocess(signal) {
        const mean = signal.reduce((a,b)=>a+b,0)/signal.length;
        const x = signal.map(v => v - mean);
        const maxAbs = Math.max(...x.map(v => Math.abs(v))) || 1;
        return x.map(v => v / maxAbs);
    }

    dft(signal) {
        const N = signal.length;
        const re = new Array(N).fill(0);
        const im = new Array(N).fill(0);
        for (let k = 0; k < N; k++) {
            for (let n = 0; n < N; n++) {
                const phi = (2 * Math.PI * k * n) / N;
                re[k] += signal[n] * Math.cos(phi);
                im[k] -= signal[n] * Math.sin(phi);
            }
        }
        return re.map((r,i)=>Math.sqrt(r*r + im[i]*im[i]));
    }

    calculateBPM() {
        const needed = Math.floor(this.sampleRate * this.fftWindowSec);
        if (this.smoothedHistory.length < needed) {
            this.bpmDisplay.textContent = '--';
            return;
        }

        const slice = this.smoothedHistory.slice(-needed).map(h => h.value);
        const x = this.preprocess(slice);
        const mag = this.dft(x);

        const N = mag.length;
        let bestHz = null;
        let bestPower = 0;

        for (let k = 1; k < Math.floor(N/2); k++) {
            const freq = (k * this.sampleRate) / N;
            if (freq < this.minBandHz || freq > this.maxBandHz) continue;
            if (mag[k] > bestPower) {
                bestPower = mag[k];
                bestHz = freq;
            }
        }

        if (!bestHz || bestPower < this.powerThreshold) {
            this.bpmDisplay.textContent = '--';
            return;
        }

        this.bpmDisplay.textContent = Math.round(bestHz * 60);
    }

    // ===== 描画 =====
    drawGraph() {
        const ctx = this.graphCtx;
        const w = this.graphCanvas.width;
        const h = this.graphCanvas.height;

        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(0,0,w,h);

        if (this.smoothedHistory.length < 2) return;

        const vals = this.smoothedHistory.map(v=>v.value);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const range = max - min || 1;

        ctx.beginPath();
        ctx.strokeStyle = '#4fd1c5';
        ctx.lineWidth = 2;

        for (let i = 0; i < this.smoothedHistory.length; i++) {
            const x = (i/(this.maxHistoryLength-1))*w;
            const y = h - ((this.smoothedHistory[i].value - min)/range)*(h-20) - 10;
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.stroke();
    }

    clearGraph() {
        this.graphCtx.fillStyle = '#1a1a2e';
        this.graphCtx.fillRect(0,0,this.graphCanvas.width,this.graphCanvas.height);
    }
}

// 起動
document.addEventListener('DOMContentLoaded', () => {
    new BreathingRateEstimator();
});
