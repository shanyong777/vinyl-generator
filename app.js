import { Muxer, ArrayBufferTarget } from 'https://cdn.jsdelivr.net/npm/mp4-muxer/+esm';

const logDebug = (msg) => {
    console.log(msg);
    const content = document.getElementById('debug-log-content');
    if (content) {
        content.innerHTML += '<div style="color:#34d399;">[app.js] ' + msg + '</div>';
        const panel = document.getElementById('debug-log-panel');
        if (panel) panel.scrollTop = panel.scrollHeight;
    }
};

logDebug("app.js loaded!");

// --- CONFIGURATION & STATE ---
const state = {
    // Layout
    aspectRatio: '1-1', // '1-1', '9-16', '16-9'
    bgStyle: 'blurred', // 'blurred', 'solid', 'gradient', 'custom'
    bgColor: '#121217',
    bgGradColor1: '#1e1e24',
    bgGradColor2: '#0a0a0d',
    bgGradAngle: 135,
    bgBlurIntensity: 40,
    bgVignetteIntensity: 50,

    // Vinyl Customization
    vinylColorStyle: 'black', // 'black', 'cherry', 'royal', 'jade', 'translucent-gold', 'custom'
    customVinylColor: '#3a0d5c',
    isTranslucent: false,
    labelTitle: 'Lost in Rotation',
    artistName: 'Synthesized Dreams',
    albumName: 'Lofi Orbitals Vol. I',
    labelSize: 33, // percentage of vinyl radius
    labelStyle: 'full-art',

    // Effects
    spinRPM: 33,
    spinReverse: false,
    grooveVisibility: 65,
    shineIntensity: 50,
    showToneArm: true,
    showSpindle: true,
    pulseToneArm: false,
    showLabelText: true,
    showAmbientText: true,
    ambientTextPos: 'bottom-left',

    // Audio & Visualizer
    visualizerType: 'pulse',
    visualizerColor: '#10b981',
    visualizerSensitivity: 5,
    exportDurationType: 'preset', // 'preset', 'full'
    exportDurationPreset: 30, // seconds

    // Video Export Settings
    exportResolution: '1080', // '720', '1080', '1440'
    exportFps: 30,
    exportBitrate: 8, // Mbps

    // Loaded Media Elements
    coverImage: null, // HTMLImageElement
    bgImage: null, // HTMLImageElement
    audioFile: null, // File object
    audioBuffer: null, // Decoded AudioBuffer
};

// Global variables for playback & animation
let audioCtx = null;
let audioSource = null;
let analyserNode = null;
let gainNode = null;
let isPlaying = false;
let playbackStartTime = 0;
let playbackPauseTime = 0;
let playbackDuration = 0;

let currentRotationAngle = 0;
let lastDrawTime = 0;
let animFrameId = null;
let volumeMeterRms = 0;
let frequencyData = new Uint8Array(128);

// Tone Arm state
const toneArmState = {
    currentAngle: 1.1, // radians, resting position
    targetAngle: 1.1,
    vibrationX: 0,
    vibrationY: 0
};

// Export variables
let isExporting = false;
let cancelExportRequested = false;

// DOM Elements
const canvas = document.getElementById('preview-canvas');
const ctx = canvas.getContext('2d');
const canvasWrapper = document.getElementById('canvas-aspect-wrapper');
const resolutionIndicator = document.getElementById('preview-resolution-text');

// Initialize placeholders
const createPlaceholderCover = () => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 512;
    tempCanvas.height = 512;
    const tCtx = tempCanvas.getContext('2d');
    
    // Nice gradient background
    const grad = tCtx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#1e1e2d');
    grad.addColorStop(1, '#0e0e15');
    tCtx.fillStyle = grad;
    tCtx.fillRect(0, 0, 512, 512);
    
    // Abstract geometric elements
    tCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    tCtx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
        tCtx.beginPath();
        tCtx.arc(256, 256, 40 + i * 45, 0, Math.PI * 2);
        tCtx.stroke();
    }
    
    // Sub-rects
    tCtx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    tCtx.beginPath();
    tCtx.arc(256, 256, 110, 0, Math.PI * 2);
    tCtx.fill();
    
    const img = new Image();
    img.src = tempCanvas.toDataURL();
    return img;
};

// Set default cover
state.coverImage = createPlaceholderCover();

// --- CANVAS RENDERING PIPELINE ---

// Fast blur trick: draws scaled down image, then stretches it back to blur naturally
const drawFastBlurredImage = (image, targetCtx, w, h, blurAmount) => {
    if (!image) return;
    
    // Blur factor: smaller means more blur, cheaper render
    const scale = Math.max(0.01, 1 - (blurAmount / 100)); 
    const sw = Math.floor(w * scale);
    const sh = Math.floor(h * scale);
    
    const offscreen = document.createElement('canvas');
    offscreen.width = sw;
    offscreen.height = sh;
    const oCtx = offscreen.getContext('2d');
    
    // Draw cover cropped to square first if it's blurred artwork
    oCtx.drawImage(image, 0, 0, sw, sh);
    
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.drawImage(offscreen, 0, 0, sw, sh, 0, 0, w, h);
};

