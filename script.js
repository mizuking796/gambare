import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

// ============================================
// 設定
// ============================================
const ALERT_START_THRESHOLD = 50;     // 50%から2秒毎にアラート
const CONTINUOUS_THRESHOLD = 70;      // 70%から連続再生
const SPEED_UP_THRESHOLD = 90;        // 90%から2倍速
const EYE_CLOSED_DURATION = 5000;     // 5秒閉眼でアラート
const ALERT_INTERVAL = 2000;          // 2秒毎にアラート
const COOLDOWN_DURATION = 30000;      // 30秒クールダウン
const PERCLOS_WINDOW = 30;            // 30秒間のウィンドウ（緩やかに）
const FATIGUE_MULTIPLIER = 120;       // 疲労度係数（緩やかに）
// ============================================

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const eyeFatigueEl = document.getElementById("eye-fatigue");
const eyeClosedWarningEl = document.getElementById("eye-closed-warning");
const fatigueValueEl = document.getElementById("fatigue-value");
const fatigueFillEl = document.getElementById("fatigue-fill");
const fatigueIconEl = document.getElementById("fatigue-icon");
const startOverlay = document.getElementById("start-overlay");
const startButton = document.getElementById("start-button");
const backButton = document.getElementById("back-button");
const awakeButton = document.getElementById("awake-button");

// State
let faceLandmarker = null;
let selectedVoice = 'm';  // 'm' or 'f'

// Audio
let alertAudio = null;
let isPlaying = false;
let alertIntervalId = null;
let currentAlertMode = 'none';  // 'none', 'interval', 'continuous'

// Eye tracking
let eyeClosedStartTime = null;  // 閉眼開始時刻
let isEyeClosed = false;
let currentFatigue = 20;

// Cooldown
let cooldownEndTime = 0;        // クールダウン終了時刻
let cooldownIntervalId = null;  // クールダウン表示更新用

// Eye fatigue tracking (PERCLOS)
let earHistory = [];
let baselineEAR = null;
let calibrationFrames = [];

// FPS tracking
let fps = 30;
let lastTime = 0;

// Initialize audio with selected voice
function initAudio() {
  const audioFile = selectedVoice === 'm' ? 'm.mp3' : 'f.mp3';
  alertAudio = new Audio(audioFile);
  alertAudio.preload = 'auto';
  alertAudio.addEventListener('ended', () => {
    isPlaying = false;
  });
  alertAudio.addEventListener('error', (e) => {
    console.error('Audio error:', e);
  });
}

// Play alert once
function playAlertOnce() {
  if (!alertAudio) {
    console.log('playAlertOnce: alertAudio is null');
    return;
  }

  console.log('playAlertOnce: attempting to play');
  alertAudio.currentTime = 0;
  alertAudio.play().then(() => {
    console.log('playAlertOnce: playing successfully');
    isPlaying = true;
  }).catch(e => {
    console.error('playAlertOnce failed:', e);
  });
}

// Start continuous playback
function startContinuousPlay() {
  if (!alertAudio) {
    console.log('startContinuousPlay: alertAudio is null');
    return;
  }

  console.log('startContinuousPlay: attempting to play');
  alertAudio.loop = true;
  alertAudio.currentTime = 0;
  alertAudio.play().then(() => {
    console.log('startContinuousPlay: playing successfully');
  }).catch(e => {
    console.error('startContinuousPlay failed:', e);
  });
}

// Stop all audio
function stopAudio() {
  if (alertIntervalId) {
    clearInterval(alertIntervalId);
    alertIntervalId = null;
  }

  if (alertAudio) {
    alertAudio.pause();
    alertAudio.currentTime = 0;
    alertAudio.loop = false;
  }

  isPlaying = false;
  currentAlertMode = 'none';
}

// Check if in cooldown period
function isInCooldown() {
  return Date.now() < cooldownEndTime;
}

// Start cooldown
function startCooldown() {
  cooldownEndTime = Date.now() + COOLDOWN_DURATION;
  stopAudio();

  // Update button appearance
  awakeButton.classList.add('cooldown');

  // Update button text with countdown
  updateCooldownDisplay();
  cooldownIntervalId = setInterval(updateCooldownDisplay, 1000);
}

// Update cooldown display
function updateCooldownDisplay() {
  const remaining = Math.ceil((cooldownEndTime - Date.now()) / 1000);
  if (remaining > 0) {
    awakeButton.textContent = `クールダウン中 ${remaining}秒`;
  } else {
    // Cooldown ended
    clearInterval(cooldownIntervalId);
    cooldownIntervalId = null;
    awakeButton.textContent = '目が覚めた';
    awakeButton.classList.remove('cooldown');
  }
}

