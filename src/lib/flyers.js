export const FLYER_FORMATS = {
  status: { label: "WhatsApp Status", width: 1080, height: 1920 },
  square: { label: "Square social post", width: 1080, height: 1080 },
  landscape: { label: "Landscape event flyer", width: 1920, height: 1080 },
};

export const FLYER_TYPES = {
  profile: "PLAYER PROFILE",
  community: "GAMING COMMUNITY",
  team: "TEAM RECRUITMENT",
  tournament: "ESPORTS TOURNAMENT",
  event: "GAMING EVENT",
  challenge: "COMMUNITY CHALLENGE",
  achievement: "PLAYER ACHIEVEMENT",
  invitation: "COMMUNITY INVITATION",
};

const themes = {
  neon: { base: "#090d18", deep: "#101a2b", accent: "#77f3d0", secondary: "#4988ff", text: "#f4fff9" },
  violet: { base: "#100c1e", deep: "#23133b", accent: "#dca2ff", secondary: "#8356ff", text: "#fff7ff" },
  ember: { base: "#1b100d", deep: "#3b1c17", accent: "#ffd17c", secondary: "#ff704c", text: "#fff8ed" },
};

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return y;
  let line = "";
  let lines = 0;
  for (let index = 0; index < words.length; index += 1) {
    const candidate = line ? `${line} ${words[index]}` : words[index];
    if (line && context.measureText(candidate).width > maxWidth) {
      context.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      line = words[index];
      if (lines === maxLines - 1) {
        let last = `${line} ${words.slice(index + 1).join(" ")}`.trim();
        while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
        context.fillText(`${last || line}…`, x, y + lines * lineHeight);
        return y + (lines + 1) * lineHeight;
      }
    } else line = candidate;
  }
  if (line && lines < maxLines) {
    context.fillText(line, x, y + lines * lineHeight);
    lines += 1;
  }
  return y + lines * lineHeight;
}

function drawGrid(context, width, height, color) {
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.14;
  context.lineWidth = 1;
  const step = Math.max(48, Math.round(Math.min(width, height) / 18));
  for (let x = 0; x < width; x += step) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += step) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();
}