// Render full frames onto target context
const renderFrame = (targetCtx, w, h, rotationAngle, audioMetrics) => {
    const { rms, waveform } = audioMetrics;
    const center = { x: w / 2, y: h / 2 };
    const baseDimension = Math.min(w, h);
    
    // 1. Draw Background
    targetCtx.fillStyle = '#08080c';
    targetCtx.fillRect(0, 0, w, h);
    
    if (state.bgStyle === 'blurred' && state.coverImage) {
        drawFastBlurredImage(state.coverImage, targetCtx, w, h, 100 - state.bgBlurIntensity);
    } else if (state.bgStyle === 'solid') {
        targetCtx.fillStyle = state.bgColor;
        targetCtx.fillRect(0, 0, w, h);
    } else if (state.bgStyle === 'gradient') {
        const rad = (state.bgGradAngle * Math.PI) / 180;
        const x2 = w * Math.cos(rad);
        const y2 = h * Math.sin(rad);
        const grad = targetCtx.createLinearGradient(0, 0, x2, y2);
        grad.addColorStop(0, state.bgGradColor1);
        grad.addColorStop(1, state.bgGradColor2);
        targetCtx.fillStyle = grad;
        targetCtx.fillRect(0, 0, w, h);
    } else if (state.bgStyle === 'custom' && state.bgImage) {
        // Draw centered and cover-scaled background
        const imgRatio = state.bgImage.width / state.bgImage.height;
        const targetRatio = w / h;
        let sw, sh, sx, sy;
        if (imgRatio > targetRatio) {
            sh = state.bgImage.height;
            sw = sh * targetRatio;
            sx = (state.bgImage.width - sw) / 2;
            sy = 0;
        } else {
            sw = state.bgImage.width;
            sh = sw / targetRatio;
            sx = 0;
            sy = (state.bgImage.height - sh) / 2;
        }
        targetCtx.drawImage(state.bgImage, sx, sy, sw, sh, 0, 0, w, h);
    }
    
    // Add Vignette Overlay
    const vignetteDarkness = state.bgVignetteIntensity / 100;
    const vigGrad = targetCtx.createRadialGradient(center.x, center.y, baseDimension * 0.1, center.x, center.y, baseDimension * 0.85);
    vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vigGrad.addColorStop(1, `rgba(0, 0, 0, ${vignetteDarkness * 0.95})`);
    targetCtx.fillStyle = vigGrad;
    targetCtx.fillRect(0, 0, w, h);

    // 2. Draw Ambient Text Over Background
    if (state.showAmbientText) {
        targetCtx.save();
        targetCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        targetCtx.font = `500 ${Math.round(baseDimension * 0.038)}px "Outfit", sans-serif`;
        
        let tx, ty;
        let padX = w * 0.08;
        let padY = h * 0.08;
        
        if (state.ambientTextPos === 'bottom-left') {
            tx = padX;
            ty = h - padY;
            targetCtx.textAlign = 'left';
        } else if (state.ambientTextPos === 'top-left') {
            tx = padX;
            ty = padY + baseDimension * 0.04;
            targetCtx.textAlign = 'left';
        } else { // center-bottom
            tx = w / 2;
            ty = h - padY;
            targetCtx.textAlign = 'center';
        }

        // Draw track info in two rows
        targetCtx.fillText(state.labelTitle, tx, ty - baseDimension * 0.032);
        
        targetCtx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        targetCtx.font = `400 ${Math.round(baseDimension * 0.022)}px "Outfit", sans-serif`;
        targetCtx.fillText(`${state.artistName}  —  ${state.albumName}`, tx, ty);
        targetCtx.restore();
    }
    
    // 3. Draw Audio Visualizer Rings/Waves
    let finalSensitivity = (state.visualizerSensitivity / 5);
    let pulseScale = 1.0;
    if (state.visualizerType === 'pulse') {
        pulseScale = 1.0 + (rms * 0.08 * finalSensitivity);
    }
    
    const vinylBaseRadius = baseDimension * 0.35 * pulseScale;
    
    if (state.visualizerType === 'ring' || state.visualizerType === 'bars' || state.visualizerType === 'double-bars' || state.visualizerType === 'deformed-ring' || state.visualizerType === 'spiral') {
        targetCtx.save();
        targetCtx.translate(center.x, center.y);
        
        const pointCount = 128;
        const waveColor = state.visualizerColor;
        
        targetCtx.strokeStyle = waveColor;
        targetCtx.shadowColor = waveColor;
        targetCtx.shadowBlur = 10;
        targetCtx.lineWidth = Math.max(1.5, baseDimension * 0.0035);
        
        if (state.visualizerType === 'ring') {
            targetCtx.beginPath();
            for (let i = 0; i < pointCount; i++) {
                const angle = (i / pointCount) * Math.PI * 2 + rotationAngle * 0.2; // Slow counter spin
                const sampleVal = waveform[i % waveform.length] || 0;
                
                // Radius offsets
                const offset = sampleVal * baseDimension * 0.09 * finalSensitivity;
                const r = vinylBaseRadius + Math.max(-10, offset);
                
                const px = r * Math.cos(angle);
                const py = r * Math.sin(angle);
                
                if (i === 0) targetCtx.moveTo(px, py);
                else targetCtx.lineTo(px, py);
            }
            targetCtx.closePath();
            targetCtx.stroke();
        } else if (state.visualizerType === 'bars') {
            for (let i = 0; i < pointCount; i += 2) {
                const angle = (i / pointCount) * Math.PI * 2 + rotationAngle * 0.15;
                const sampleVal = Math.abs(waveform[i % waveform.length]) || 0;
                
                const barLen = Math.max(2, sampleVal * baseDimension * 0.12 * finalSensitivity);
                
                const startX = vinylBaseRadius * Math.cos(angle);
                const startY = vinylBaseRadius * Math.sin(angle);
                
                const endX = (vinylBaseRadius + barLen) * Math.cos(angle);
                const endY = (vinylBaseRadius + barLen) * Math.sin(angle);
                
                targetCtx.beginPath();
                targetCtx.moveTo(startX, startY);
                targetCtx.lineTo(endX, endY);
                targetCtx.stroke();
            }
        } else if (state.visualizerType === 'double-bars') {
            for (let i = 0; i < pointCount; i += 2) {
                const angle = (i / pointCount) * Math.PI * 2 + rotationAngle * 0.15;
                const sampleVal = Math.abs(waveform[i % waveform.length]) || 0;
                
                const barLen = Math.max(2, sampleVal * baseDimension * 0.09 * finalSensitivity);
                
                // Outward bar
                const startX1 = vinylBaseRadius * Math.cos(angle);
                const startY1 = vinylBaseRadius * Math.sin(angle);
                const endX1 = (vinylBaseRadius + barLen) * Math.cos(angle);
                const endY1 = (vinylBaseRadius + barLen) * Math.sin(angle);
                
                // Inward bar
                const startX2 = vinylBaseRadius * Math.cos(angle);
                const startY2 = vinylBaseRadius * Math.sin(angle);
                const endX2 = (vinylBaseRadius - barLen * 0.6) * Math.cos(angle);
                const endY2 = (vinylBaseRadius - barLen * 0.6) * Math.sin(angle);
                
                targetCtx.beginPath();
                targetCtx.moveTo(startX1, startY1);
                targetCtx.lineTo(endX1, endY1);
                targetCtx.stroke();
                
                targetCtx.beginPath();
                targetCtx.moveTo(startX2, startY2);
                targetCtx.lineTo(endX2, endY2);
                targetCtx.stroke();
            }
        } else if (state.visualizerType === 'deformed-ring') {
            targetCtx.beginPath();
            const angleStep = (Math.PI * 2) / pointCount;
            for (let i = 0; i < pointCount; i++) {
                const angle = i * angleStep + rotationAngle * 0.1;
                const sampleVal = Math.abs(waveform[i % waveform.length]) || 0;
                
                const offset = sampleVal * baseDimension * 0.09 * finalSensitivity;
                const r = vinylBaseRadius + offset;
                
                const px = r * Math.cos(angle);
                const py = r * Math.sin(angle);
                
                if (i === 0) targetCtx.moveTo(px, py);
                else targetCtx.lineTo(px, py);
            }
            targetCtx.closePath();
            targetCtx.stroke();
        } else if (state.visualizerType === 'spiral') {
            const spiralCount = 120;
            const waveColor = state.visualizerColor;
            let rgb = '16, 185, 129';
            if (waveColor.startsWith('#')) {
                const r = parseInt(waveColor.slice(1, 3), 16);
                const g = parseInt(waveColor.slice(3, 5), 16);
                const b = parseInt(waveColor.slice(5, 7), 16);
                rgb = `${r}, ${g}, ${b}`;
            }
            
            for (let i = 0; i < spiralCount; i++) {
                const theta = (i * 0.18) + rotationAngle * 0.15;
                const baseR = vinylBaseRadius * 0.45 + (i * (vinylBaseRadius * 0.9) / spiralCount);
                
                const freqIdx = i % waveform.length;
                const freqVal = (waveform[freqIdx] / 255) || 0;
                
                const r = baseR + freqVal * baseDimension * 0.06 * finalSensitivity;
                const alpha = (1.0 - (i / spiralCount)) * (0.35 + freqVal * 0.65);
                const dotSize = Math.max(1.2, (1.0 - (i / spiralCount)) * 4.5 + freqVal * 2.5);
                
                const px = r * Math.cos(theta);
                const py = r * Math.sin(theta);
                
                targetCtx.beginPath();
                targetCtx.arc(px, py, dotSize, 0, Math.PI * 2);
                targetCtx.fillStyle = `rgba(${rgb}, ${alpha})`;
                targetCtx.fill();
            }
        }
        
        targetCtx.restore();
    }
    
    // 3.b Draw Behind-Vinyl Ambient Visualizers (Glow / Particles)
    if (state.visualizerType === 'glow-pulse') {
        targetCtx.save();
        const glowRadius = vinylBaseRadius * 1.6;
        const glowGrad = targetCtx.createRadialGradient(center.x, center.y, vinylBaseRadius * 0.7, center.x, center.y, glowRadius);
        const visColor = state.visualizerColor;
        let rgb = '16, 185, 129';
        if (visColor.startsWith('#')) {
            const r = parseInt(visColor.slice(1, 3), 16);
            const g = parseInt(visColor.slice(3, 5), 16);
            const b = parseInt(visColor.slice(5, 7), 16);
            rgb = `${r}, ${g}, ${b}`;
        }
        const glowOpacity = 0.35 + (rms * 0.45 * finalSensitivity);
        glowGrad.addColorStop(0, `rgba(${rgb}, ${glowOpacity})`);
        glowGrad.addColorStop(0.4, `rgba(${rgb}, ${glowOpacity * 0.45})`);
        glowGrad.addColorStop(1, `rgba(${rgb}, 0)`);
        
        targetCtx.fillStyle = glowGrad;
        targetCtx.beginPath();
        targetCtx.arc(center.x, center.y, glowRadius, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.restore();
    } else if (state.visualizerType === 'particles') {
        targetCtx.save();
        targetCtx.translate(center.x, center.y);
        
        const particleCount = 45;
        const visColor = state.visualizerColor;
        let rgb = '16, 185, 129';
        if (visColor.startsWith('#')) {
            const r = parseInt(visColor.slice(1, 3), 16);
            const g = parseInt(visColor.slice(3, 5), 16);
            const b = parseInt(visColor.slice(5, 7), 16);
            rgb = `${r}, ${g}, ${b}`;
        }
        
        const timeVal = Math.abs(rotationAngle) * 45;
        
        for (let i = 0; i < particleCount; i++) {
            const seedAngle = (i * 137.5) * Math.PI / 180;
            const speed = 1.0 + (i % 3) * 0.8;
            
            const startDist = vinylBaseRadius * 0.85;
            const maxDist = baseDimension * 0.48;
            const travelRange = maxDist - startDist;
            
            let dist = startDist + ((timeVal * speed + (i * 25)) % travelRange);
            
            const frequencyIdx = i % waveform.length;
            const freqVal = (waveform[frequencyIdx] / 255) || 0;
            dist += freqVal * baseDimension * 0.04 * finalSensitivity;
            
            const size = Math.max(1.2, (1.0 - (dist - startDist) / travelRange) * 4.5 + freqVal * 3);
            const alpha = (1.0 - (dist - startDist) / travelRange) * (0.25 + freqVal * 0.7);
            
            const px = dist * Math.cos(seedAngle);
            const py = dist * Math.sin(seedAngle);
            
            targetCtx.beginPath();
            targetCtx.arc(px, py, size, 0, Math.PI * 2);
            targetCtx.fillStyle = `rgba(${rgb}, ${alpha})`;
            
            targetCtx.shadowColor = visColor;
            targetCtx.shadowBlur = size * 1.2;
            targetCtx.fill();
        }
        targetCtx.restore();
    }

    // 4. Draw Vinyl Body Shadow
    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.arc(center.x, center.y + baseDimension * 0.015, vinylBaseRadius, 0, Math.PI * 2);
    targetCtx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    targetCtx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    targetCtx.shadowBlur = baseDimension * 0.04;
    targetCtx.fill();
    targetCtx.restore();
    
    // 5. Draw Vinyl Disk Body
    targetCtx.save();
    targetCtx.translate(center.x, center.y);
    
    let vinylFill = '#0e0e11';
    let isTranslucentStyle = state.isTranslucent;
    
    if (state.vinylColorStyle === 'cherry') {
        vinylFill = isTranslucentStyle ? 'rgba(114, 13, 28, 0.72)' : '#4a0812';
    } else if (state.vinylColorStyle === 'royal') {
        vinylFill = isTranslucentStyle ? 'rgba(15, 76, 129, 0.72)' : '#0a3052';
    } else if (state.vinylColorStyle === 'jade') {
        vinylFill = isTranslucentStyle ? 'rgba(26, 79, 56, 0.72)' : '#103324';
    } else if (state.vinylColorStyle === 'translucent-gold') {
        vinylFill = 'rgba(212, 163, 89, 0.65)';
    } else if (state.vinylColorStyle === 'custom') {
        const hex = state.customVinylColor;
        if (isTranslucentStyle) {
            // Hex to RGBA conversion helper
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            vinylFill = `rgba(${r}, ${g}, ${b}, 0.72)`;
        } else {
            vinylFill = hex;
        }
    }
    
    targetCtx.beginPath();
    targetCtx.arc(0, 0, vinylBaseRadius, 0, Math.PI * 2);
    targetCtx.fillStyle = vinylFill;
    targetCtx.fill();
    
    // Sub-groove details (Inner circles)
    const grooveOpacity = state.grooveVisibility / 100;
    targetCtx.strokeStyle = `rgba(255, 255, 255, ${grooveOpacity * 0.045})`;
    targetCtx.lineWidth = 1;
    
    // Draw 35 concentric grooves
    for (let r = vinylBaseRadius * 0.42; r < vinylBaseRadius * 0.96; r += (vinylBaseRadius * 0.016)) {
        targetCtx.beginPath();
        // Add random micro adjustments for visual realism
        const jitter = Math.sin(r * 5) * 0.5;
        targetCtx.arc(0, 0, r + jitter, 0, Math.PI * 2);
        targetCtx.stroke();
    }
    
    // Muted dark grooves for contrast
    targetCtx.strokeStyle = `rgba(0, 0, 0, ${grooveOpacity * 0.2})`;
    for (let r = vinylBaseRadius * 0.45; r < vinylBaseRadius * 0.95; r += (vinylBaseRadius * 0.055)) {
        targetCtx.beginPath();
        targetCtx.arc(0, 0, r, 0, Math.PI * 2);
        targetCtx.stroke();
    }
    
    // 6. Draw Spindle Center Ring Label Backdrop
    const labelRadius = vinylBaseRadius * (state.labelSize / 100);
    
    targetCtx.beginPath();
    targetCtx.arc(0, 0, labelRadius, 0, Math.PI * 2);
    
    let labelBg = '#18181f';
    if (state.labelStyle === 'vintage') {
        labelBg = '#fcf8f2';
    } else if (state.labelStyle === 'ring-art') {
        labelBg = state.visualizerType !== 'none' ? state.visualizerColor : '#272730';
    }
    targetCtx.fillStyle = labelBg;
    targetCtx.fill();
    
    // Draw Cover Art
    if (state.coverImage && (state.labelStyle === 'full-art' || state.labelStyle === 'ring-art')) {
        targetCtx.save();
        targetCtx.beginPath();
        
        let artRadius = labelRadius;
        if (state.labelStyle === 'ring-art') {
            artRadius = labelRadius * 0.55;
        }
        
        targetCtx.arc(0, 0, artRadius, 0, Math.PI * 2);
        targetCtx.clip();
        
        // Spin the cover art!
        targetCtx.rotate(rotationAngle);
        targetCtx.drawImage(state.coverImage, -artRadius, -artRadius, artRadius * 2, artRadius * 2);
        targetCtx.restore();
        
        // Border around inner art ring
        if (state.labelStyle === 'ring-art') {
            targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
            targetCtx.lineWidth = 1;
            targetCtx.beginPath();
            targetCtx.arc(0, 0, artRadius, 0, Math.PI * 2);
            targetCtx.stroke();
        }
    }
    
    // Draw label paper borders & details
    let labelBorderColor = 'rgba(255, 255, 255, 0.2)';
    if (state.labelStyle === 'vintage') {
        labelBorderColor = 'rgba(28, 25, 23, 0.15)';
    }
    targetCtx.strokeStyle = labelBorderColor;
    targetCtx.lineWidth = Math.max(1, baseDimension * 0.002);
    targetCtx.beginPath();
    targetCtx.arc(0, 0, labelRadius, 0, Math.PI * 2);
    targetCtx.stroke();
    
    // Label details (Artists, tracks)
    if (state.showLabelText) {
        targetCtx.save();
        targetCtx.rotate(rotationAngle); // Spin label details in sync
        
        // Check color theme
        let textColor = '#ffffff';
        let subTextColor = 'rgba(255, 255, 255, 0.65)';
        let boxColor = 'rgba(0, 0, 0, 0.4)';
        
        if (state.labelStyle === 'vintage') {
            textColor = '#1c1917';
            subTextColor = 'rgba(28, 25, 23, 0.65)';
            boxColor = 'transparent';
        } else if (state.labelStyle === 'ring-art') {
            textColor = '#ffffff';
            subTextColor = 'rgba(255, 255, 255, 0.7)';
            boxColor = 'rgba(0, 0, 0, 0.3)';
        } else if (state.labelStyle === 'dark') {
            textColor = state.visualizerType !== 'none' ? state.visualizerColor : '#ffffff';
            subTextColor = 'rgba(255, 255, 255, 0.55)';
            boxColor = 'transparent';
        }
        
        const txtBoxRadius = labelRadius * 0.7;
        if (boxColor !== 'transparent') {
            targetCtx.beginPath();
            targetCtx.arc(0, 0, txtBoxRadius, 0, Math.PI * 2);
            targetCtx.fillStyle = boxColor;
            targetCtx.fill();
        }
        
        targetCtx.fillStyle = textColor;
        targetCtx.textAlign = 'center';
        
        // Title
        targetCtx.font = `600 ${Math.max(8, Math.round(labelRadius * 0.15))}px "Outfit", sans-serif`;
        targetCtx.fillText(state.labelTitle, 0, -2);
        
        // Artist
        targetCtx.fillStyle = subTextColor;
        targetCtx.font = `400 ${Math.max(6, Math.round(labelRadius * 0.09))}px "Outfit", sans-serif`;
        targetCtx.fillText(state.artistName, 0, Math.round(labelRadius * 0.15));
        
        targetCtx.restore();
    }
    
    // Center Spindle Hole
    if (state.showSpindle) {
        const spindleRadius = labelRadius * 0.08;
        
        // Chrome metal ring border
        targetCtx.strokeStyle = '#cccccc';
        targetCtx.lineWidth = 1.5;
        targetCtx.beginPath();
        targetCtx.arc(0, 0, spindleRadius * 1.3, 0, Math.PI * 2);
        targetCtx.stroke();
        
        // Inner hole
        targetCtx.beginPath();
        targetCtx.arc(0, 0, spindleRadius, 0, Math.PI * 2);
        targetCtx.fillStyle = '#08080c';
        targetCtx.fill();
    }
    
    targetCtx.restore(); // Recover from translated center

    // 7. Stationary Vinyl Light Reflections (Shine)
    // The shine angle is physically fixed even as vinyl spins underneath
    if (state.shineIntensity > 0) {
        targetCtx.save();
        targetCtx.translate(center.x, center.y);
        
        const shineOpacity = state.shineIntensity / 100 * 0.18;
        const radShineGrad = targetCtx.createRadialGradient(0, 0, labelRadius, 0, 0, vinylBaseRadius);
        radShineGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        radShineGrad.addColorStop(0.3, `rgba(255, 255, 255, ${shineOpacity})`);
        radShineGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
        radShineGrad.addColorStop(0.7, `rgba(255, 255, 255, ${shineOpacity * 0.7})`);
        radShineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        // We draw two opposite reflection wedges
        const drawReflectionWedge = (startDeg, endDeg) => {
            const startRad = (startDeg * Math.PI) / 180;
            const endRad = (endDeg * Math.PI) / 180;
            
            targetCtx.save();
            targetCtx.beginPath();
            targetCtx.moveTo(0, 0);
            targetCtx.arc(0, 0, vinylBaseRadius, startRad, endRad);
            targetCtx.closePath();
            targetCtx.clip();
            
            targetCtx.fillStyle = radShineGrad;
            targetCtx.fillRect(-vinylBaseRadius, -vinylBaseRadius, vinylBaseRadius * 2, vinylBaseRadius * 2);
            targetCtx.restore();
        };
        
        // Classic butterfly shapes
        drawReflectionWedge(-25, 25);
        drawReflectionWedge(155, 205);
        
        // Soft secondary reflections
        const secOpacity = shineOpacity * 0.45;
        const secGrad = targetCtx.createRadialGradient(0, 0, labelRadius, 0, 0, vinylBaseRadius);
        secGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        secGrad.addColorStop(0.5, `rgba(255, 255, 255, ${secOpacity})`);
        secGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        const drawSecWedge = (startDeg, endDeg) => {
            const startRad = (startDeg * Math.PI) / 180;
            const endRad = (endDeg * Math.PI) / 180;
            targetCtx.save();
            targetCtx.beginPath();
            targetCtx.moveTo(0, 0);
            targetCtx.arc(0, 0, vinylBaseRadius, startRad, endRad);
            targetCtx.closePath();
            targetCtx.clip();
            targetCtx.fillStyle = secGrad;
            targetCtx.fillRect(-vinylBaseRadius, -vinylBaseRadius, vinylBaseRadius * 2, vinylBaseRadius * 2);
            targetCtx.restore();
        };
        
        drawSecWedge(65, 95);
        drawSecWedge(245, 275);
        
        targetCtx.restore();
    }
    // 8. Draw Tone Arm Hardware
    if (state.showToneArm) {
        targetCtx.save();
        
        // Pivot point sits in the top right corner
        const pivot = {
            x: center.x + baseDimension * 0.32,
            y: center.y - baseDimension * 0.35
        };
        
        // Calculate arm angle based on play state and duration
        // Outer grooves to inner grooves range: 0.8 rad to 0.45 rad
        const startArmRad = 0.95;
        const endArmRad = 0.65;
        
        let armProgress = 0; // Resting position default
        if (isPlaying) {
            // Track playback position progress
            const duration = state.audioBuffer ? state.audioBuffer.duration : playbackDuration || 30;
            armProgress = playbackDuration > 0 ? (playbackDuration / duration) : 0;
            if (armProgress > 1) armProgress = 1;
            toneArmState.targetAngle = startArmRad - (startArmRad - endArmRad) * armProgress;
        } else {
            toneArmState.targetAngle = 1.15; // Resting bracket angle
        }
        
        // Smooth target rotation
        toneArmState.currentAngle += (toneArmState.targetAngle - toneArmState.currentAngle) * 0.1;
        
        // Arm base vibration with bass beat
        if (state.pulseToneArm && isPlaying) {
            toneArmState.vibrationX = (Math.random() - 0.5) * rms * 3 * finalSensitivity;
            toneArmState.vibrationY = (Math.random() - 0.5) * rms * 3 * finalSensitivity;
        } else {
            toneArmState.vibrationX = 0;
            toneArmState.vibrationY = 0;
        }
        
        // 8.a Base Pivot base
        targetCtx.beginPath();
        targetCtx.arc(pivot.x, pivot.y, baseDimension * 0.045, 0, Math.PI * 2);
        targetCtx.fillStyle = '#1e1e24';
        targetCtx.strokeStyle = '#475569';
        targetCtx.lineWidth = 2;
        targetCtx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        targetCtx.shadowBlur = 8;
        targetCtx.fill();
        targetCtx.stroke();
        targetCtx.shadowBlur = 0; // reset
        
        targetCtx.beginPath();
        targetCtx.arc(pivot.x, pivot.y, baseDimension * 0.025, 0, Math.PI * 2);
        targetCtx.fillStyle = '#0f0f13';
        targetCtx.fill();
        
        // 8.b Arm Rod (Stem)
        targetCtx.save();
        targetCtx.translate(pivot.x, pivot.y);
        targetCtx.rotate(toneArmState.currentAngle);
        
        const armLength = baseDimension * 0.42;
        
        // Draw metallic stick with a slight bend (Classic curved style)
        targetCtx.strokeStyle = '#d1d5db'; // metallic silver
        targetCtx.lineWidth = Math.max(2, baseDimension * 0.007);
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';
        
        // Curve coordinates
        targetCtx.beginPath();
        targetCtx.moveTo(0, 0);
        targetCtx.lineTo(0, armLength * 0.4);
        targetCtx.lineTo(-baseDimension * 0.045, armLength * 0.85);
        targetCtx.lineTo(-baseDimension * 0.045 + toneArmState.vibrationX, armLength + toneArmState.vibrationY);
        targetCtx.stroke();
        
        // Draw Counterweight block (opposite side of rod)
        targetCtx.fillStyle = '#4b5563';
        targetCtx.fillRect(-baseDimension * 0.015, -baseDimension * 0.04, baseDimension * 0.03, baseDimension * 0.03);
        
        // 8.c Headshell (Stylus / needle head)
        const tipX = -baseDimension * 0.045 + toneArmState.vibrationX;
        const tipY = armLength + toneArmState.vibrationY;
        
        targetCtx.save();
        targetCtx.translate(tipX, tipY);
        targetCtx.rotate(-0.15); // Cartridge offset angle
        
        // Headshell block
        targetCtx.fillStyle = '#111827';
        targetCtx.fillRect(-baseDimension * 0.012, 0, baseDimension * 0.024, baseDimension * 0.04);
        
        // Chrome cartridge details
        targetCtx.fillStyle = '#e5e7eb';
        targetCtx.fillRect(-baseDimension * 0.008, baseDimension * 0.04, baseDimension * 0.016, baseDimension * 0.012);
        
        // Dynamic tiny cue light
        targetCtx.fillStyle = isPlaying ? '#10b981' : '#f59e0b';
        targetCtx.beginPath();
        targetCtx.arc(0, baseDimension * 0.01, 2, 0, Math.PI * 2);
        targetCtx.fill();
        
        targetCtx.restore();
        targetCtx.restore(); // recover translate/rotate
        targetCtx.restore();
    }
};

// Main loop for live preview drawing
let frameCount = 0;
const drawLoop = (timestamp) => {
    frameCount++;
    if (frameCount % 60 === 0) {
        logDebug("drawLoop running, frameCount = " + frameCount);
    }
    if (!lastDrawTime) lastDrawTime = timestamp;
    const elapsed = timestamp - lastDrawTime;
    lastDrawTime = timestamp;
    
    // Calculate rotation angle change based on state
    if (isPlaying) {
        const rpm = state.spinRPM;
        const speed = (rpm * 2 * Math.PI) / (60 * 1000); // radians per ms
        const direction = state.spinReverse ? -1 : 1;
        currentRotationAngle += direction * speed * elapsed;
        
        // Keep track of playback duration
        if (audioCtx) {
            playbackDuration = audioCtx.currentTime - playbackStartTime + playbackPauseTime;
            
            // Loop/Restart if it finishes
            const songLength = state.audioBuffer ? state.audioBuffer.duration : 0;
            if (songLength > 0 && playbackDuration >= songLength) {
                restartPlayback();
            }
        } else {
            // Simulated local loop counter when no audio loaded
            playbackDuration += elapsed / 1000;
            if (playbackDuration >= state.exportDurationPreset) {
                playbackDuration = 0;
            }
        }
        
        updateScrubberUI();
    }
    
    // Read frequencies from Web Audio analyser
    if (analyserNode && isPlaying) {
        analyserNode.getByteFrequencyData(frequencyData);
        
        // Calculate bass intensity (average of first 6 bins)
        let bassSum = 0;
        for (let i = 0; i < 6; i++) {
            bassSum += frequencyData[i];
        }
        volumeMeterRms = bassSum / (6 * 255); // 0.0 to 1.0 range
    } else {
        volumeMeterRms = 0;
        frequencyData.fill(0);
    }
    
    // Draw onto preview canvas
    const w = canvas.width;
    const h = canvas.height;
    
    renderFrame(ctx, w, h, currentRotationAngle, {
        rms: volumeMeterRms,
        waveform: frequencyData
    });
    
    animFrameId = requestAnimationFrame(drawLoop);
};

// --- AUDIO SYSTEMS (Web Audio API) ---

const initAudio = () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
        gainNode = audioCtx.createGain();
        
        // Connect nodes
        analyserNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
    }
};