// Update alert based on fatigue and eye state
function updateAlert(fatigue, eyeOpen) {
  // Show/hide awake button based on alert state
  if (currentAlertMode !== 'none' || isInCooldown()) {
    awakeButton.classList.remove('hidden');
  }

  // Track eye closed duration
  if (!eyeOpen) {
    if (eyeClosedStartTime === null) {
      eyeClosedStartTime = performance.now();
    }
  } else {
    eyeClosedStartTime = null;
    eyeClosedWarningEl.classList.add('hidden');
  }

  // During cooldown, no alerts
  if (isInCooldown()) {
    if (currentAlertMode !== 'none') {
      stopAudio();
    }
    return;
  }

  // Check eye closed duration
  if (!eyeOpen && eyeClosedStartTime !== null) {
    const closedDuration = performance.now() - eyeClosedStartTime;

    // 5秒閉眼で強制アラート
    if (closedDuration >= EYE_CLOSED_DURATION) {
      eyeClosedWarningEl.classList.remove('hidden');
      eyeClosedWarningEl.textContent = `閉眼 ${Math.floor(closedDuration / 1000)}秒`;

      if (currentAlertMode !== 'continuous') {
        stopAudio();
        startContinuousPlay();
        currentAlertMode = 'continuous';
      }
      return;
    } else if (closedDuration >= 2000) {
      eyeClosedWarningEl.classList.remove('hidden');
      eyeClosedWarningEl.textContent = `閉眼検出中... ${Math.floor(closedDuration / 1000)}秒`;
    }
  }

  // 疲労度ベースのアラート
  if (fatigue >= CONTINUOUS_THRESHOLD) {
    // 70%以上：連続再生
    if (currentAlertMode !== 'continuous') {
      stopAudio();
      startContinuousPlay();
      currentAlertMode = 'continuous';
    }
  } else if (fatigue >= ALERT_START_THRESHOLD) {
    // 50-69%：2秒毎
    if (currentAlertMode !== 'interval') {
      stopAudio();
      playAlertOnce();
      alertIntervalId = setInterval(() => {
        playAlertOnce();
      }, ALERT_INTERVAL);
      currentAlertMode = 'interval';
    }
  } else {
    // 50%未満：停止
    if (currentAlertMode !== 'none') {
      stopAudio();
    }
    // Hide awake button when not alerting and not in cooldown
    if (!isInCooldown()) {
      awakeButton.classList.add('hidden');
    }
  }

  // 90%以上で2倍速
  if (alertAudio) {
    alertAudio.playbackRate = fatigue >= SPEED_UP_THRESHOLD ? 2.0 : 1.0;
  }
}

// Draw eye boxes on canvas
function drawEyeBoxes(landmarks) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const leftEyePoints = [33, 133, 159, 145];
  const rightEyePoints = [362, 263, 386, 374];

  function drawEyeBox(points, color) {
    const xs = points.map(i => landmarks[i].x * canvas.width);
    const ys = points.map(i => landmarks[i].y * canvas.height);

    const minX = Math.min(...xs) - 10;
    const maxX = Math.max(...xs) + 10;
    const minY = Math.min(...ys) - 10;
    const maxY = Math.max(...ys) + 10;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  }

  const color = isEyeClosed ? '#ff6b6b' : '#4ade80';
  drawEyeBox(leftEyePoints, color);
  drawEyeBox(rightEyePoints, color);
}

// Calculate Eye Aspect Ratio
function calculateEyeAspectRatio(landmarks) {
  const leftEye = {
    top: landmarks[159],
    bottom: landmarks[145],
    left: landmarks[33],
    right: landmarks[133]
  };

  const rightEye = {
    top: landmarks[386],
    bottom: landmarks[374],
    left: landmarks[362],
    right: landmarks[263]
  };

  function getEAR(eye) {
    const vertical = Math.abs(eye.top.y - eye.bottom.y);
    const horizontal = Math.abs(eye.right.x - eye.left.x);
    return vertical / (horizontal + 0.001);
  }

  const leftEAR = getEAR(leftEye);
  const rightEAR = getEAR(rightEye);

  return (leftEAR + rightEAR) / 2;
}

// Check if eyes are open
function checkEyeOpen(ear) {
  if (baselineEAR === null) return true;  // キャリブレーション中は開眼とみなす

  // ベースラインの15%以下なら閉眼（より厳しく）
  const closedThreshold = baselineEAR * 0.15;
  return ear >= closedThreshold;
}

