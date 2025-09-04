const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');

// Centralized error logger
function logError(source, error) {
  const timestamp = new Date().toISOString();
  console.error(`\n❌ [${timestamp}] [${source}]`, error);
}

// Configuration
const CONFIG = {
  width: 1920,
  height: 1080,
  fps: 30,
  channelId: 'UC5vPGxCutFL9onTJHQN-UsA',
  streamId: 'tXRuaacO-ZU',
  outputFile: null,
  streamUrl: 'rtmp://a.rtmp.youtube.com/live2/s4m4-c1xt-d0vv-vayh-11ay',
  duration: 0,
  audioFile: './play.mp3'
};

class LiveCounter {
  constructor() {
    this.canvas = createCanvas(CONFIG.width, CONFIG.height);
    this.ctx = this.canvas.getContext('2d');
    this.frame = 0;
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
    this.ffmpegProcess = null;

    this.pulsePhase = 0;
    this.isRunning = true;
    this.startTime = Date.now();
    this.dataIntervals = [];

    this.init();
  }

  async init() {
    try {
      if (CONFIG.audioFile && !fs.existsSync(CONFIG.audioFile)) {
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
      this.setupFFmpeg();
      this.startAnimation();

      const channelDataInterval = setInterval(() => {
        if (this.isRunning) this.fetchChannelData();
      }, 60000);

      const streamDataInterval = setInterval(() => {
        if (this.isRunning) this.fetchStreamData();
      }, 10000);

      this.dataIntervals.push(channelDataInterval, streamDataInterval);
    } catch (error) {
      logError('Initialization', error);
      this.stop();
    }
  }

  setupFFmpeg() {
    const args = [
      '-f', 'rawvideo',
      '-vcodec', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${CONFIG.width}x${CONFIG.height}`,
      '-r', CONFIG.fps.toString(),
      '-i', '-',
      '-stream_loop', '-1',
      '-i', CONFIG.audioFile,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', '30',
      '-maxrate', '7000k',
      '-bufsize', '4000k',
      '-pix_fmt', 'yuv420p',
      '-g', '30',
      '-threads', '0',
      '-x264-params', 'sliced-threads=1:sync-lookahead=0',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-ar', '44100',
      '-ac', '2',
      '-map', '0:v',
      '-map', '1:a',
      '-f', 'flv',
      CONFIG.streamUrl
    ];

    console.log('⚡ Starting MAXIMUM PERFORMANCE YouTube Live Stream...');
    console.log(`🚀 Encoding: Ultra-fast preset for 30 FPS delivery`);

    this.ffmpegProcess = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    });

    this.ffmpegProcess.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        logError('FFmpeg stdin', error);
      }
    });

    this.ffmpegProcess.stderr.on('data', (data) => {
      const message = data.toString();
      if (message.includes('frame=')) {
        if (this.frame % 150 === 0) {
          const bitrateMatch = message.match(/bitrate=\s*([0-9.]+)kbits\/s/);
          const fpsMatch = message.match(/fps=\s*([0-9.]+)/);
          if (bitrateMatch && fpsMatch) {
            const currentFps = parseFloat(fpsMatch[1]);
            const status = currentFps >= 25 ? '✅' : currentFps >= 20 ? '⚠️' : '❌';
            console.log(`${status} Bitrate: ${bitrateMatch[1]} Kbps | FPS: ${currentFps} | Frame: ${this.frame}`);
          }
        }
      } else if (message.toLowerCase().includes('error')) {
        logError('FFmpeg stderr', message);
      }
    });

    this.ffmpegProcess.on('error', (error) => {
      logError('FFmpeg process', error);
    });

    this.ffmpegProcess.on('close', (code) => {
      console.log(`\n📹 FFmpeg exited with code ${code}`);
    });
  }

  async fetchData() {
    try {
      await Promise.all([
        this.fetchChannelData(),
        this.fetchStreamData()
      ]);
    } catch (error) {
      logError('Fetch Data', error);
    }
  }

  async fetchChannelData() {
    try {
      const data = await this.httpGet(`https://mixerno.space/api/youtube-channel-counter/user/${CONFIG.channelId}`);
      const parsedData = JSON.parse(data);

      const user = Object.fromEntries(parsedData.user.map(u => [u.value, u.count]));
      const counts = Object.fromEntries(parsedData.counts.map(c => [c.value, c.count]));

      this.data.channelName = user.name || 'Unknown Channel';
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
      const parsedData = JSON.parse(data);

      const counts = Object.fromEntries(parsedData.counts.map(c => [c.value, c.count || 0]));

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
      const timeout = setTimeout(() => {
        reject(new Error('Request timed out'));
      }, 3000);

      https.get(url, { timeout: 2000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          clearTimeout(timeout);
          resolve(data);
        });
      }).on('error', (error) => {
        clearTimeout(timeout);
        logError('HTTP GET', `${url} → ${error.message}`);
        reject(error);
      });
    });
  }

  updateAnimatedValue(key, targetValue) {
    if (!this.animatedValues[key]) {
      this.animatedValues[key] = { current: 0, target: 0 };
    }
    this.animatedValues[key].target = parseInt(targetValue) || 0;
  }

  interpolateValues() {
    for (const key in this.animatedValues) {
      const anim = this.animatedValues[key];
      const diff = anim.target - anim.current;
      if (Math.abs(diff) > 1) {
        anim.current += diff * 0.15;
      } else {
        anim.current = anim.target;
      }
      this.data[key] = Math.round(anim.current);
    }
  }

  drawBackground() {
    const gradient = this.ctx.createLinearGradient(0, 0, CONFIG.width, CONFIG.height);
    gradient.addColorStop(0, '#0f0f23');
    gradient.addColorStop(1, '#16213e');

    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
  }

  drawLiveBadge() {
    const x = CONFIG.width / 2;
    const y = 80;
    const scale = 1 + Math.sin(this.pulsePhase) * 0.05;
    this.pulsePhase += 0.05;

    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.scale(scale, scale);

    this.ctx.fillStyle = '#ff0000';
    this.ctx.fillRect(-100, -25, 200, 50);

    this.ctx.fillStyle = 'white';
    this.ctx.font = 'bold 28px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🔴 LIVE', 0, 0);

    this.ctx.restore();
  }

  drawChannelHeader() {
    const centerX = CONFIG.width / 2;
    const y = 200;

    if (this.data.channelAvatar) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(centerX - 150, y, 50, 0, Math.PI * 2);
      this.ctx.clip();
      this.ctx.drawImage(this.data.channelAvatar, centerX - 200, y - 50, 100, 100);
      this.ctx.restore();
    }

    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 48px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(this.data.channelName, centerX - 50, y);
  }

  drawStatCard(x, y, width, height, value, label, color) {
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.fillRect(x, y, width, height);

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, width, height);

    this.ctx.fillStyle = color;
    this.ctx.font = 'bold 56px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(this.formatNumber(value), x + width / 2, y + height / 2 - 20);

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.font = '18px Arial';
    this.ctx.fillText(label.toUpperCase(), x + width / 2, y + height / 2 + 30);
  }

  formatNumber(num) {
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toLocaleString();
  }

  drawStats() {
    const cardWidth = 300;
    const cardHeight = 180;
    const gap = 40;
    const totalWidth = (cardWidth * 5) + (gap * 4);
    const startX = (CONFIG.width - totalWidth) / 2;
    const y = CONFIG.height - cardHeight - 100;

    const stats = [
      { value: this.data.subscribers, label: 'Subscribers', color: '#ff6b6b' },
      { value: this.data.totalViews, label: 'Total Views', color: '#4ecdc4' },
      { value: this.data.videos, label: 'Videos', color: '#45b7d1' },
      { value: this.data.liveViewers, label: 'Live Viewers', color: '#ff4757' },
      { value: this.data.likes, label: 'Stream Likes', color: '#ffa502' }
    ];

    stats.forEach((stat, index) => {
      const x = startX + (cardWidth + gap) * index;
      this.drawStatCard(x, y, cardWidth, cardHeight, stat.value, stat.label, stat.color);
    });
  }

  render() {
    if (!this.isRunning) return;

    this.ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
    this.interpolateValues();
    this.drawBackground();
    this.drawLiveBadge();
    this.drawChannelHeader();
    this.drawStats();

    if (this.ffmpegProcess && !this.ffmpegProcess.stdin.destroyed) {
      try {
        const buffer = this.canvas.toBuffer('raw');
        if (!this.ffmpegProcess.stdin.write(buffer)) {
          console.log('⚠️  Skipping frame due to buffer pressure');
        }
      } catch (error) {
        if (error.code !== 'EPIPE') {
          logError('Render Frame', error);
          this.stop();
        }
      }
    }
    this.frame++;
  }

  startAnimation() {
    const targetInterval = 1000 / CONFIG.fps;
    let lastTime = Date.now();

    const animate = () => {
      if (!this.isRunning) return;
      const currentTime = Date.now();
      const deltaTime = currentTime - lastTime;
      if (deltaTime >= targetInterval - 2) {
        this.render();
        lastTime = currentTime;
      }
      setImmediate(animate);
    };

    animate();

    console.log('🔴 PERFORMANCE-OPTIMIZED YouTube Live Stream Started!');
    console.log(`📺 Resolution: ${CONFIG.width}x${CONFIG.height}@${CONFIG.fps}fps`);
  }

  stop() {
    console.log('\n🛑 Stopping YouTube Live Stream...');
    this.isRunning = false;
    this.dataIntervals.forEach(interval => clearInterval(interval));

    if (this.ffmpegProcess && !this.ffmpegProcess.stdin.destroyed) {
      try {
        console.log('📝 Ending live stream...');
        this.ffmpegProcess.stdin.end();
        setTimeout(() => {
          if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
            this.ffmpegProcess.kill('SIGTERM');
            setTimeout(() => {
              if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
                this.ffmpegProcess.kill('SIGKILL');
              }
            }, 3000);
          }
        }, 1000);
      } catch (error) {
        logError('Stop FFmpeg', error);
      }
    }
    console.log('✅ YouTube Live Stream stopped.');
  }
}

process.on('SIGINT', () => {
  console.log('\n📛 Received interrupt signal...');
  if (global.liveCounter) global.liveCounter.stop();
  setTimeout(() => process.exit(0), 5000);
});

process.on('SIGTERM', () => {
  console.log('\n📛 Received terminate signal...');
  if (global.liveCounter) global.liveCounter.stop();
  setTimeout(() => process.exit(0), 5000);
});

process.on('uncaughtException', (error) => {
  logError('Uncaught Exception', error);
  if (global.liveCounter) {
    global.liveCounter.stop();
  } else {
    process.exit(1);
  }
});

console.log('🚀 Starting MAXIMUM PERFORMANCE YouTube Live Counter...\n');

// Check audio file
if (!fs.existsSync('./play.mp3')) {
  logError('Startup', 'Audio file "./play.mp3" not found!');
  process.exit(1);
}

// Start the stream
global.liveCounter = new LiveCounter();

module.exports = LiveCounter;