const handleAudioFile = async (file) => {
    state.audioFile = file;
    document.getElementById('audio-file-name').textContent = file.name;
    document.getElementById('audio-preview-container').classList.remove('hidden');
    document.getElementById('audio-dropzone').classList.add('hidden');
    
    // Update play button
    const playBtn = document.getElementById('panel-play-btn');
    playBtn.disabled = true;
    playBtn.querySelector('span').textContent = 'Loading...';
    
    initAudio();
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        state.audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        // Update format values
        const min = Math.floor(state.audioBuffer.duration / 60);
        const sec = Math.floor(state.audioBuffer.duration % 60);
        document.getElementById('audio-file-duration').textContent = `${min}:${sec < 10 ? '0' : ''}${sec}`;
        document.getElementById('playback-time-display').textContent = `0:00 / ${min}:${sec < 10 ? '0' : ''}${sec}`;
        document.getElementById('scrubber-total-time').textContent = `${min}:${sec < 10 ? '0' : ''}${sec}`;
        
        // Enable controls
        playBtn.disabled = false;
        playBtn.querySelector('span').textContent = 'Play Track';
        
        // Check "Full Song" option in export tab
        document.getElementById('export-duration-full-radio').disabled = false;
    } catch (err) {
        console.error("Audio Decode Error:", err);
        alert("Failed to decode audio. Please try another MP3 or WAV file.");
        removeAudioFile();
    }
};

