// ─── Avatar Drawing Engine ────────────────────────────────
// Each agent gets a unique Indian mythological character.

const HEROES = [
  // VisCarma → Krishna (blue/gold)
  {
    id: 'avatarVis',
    skinColor: '#4A6FA5',
    robeColor: '#FAC775',
    robeColor2: '#BA7517',
    hairColor: '#1a1240',
    ornamentColor: '#EF9F27',
    eyeColor: '#fff',
    idleAnim: 'sway',
    actionAnim: 'playFlute',
    flutePeacock: '#1D9E75',
    tilakColor: '#fff',
  },
  // Parsh → Parashurama (amber/warrior)
  {
    id: 'avatarParsh',
    skinColor: '#D4845A',
    robeColor: '#BA7517',
    robeColor2: '#854F0B',
    hairColor: '#2C1810',
    ornamentColor: '#EF9F27',
    eyeColor: '#1a0a00',
    idleAnim: 'breathe',
    actionAnim: 'swingAxe',
    axeColor: '#888780',
    axeHandle: '#5F4020',
    tilakColor: '#E24B4A',
  },
  // Krish → Arjuna (purple/hero)
  {
    id: 'avatarKrish',
    skinColor: '#C8956A',
    robeColor: '#534AB7',
    robeColor2: '#3C3489',
    hairColor: '#1a1240',
    ornamentColor: '#EF9F27',
    eyeColor: '#1a0a00',
    idleAnim: 'stand',
    actionAnim: 'drawBow',
    bowColor: '#854F0B',
    arrowColor: '#888780',
    tilakColor: '#E24B4A',
  },
  // Parth → Charioteer (teal/orange) – reused Krishna with distinct colors
  {
    id: 'avatarParth',
    skinColor: '#3D8B8B',
    robeColor: '#F39C12',
    robeColor2: '#D35400',
    hairColor: '#1a1240',
    ornamentColor: '#F1C40F',
    eyeColor: '#fff',
    idleAnim: 'sway',
    actionAnim: 'playFlute',
    flutePeacock: '#1D9E75',
    tilakColor: '#F1C40F',
  }
];

const states = HEROES.map(() => ({
  t: Math.random() * Math.PI * 2,
  action: false,
  actionT: 0,
  eyeBlink: 0,
  blinkTimer: Math.random() * 180 + 60,
  active: false,
}));

// ─── Drawing functions ──────────────────────────────────────

