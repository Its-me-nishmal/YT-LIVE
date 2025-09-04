const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

// Error logger
function logError(source, error) {
  const timestamp = new Date().toISOString();
  console.error(`❌ [${timestamp}] [${source}]`, error);
}

// CONFIG
const CONFIG = {
  width: 1280,
  height: 720,
  fps: 10,               // animation FPS
  apiInterval: 5000,      // fetch API every 5 sec
  channelId: 'UC5vPGxCutFL9onTJHQN-UsA',
  streamId: 'NAjWQNHnVD4',
  audioFile: './play.mp3',
  frameFile: './frame.png',
  streamUrl: 'rtmp://a.rtmp.youtube.com/live2/s4m4-c1xt-d0vv-vayh-11ay',
  videoBitrate: '6800k',
  bufferSize: '13600k'
};

class LiveCounter {
  constructor() {
    this.canvas = createCanvas(CONFIG.width, CONFIG.height);
    this.ctx = this.canvas.getContext('2d');
    this.data = {
      channelName: 'Loading...',
      channelAvatar: null,
      subscribers: 0,
      totalViews: 0,
      videos: 0,
      liveViewers: 0,
      likes: 0
    };
    this.animatedValues = {};
    this.isRunning = true;
    this.ffmpegProcess = null;
    this.pulsePhase = 0;

    this.init();
  }

  async init() {
    try {
      if (!fs.existsSync(CONFIG.audioFile)) {
        logError('Init', `Audio file not found: ${CONFIG.audioFile}`);
        process.exit(1);
      }

      try {
        registerFont('./fonts/Roboto-Bold.ttf', { family: 'Roboto Bold' });
        registerFont('./fonts/Roboto-Regular.ttf', { family: 'Roboto' });
      } catch (e) {
        console.log('Custom fonts not found, using default fonts');
      }

      await this.fetchData();
      this.startFFmpeg();
      this.startAnimation();
      this.setupIntervals();
    } catch (error) {
      logError('Initialization', error);
      this.stop();
    }
  }

  setupIntervals() {
    // Fetch channel & stream data every 5 seconds
    setInterval(() => {
      if (this.isRunning) this.fetchData();
    }, CONFIG.apiInterval);
  }