const removeAudioFile = () => {
    stopPlayback();
    state.audioFile = null;
    state.audioBuffer = null;
    document.getElementById('audio-preview-container').classList.add('hidden');
    document.getElementById('audio-dropzone').classList.remove('hidden');
    
    const playBtn = document.getElementById('panel-play-btn');
    playBtn.disabled = true;
    playBtn.querySelector('span').textContent = 'Play Track';
    
    document.getElementById('playback-time-display').textContent = `0:00 / 0:00`;
    document.getElementById('scrubber-total-time').textContent = `00:00`;
    document.getElementById('scrubber-current-time').textContent = `00:00`;
    document.getElementById('scrubber-fill-bar').style.width = '0%';
    document.getElementById('scrubber-handle-dot').style.left = '0%';
    
    document.getElementById('export-duration-full-radio').disabled = true;
    document.getElementsByName('export-duration-type')[0].checked = true; // Fall back to loop clip
};

const startPlayback = () => {
    if (!state.audioBuffer) return;
    initAudio();
    
    // Stop any existing sources
    if (audioSource) {
        try { audioSource.stop(); } catch(e) {}
    }
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = state.audioBuffer;
    audioSource.connect(analyserNode);
    
    playbackStartTime = audioCtx.currentTime;
    audioSource.start(0, playbackPauseTime);
    isPlaying = true;
    
    // Change play icons
    updatePlayIcons(true);
};