function drawKrishna(ctx, h, s, w=60, hh=65) {
  const cx = w/2, cy = hh/2 + 5;
  const sway = Math.sin(s.t * 0.035) * 4;
  const flute = s.action;
  const fluteT = s.actionT;

  ctx.clearRect(0, 0, w, hh);
  ctx.save();
  ctx.translate(cx + sway * 0.3, cy);

  // Body
  ctx.beginPath();
  ctx.moveTo(-16, 8); ctx.lineTo(16, 8); ctx.lineTo(20, 40); ctx.lineTo(-20, 40); ctx.closePath();
  ctx.fillStyle = h.robeColor; ctx.fill();
  ctx.beginPath(); ctx.rect(-20, 28, 40, 6); ctx.fillStyle = h.robeColor2; ctx.fill();
  for (let i=0;i<3;i++) { ctx.beginPath(); ctx.moveTo(-20,30+i*2); ctx.lineTo(20,30+i*2); ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=0.6; ctx.stroke(); }

  // Peacock feather
  ctx.save();
  ctx.translate(8, -38);
  ctx.rotate(-0.3);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,18);
  ctx.strokeStyle = h.flutePeacock; ctx.lineWidth=1.2; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0,1,5,7,0,0,Math.PI*2);
  ctx.strokeStyle = h.flutePeacock; ctx.lineWidth=1.2; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0,1,2.5,4,0,0,Math.PI*2);
  ctx.fillStyle = '#185FA5'; ctx.fill();
  ctx.beginPath(); ctx.arc(0,1,1.2,0,Math.PI*2);
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.restore();

  // Arms
  if (!flute) {
    ctx.beginPath(); ctx.moveTo(-16,11); ctx.lineTo(-30,24); ctx.lineTo(-25,27); ctx.lineTo(-12,14);
    ctx.fillStyle = h.skinColor; ctx.fill();
    ctx.beginPath(); ctx.moveTo(16,11); ctx.lineTo(30,24); ctx.lineTo(25,27); ctx.lineTo(12,14);
    ctx.fillStyle = h.skinColor; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-24,28); ctx.lineTo(24,28);
    ctx.strokeStyle='#5F4020'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke();
  } else {
    const armAng = Math.min(fluteT/20, 1);
    ctx.save(); ctx.translate(-16,11); ctx.rotate(-armAng*0.6);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-14,12); ctx.lineTo(-10,14); ctx.lineTo(4,4);
    ctx.fillStyle = h.skinColor; ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(16,11); ctx.rotate(armAng*0.6);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(14,12); ctx.lineTo(10,14); ctx.lineTo(-4,4);
    ctx.fillStyle = h.skinColor; ctx.fill(); ctx.restore();
    ctx.save();
    ctx.translate(0, -8 + (1-armAng)*16);
    ctx.rotate(-0.2);
    ctx.beginPath(); ctx.moveTo(-22,0); ctx.lineTo(22,0);
    ctx.strokeStyle='#5F4020'; ctx.lineWidth=3; ctx.lineCap='round'; ctx.stroke();
    for (let i=-3;i<=3;i++) { ctx.beginPath(); ctx.arc(i*5.5, -1.2, 1.2, 0, Math.PI*2); ctx.fillStyle='#3a2010'; ctx.fill(); }
    if (fluteT > 20) {
      const noteAlpha = Math.min((fluteT-20)/15, 0.8);
      const noteY = -((fluteT-20)*1.4) % 32;
      ctx.fillStyle = `rgba(24,95,165,${noteAlpha})`;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('♪', 16, noteY-6);
      ctx.fillText('♫', -24, noteY-14);
    }
    ctx.restore();
  }

  // Neck & head
  ctx.beginPath(); ctx.ellipse(0,3,6,4,0,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();
  ctx.beginPath(); ctx.ellipse(0,-13,14,16,0,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();

  // Crown
  ctx.beginPath();
  ctx.moveTo(-12,-24); ctx.lineTo(-14,-40); ctx.lineTo(-6,-34); ctx.lineTo(0,-44);
  ctx.lineTo(6,-34); ctx.lineTo(14,-40); ctx.lineTo(12,-24);
  ctx.fillStyle = h.ornamentColor; ctx.fill();

  // Tilak
  ctx.beginPath(); ctx.rect(-1.2,-24,2.4,6); ctx.fillStyle=h.tilakColor; ctx.fill();

  // Eyes
  const blink = s.eyeBlink > 0;
  if (!blink) {
    ctx.beginPath(); ctx.ellipse(-6,-13,3.5,3,0,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(6,-13,3.5,3,0,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(-6,-13,2,0,Math.PI*2); ctx.fillStyle='#1a0a40'; ctx.fill();
    ctx.beginPath(); ctx.arc(6,-13,2,0,Math.PI*2); ctx.fillStyle='#1a0a40'; ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(-9,-13); ctx.lineTo(-3,-13); ctx.strokeStyle='#1a0a40'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3,-13); ctx.lineTo(9,-13); ctx.stroke();
  }

  // Smile
  ctx.beginPath(); ctx.arc(0,-6,4.5,0.15,Math.PI-0.15);
  ctx.strokeStyle='#0C3A6A'; ctx.lineWidth=1.5; ctx.stroke();

  // Necklace
  for (let i=-2;i<=2;i++) {
    ctx.beginPath(); ctx.arc(i*4,1,2.2,0,Math.PI*2);
    ctx.fillStyle = i%2===0 ? h.ornamentColor : '#fff'; ctx.fill();
  }

  // Feet
  ctx.beginPath(); ctx.ellipse(-7,40,6,4,-0.2,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();
  ctx.beginPath(); ctx.ellipse(7,40,6,4,0.2,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();
  ctx.beginPath(); ctx.ellipse(-7,43,7,2.5,0,0,Math.PI*2); ctx.fillStyle=h.ornamentColor; ctx.fill();
  ctx.beginPath(); ctx.ellipse(7,43,7,2.5,0,0,Math.PI*2); ctx.fillStyle=h.ornamentColor; ctx.fill();

  ctx.restore();
}

function drawParashurama(ctx, h, s, w=60, hh=65) {
  const cx = w/2, cy = hh/2 + 5;
  const breath = Math.sin(s.t * 0.04) * 1.5;
  const swing = s.action ? Math.sin(s.actionT * 0.12) * 30 : 0;
  ctx.clearRect(0, 0, w, hh);
  ctx.save();
  ctx.translate(cx, cy + breath);

  // Body
  ctx.beginPath();
  ctx.moveTo(-17,8); ctx.lineTo(17,8); ctx.lineTo(22,40); ctx.lineTo(-22,40); ctx.closePath();
  ctx.fillStyle = h.robeColor; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-22,40); ctx.lineTo(22,40);
  ctx.strokeStyle = h.robeColor2; ctx.lineWidth=1.5; ctx.stroke();
  ctx.beginPath(); ctx.rect(-18,22,36,6); ctx.fillStyle = h.ornamentColor; ctx.fill();

  // Arms
  ctx.beginPath(); ctx.moveTo(-17,10); ctx.lineTo(-30,28); ctx.lineTo(-26,30); ctx.lineTo(-14,14);
  ctx.fillStyle = h.skinColor; ctx.fill();
  ctx.save(); ctx.translate(17,12);
  ctx.rotate((swing * Math.PI) / 180);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(16,18); ctx.lineTo(18,16); ctx.lineTo(2,-2);
  ctx.fillStyle = h.skinColor; ctx.fill();
  ctx.beginPath(); ctx.moveTo(16,18); ctx.lineTo(30,40);
  ctx.strokeStyle = h.axeHandle; ctx.lineWidth=3; ctx.lineCap='round'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(30,40); ctx.lineTo(38,30); ctx.lineTo(42,36); ctx.lineTo(36,42);
  ctx.fillStyle = h.axeColor; ctx.fill();
  ctx.strokeStyle='#444'; ctx.lineWidth=0.8; ctx.stroke();
  ctx.restore();

  // Neck & head
  ctx.beginPath(); ctx.ellipse(0,3,6,4,0,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();
  ctx.beginPath(); ctx.ellipse(0,-13,15,17,0,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();

  // Hair (matted)
  ctx.beginPath();
  ctx.moveTo(-13,-18); ctx.bezierCurveTo(-16,-36,0,-42,0,-42);
  ctx.bezierCurveTo(0,-42,16,-36,13,-18);
  ctx.fillStyle = h.hairColor; ctx.fill();
  ctx.beginPath(); ctx.ellipse(0,-40,7,5,0,0,Math.PI*2);
  ctx.fillStyle = h.hairColor; ctx.fill();

  // Tilak
  ctx.beginPath(); ctx.moveTo(0,-24); ctx.lineTo(-2.5,-18); ctx.lineTo(2.5,-18);
  ctx.fillStyle = h.tilakColor; ctx.fill();

  // Eyes
  const blink = s.eyeBlink > 0;
  if (!blink) {
    ctx.beginPath(); ctx.ellipse(-6,-13,3.5,3,0,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(6,-13,3.5,3,0,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(-6,-13,2,0,Math.PI*2); ctx.fillStyle=h.eyeColor; ctx.fill();
    ctx.beginPath(); ctx.arc(6,-13,2,0,Math.PI*2); ctx.fillStyle=h.eyeColor; ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(-9,-13); ctx.lineTo(-3,-13); ctx.strokeStyle=h.eyeColor; ctx.lineWidth=1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3,-13); ctx.lineTo(9,-13); ctx.stroke();
  }

  // Beard
  ctx.beginPath();
  ctx.moveTo(-12,-4); ctx.bezierCurveTo(-14,3,-8,9,0,11);
  ctx.bezierCurveTo(8,9,14,3,12,-4);
  ctx.strokeStyle = h.hairColor; ctx.lineWidth=1.5; ctx.stroke();

  // Necklace
  for (let i=-2;i<=2;i++) {
    ctx.beginPath(); ctx.arc(i*4.5,1,2,0,Math.PI*2);
    ctx.fillStyle = h.ornamentColor; ctx.fill();
  }

  // Feet
  ctx.beginPath(); ctx.ellipse(-8,40,6,4,-0.2,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();
  ctx.beginPath(); ctx.ellipse(8,40,6,4,0.2,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();

  ctx.restore();
}

function drawArjuna(ctx, h, s, w=60, hh=65) {
  const cx = w/2, cy = hh/2 + 5;
  const breath = Math.sin(s.t * 0.033) * 1.2;
  const draw = s.action;
  const drawAmt = s.action ? Math.min(s.actionT/30, 1) : 0;
  ctx.clearRect(0, 0, w, hh);
  ctx.save();
  ctx.translate(cx, cy + breath);

  // Body
  ctx.beginPath();
  ctx.moveTo(-18,8); ctx.lineTo(18,8); ctx.lineTo(23,40); ctx.lineTo(-23,40); ctx.closePath();
  ctx.fillStyle = h.robeColor; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0,16,13,11,0,0,Math.PI*2);
  ctx.fillStyle = h.robeColor2; ctx.fill();
  ctx.strokeStyle=h.ornamentColor; ctx.lineWidth=1.2; ctx.stroke();
  ctx.beginPath(); ctx.rect(-18,24,36,6); ctx.fillStyle=h.ornamentColor; ctx.fill();

  // Bow
  const bowX = 24; const bowPull = drawAmt * 18;
  ctx.save();
  ctx.translate(bowX, 0);
  ctx.beginPath(); ctx.moveTo(0,-24);
  ctx.bezierCurveTo(12 + bowPull*0.3, -10, 12 + bowPull*0.3, 10, 0, 24);
  ctx.strokeStyle = h.bowColor; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,-24); ctx.lineTo(-bowPull*0.8,0); ctx.lineTo(0,24);
  ctx.strokeStyle='#C8956A'; ctx.lineWidth=1; ctx.stroke();
  if (drawAmt > 0.1) {
    const ax = -bowPull*0.75;
    ctx.beginPath(); ctx.moveTo(ax,0); ctx.lineTo(ax+40,0);
    ctx.strokeStyle=h.arrowColor; ctx.lineWidth=1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax+40,0); ctx.lineTo(ax+35,-3); ctx.lineTo(ax+35,3); ctx.closePath();
    ctx.fillStyle=h.arrowColor; ctx.fill();
    ctx.beginPath(); ctx.moveTo(ax+2,0); ctx.lineTo(ax-3,-5); ctx.lineTo(ax,0);
    ctx.fillStyle=h.robeColor; ctx.fill();
    ctx.beginPath(); ctx.moveTo(ax+2,0); ctx.lineTo(ax-3,5); ctx.lineTo(ax,0);
    ctx.fillStyle=h.robeColor2; ctx.fill();
  }
  ctx.restore();

  // Arms (simplified)
  ctx.save(); ctx.translate(-17,12); ctx.rotate(-0.2 - drawAmt*0.2);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-12,16); ctx.lineTo(-8,18); ctx.lineTo(4,4);
  ctx.fillStyle = h.skinColor; ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(17,12); ctx.rotate(drawAmt*0.4);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(12,12); ctx.lineTo(10,14); ctx.lineTo(-2,2);
  ctx.fillStyle = h.skinColor; ctx.fill();
  ctx.restore();

  // Neck & head
  ctx.beginPath(); ctx.ellipse(0,3,6,4,0,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();
  ctx.beginPath(); ctx.ellipse(0,-13,14,16,0,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();

  // Crown
  ctx.beginPath(); ctx.rect(-13,-28,26,8); ctx.fillStyle=h.ornamentColor; ctx.fill();
  ctx.beginPath(); ctx.rect(-14,-32,28,5); ctx.fillStyle=h.robeColor; ctx.fill();
  ctx.beginPath(); ctx.arc(0,-30,3,0,Math.PI*2); ctx.fillStyle='#97C459'; ctx.fill();
  ctx.strokeStyle=h.ornamentColor; ctx.lineWidth=0.8; ctx.stroke();

  // Tilak
  ctx.beginPath(); ctx.moveTo(0,-22); ctx.lineTo(-2.5,-16); ctx.lineTo(2.5,-16);
  ctx.fillStyle=h.tilakColor; ctx.fill();

  // Eyes
  const blink = s.eyeBlink > 0;
  if (!blink) {
    ctx.beginPath(); ctx.ellipse(-6,-13,3.5,3,0,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(6,-13,3.5,3,0,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(-6,-13,2,0,Math.PI*2); ctx.fillStyle=h.eyeColor; ctx.fill();
    ctx.beginPath(); ctx.arc(6,-13,2,0,Math.PI*2); ctx.fillStyle=h.eyeColor; ctx.fill();
    if (drawAmt > 0.3) {
      ctx.beginPath(); ctx.moveTo(-9,-16); ctx.lineTo(-3,-16); ctx.strokeStyle='#8B4513'; ctx.lineWidth=1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(3,-16); ctx.lineTo(9,-16); ctx.stroke();
    }
  } else {
    ctx.beginPath(); ctx.moveTo(-9,-13); ctx.lineTo(-3,-13); ctx.strokeStyle=h.eyeColor; ctx.lineWidth=1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3,-13); ctx.lineTo(9,-13); ctx.stroke();
  }

  // Mouth
  ctx.beginPath(); ctx.arc(0,-6,4,0.1,Math.PI-0.1);
  ctx.strokeStyle='#8B4513'; ctx.lineWidth=1.2; ctx.stroke();

  // Necklace
  for (let i=-2;i<=2;i++) {
    ctx.beginPath(); ctx.arc(i*4.5,1,2.2,0,Math.PI*2);
    ctx.fillStyle = h.ornamentColor; ctx.fill();
  }

  // Feet
  ctx.beginPath(); ctx.ellipse(-8,40,6,4,-0.2,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();
  ctx.beginPath(); ctx.ellipse(8,40,6,4,0.2,0,Math.PI*2); ctx.fillStyle=h.skinColor; ctx.fill();

  ctx.restore();
}

const drawMap = {
  'avatarVis': drawKrishna,
  'avatarParsh': drawParashurama,
  'avatarKrish': drawArjuna,
  'avatarParth': drawKrishna, // Parth uses Krishna with different colors
};

// ─── Animation loop ────────────────────────────────────────
function animateAvatars() {
  HEROES.forEach((h, i) => {
    const s = states[i];
    s.t += 1;
    s.blinkTimer--;
    if (s.blinkTimer <= 0) {
      s.eyeBlink = 6;
      s.blinkTimer = Math.random() * 180 + 80;
    }
    if (s.eyeBlink > 0) s.eyeBlink--;
    if (s.action) {
      s.actionT++;
      if (s.actionT > 90) { s.action = false; s.actionT = 0; }
    }
    const canvas = document.getElementById(h.id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const drawFn = drawMap[h.id] || drawKrishna;
    drawFn(ctx, h, s, canvas.width, canvas.height);
  });
  requestAnimationFrame(animateAvatars);
}

// ─── Expose to global scope ───────────────────────────────
window.HEROES = HEROES;
window.states = states;
window.animateAvatars = animateAvatars;
window.setAgentActive = function(agentName, active) {
  const map = { VisCarma: 'Vis', Parsh: 'Parsh', Krish: 'Krish', Parth: 'Parth' };
  const key = map[agentName];
  const dot = document.getElementById('status' + key);
  if (dot) {
    dot.className = 'status-dot' + (active ? ' pulse' : ' idle');
  }
  const idx = HEROES.findIndex(h => h.id === 'avatar' + key);
  if (idx !== -1 && active && !states[idx].action) {
    states[idx].action = true;
    states[idx].actionT = 0;
  }
};