// Update eye fatigue (PERCLOS)
function updateEyeFatigue(ear) {
  const eyeOpen = checkEyeOpen(ear);
  isEyeClosed = !eyeOpen;

  // Calibration: collect first 90 frames (~3 sec) to establish baseline
  if (baselineEAR === null) {
    calibrationFrames.push(ear);
    currentFatigue = 20;
    updateFatigueUI(20);

    if (calibrationFrames.length >= 90) {
      calibrationFrames.sort((a, b) => b - a);
      baselineEAR = calibrationFrames[Math.floor(calibrationFrames.length * 0.2)];
    }
    return;
  }

  // Store EAR with timestamp
  const now = performance.now();
  earHistory.push({ ear, time: now });

  // Keep only last PERCLOS_WINDOW seconds
  const windowStart = now - (PERCLOS_WINDOW * 1000);
  earHistory = earHistory.filter(e => e.time >= windowStart);

  // Calculate PERCLOS（より厳しい閾値で）
  const closedThreshold = baselineEAR * 0.15;
  const closedFrames = earHistory.filter(e => e.ear < closedThreshold).length;
  const perclos = earHistory.length > 0 ? (closedFrames / earHistory.length) : 0;

  // Convert to fatigue percentage (20% base + PERCLOS contribution)
  const baseFatigue = 20;
  const fatigue = Math.min(100, Math.round(baseFatigue + perclos * FATIGUE_MULTIPLIER));
  currentFatigue = fatigue;

  updateFatigueUI(fatigue);
  updateAlert(fatigue, eyeOpen);
}

// Update fatigue UI
function updateFatigueUI(fatigue) {
  // Color based on fatigue level
  let color;
  if (fatigue < 40) {
    color = "#4ade80"; // 緑
  } else if (fatigue < 60) {
    color = "#feca57"; // 黄
  } else if (fatigue < 80) {
    color = "#f97316"; // オレンジ
  } else {
    color = "#ff6b6b"; // 赤
  }

  eyeFatigueEl.textContent = `目の疲労度: ${fatigue}%`;
  eyeFatigueEl.style.color = color;

  fatigueValueEl.textContent = fatigue;
  fatigueValueEl.style.color = color;

  fatigueFillEl.style.width = `${fatigue}%`;
  fatigueFillEl.style.background = `linear-gradient(90deg, #4ade80, ${color})`;

  // Icon based on fatigue level (face scale)
  if (fatigue >= 70) {
    fatigueIconEl.textContent = '😫';
  } else if (fatigue >= 50) {
    fatigueIconEl.textContent = '😐';
  } else {
    fatigueIconEl.textContent = '😊';
  }
}

// Back button handler - reload page to return to start
backButton.addEventListener('click', () => {
  location.reload();
});

// Awake button handler - start cooldown
awakeButton.addEventListener('click', () => {
  if (!isInCooldown()) {
    startCooldown();
  }
});

// Start button handler
startButton.addEventListener('click', async () => {
  // Get selected voice
  const voiceRadio = document.querySelector('input[name="voice"]:checked');
  selectedVoice = voiceRadio ? voiceRadio.value : 'm';

  // Initialize audio
  initAudio();

  // Unlock audio (required for mobile)
  try {
    await alertAudio.play();
    alertAudio.pause();
    alertAudio.currentTime = 0;
  } catch (e) {
    console.log('Audio unlock:', e);
  }

  // Hide overlay
  startOverlay.classList.add('hidden');

  // Start the app
  await init();
});

async function init() {
  statusEl.textContent = "モデル読み込み中...";

  try {
    // Load MediaPipe FaceLandmarker
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numFaces: 1
    });

    statusEl.textContent = "カメラを起動中...";

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 }
    });

    video.srcObject = stream;
    await video.play();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    statusEl.textContent = "測定中";

    // Prevent screen sleep
    requestWakeLock();

    requestAnimationFrame(process);

  } catch (e) {
    statusEl.textContent = "エラー: " + e.message;
  }
}

async function process(time) {
  if (lastTime > 0) {
    const delta = time - lastTime;
    fps = fps * 0.9 + (1000 / delta) * 0.1;
  }
  lastTime = time;

  // Detect face with MediaPipe
  if (faceLandmarker) {
    const results = faceLandmarker.detectForVideo(video, time);

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];

      // Calculate eye fatigue
      const ear = calculateEyeAspectRatio(landmarks);
      updateEyeFatigue(ear);

      // Draw eye boxes
      drawEyeBoxes(landmarks);

    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Face not detected
      eyeFatigueEl.textContent = "顔が検出されません";
      eyeFatigueEl.style.color = "#888";
      stopAudio();
      eyeClosedStartTime = null;
      eyeClosedWarningEl.classList.add('hidden');
    }
  }

  requestAnimationFrame(process);
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log('Service Worker registered'))
    .catch((e) => console.log('Service Worker registration failed:', e));
}

// Wake Lock to prevent screen sleep
let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock activated');
    } catch (e) {
      console.log('Wake Lock failed:', e);
    }
  }
}

// Re-acquire wake lock when page becomes visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock === null) {
    requestWakeLock();
  }
});