const pausePlayback = () => {
    if (!isPlaying) return;
    isPlaying = false;
    playbackPauseTime += audioCtx.currentTime - playbackStartTime;
    
    if (audioSource) {
        try { audioSource.stop(); } catch(e) {}
        audioSource = null;
    }
    
    updatePlayIcons(false);
};

const stopPlayback = () => {
    isPlaying = false;
    playbackPauseTime = 0;
    playbackDuration = 0;
    if (audioSource) {
        try { audioSource.stop(); } catch(e) {}
        audioSource = null;
    }
    updatePlayIcons(false);
    updateScrubberUI();
};

const restartPlayback = () => {
    playbackPauseTime = 0;
    playbackDuration = 0;
    startPlayback();
};

const updatePlayIcons = (playing) => {
    const pBtns = [document.getElementById('panel-play-btn'), document.getElementById('canvas-play-btn')];
    pBtns.forEach(btn => {
        const icon = btn.querySelector('i');
        const txt = btn.querySelector('span');
        if (playing) {
            icon.className = 'ph-fill ph-pause';
            if (txt) txt.textContent = 'Pause Track';
        } else {
            icon.className = 'ph-fill ph-play';
            if (txt) txt.textContent = 'Play Track';
        }
    });
    
    // Logo spinning class
    const logo = document.querySelector('.logo-icon');
    if (playing) {
        logo.style.animationPlayState = 'running';
    } else {
        logo.style.animationPlayState = 'paused';
    }
};

const updateScrubberUI = () => {
    const duration = state.audioBuffer ? state.audioBuffer.duration : state.exportDurationPreset;
    const progress = duration > 0 ? (playbackDuration / duration) : 0;
    
    const fmtTime = (s) => {
        const min = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    };
    
    document.getElementById('playback-time-display').textContent = `${fmtTime(playbackDuration)} / ${fmtTime(duration)}`;
    document.getElementById('scrubber-current-time').textContent = fmtTime(playbackDuration);
    
    const fillPercent = Math.min(100, progress * 100);
    document.getElementById('scrubber-fill-bar').style.width = `${fillPercent}%`;
    document.getElementById('scrubber-handle-dot').style.left = `${fillPercent}%`;
};

// --- DYNAMIC AUDIO RETRIEVAL FOR RENDERING ---
// Looks up precise audio samples around a timestamp inside offline export loops
const getOfflineAudioDataAt = (timestamp, length = 128) => {
    if (!state.audioBuffer) {
        return { rms: 0, waveform: new Float32Array(length) };
    }
    
    const sampleRate = state.audioBuffer.sampleRate;
    const centerSample = Math.floor(timestamp * sampleRate);
    
    const leftData = state.audioBuffer.getChannelData(0);
    const rightData = state.audioBuffer.numberOfChannels > 1 
        ? state.audioBuffer.getChannelData(1) 
        : leftData;
        
    const windowSize = 1024;
    let sum = 0;
    const waveform = new Float32Array(length);
    
    for (let i = 0; i < windowSize; i++) {
        const idx = centerSample - (windowSize / 2) + i;
        if (idx >= 0 && idx < leftData.length) {
            const l = leftData[idx];
            const r = rightData[idx];
            const sample = (l + r) / 2;
            sum += sample * sample;
            
            // Populate output waveform buffer evenly
            if (i % Math.floor(windowSize / length) === 0) {
                const waveIdx = Math.floor(i / (windowSize / length));
                if (waveIdx < length) {
                    waveform[waveIdx] = sample;
                }
            }
        }
    }
    
    const rms = Math.sqrt(sum / windowSize);
    return { rms, waveform };
};

// --- VIDEO EXPORT PIPELINE (WEBCODECS & MP4 MUXER) ---

const checkWebCodecsSupport = () => {
    return (typeof VideoEncoder !== 'undefined');
};