  startFFmpeg() {
    const args = [
      '-re',
      '-loop', '1',
      '-framerate', CONFIG.fps.toString(),
      '-i', CONFIG.frameFile,
      '-i', CONFIG.audioFile,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', CONFIG.videoBitrate,
      '-maxrate', CONFIG.videoBitrate,
      '-bufsize', CONFIG.bufferSize,
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-f', 'flv',
      CONFIG.streamUrl
    ];

    const startProcess = () => {
      console.log('⚡ Starting YouTube Live FFmpeg...');
      this.ffmpegProcess = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

      this.ffmpegProcess.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) logError('FFmpeg stderr', msg);
      });

      this.ffmpegProcess.on('close', code => {
        console.log(`FFmpeg closed with code ${code}, restarting...`);
        if (this.isRunning) setTimeout(startProcess, 2000);
      });

      this.ffmpegProcess.on('error', err => {
        logError('FFmpeg process', err);
        if (this.isRunning) setTimeout(startProcess, 2000);
      });
    };

    startProcess();
  }

  async fetchData() {
    await Promise.all([this.fetchChannelData(), this.fetchStreamData()]);
  }

  async fetchChannelData() {
    try {
      const data = await this.httpGet(`https://mixerno.space/api/youtube-channel-counter/user/${CONFIG.channelId}`);
      const parsed = JSON.parse(data);
      const user = Object.fromEntries(parsed.user.map(u => [u.value, u.count]));
      const counts = Object.fromEntries(parsed.counts.map(c => [c.value, c.count]));

      this.data.channelName = user.name || 'Unknown';
      this.updateAnimatedValue('subscribers', counts.subscribers);
      this.updateAnimatedValue('totalViews', counts.views);
      this.updateAnimatedValue('videos', counts.videos);

      if (user.pfp && !this.data.channelAvatar) {
        try {
          this.data.channelAvatar = await loadImage(user.pfp);
        } catch (imgError) {
          logError('Avatar Load', imgError.message);
        }
      }
    } catch (error) {
      logError('Channel Data', error.message);
    }
  }

  async fetchStreamData() {
    try {
      const data = await this.httpGet(`https://mixerno.space/api/youtube-stream-counter/user/${CONFIG.streamId}`);
      const parsed = JSON.parse(data);
      const counts = Object.fromEntries(parsed.counts.map(c => [c.value, c.count || 0]));
      this.updateAnimatedValue('liveViewers', counts.viewers);
      this.updateAnimatedValue('likes', counts.likes);
    } catch (error) {
      logError('Stream Data', error.message);
      this.updateAnimatedValue('liveViewers', 0);
      this.updateAnimatedValue('likes', 0);
    }
  }

  httpGet(url) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Request timed out')), 3000);
      https.get(url, { timeout: 2000 }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { clearTimeout(timeout); resolve(data); });
      }).on('error', error => { clearTimeout(timeout); logError('HTTP GET', `${url} → ${error.message}`); reject(error); });
    });
  }

  updateAnimatedValue(key, targetValue) {
    if (!this.animatedValues[key]) this.animatedValues[key] = { current: 0, target: 0 };
    this.animatedValues[key].target = parseInt(targetValue) || 0;
  }

  interpolateValues() {
    for (const key in this.animatedValues) {
      const anim = this.animatedValues[key];
      const diff = anim.target - anim.current;
      anim.current += diff * 0.15;
      this.data[key] = Math.round(anim.current);
    }
  }

  drawBackground() {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, CONFIG.width, CONFIG.height);
    gradient.addColorStop(0, '#0f0f23');
    gradient.addColorStop(1, '#16213e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
  }

  drawLiveBadge() {
    const ctx = this.ctx;
    const scale = 1 + Math.sin(this.pulsePhase) * 0.05;
    this.pulsePhase += 0.05;

    ctx.save();
    ctx.translate(CONFIG.width / 2, 75);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(-100, -25, 200, 50);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔴 LIVE', 0, 0);
    ctx.restore();
  }

  drawChannelHeader() {
    const ctx = this.ctx;
    const centerX = CONFIG.width / 2;
    const y = 200;

    if (this.data.channelAvatar) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX - 150, y, 50, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(this.data.channelAvatar, centerX - 200, y - 50, 100, 100);
      ctx.restore();
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.data.channelName, centerX - 50, y);
  }

  drawStats() {
    const ctx = this.ctx;
    const cardWidth = 200;
    const cardHeight = 120;
    const gap = 20;
    const stats = [
      { key: 'subscribers', label: 'Subscribers', color: '#ff6b6b' },
      { key: 'totalViews', label: 'Total Views', color: '#4ecdc4' },
      { key: 'videos', label: 'Videos', color: '#45b7d1' },
      { key: 'liveViewers', label: 'Live Viewers', color: '#ff4757' },
      { key: 'likes', label: 'Stream Likes', color: '#ffa502' }
    ];

    const startX = (CONFIG.width - (stats.length * cardWidth + gap * (stats.length - 1))) / 2;
    const y = CONFIG.height - cardHeight - 50;

    stats.forEach((stat, index) => {
      const x = startX + index * (cardWidth + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(x, y, cardWidth, cardHeight);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cardWidth, cardHeight);

      ctx.fillStyle = stat.color;
      ctx.font = 'bold 36px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.data[stat.key].toLocaleString(), x + cardWidth / 2, y + cardHeight / 2 - 15);

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '16px Arial';
      ctx.fillText(stat.label.toUpperCase(), x + cardWidth / 2, y + cardHeight / 2 + 25);
    });
  }

  renderFrame() {
    this.interpolateValues();
    this.drawBackground();
    this.drawLiveBadge();
    this.drawChannelHeader();
    this.drawStats();
    fs.writeFileSync(CONFIG.frameFile, this.canvas.toBuffer('image/png'));
  }

  startAnimation() {
    setInterval(() => {
      if (!this.isRunning) return;
      this.renderFrame();
    }, 1000 / CONFIG.fps);
  }

  stop() {
    console.log('🛑 Stopping Live Counter...');
    this.isRunning = false;
    if (this.ffmpegProcess && !this.ffmpegProcess.killed) this.ffmpegProcess.kill('SIGTERM');
  }
}

// Graceful exit
process.on('SIGINT', () => { if (global.liveCounter) global.liveCounter.stop(); process.exit(); });
process.on('SIGTERM', () => { if (global.liveCounter) global.liveCounter.stop(); process.exit(); });

global.liveCounter = new LiveCounter();
