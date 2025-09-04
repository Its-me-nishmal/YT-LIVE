const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');

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
    
    // Animation state
    this.pulsePhase = 0;
    this.isRunning = true;
    this.startTime = Date.now();
    this.dataIntervals = [];
    
    this.init();
  }

  async init() {
    try {
      if (CONFIG.audioFile && !fs.existsSync(CONFIG.audioFile)) {
        console.error(`❌ Audio file not found: ${CONFIG.audioFile}`);
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
      
      // Reduced API call frequency for better performance
      const channelDataInterval = setInterval(() => {
        if (this.isRunning) this.fetchChannelData();
      }, 60000); // Every 60 seconds
      
      const streamDataInterval = setInterval(() => {
        if (this.isRunning) this.fetchStreamData();
      }, 10000); // Every 10 seconds

      this.dataIntervals.push(channelDataInterval, streamDataInterval);

    } catch (error) {
      console.error('Initialization error:', error);
      this.stop();
    }
  }

  setupFFmpeg() {
    const args = [
      // Video input
      '-f', 'rawvideo',
      '-vcodec', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${CONFIG.width}x${CONFIG.height}`,
      '-r', CONFIG.fps.toString(),
      '-i', '-',
      
      // Audio input
      '-stream_loop', '-1',
      '-i', CONFIG.audioFile,
      
      // **ULTRA-FAST ENCODING FOR MAXIMUM FPS**
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      
      // **SIMPLIFIED BITRATE SETTINGS**
      '-crf', '30', // Higher CRF for faster encoding
      '-maxrate', '7000k',
      '-bufsize', '4000k',
      
      '-pix_fmt', 'yuv420p',
      '-g', '30', // GOP size
      '-threads', '0', // Use all CPU threads
      '-x264-params', 'sliced-threads=1:sync-lookahead=0', // Performance optimizations
      
      // **FAST AUDIO ENCODING**
      '-c:a', 'aac',
      '-b:a', '96k',
      '-ar', '44100',
      '-ac', '2',
      
      // Stream mapping
      '-map', '0:v',
      '-map', '1:a',
      
      // Output
      '-f', 'flv',
      CONFIG.streamUrl
    ];

    console.log('⚡ Starting MAXIMUM PERFORMANCE YouTube Live Stream...');
    console.log(`🚀 Encoding: Ultra-fast preset for 30 FPS delivery`);
    console.log(`🎯 Target: Consistent frame delivery over quality`);

    this.ffmpegProcess = spawn('ffmpeg', args, { 
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    });

    this.ffmpegProcess.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        console.error('FFmpeg stdin error:', error);
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
            
            if (currentFps < 20) {
              console.log('⚠️  Low FPS detected - consider reducing video complexity');
            }
          }
        }
      } else if (message.includes('error') || message.includes('Error')) {
        console.error(`❌ FFmpeg Error: ${message}`);
      }
    });

    this.ffmpegProcess.on('error', (error) => {
      console.error('❌ FFmpeg process error:', error);
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
      // Silently handle errors to not impact performance
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
          // Ignore avatar loading errors
        }
      }
    } catch (error) {
      // Silently handle errors
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
      this.updateAnimatedValue('liveViewers', 0);
      this.updateAnimatedValue('likes', 0);
    }
  }

  httpGet(url) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timed out'));
      }, 3000); // Very short timeout

      https.get(url, { timeout: 2000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          clearTimeout(timeout);
          resolve(data);
        });
      }).on('error', (error) => {
        clearTimeout(timeout);
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
        anim.current += diff * 0.15; // Faster animation
      } else {
        anim.current = anim.target;
      }
      this.data[key] = Math.round(anim.current);
    }
  }

  // **ULTRA-SIMPLIFIED RENDERING FOR MAXIMUM PERFORMANCE**
  
  drawBackground() {
    // Solid gradient - no animation to save performance
    const gradient = this.ctx.createLinearGradient(0, 0, CONFIG.width, CONFIG.height);
    gradient.addColorStop(0, '#0f0f23');
    gradient.addColorStop(1, '#16213e');
    
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
  }

  drawLiveBadge() {
    const x = CONFIG.width / 2;
    const y = 80;
    
    // Simple pulsing effect
    const scale = 1 + Math.sin(this.pulsePhase) * 0.05;
    this.pulsePhase += 0.05; // Slower animation
    
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.scale(scale, scale);

    // Simple red rectangle
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

    // Draw avatar without any effects
    if (this.data.channelAvatar) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(centerX - 150, y, 50, 0, Math.PI * 2);
      this.ctx.clip();
      this.ctx.drawImage(this.data.channelAvatar, centerX - 200, y - 50, 100, 100);
      this.ctx.restore();
    }

    // Simple white text
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 48px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(this.data.channelName, centerX - 50, y);
  }

  drawStatCard(x, y, width, height, value, label, color) {
    // Simple card background
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.fillRect(x, y, width, height);

    // Simple border
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, width, height);

    // Value
    this.ctx.fillStyle = color;
    this.ctx.font = 'bold 56px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    
    const formattedValue = this.formatNumber(value);
    this.ctx.fillText(formattedValue, x + width / 2, y + height / 2 - 20);

    // Label
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.font = '18px Arial';
    this.ctx.fillText(label.toUpperCase(), x + width / 2, y + height / 2 + 30);
  }

  formatNumber(num) {
    if (num >= 1000000000) {
      return (num / 1000000000).toFixed(1) + 'B';
    } else if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
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

    // Clear canvas
    this.ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
    
    // Update animated values
    this.interpolateValues();
    
    // Draw all elements
    this.drawBackground();
    this.drawLiveBadge();
    this.drawChannelHeader();
    this.drawStats();

    // Send frame to FFmpeg with error handling
    if (this.ffmpegProcess && !this.ffmpegProcess.stdin.destroyed) {
      try {
        const buffer = this.canvas.toBuffer('raw');
        
        // Write with backpressure handling
        if (!this.ffmpegProcess.stdin.write(buffer)) {
          // If buffer is full, skip this frame to maintain FPS
          console.log('⚠️  Skipping frame due to buffer pressure');
        }
      } catch (error) {
        if (error.code !== 'EPIPE') {
          console.error('Error writing to FFmpeg:', error);
          this.stop();
        }
      }
    }

    this.frame++;
  }

  startAnimation() {
    // **HIGH-PERFORMANCE FRAME TIMING**
    const targetInterval = 1000 / CONFIG.fps; // 33.33ms
    let lastTime = Date.now();

    const animate = () => {
      if (!this.isRunning) return;
      
      const currentTime = Date.now();
      const deltaTime = currentTime - lastTime;

      // Only render if enough time has passed
      if (deltaTime >= targetInterval - 2) { // Small tolerance
        this.render();
        lastTime = currentTime;
      }
      
      // Use setImmediate for maximum performance
      setImmediate(animate);
    };

    animate();
    
    console.log('🔴 PERFORMANCE-OPTIMIZED YouTube Live Stream Started!');
    console.log(`⚡ Ultra-fast rendering for consistent 30 FPS`);
    console.log(`🎵 Audio: ${path.basename(CONFIG.audioFile)}`);
    console.log(`📺 Resolution: ${CONFIG.width}x${CONFIG.height}@${CONFIG.fps}fps`);
    console.log(`\n🚀 Stream optimized for maximum FPS delivery!`);
    console.log(`📱 Monitor YouTube Studio - should show ~30 FPS now`);
  }

  stop() {
    console.log('\n🛑 Stopping YouTube Live Stream...');
    this.isRunning = false;

    // Clear all intervals
    this.dataIntervals.forEach(interval => clearInterval(interval));

    // Close FFmpeg properly
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
        console.error('Error stopping FFmpeg:', error);
      }
    }

    console.log('✅ YouTube Live Stream stopped.');
  }
}

// **OPTIMIZED PROCESS HANDLERS**
process.on('SIGINT', () => {
  console.log('\n📛 Received interrupt signal...');
  if (global.liveCounter) {
    global.liveCounter.stop();
  }
  
  setTimeout(() => {
    process.exit(0);
  }, 5000);
});

process.on('SIGTERM', () => {
  console.log('\n📛 Received terminate signal...');
  if (global.liveCounter) {
    global.liveCounter.stop();
  }
  
  setTimeout(() => {
    process.exit(0);
  }, 5000);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  if (global.liveCounter) {
    global.liveCounter.stop();
  } else {
    process.exit(1);
  }
});

// **PERFORMANCE CHECK BEFORE STARTING**
console.log('🚀 Starting MAXIMUM PERFORMANCE YouTube Live Counter...\n');
console.log('⚡ Performance Optimizations:');
console.log('   - Ultra-fast H.264 encoding');
console.log('   - Simplified visual effects');
console.log('   - Reduced API call frequency');
console.log('   - Optimized frame timing');
console.log('   - Buffer backpressure handling\n');

// Check audio file
if (!fs.existsSync('./play.mp3')) {
  console.error('❌ Audio file "./play.mp3" not found!');
  process.exit(1);
}

// Start the stream
global.liveCounter = new LiveCounter();

module.exports = LiveCounter;