const executeExport = async () => {
    if (isExporting) return;
    
    // Verification check for full song duration option
    const durType = document.querySelector('input[name="export-duration-type"]:checked').value;
    if (durType === 'full' && !state.audioBuffer) {
        alert("You must upload an audio file to export a 'Full Song' video.");
        return;
    }
    
    // Stop live preview loop to avoid CPU clashes
    pausePlayback();
    isExporting = true;
    cancelExportRequested = false;
    
    // UI states
    const exportBtn = document.getElementById('start-export-btn');
    const cancelBtn = document.getElementById('cancel-export-btn');
    const progressCard = document.getElementById('export-progress-card');
    const progressBar = document.getElementById('export-bar-fill');
    const statusText = document.getElementById('export-status-text');
    const percentText = document.getElementById('export-percent-text');
    const metaText = document.getElementById('export-meta-text');
    
    exportBtn.disabled = true;
    exportBtn.querySelector('span').textContent = 'Preparing Render...';
    progressCard.classList.remove('hidden');
    
    // 1. Calculate Resolution / Aspect ratio parameters
    const height = parseInt(state.exportResolution);
    let width = height; // Default square
    if (state.aspectRatio === '9-16') {
        // Vertical width must be divisible by 4 (required by H.264 profiles)
        width = Math.floor((height * 9) / 16);
        width = width - (width % 4); 
    } else if (state.aspectRatio === '16-9') {
        width = Math.floor((height * 16) / 9);
        width = width - (width % 4);
    }
    
    const fps = state.exportFps;
    const duration = durType === 'full' 
        ? state.audioBuffer.duration 
        : parseInt(document.getElementById('export-duration-preset').value);
        
    const totalFrames = Math.floor(duration * fps);
    
    // Create high-res offscreen rendering canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const eCtx = exportCanvas.getContext('2d');
    
    // Status update
    statusText.textContent = checkWebCodecsSupport() ? "Initializing Encoders..." : "Initializing MediaRecorder (Fallback)...";
    percentText.textContent = "0%";
    progressBar.style.width = "0%";
    
    // Prepare WebCodecs MP4 Muxer Pipeline
    if (checkWebCodecsSupport()) {
        try {
            const hasAudio = !!state.audioBuffer;
            const sampleRate = hasAudio ? state.audioBuffer.sampleRate : 44100;
            const bitrate = state.exportBitrate * 1000 * 1000; // Mbps to bits
            
            // Set up Muxer
            const muxerConfig = {
                target: new ArrayBufferTarget(),
                video: {
                    codec: 'avc',
                    width: width,
                    height: height
                },
                fastStart: 'in-memory'
            };
            
            if (hasAudio) {
                muxerConfig.audio = {
                    codec: 'aac',
                    numberOfChannels: 2,
                    sampleRate: sampleRate
                };
            }
            
            const muxer = new Muxer(muxerConfig);
            
            // Set up Video Encoder
            const videoEncoder = new VideoEncoder({
                output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                error: (e) => {
                    console.error("VideoEncoder Error: ", e);
                    throw e;
                }
            });
            
            videoEncoder.configure({
                codec: 'avc1.4d002a', // H.264 Main Profile Level 4.2
                width: width,
                height: height,
                bitrate: bitrate,
                framerate: fps,
                latencyMode: 'quality'
            });
            
            // Set up Audio Encoder if track exists
            let audioEncoder = null;
            if (hasAudio) {
                audioEncoder = new AudioEncoder({
                    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
                    error: (e) => {
                        console.error("AudioEncoder Error: ", e);
                        throw e;
                    }
                });
                
                audioEncoder.configure({
                    codec: 'mp4a.40.2', // AAC Low Complexity
                    sampleRate: sampleRate,
                    numberOfChannels: 2,
                    bitrate: 128000
                });
            }
            
            // Encode Loops
            let frameIndex = 0;
            
            const encodeStep = async () => {
                if (cancelExportRequested) {
                    cleanupEncoders();
                    return;
                }
                
                // Track time
                const t = frameIndex / fps;
                const timestampUs = Math.round(t * 1000 * 1000); // Microseconds
                
                // Get audio sample metrics for visualizer frame
                const audioMetrics = getOfflineAudioDataAt(t);
                
                // Spin calculations
                const rpm = state.spinRPM;
                const totalRotation = t * ((rpm * 2 * Math.PI) / 60) * (state.spinReverse ? -1 : 1);
                
                // Draw offline frame
                renderFrame(eCtx, width, height, totalRotation, audioMetrics);
                
                // Create VideoFrame & Encode
                const vFrame = new VideoFrame(exportCanvas, { timestamp: timestampUs });
                videoEncoder.encode(vFrame, { keyFrame: frameIndex % 60 === 0 });
                vFrame.close();
                
                // Encode Audio Segment matching this frame interval
                if (hasAudio && audioEncoder) {
                    const samplesPerFrame = Math.round(sampleRate / fps);
                    const sampleOffset = Math.floor(t * sampleRate);
                    
                    const leftChannel = state.audioBuffer.getChannelData(0);
                    const rightChannel = state.audioBuffer.numberOfChannels > 1 
                        ? state.audioBuffer.getChannelData(1) 
                        : leftData;
                    
                    // Construct Planar Float32 concatenated array
                    const planarBuffer = new Float32Array(samplesPerFrame * 2);
                    
                    for (let s = 0; s < samplesPerFrame; s++) {
                        const sIdx = sampleOffset + s;
                        if (sIdx < leftChannel.length) {
                            planarBuffer[s] = leftChannel[sIdx];
                            planarBuffer[samplesPerFrame + s] = rightChannel[sIdx];
                        } else {
                            planarBuffer[s] = 0;
                            planarBuffer[samplesPerFrame + s] = 0;
                        }
                    }
                    
                    const audioData = new AudioData({
                        format: 'f32-planar',
                        sampleRate: sampleRate,
                        numberOfFrames: samplesPerFrame,
                        numberOfChannels: 2,
                        timestamp: timestampUs,
                        data: planarBuffer
                    });
                    
                    audioEncoder.encode(audioData);
                    audioData.close();
                }
                
                // Progress calculations
                frameIndex++;
                const progress = frameIndex / totalFrames;
                const pct = Math.floor(progress * 100);
                
                percentText.textContent = `${pct}%`;
                progressBar.style.width = `${pct}%`;
                statusText.textContent = `Encoding Frame ${frameIndex} / ${totalFrames}...`;
                metaText.textContent = `Time elapsed: ${t.toFixed(1)}s / ${duration.toFixed(1)}s`;
                
                if (frameIndex < totalFrames) {
                    // Small timeout keeps UI threading responsive (no canvas lockup)
                    setTimeout(encodeStep, 2);
                } else {
                    // Finalizing encoding pipelines
                    statusText.textContent = "Finalizing video containers...";
                    await videoEncoder.flush();
                    if (audioEncoder) await audioEncoder.flush();
                    
                    muxer.finalize();
                    const finalBuffer = muxer.target.buffer;
                    
                    downloadBlob(new Blob([finalBuffer], { type: 'video/mp4' }), `${state.labelTitle.toLowerCase().replace(/[^a-z0-9]/g, '_')}_vinyl.mp4`);
                    resetExportUI();
                }
            };
            
            const cleanupEncoders = () => {
                try { videoEncoder.close(); } catch(e){}
                if (audioEncoder) {
                    try { audioEncoder.close(); } catch(e){}
                }
                resetExportUI();
            };
            
            // Start encoder loop
            encodeStep();
            
        } catch (err) {
            console.error("WebCodecs Export Fail, falling back:", err);
            alert("High-speed H.264 encoding encountered an error. Falling back to native MediaRecorder WebM...");
            executeFallbackRecorder(exportCanvas, w, h, duration, fps);
        }
    } else {
        // Fallback to MediaRecorder
        executeFallbackRecorder(exportCanvas, width, height, duration, fps);
    }
};

// Standard MediaRecorder (WebM) fallback for Safari/Firefox
const executeFallbackRecorder = (exportCanvas, width, height, duration, fps) => {
    const hasAudio = !!state.audioBuffer;
    const canvasStream = exportCanvas.captureStream(fps);
    let finalStream = canvasStream;
    
    // If audio exists, route decoded buffer playout through a stream node to capture it
    let fallbackAudioNode = null;
    let fallbackDestNode = null;
    
    if (hasAudio) {
        initAudio();
        fallbackDestNode = audioCtx.createMediaStreamDestination();
        
        fallbackAudioNode = audioCtx.createBufferSource();
        fallbackAudioNode.buffer = state.audioBuffer;
        fallbackAudioNode.connect(fallbackDestNode);
        
        // Merge canvas video tracks and audio stream tracks
        const audioTracks = fallbackDestNode.stream.getAudioTracks();
        if (audioTracks.length > 0) {
            finalStream = new MediaStream([
                ...canvasStream.getVideoTracks(),
                audioTracks[0]
            ]);
        }
    }
    
    const options = { mimeType: 'video/webm;codecs=vp9' };
    let mediaRecorder;
    try {
        mediaRecorder = new MediaRecorder(finalStream, options);
    } catch(e) {
        mediaRecorder = new MediaRecorder(finalStream); // Fallback to system default
    }
    
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    
    mediaRecorder.onstop = () => {
        if (cancelExportRequested) {
            resetExportUI();
            return;
        }
        const blob = new Blob(chunks, { type: 'video/webm' });
        // Standard .mp4 extension fallback (browsers will still play WebM internally mapped, is compatible enough)
        downloadBlob(blob, `${state.labelTitle.toLowerCase().replace(/[^a-z0-9]/g, '_')}_vinyl.mp4`);
        resetExportUI();
    };
    
    // Start Recording
    let frameIndex = 0;
    const totalFrames = Math.floor(duration * fps);
    
    if (fallbackAudioNode) {
        fallbackAudioNode.start(0);
    }
    mediaRecorder.start();
    
    const renderStep = () => {
        if (cancelExportRequested) {
            mediaRecorder.stop();
            if (fallbackAudioNode) fallbackAudioNode.stop();
            return;
        }
        
        const t = frameIndex / fps;
        const audioMetrics = getOfflineAudioDataAt(t);
        const rpm = state.spinRPM;
        const totalRotation = t * ((rpm * 2 * Math.PI) / 60) * (state.spinReverse ? -1 : 1);
        
        // Draw frame
        renderFrame(exportCanvas.getContext('2d'), width, height, totalRotation, audioMetrics);
        
        frameIndex++;
        const progress = frameIndex / totalFrames;
        const pct = Math.floor(progress * 100);
        
        document.getElementById('export-percent-text').textContent = `${pct}%`;
        document.getElementById('export-bar-fill').style.width = `${pct}%`;
        document.getElementById('export-status-text').textContent = `Recording stream ${frameIndex} / ${totalFrames}...`;
        document.getElementById('export-meta-text').textContent = `Rendering: ${t.toFixed(1)}s / ${duration.toFixed(1)}s`;
        
        if (frameIndex < totalFrames) {
            requestAnimationFrame(renderStep);
        } else {
            mediaRecorder.stop();
            if (fallbackAudioNode) fallbackAudioNode.stop();
        }
    };
    
    renderStep();
};