function drawAvatar(context, data, x, y, size, image) {
  context.save();
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = "#17252b";
  context.fillRect(x, y, size, size);
  if (image) context.drawImage(image, x, y, size, size);
  else {
    context.fillStyle = data.accent;
    context.font = `700 ${Math.round(size * 0.39)}px "DM Sans", Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText((data.username || data.title || "DW").trim().slice(0, 2).toUpperCase(), x + size / 2, y + size / 2);
  }
  context.restore();
  context.save();
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size / 2 - 3, 0, Math.PI * 2);
  context.strokeStyle = data.accent;
  context.lineWidth = Math.max(3, size * 0.035);
  context.stroke();
  context.restore();
}

export function drawFlyer(canvas, data, avatarImage = null) {
  const format = FLYER_FORMATS[data.format] || FLYER_FORMATS.status;
  const palette = themes[data.theme] || themes.neon;
  const { width, height } = format;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create an image canvas.");

  context.fillStyle = palette.base;
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(width * 0.78, height * 0.22, 2, width * 0.78, height * 0.22, Math.max(width, height) * 0.8);
  glow.addColorStop(0, `${palette.secondary}8c`);
  glow.addColorStop(1, `${palette.base}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  drawGrid(context, width, height, palette.accent);

  const landscape = width > height;
  const margin = Math.round(Math.min(width, height) * 0.085);
  const contentWidth = width - margin * 2;
  context.save();
  context.strokeStyle = `${palette.accent}88`;
  context.lineWidth = Math.max(2, width / 540);
  roundedRect(context, margin / 2, margin / 2, width - margin, height - margin, margin * 0.45);
  context.stroke();
  context.restore();

  const brandSize = Math.round(Math.min(width, height) * 0.047);
  context.fillStyle = palette.accent;
  roundedRect(context, margin, margin, brandSize * 1.55, brandSize * 1.35, brandSize * 0.24);
  context.fill();
  context.fillStyle = palette.base;
  context.font = `900 ${Math.round(brandSize * 0.7)}px "DM Sans", Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("DW", margin + brandSize * 0.775, margin + brandSize * 0.68);
  context.textAlign = "left";
  context.fillStyle = palette.text;
  context.font = `800 ${brandSize}px "DM Sans", Arial, sans-serif`;
  context.fillText("DRIVENWAVE", margin + brandSize * 1.9, margin + brandSize * 0.62);
  context.fillStyle = `${palette.accent}cc`;
  context.font = `500 ${Math.round(brandSize * 0.52)}px "DM Sans", Arial, sans-serif`;
  context.fillText("GAMING • COMMUNITY • COMPETITION", margin + brandSize * 1.9, margin + brandSize * 1.32);

  const top = Math.round(landscape ? height * 0.19 : height * 0.2);
  const mainX = landscape ? width * 0.51 : margin;
  const mainWidth = landscape ? width * 0.39 : contentWidth;
  context.fillStyle = palette.accent;
  context.font = `800 ${Math.round(Math.min(width, height) * 0.026)}px "DM Sans", Arial, sans-serif`;
  context.fillText(FLYER_TYPES[data.type] || "GAMING FLYER", mainX, top);

  const titleSize = Math.round(Math.min(width, height) * (landscape ? 0.084 : 0.1));
  context.fillStyle = palette.text;
  context.font = `900 ${titleSize}px "DM Sans", Arial, sans-serif`;
  context.textBaseline = "alphabetic";
  const titleBottom = wrapText(context, data.title || "Find your next game.", mainX, top + titleSize * 1.45, mainWidth, titleSize * 1.13, landscape ? 3 : 4);

  let detailY = titleBottom + titleSize * 0.42;
  if (data.game) {
    context.fillStyle = palette.accent;
    context.font = `700 ${Math.round(Math.min(width, height) * 0.037)}px "DM Sans", Arial, sans-serif`;
    detailY = wrapText(context, data.game.toUpperCase(), mainX, detailY, mainWidth, Math.min(width, height) * 0.047, 2) + 12;
  }
  if (data.showBranding && data.branding) {
    context.fillStyle = palette.accent;
    context.font = `700 ${Math.round(Math.min(width, height) * 0.026)}px "DM Sans", Arial, sans-serif`;
    detailY = wrapText(context, data.branding.toUpperCase(), mainX, detailY, mainWidth, Math.min(width, height) * 0.038, 2) + 8;
  }
  context.fillStyle = `${palette.text}dd`;
  context.font = `500 ${Math.round(Math.min(width, height) * 0.028)}px "DM Sans", Arial, sans-serif`;
  detailY = wrapText(context, data.description || "Connect with players and join the next game.", mainX, detailY + 10, mainWidth, Math.min(width, height) * 0.042, landscape ? 4 : 5);

  const facts = [data.date && `DATE  ${data.date}`, data.prize && `PRIZE  ${data.prize}`].filter(Boolean);
  if (facts.length) {
    context.fillStyle = `${palette.accent}dd`;
    context.font = `700 ${Math.round(Math.min(width, height) * 0.024)}px "DM Sans", Arial, sans-serif`;
    detailY += Math.min(width, height) * 0.025;
    facts.forEach((fact) => {
      detailY = wrapText(context, fact, mainX, detailY, mainWidth, Math.min(width, height) * 0.038, 2);
      detailY += 8;
    });
  }

  if (landscape) {
    const artX = margin * 1.2;
    const artY = height * 0.28;
    const artSize = height * 0.48;
    context.save();
    context.shadowColor = `${palette.accent}44`;
    context.shadowBlur = height * 0.06;
    context.fillStyle = `${palette.deep}dd`;
    context.beginPath();
    context.moveTo(artX + artSize * 0.12, artY);
    context.lineTo(artX + artSize * 0.88, artY);
    context.lineTo(artX + artSize, artY + artSize * 0.15);
    context.lineTo(artX + artSize * 0.9, artY + artSize * 0.86);
    context.lineTo(artX + artSize * 0.5, artY + artSize);
    context.lineTo(artX + artSize * 0.08, artY + artSize * 0.84);
    context.lineTo(artX, artY + artSize * 0.15);
    context.closePath();
    context.fill();
    context.restore();
    if (data.showAvatar) drawAvatar(context, data, artX + artSize * 0.19, artY + artSize * 0.19, artSize * 0.62, avatarImage);
    else {
      context.strokeStyle = `${palette.accent}bb`;
      context.lineWidth = Math.max(3, artSize * 0.018);
      context.beginPath();
      context.arc(artX + artSize / 2, artY + artSize / 2, artSize * 0.27, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = palette.accent;
      context.font = `900 ${Math.round(artSize * 0.14)}px "DM Sans", Arial, sans-serif`;
      context.textAlign = "center";
      context.fillText("DW", artX + artSize / 2, artY + artSize * 0.55);
      context.textAlign = "left";
    }
  } else if (data.showAvatar) {
    const avatarSize = Math.min(width * 0.32, height * 0.17);
    const avatarY = Math.max(top + titleSize * 0.9, height * 0.53);
    drawAvatar(context, data, (width - avatarSize) / 2, avatarY, avatarSize, avatarImage);
  }

  const footerHeight = Math.round(Math.min(width, height) * 0.19);
  const footerY = height - margin - footerHeight;
  context.save();
  context.fillStyle = `${palette.deep}ee`;
  context.strokeStyle = `${palette.accent}66`;
  context.lineWidth = 2;
  roundedRect(context, margin, footerY, contentWidth, footerHeight, margin * 0.3);
  context.fill();
  context.stroke();
  context.restore();
  const footerPad = margin * 0.42;
  context.fillStyle = palette.accent;
  context.font = `800 ${Math.round(Math.min(width, height) * 0.032)}px "DM Sans", Arial, sans-serif`;
  context.fillText(data.cta || "JOIN THE COMMUNITY", margin + footerPad, footerY + footerPad * 1.15);
  if (data.showUsername && data.username) {
    context.fillStyle = palette.text;
    context.font = `600 ${Math.round(Math.min(width, height) * 0.025)}px "DM Sans", Arial, sans-serif`;
    context.fillText(`@${data.username.replace(/^@/, "")}`, margin + footerPad, footerY + footerPad * 1.95);
  }
  context.fillStyle = `${palette.text}cc`;
  context.font = `600 ${Math.round(Math.min(width, height) * 0.022)}px "DM Sans", Arial, sans-serif`;
  const footerUrl = data.showLink && data.shareUrl ? new URL(data.shareUrl).hostname + new URL(data.shareUrl).pathname : "drivenwave.site";
  context.textAlign = "right";
  context.fillText(footerUrl.slice(0, landscape ? 70 : 42), width - margin - footerPad, footerY + footerPad * 1.9);
  context.textAlign = "left";
  context.fillStyle = `${palette.text}88`;
  context.font = `500 ${Math.round(Math.min(width, height) * 0.018)}px "DM Sans", Arial, sans-serif`;
  context.fillText("CONNECT • PLAY • COMPETE", margin + footerPad, height - margin * 0.52);
}

export async function loadFlyerAvatar(url) {
  if (!url) return null;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error("The avatar image could not be loaded with safe cross-origin permissions. Turn off “Include avatar” to make the flyer.");
  }
  return image;
}

export function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas.width || !canvas.height) {
      reject(new Error("Generate a flyer preview before downloading."));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not export this flyer as a PNG."));
    }, "image/png");
  });
}