const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const resetExportUI = () => {
    isExporting = false;
    document.getElementById('export-progress-card').classList.add('hidden');
    
    const exportBtn = document.getElementById('start-export-btn');
    exportBtn.disabled = false;
    exportBtn.querySelector('span').textContent = 'Generate MP4 Background';
    
    // Start live drawing loop back up
    lastDrawTime = 0;
};

// --- BROWSER DOM INTERACTION & EVENTS ---

const setupEventListeners = () => {
    // 1. Tab switches
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabSections = document.querySelectorAll('.tab-section');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabSections.forEach(s => s.classList.remove('active'));
            
            btn.classList.add('active');
            const targetId = `tab-${btn.dataset.tab}`;
            document.getElementById(targetId).classList.add('active');
        });
    });

    // 2. Artwork Upload Handlers
    const coverUpload = document.getElementById('cover-upload');
    const coverDropzone = document.getElementById('cover-dropzone');
    const coverPreview = document.getElementById('cover-preview-container');
    const coverPreviewImg = document.getElementById('cover-preview-img');
    const coverFileName = document.getElementById('cover-file-name');
    const removeCoverBtn = document.getElementById('remove-cover-btn');

    const handleCoverSelect = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                state.coverImage = img;
                coverPreviewImg.src = e.target.result;
                coverFileName.textContent = file.name;
                coverPreview.classList.remove('hidden');
                coverDropzone.classList.add('hidden');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };

    coverUpload.addEventListener('change', (e) => handleCoverSelect(e.target.files[0]));
    
    coverDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        coverDropzone.classList.add('dragover');
    });
    
    coverDropzone.addEventListener('dragleave', () => coverDropzone.classList.remove('dragover'));
    
    coverDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        coverDropzone.classList.remove('dragover');
        handleCoverSelect(e.dataTransfer.files[0]);
    });

    removeCoverBtn.addEventListener('click', () => {
        state.coverImage = createPlaceholderCover();
        coverPreview.classList.add('hidden');
        coverDropzone.classList.remove('hidden');
        coverUpload.value = '';
    });

    // 3. Custom Vinyl Color Switchers
    const swatches = document.querySelectorAll('.color-swatch');
    const customColorContainer = document.getElementById('custom-color-container');
    const customColorPicker = document.getElementById('vinyl-color-picker');
    const customColorHex = document.getElementById('vinyl-color-hex');
    const translucentCheck = document.getElementById('vinyl-translucent');

    swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
            swatches.forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            
            state.vinylColorStyle = swatch.dataset.color;
            if (state.vinylColorStyle === 'custom') {
                customColorContainer.classList.remove('hidden');
            } else {
                customColorContainer.classList.add('hidden');
            }
        });
    });

    customColorPicker.addEventListener('input', (e) => {
        state.customVinylColor = e.target.value;
        customColorHex.value = e.target.value.toUpperCase();
    });

    customColorHex.addEventListener('input', (e) => {
        const val = e.target.value;
        if (/^#[0-9A-F]{6}$/i.test(val)) {
            state.customVinylColor = val;
            customColorPicker.value = val;
        }
    });

    translucentCheck.addEventListener('change', (e) => {
        state.isTranslucent = e.target.checked;
    });

    // 4. Center Label Metadata fields
    const titleInp = document.getElementById('label-title');
    const artistInp = document.getElementById('label-artist');
    const albumInp = document.getElementById('label-album');
    const labelSizeInp = document.getElementById('label-size');
    const labelSizeVal = document.getElementById('label-size-val');

    titleInp.addEventListener('input', (e) => {
        state.labelTitle = e.target.value || "Untitled Loop";
    });
    artistInp.addEventListener('input', (e) => {
        state.artistName = e.target.value || "Unknown Artist";
    });
    albumInp.addEventListener('input', (e) => {
        state.albumName = e.target.value || "Single Background";
    });
    labelSizeInp.addEventListener('input', (e) => {
        state.labelSize = parseInt(e.target.value);
        labelSizeVal.textContent = `${state.labelSize}%`;
    });

    const labelDesignInp = document.getElementById('label-design-style');
    labelDesignInp.addEventListener('change', (e) => {
        state.labelStyle = e.target.value;
    });

    // 5. Audio Upload & Player Controls
    const audioUpload = document.getElementById('audio-upload');
    const audioDropzone = document.getElementById('audio-dropzone');
    const removeAudioBtn = document.getElementById('remove-audio-btn');
    const playBtn = document.getElementById('panel-play-btn');
    const canvasPlay = document.getElementById('canvas-play-btn');
    const canvasMute = document.getElementById('canvas-mute-btn');

    audioUpload.addEventListener('change', (e) => {
        if (e.target.files[0]) handleAudioFile(e.target.files[0]);
    });

    audioDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        audioDropzone.classList.add('dragover');
    });
    
    audioDropzone.addEventListener('dragleave', () => audioDropzone.classList.remove('dragover'));
    
    audioDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        audioDropzone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleAudioFile(e.dataTransfer.files[0]);
    });

    removeAudioBtn.addEventListener('click', removeAudioFile);

    const togglePlay = () => {
        if (isPlaying) {
            pausePlayback();
        } else {
            startPlayback();
        }
    };

    playBtn.addEventListener('click', togglePlay);
    canvasPlay.addEventListener('click', togglePlay);
    
    let isMuted = false;
    canvasMute.addEventListener('click', () => {
        if (!gainNode) return;
        isMuted = !isMuted;
        gainNode.gain.setValueAtTime(isMuted ? 0 : 1, audioCtx.currentTime);
        canvasMute.querySelector('i').className = isMuted ? 'ph-bold ph-speaker-simple-x' : 'ph-bold ph-speaker-high';
    });

    // 6. Visualizer customizations
    const visType = document.getElementById('visualizer-type');
    const visColor = document.getElementById('visualizer-color');
    const visColorHex = document.getElementById('visualizer-color-hex');
    const visSens = document.getElementById('visualizer-sensitivity');
    const visSensVal = document.getElementById('visualizer-sens-val');

    visType.addEventListener('change', (e) => {
        state.visualizerType = e.target.value;
        const colorRow = document.getElementById('visualizer-color-row');
        const sensRow = document.getElementById('visualizer-sensitivity-row');
        
        if (state.visualizerType === 'none' || state.visualizerType === 'pulse') {
            colorRow.classList.add('hidden');
        } else {
            colorRow.classList.remove('hidden');
        }
        
        if (state.visualizerType === 'none') {
            sensRow.classList.add('hidden');
        } else {
            sensRow.classList.remove('hidden');
        }
    });

    visColor.addEventListener('input', (e) => {
        state.visualizerColor = e.target.value;
        visColorHex.value = e.target.value.toUpperCase();
    });
    
    visColorHex.addEventListener('input', (e) => {
        const val = e.target.value;
        if (/^#[0-9A-F]{6}$/i.test(val)) {
            state.visualizerColor = val;
            visColor.value = val;
        }
    });

    visSens.addEventListener('input', (e) => {
        state.visualizerSensitivity = parseInt(e.target.value);
        visSensVal.textContent = state.visualizerSensitivity;
    });

    // 7. Layout Aspect Ratios & Backgrounds
    const ratioCards = document.querySelectorAll('.ratio-card');
    const bgStyleSelect = document.getElementById('bg-style');
    const bgSolidRow = document.getElementById('bg-solid-color-row');
    const bgGradGroup = document.getElementById('bg-gradient-group');
    const bgCustomRow = document.getElementById('bg-custom-image-row');
    const bgBlurRow = document.getElementById('bg-blur-row');
    
    const bgCol = document.getElementById('bg-color');
    const bgColHex = document.getElementById('bg-color-hex');
    const bgGrad1 = document.getElementById('bg-grad-color1');
    const bgGrad1Hex = document.getElementById('bg-grad-color1-hex');
    const bgGrad2 = document.getElementById('bg-grad-color2');
    const bgGrad2Hex = document.getElementById('bg-grad-color2-hex');
    const bgGradAng = document.getElementById('bg-grad-angle');
    const bgGradAngVal = document.getElementById('bg-grad-angle-val');
    
    const bgBlurInp = document.getElementById('bg-blur-intensity');
    const bgBlurVal = document.getElementById('bg-blur-val');
    const bgVigInp = document.getElementById('bg-vignette-intensity');
    const bgVigVal = document.getElementById('bg-vignette-val');

    ratioCards.forEach(card => {
        card.addEventListener('click', () => {
            ratioCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            state.aspectRatio = card.dataset.ratio;
            
            // Adjust preview canvas dimensions
            canvasWrapper.className = `canvas-wrapper ratio-${state.aspectRatio}`;
            
            // Update preview dimensions indicators
            let rw = 1080, rh = 1080;
            if (state.aspectRatio === '9-16') { rw = 608; rh = 1080; }
            else if (state.aspectRatio === '16-9') { rw = 1920; rh = 1080; }
            
            canvas.width = rw;
            canvas.height = rh;
            resolutionIndicator.textContent = `${rw} x ${rh} (${state.aspectRatio.replace('-', ':')})`;
        });
    });

    bgStyleSelect.addEventListener('change', (e) => {
        state.bgStyle = e.target.value;
        
        bgSolidRow.classList.add('hidden');
        bgGradGroup.classList.add('hidden');
        bgCustomRow.classList.add('hidden');
        bgBlurRow.classList.add('hidden');
        
        if (state.bgStyle === 'solid') bgSolidRow.classList.remove('hidden');
        else if (state.bgStyle === 'gradient') bgGradGroup.classList.remove('hidden');
        else if (state.bgStyle === 'custom') bgCustomRow.classList.remove('hidden');
        else if (state.bgStyle === 'blurred') bgBlurRow.classList.remove('hidden');
    });

    // Color picks
    bgCol.addEventListener('input', (e) => {
        state.bgColor = e.target.value;
        bgColHex.value = e.target.value.toUpperCase();
    });
    bgColHex.addEventListener('input', (e) => {
        if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
            state.bgColor = e.target.value;
            bgCol.value = e.target.value;
        }
    });

    bgGrad1.addEventListener('input', (e) => {
        state.bgGradColor1 = e.target.value;
        bgGrad1Hex.value = e.target.value.toUpperCase();
    });
    bgGrad1Hex.addEventListener('input', (e) => {
        if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
            state.bgGradColor1 = e.target.value;
            bgGrad1.value = e.target.value;
        }
    });

    bgGrad2.addEventListener('input', (e) => {
        state.bgGradColor2 = e.target.value;
        bgGrad2Hex.value = e.target.value.toUpperCase();
    });
    bgGrad2Hex.addEventListener('input', (e) => {
        if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
            state.bgGradColor2 = e.target.value;
            bgGrad2.value = e.target.value;
        }
    });

    bgGradAng.addEventListener('input', (e) => {
        state.bgGradAngle = parseInt(e.target.value);
        bgGradAngVal.textContent = `${state.bgGradAngle}°`;
    });

    // Custom Background Image upload
    const bgUpload = document.getElementById('bg-upload');
    bgUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                state.bgImage = img;
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    // Blurs
    bgBlurInp.addEventListener('input', (e) => {
        state.bgBlurIntensity = parseInt(e.target.value);
        bgBlurVal.textContent = `${state.bgBlurIntensity}px`;
    });
    bgVigInp.addEventListener('input', (e) => {
        state.bgVignetteIntensity = parseInt(e.target.value);
        bgVigVal.textContent = `${state.bgVignetteIntensity}%`;
    });

    // 8. Animation & Effects adjustments
    const spinRpmInp = document.getElementById('spin-rpm');
    const spinRpmVal = document.getElementById('spin-rpm-val');
    const spinRevInp = document.getElementById('spin-reverse');
    const grooveVisInp = document.getElementById('groove-visibility');
    const groovesVal = document.getElementById('grooves-val');
    const shineIntInp = document.getElementById('shine-intensity');
    const shineVal = document.getElementById('shine-val');
    
    const showArmInp = document.getElementById('show-tone-arm');
    const showSpindleInp = document.getElementById('show-spindle');
    const pulseArmInp = document.getElementById('pulse-tone-arm');
    const showLabelTextInp = document.getElementById('show-label-text');
    const showAmbTextInp = document.getElementById('show-ambient-text');
    const ambTextPosInp = document.getElementById('ambient-text-pos');

    spinRpmInp.addEventListener('input', (e) => {
        state.spinRPM = parseInt(e.target.value);
        if (state.spinRPM === 33) {
            spinRpmVal.textContent = "33⅓";
        } else {
            spinRpmVal.textContent = state.spinRPM;
        }
    });

    spinRevInp.addEventListener('change', (e) => {
        state.spinReverse = e.target.checked;
    });

    grooveVisInp.addEventListener('input', (e) => {
        state.grooveVisibility = parseInt(e.target.value);
        groovesVal.textContent = `${state.grooveVisibility}%`;
    });

    shineIntInp.addEventListener('input', (e) => {
        state.shineIntensity = parseInt(e.target.value);
        shineVal.textContent = `${state.shineIntensity}%`;
    });

    showArmInp.addEventListener('change', (e) => {
        state.showToneArm = e.target.checked;
        if (!state.showToneArm) {
            document.getElementById('pulse-tone-arm').checked = false;
            state.pulseToneArm = false;
        }
    });

    showSpindleInp.addEventListener('change', (e) => {
        state.showSpindle = e.target.checked;
    });

    pulseArmInp.addEventListener('change', (e) => {
        if (!state.showToneArm) {
            pulseArmInp.checked = false;
            return;
        }
        state.pulseToneArm = e.target.checked;
    });

    showLabelTextInp.addEventListener('change', (e) => {
        state.showLabelText = e.target.checked;
    });

    showAmbTextInp.addEventListener('change', (e) => {
        state.showAmbientText = e.target.checked;
        const opt = document.getElementById('ambient-text-options');
        if (state.showAmbientText) opt.classList.remove('hidden');
        else opt.classList.add('hidden');
    });

    ambTextPosInp.addEventListener('change', (e) => {
        state.ambientTextPos = e.target.value;
    });

    // 9. Export Tab triggers
    const resSelect = document.getElementById('export-resolution');
    const fpsSelect = document.getElementById('export-fps');
    const bitrateSelect = document.getElementById('export-bitrate');
    const startExportBtn = document.getElementById('start-export-btn');
    const cancelExportBtn = document.getElementById('cancel-export-btn');

    resSelect.addEventListener('change', (e) => {
        state.exportResolution = e.target.value;
    });
    fpsSelect.addEventListener('change', (e) => {
        state.exportFps = parseInt(e.target.value);
    });
    bitrateSelect.addEventListener('change', (e) => {
        state.exportBitrate = parseInt(e.target.value);
    });

    startExportBtn.addEventListener('click', executeExport);
    cancelExportBtn.addEventListener('click', () => {
        cancelExportRequested = true;
        document.getElementById('export-status-text').textContent = "Cancelling export...";
    });

    // 10. Scrubber Track Dragging Interaction
    const scrubberTrack = document.getElementById('scrubber-track-bar');
    
    const handleScrub = (e) => {
        if (!state.audioBuffer) return;
        
        const rect = scrubberTrack.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        let pct = clickX / width;
        if (pct < 0) pct = 0;
        if (pct > 1) pct = 1;
        
        playbackDuration = pct * state.audioBuffer.duration;
        playbackPauseTime = playbackDuration;
        
        if (isPlaying) {
            // Seek and play
            startPlayback();
        } else {
            // Just update visual arm and details
            updateScrubberUI();
        }
    };
    
    scrubberTrack.addEventListener('click', handleScrub);

    // Initial compatibility warning trigger if not Chrome/Edge
    if (!checkWebCodecsSupport()) {
        document.getElementById('compat-warning-modal').classList.remove('hidden');
    }
    
    document.getElementById('close-compat-modal').addEventListener('click', () => {
        document.getElementById('compat-warning-modal').classList.add('hidden');
    });
};

// --- INITIALIZE & START ---

const initApp = () => {
    logDebug("initApp called, readyState = " + document.readyState);
    // Correct canvas sizing at start
    canvas.width = 1080;
    canvas.height = 1080;
    
    setupEventListeners();
    
    // Kickoff live preview drawing loop
    logDebug("drawLoop scheduled");
    requestAnimationFrame(drawLoop);
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initApp();
} else {
    window.addEventListener('load', initApp);
}
