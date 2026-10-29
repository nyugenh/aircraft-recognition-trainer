'use strict';

/**
 * Aircraft Recognition Trainer - Main Application Script
 * Refactored for maintainability, clarity, and robust performance.
 */

// ============================================================================
// 1. Configuration & Constants
// ============================================================================
const MANIFEST_PATH = 'manifest.json';
const CODE_FREE_NAMES_PATH = 'icao-free-names.json';
const ASSET_FOLDER = '';

const ANSWER_MODES = [
  { value: 'name', label: 'Name (choose)', semantic: 'name' },
  { value: 'icao', label: 'ICAO (choose)', semantic: 'icao' },
  { value: 'photo', label: 'Photo (choose)', semantic: 'photo' },
  { value: 'enter-name', label: 'Name (type)', semantic: 'name' },
  { value: 'enter-icao', label: 'ICAO (type)', semantic: 'icao' },
];

const QUESTION_TYPES = new Set([
  'photo',
  'name',
  'icao',
  'cruise-speed',
  'speed',
  'rank-speed',
  'approach-speed',
  'compare-approach',
  'rank-approach',
  'climb-speed',
  'compare-climb',
  'rank-climb',
  'descent-speed',
  'compare-descent',
  'rank-descent',
  'wake',
]);

const WAKE_CATEGORIES = ['Light', 'Medium', 'Heavy', 'Super'];
const WAKE_CATEGORY_INFO = {
  Light: 'MTOW ≤ 7,000 kg',
  Medium: 'MTOW > 7,000 kg and < 136,000 kg',
  Heavy: 'MTOW ≥ 136,000 kg',
  Super: 'Airbus A380',
};
const WAKE_CATEGORY_CHOICE_LABELS = {
  Light: 'Light (≤ 7,000 kg)',
  Medium: 'Medium (7,000–136,000 kg)',
  Heavy: 'Heavy (≥ 136,000 kg)',
  Super: 'Super',
};

const KEYBOARD_HELP =
  'Keyboard shortcuts: 1 through 4 select an answer. ' +
  'Arrow keys move between answer choices. ' +
  'Home selects the first answer and End selects the last. ' +
  'Enter submits a typed answer. N moves to the next question.';

// ============================================================================
// 2. DOM References & UI Setup
// ============================================================================
const $ = (selector) => document.querySelector(selector);
const byId = (id) => document.getElementById(id);

const appElement = $('.app');
const categorySelect = byId('category');
const questionTypeSelect = byId('question-type');
let answerTypeSelect = byId('answer-type');
let answerTypeLabel = byId('answer-type-label');
let answerTypeCaption = null;

if (!answerTypeSelect) {
  const controlsElement = $('.controls');
  if (controlsElement) {
    if (!answerTypeLabel) {
      answerTypeLabel = document.createElement('label');
      answerTypeLabel.id = 'answer-type-label';
      answerTypeLabel.textContent = 'Answer';
      controlsElement.appendChild(answerTypeLabel);
    }
    answerTypeSelect = document.createElement('select');
    answerTypeSelect.id = 'answer-type';
    answerTypeSelect.name = 'answer-type';
    answerTypeSelect.setAttribute('aria-label', 'Answer type');
    answerTypeLabel.appendChild(answerTypeSelect);
  }
}

if (answerTypeLabel) {
  const existingCaptionNode = [...answerTypeLabel.childNodes].find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
  );
  answerTypeCaption = document.createElement('span');
  answerTypeCaption.className = 'answer-type-caption';
  answerTypeCaption.textContent = existingCaptionNode
    ? existingCaptionNode.textContent.trim()
    : 'Answer';
  if (existingCaptionNode) {
    existingCaptionNode.replaceWith(answerTypeCaption);
  } else {
    answerTypeLabel.insertBefore(answerTypeCaption, answerTypeSelect);
  }
  answerTypeLabel.dataset.defaultLabel = answerTypeCaption.textContent;
}

const imageContainer = byId('image-container');
const imageElement = byId('aircraft-image');
const loadingMessage = byId('loading-message');
const photoViewer = byId('photo-viewer');
const photoViewerImage = byId('photo-viewer-image');
const photoViewerTitle = byId('photo-viewer-title');
const photoViewerStage = byId('photo-viewer-stage');
const photoViewerCloseButton = byId('photo-viewer-close');
const photoZoomLevel = byId('photo-zoom-level');
const photoZoomInButton = byId('photo-zoom-in');
const photoZoomOutButton = byId('photo-zoom-out');
const photoZoomResetButton = byId('photo-zoom-reset');
const photoZoomStep = 0.5;
const photoZoomMaximum = 4;
let photoZoom = 1;
let photoPanX = 0;
let photoPanY = 0;
let lastFocusedPhoto = null;
const photoPointers = new Map();
let photoPinchStart = null;
let photoDragStart = null;
const promptElement = byId('prompt');
const answerContainer = byId('answers');
const answerButtons = [...document.querySelectorAll('#answers button')];
const typeAnswerContainer = byId('type-answer-container');
const typeAnswerInput = byId('type-answer-input');
const submitAnswerButton = byId('submit-answer');
const scoreElement = byId('score');
const feedbackElement = byId('feedback');
const nextButton = byId('next');
const photoToggleButton = byId('photo-toggle');

photoToggleButton.type = 'button';
photoToggleButton.className = 'photo-toggle';
photoToggleButton.hidden = true;
photoToggleButton.setAttribute('aria-pressed', 'false');

function updatePhotoViewerTransform() {
  photoViewerImage.style.transform = `translate(${photoPanX}px, ${photoPanY}px) scale(${photoZoom})`;
  photoViewerImage.style.cursor = photoZoom > 1 ? 'grab' : 'zoom-in';
  photoZoomLevel.value = `${Math.round(photoZoom * 100)}%`;
  photoZoomLevel.textContent = `${Math.round(photoZoom * 100)}%`;
}

function setPhotoZoom(zoom) {
  photoZoom = Math.max(1, Math.min(photoZoomMaximum, zoom));
  if (photoZoom === 1) {
    photoPanX = 0;
    photoPanY = 0;
  }
  updatePhotoViewerTransform();
}

function showPhotoViewer(image) {
  if (image.hidden || !image.naturalWidth) return;
  lastFocusedPhoto = image;
  photoViewerImage.src = image.currentSrc || image.src;
  photoViewerImage.alt = image.alt;
  photoViewerTitle.textContent = image.alt || 'Aircraft photo';
  setPhotoZoom(1);
  photoViewer.showModal();
  photoViewerCloseButton.focus();
}

function isAircraftPhoto(image) {
  return image.matches(
    '#aircraft-image, .speed-aircraft-photo img, .ranking-photo-wrap img',
  );
}

function preparePhotoViewerImage(image) {
  if (!isAircraftPhoto(image)) return;
  image.setAttribute('aria-label', `Open larger photo: ${image.alt}`);
  if (!image.closest('button')) {
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
  }
}

document.addEventListener(
  'click',
  (event) => {
    const image = event.target.closest?.('img');
    if (!(image instanceof HTMLImageElement) || !isAircraftPhoto(image)) return;
    event.preventDefault();
    event.stopPropagation();
    showPhotoViewer(image);
  },
  true,
);

document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape' && photoViewer.open) {
      event.preventDefault();
      photoViewer.close();
      return;
    }
    const image = event.target;
    if (
      !(image instanceof HTMLImageElement) ||
      !isAircraftPhoto(image) ||
      (event.key !== 'Enter' && event.key !== ' ')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    showPhotoViewer(image);
  },
  true,
);

photoViewerCloseButton.addEventListener('click', () => {
  photoViewer.close();
});

photoViewer.addEventListener('click', (event) => {
  if (event.target === photoViewer) photoViewer.close();
});

photoViewer.addEventListener('close', () => {
  lastFocusedPhoto?.focus();
  lastFocusedPhoto = null;
});

photoZoomInButton.addEventListener('click', () => {
  setPhotoZoom(photoZoom + photoZoomStep);
});

photoZoomOutButton.addEventListener('click', () => {
  setPhotoZoom(photoZoom - photoZoomStep);
});

photoZoomResetButton.addEventListener('click', () => {
  setPhotoZoom(1);
});

photoViewer.addEventListener('wheel', (event) => {
  event.preventDefault();
  setPhotoZoom(photoZoom + (event.deltaY < 0 ? photoZoomStep : -photoZoomStep));
});

photoViewerStage.addEventListener('pointerdown', (event) => {
  if (event.target !== photoViewerImage) return;
  event.preventDefault();
  photoViewerStage.setPointerCapture(event.pointerId);
  photoPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (photoPointers.size === 2) {
    const [first, second] = [...photoPointers.values()];
    photoPinchStart = {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      zoom: photoZoom,
    };
    photoDragStart = null;
  } else if (photoZoom > 1) {
    photoDragStart = {
      x: event.clientX,
      y: event.clientY,
      panX: photoPanX,
      panY: photoPanY,
    };
    photoViewerImage.style.cursor = 'grabbing';
  }
});

photoViewerStage.addEventListener('pointermove', (event) => {
  if (!photoPointers.has(event.pointerId)) return;
  photoPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (photoPointers.size === 2 && photoPinchStart) {
    const [first, second] = [...photoPointers.values()];
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    setPhotoZoom(photoPinchStart.zoom * (distance / photoPinchStart.distance));
  } else if (photoDragStart && photoZoom > 1) {
    photoPanX = photoDragStart.panX + event.clientX - photoDragStart.x;
    photoPanY = photoDragStart.panY + event.clientY - photoDragStart.y;
    updatePhotoViewerTransform();
  }
});

function finishPhotoPointer(event) {
  photoPointers.delete(event.pointerId);
  if (photoPointers.size < 2) photoPinchStart = null;
  if (photoPointers.size === 0) {
    photoDragStart = null;
    if (photoViewer.open) updatePhotoViewerTransform();
  }
}

photoViewerStage.addEventListener('pointerup', finishPhotoPointer);
photoViewerStage.addEventListener('pointercancel', finishPhotoPointer);

const photoToggleIcon = document.createElementNS(
  'http://www.w3.org/2000/svg',
  'svg',
);
photoToggleIcon.setAttribute('viewBox', '0 0 24 24');
photoToggleIcon.setAttribute('fill', 'none');
photoToggleIcon.setAttribute('stroke', 'currentColor');
photoToggleIcon.setAttribute('stroke-width', '2');
photoToggleIcon.setAttribute('stroke-linecap', 'round');
photoToggleIcon.setAttribute('stroke-linejoin', 'round');
photoToggleIcon.setAttribute('aria-hidden', 'true');

const photoToggleText = document.createElement('span');
photoToggleButton.replaceChildren(photoToggleIcon, photoToggleText);

function updatePhotoToggleContents(visible) {
  photoToggleText.textContent = visible ? 'Hide photos' : 'Show photos';
  photoToggleIcon.replaceChildren();

  const shapes = visible
    ? [
        ['path', { d: 'M2 2l20 20' }],
        ['path', { d: 'M10.6 10.6a2 2 0 0 0 2.8 2.8' }],
        [
          'path',
          {
            d: 'M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.3 4.5 9.5 6.3a1.2 1.2 0 0 1 0 1.4 16 16 0 0 1-3.1 3.4',
          },
        ],
        [
          'path',
          {
            d: 'M6.2 6.2a16 16 0 0 0-3.7 5.1 1.2 1.2 0 0 0 0 1.4C3.7 14.5 7 19 12 19a10 10 0 0 0 3-.5',
          },
        ],
      ]
    : [
        ['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z' }],
        ['circle', { cx: '12', cy: '12', r: '3' }],
      ];

  for (const [tagName, attributes] of shapes) {
    const shape = document.createElementNS(
      'http://www.w3.org/2000/svg',
      tagName,
    );
    for (const [attribute, value] of Object.entries(attributes)) {
      shape.setAttribute(attribute, value);
    }
    photoToggleIcon.appendChild(shape);
  }
}
updatePhotoToggleContents(false);

// ============================================================================
// 3. Application State
// ============================================================================
let aircraft = [];
let currentAircraft = null;
let currentChoices = [];
let aircraftStats = {};
let questionCounter = 0;
let recentAircraftKeys = [];
let scoreAtQuestionStart = 0;
const MAX_COOLDOWN = 10;
const COOLDOWN_RATIO = 0.2;
let score = 0;
let total = 0;
let answered = false;
let specialQuestionData = null;
let photosVisible = false;
let rankingPointerDrag = null;
let previousQuestion = null;

// ============================================================================
// 4. General Utilities & Helpers
// ============================================================================
const displayText = (value) => (value == null ? '' : String(value).trim());

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

const randomItem = (items) =>
  items.length ? items[Math.floor(Math.random() * items.length)] : null;

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normaliseAnswer(value) {
  return displayText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// ============================================================================
// 5. Image Loading & Transition Management
// ============================================================================
function preparePhotoFadeIn(image) {
  if (!(image instanceof HTMLImageElement)) return;
  preparePhotoViewerImage(image);
  // Fade only once the pixels exist, otherwise the animation finishes while the image is still blank.
  if (!image.complete || !image.naturalWidth) return;
  if (image.dataset.fadeInPrepared === 'true' && image.style.animationName)
    return;
  image.dataset.fadeInPrepared = 'true';

  image.style.animation = 'none';
  image.offsetHeight; // Trigger DOM reflow
  image.style.animation = 'photoFadeIn 0.25s ease-out forwards';
}

function loadQuestionImage(path, altText) {
  pendingPhotoLoad = null;
  return new Promise((resolve, reject) => {
    if (typeof setLoading === 'function') setLoading(true);
    imageElement.removeAttribute('src');
    imageElement.style.opacity = '0';

    const preloader = new Image();

    preloader.onload = () => {
      if (typeof setLoading === 'function') setLoading(false);

      imageElement.style.animation = 'none';
      imageElement.offsetHeight; // Trigger reflow

      imageElement.alt = altText;
      imageElement.src = path;
      imageElement.style.opacity = '1';
      imageElement.style.animation = 'photoFadeIn 0.25s ease-out forwards';
      resolve();
    };

    preloader.onerror = () => {
      if (typeof setLoading === 'function') setLoading(false);
      reject(new Error(`Unable to load aircraft image: ${path}`));
    };

    preloader.src = path;
  });
}

// Toggle-mode photos are only fetched once they are revealed.
let pendingPhotoLoad = null;

function loadQuestionImageWhenRevealed(path, altText) {
  imageElement.removeAttribute('src');
  delete imageElement.dataset.pendingSrc;
  if (photosVisible) {
    pendingPhotoLoad = null;
    return loadQuestionImage(path, altText);
  }
  setLoading(false);
  imageElement.style.opacity = '0';
  imageElement.dataset.pendingSrc = path;
  pendingPhotoLoad = () => {
    const showSpinner = (loading) => {
      if (imageElement.dataset.pendingSrc !== path) return;
      imageElement.classList.toggle('loading', loading);
      loadingMessage.classList.toggle('hidden', !loading);
    };
    showSpinner(true);
    const preloader = new Image();
    preloader.onload = () => {
      if (imageElement.dataset.pendingSrc !== path) return;
      showSpinner(false);
      imageElement.style.animation = 'none';
      imageElement.offsetHeight; // Restart the fade-in
      imageElement.alt = altText;
      imageElement.src = path;
      imageElement.style.opacity = '1';
      imageElement.style.animation = 'photoFadeIn 0.25s ease-out forwards';
    };
    preloader.onerror = () => {
      showSpinner(false);
      feedbackElement.textContent = `Unable to load aircraft image: ${path}`;
    };
    preloader.src = path;
  };
  return Promise.resolve();
}

function setDeferredImageSource(image, path) {
  if (photosVisible) image.src = path;
  else image.dataset.src = path;
}

function loadDeferredPhotos() {
  if (!photosVisible) return;
  if (pendingPhotoLoad) {
    const load = pendingPhotoLoad;
    pendingPhotoLoad = null;
    load();
  }
  document.querySelectorAll('img[data-src]').forEach((image) => {
    const path = image.dataset.src;
    delete image.dataset.src;
    image.src = path;
  });
}

function preparePhotosIn(node) {
  if (!(node instanceof Element)) return;
  if (node.matches('img')) preparePhotoFadeIn(node);
  node.querySelectorAll?.('img').forEach(preparePhotoFadeIn);
}

const photoFadeObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(preparePhotosIn);
    } else if (
      mutation.type === 'attributes' &&
      mutation.target instanceof HTMLImageElement
    ) {
      const image = mutation.target;
      if (image !== imageElement && image.getAttribute('src')) {
        preparePhotoViewerImage(image);
        image.dataset.fadeInPrepared = 'false';
        preparePhotoFadeIn(image);
      }
    }
  }
});
photoFadeObserver.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['src'],
});
preparePhotoViewerImage(imageElement);

document.addEventListener(
  'load',
  (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image === imageElement) return;
    image.dataset.fadeInPrepared = 'false';
    preparePhotoFadeIn(image);
  },
  true,
);
function cleanPath(value) {
  return displayText(value).replace(/\\/g, '/').replace(/^\/+/, '');
}

function getAircraftImages(item) {
  if (!item) return [];
  const folder = cleanPath(item.folder);
  const baseFolder = cleanPath(ASSET_FOLDER);
  let images = [];
  if (Array.isArray(item.images)) {
    images = item.images.map(cleanPath).filter(Boolean);
  } else if (item.image_path) {
    images = [cleanPath(item.image_path)].filter(Boolean);
  }
  return images.map((image) => {
    const path = folder ? `${folder}/${image}` : image;
    return baseFolder ? `${baseFolder}/${path}` : path;
  });
}

const lastImageByAircraft = new Map();
function getRandomImagePath(item) {
  const images = getAircraftImages(item);
  const key = getAircraftTypeKey(item);
  const last = lastImageByAircraft.get(key);
  const options = images.length > 1 ? images.filter((p) => p !== last) : images;
  const chosen = randomItem(options) ?? '';
  if (key) lastImageByAircraft.set(key, chosen);
  return chosen;
}

// ============================================================================
// 6. Question & Answer Mode Helpers
// ============================================================================
const speedModeSelect = byId('speed-mode');
const speedModeLabel = byId('speed-mode-label');
// The Question select holds cruise/climb/descent; the Mode select picks the format.
const getQuestionType = () => {
  const base = questionTypeSelect.value;
  const metric = SPEED_METRICS[base];
  return metric ? metric[speedModeSelect.value] : base;
};
function syncSpeedModeVisibility() {
  speedModeLabel.hidden = !SPEED_METRICS[questionTypeSelect.value];
}
const getAnswerMode = () => answerTypeSelect.value;
const isSpecialQuestionType = (type = getQuestionType()) =>
  type === 'wake' || getSpeedQuestion(type) !== null;
const getAnswerSemanticType = (mode = getAnswerMode()) =>
  ANSWER_MODES.find((item) => item.value === mode)?.semantic ?? '';
const isTypedAnswer = (mode = getAnswerMode()) =>
  mode === 'enter-name' || mode === 'enter-icao';
const isPhotoAnswer = (mode = getAnswerMode()) => mode === 'photo';

function ensureAnswerTypeOptions() {
  for (const definition of ANSWER_MODES) {
    let option = [...answerTypeSelect.options].find(
      (item) => item.value === definition.value,
    );
    if (!option) {
      option = document.createElement('option');
      option.value = definition.value;
      answerTypeSelect.appendChild(option);
    }
    option.textContent = definition.label;
  }
}

function syncAnswerOptions() {
  const questionType = getQuestionType();
  const specialQuestion = isSpecialQuestionType(questionType);
  const currentValue = answerTypeSelect.value;
  if (answerTypeLabel) {
    answerTypeLabel.hidden = false;
    if (answerTypeCaption) {
      answerTypeCaption.textContent = specialQuestion
        ? 'Identifier'
        : answerTypeLabel.dataset.defaultLabel || 'Answer';
    }
  }
  answerTypeSelect.disabled = false;
  const availableModes = ANSWER_MODES.filter((definition) =>
    specialQuestion
      ? ['name', 'icao'].includes(definition.value)
      : getAnswerSemanticType(definition.value) !== questionType,
  );
  answerTypeSelect.replaceChildren();
  for (const definition of availableModes) {
    const option = document.createElement('option');
    option.value = definition.value;
    option.textContent = specialQuestion
      ? ({ name: 'Aircraft name', icao: 'ICAO code' }[definition.value] ??
        definition.label)
      : definition.label;
    answerTypeSelect.appendChild(option);
  }
  if (availableModes.some((definition) => definition.value === currentValue)) {
    answerTypeSelect.value = currentValue;
    return;
  }
  const preferredModes = {
    photo: ['name', 'enter-name', 'icao', 'enter-icao'],
    name: ['photo', 'icao', 'enter-icao'],
    icao: ['photo', 'name', 'enter-name'],
  };
  const preferred = (preferredModes[questionType] ?? []).find((mode) =>
    availableModes.some((definition) => definition.value === mode),
  );
  answerTypeSelect.value = preferred ?? availableModes[0]?.value ?? '';
}

// ============================================================================
// 7. Aircraft Data & Property Helpers
// ============================================================================
const getAircraftCode = (item) => displayText(item?.icao);

const getFullAircraftName = (item) => displayText(item?.label ?? item?.name);

const normalizeIdentifier = (text) =>
  text.toUpperCase().replace(/[^A-Z0-9]/g, '');

// A name token gives away the ICAO code when it contains the code, or shares
// a run of at least two digits with it (e.g. "172" for C172, "UH-60M" for H60).
function tokenRevealsCode(token, code) {
  const tokenId = normalizeIdentifier(token);
  const codeId = normalizeIdentifier(code);
  if (!/\d/.test(tokenId) || codeId.length < 2) return false;
  if (tokenId.includes(codeId) || (tokenId.length > 1 && codeId.includes(tokenId)))
    return true;
  const tokenDigits = tokenId.replace(/\D/g, '');
  const codeDigits = codeId.replace(/\D/g, '');
  return (
    tokenDigits.length >= 2 &&
    codeDigits.length >= 2 &&
    (tokenDigits.includes(codeDigits) || codeDigits.includes(tokenDigits))
  );
}

function stripCodeFromName(item) {
  const name = getFullAircraftName(item);
  const code = getAircraftCode(item);
  if (!name || !code) return name;
  const tokens = name.split(/\s+/);
  const kept = tokens.filter((token) => !tokenRevealsCode(token, code));
  return kept.length === tokens.length ? name : kept.join(' ');
}

let codeFreeNameCache = null;

// Names come from icao-free-names.json (full label -> shown name). Aircraft
// missing from that file fall back to automatic stripping, or the full name
// when stripping would leave it too generic.
let codeFreeNameOverrides = new Map();

function getCodeFreeName(item) {
  const override = codeFreeNameOverrides.get(getFullAircraftName(item));
  if (override) return override;
  if (!codeFreeNameCache || codeFreeNameCache.source !== aircraft) {
    const counts = new Map();
    for (const entry of aircraft) {
      const key = stripCodeFromName(entry).toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    codeFreeNameCache = { source: aircraft, counts };
  }
  const full = getFullAircraftName(item);
  const stripped = stripCodeFromName(item);
  if (stripped === full) return full;
  const prefix = `${stripped.toLowerCase()} `;
  const tooGeneric =
    !stripped ||
    (codeFreeNameCache.counts.get(stripped.toLowerCase()) ?? 0) > 1 ||
    aircraft.some(
      (other) =>
        other !== item && getFullAircraftName(other).toLowerCase().startsWith(prefix),
    );
  return tooGeneric ? full : stripped;
}

function getAnswerValue(item, type) {
  if (!item) return '';
  if (type === 'Aircraft name' || type === 'name') {
    const hidesCode =
      (getQuestionType() === 'icao' &&
        (getAnswerMode() === 'name' || getAnswerMode() === 'enter-name')) ||
      (getQuestionType() === 'name' &&
        (getAnswerMode() === 'icao' || getAnswerMode() === 'enter-icao'));
    return hidesCode ? getCodeFreeName(item) : getFullAircraftName(item);
  }
  if (type === 'ICAO code' || type === 'icao') return getAircraftCode(item);
  return '';
}

function getFeedbackAnswer(item, type) {
  if (!item) return '';
  const name = getFullAircraftName(item);
  const code = getAnswerValue(item, 'icao');
  if (type === 'Aircraft name' || type === 'name') {
    return name && code ? `${name} (${code})` : name || code;
  }
  if (type === 'ICAO code' || type === 'icao') {
    return code && name ? `${code} (${name})` : code || name;
  }
  return '';
}

function getFeedbackDisplayAnswer(item) {
  if (!item) return '';
  const questionType = getQuestionType();
  const answerSemantic = getAnswerSemanticType();
  const name = getFullAircraftName(item);
  if (questionType === 'photo') {
    return getFeedbackAnswer(item, answerSemantic === 'icao' ? 'icao' : 'name');
  }
  if (questionType === 'name' && answerSemantic === 'icao') {
    return getAnswerValue(item, 'icao');
  }
  if (questionType === 'icao' && isPhotoAnswer()) {
    return getFeedbackAnswer(item, 'icao');
  }
  if (questionType === 'icao' && answerSemantic === 'name') return name;
  return getFeedbackAnswer(item, answerSemantic === 'icao' ? 'icao' : 'name');
}

const getTypedAnswerValue = (item, mode = getAnswerMode()) =>
  mode === 'enter-name'
    ? getAnswerValue(item, 'name')
    : mode === 'enter-icao'
      ? getAnswerValue(item, 'icao')
      : '';

function getAircraftTypeKey(item) {
  const code = getAircraftCode(item).toLowerCase();
  const name = getAnswerValue(item, 'name').toLowerCase();
  if (code) return `code:${code}`;
  if (name) return `name:${name}`;
  return '';
}

function getQuestionAircraftKeys(items, ordered = false) {
  const keys = items.map(getRankingItemKey);
  return ordered ? keys : keys.sort();
}

function isRepeatedQuestion(
  questionType,
  items,
  ordered = false,
  signature = '',
) {
  if (previousQuestion?.type !== questionType) return false;
  if (signature && previousQuestion.signature)
    return signature === previousQuestion.signature;
  if (previousQuestion.answerMode !== getAnswerMode()) return false;
  const keys = getQuestionAircraftKeys(items, ordered);
  return (
    keys.length === previousQuestion.keys.length &&
    keys.every((key, index) => key === previousQuestion.keys[index])
  );
}

function rememberQuestion(
  questionType,
  items,
  ordered = false,
  signature = '',
) {
  previousQuestion = {
    type: questionType,
    answerMode: getAnswerMode(),
    keys: getQuestionAircraftKeys(items, ordered),
    aircraftTypeKeys: items.map(getAircraftTypeKey),
    signature,
  };
}

function getPreviousSingleQuestionAircraftKey(questionType) {
  if (
    previousQuestion?.type === questionType &&
    previousQuestion.answerMode === getAnswerMode() &&
    previousQuestion.keys.length === 1
  )
    return previousQuestion.aircraftTypeKeys[0];
  return '';
}

const getAircraftDisplayName = (item) =>
  getAnswerValue(item, 'name') || getAnswerValue(item, 'icao');

function getSpecialArticle(identifier) {
  return getAnswerMode() === 'icao'
    ? getIndefiniteArticleForCode(identifier)
    : getIndefiniteArticle(identifier);
}

function getSpecialAircraftIdentifier(item) {
  const type = getAnswerMode() === 'icao' ? 'icao' : 'name';
  return getAnswerValue(item, type) || getAircraftDisplayName(item);
}

function getSpeedComparisonPrompt(first, second) {
  const firstName = getSpecialAircraftIdentifier(first);
  const secondName = getSpecialAircraftIdentifier(second);
  const { metric } = getSpeedQuestion();
  if (metric.words === RATE_WORDS) {
    return (
      `Is the ${metric.noun} of ${getSpecialArticle(firstName)} ${firstName} ` +
      `higher, lower, or the same as that of ` +
      `${getSpecialArticle(secondName)} ${secondName}?`
    );
  }
  if (metric.key !== 'cruise') {
    return (
      `Is the ${metric.noun} of ${getSpecialArticle(firstName)} ${firstName} ` +
      `faster, slower, or the same as that of ` +
      `${getSpecialArticle(secondName)} ${secondName}?`
    );
  }
  return (
    `Is ${getSpecialArticle(firstName)} ${firstName} faster, slower, ` +
    `or the same speed as ${getSpecialArticle(secondName)} ${secondName}?`
  );
}

// ============================================================================
// 8. Speed & Wake Calculations
// ============================================================================
// Each metric has three question types: compare, estimate (choose a band) and rank.
// Bands [min, max) are chosen to split the manifest's values fairly evenly.
// Fast speeds read better as Mach; 573 kt is the speed of sound at typical cruise altitude.
const MACH_THRESHOLD_KT = 400;
const KT_PER_MACH = 573;
const formatSpeed = (kt) =>
  kt >= MACH_THRESHOLD_KT
    ? `Mach ${(kt / KT_PER_MACH).toFixed(2)}`
    : `${Math.round(kt)} kt`;

const formatRate = (ftPerMin) =>
  `${Math.round(ftPerMin).toLocaleString('en-US')} ft/min`;

const makeSpeedSegments = (low, mid, high, format = formatSpeed) => [
  { min: -Infinity, max: low, label: `Below ${format(low)}` },
  { min: low, max: mid, label: `${format(low)} to below ${format(mid)}` },
  { min: mid, max: high, label: `${format(mid)} to below ${format(high)}` },
  { min: high, max: Infinity, label: `${format(high)} or above` },
];

const SPEED_WORDS = {
  higher: 'Faster',
  lower: 'Slower',
  same: 'Same speed',
  low: 'slowest',
  high: 'fastest',
};
const RATE_WORDS = {
  higher: 'Higher',
  lower: 'Lower',
  same: 'Same rate',
  low: 'lowest',
  high: 'highest',
};

// step/zeroError drive the estimate slider; maxEstimate leaves outliers out of estimate questions; mach metrics switch to Mach above the threshold.
const SPEED_METRICS = {
  cruise: {
    key: 'cruise',
    field: 'cruise_speed_kt',
    noun: 'cruise speed',
    compare: 'speed',
    estimate: 'cruise-speed',
    rank: 'rank-speed',
    format: formatSpeed,
    words: SPEED_WORDS,
    mach: true,
    step: 10,
    zeroError: 60,
    segments: makeSpeedSegments(150, 250, 450),
  },
  approach: {
    key: 'approach',
    field: 'approach_speed_kt',
    noun: 'approach speed',
    compare: 'compare-approach',
    estimate: 'approach-speed',
    rank: 'rank-approach',
    format: formatSpeed,
    words: SPEED_WORDS,
    mach: true,
    step: 5,
    zeroError: 30,
    segments: makeSpeedSegments(75, 110, 130),
  },
  climb: {
    key: 'climb',
    field: 'rate_of_climb_ft_per_min',
    noun: 'rate of climb',
    compare: 'compare-climb',
    estimate: 'climb-speed',
    rank: 'rank-climb',
    format: formatRate,
    words: RATE_WORDS,
    step: 100,
    zeroError: 1500,
    maxEstimate: 4300,
    segments: makeSpeedSegments(1300, 2000, 3000, formatRate),
  },
  descent: {
    key: 'descent',
    field: 'rate_of_descent_ft_per_min',
    noun: 'rate of descent',
    compare: 'compare-descent',
    estimate: 'descent-speed',
    rank: 'rank-descent',
    format: formatRate,
    words: RATE_WORDS,
    step: 100,
    zeroError: 1000,
    maxEstimate: 3500,
    segments: makeSpeedSegments(800, 2000, 3000, formatRate),
  },
};
// Returns { metric, kind } for a speed-based question type, otherwise null.
function getSpeedQuestion(type = getQuestionType()) {
  for (const metric of Object.values(SPEED_METRICS)) {
    for (const kind of ['compare', 'estimate', 'rank']) {
      if (metric[kind] === type) return { metric, kind };
    }
  }
  return null;
}

const isSpeedKind = (kind, type = getQuestionType()) =>
  getSpeedQuestion(type)?.kind === kind;

function getSpeedValue(item, metric = getSpeedQuestion()?.metric) {
  const speed = item?.[(metric ?? SPEED_METRICS.cruise).field];
  if (speed == null || speed === '') return null;
  const value = Number(speed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getSpeedSegment(item) {
  const speed = getSpeedValue(item);
  if (speed == null) return null;
  if (speed > (getSpeedQuestion().metric.maxEstimate ?? Infinity)) return null;
  return (
    getSpeedQuestion().metric.segments.find(
      (segment) => speed >= segment.min && speed < segment.max,
    ) ?? null
  );
}

const formatApproxSpeed = (speed, metric = getSpeedQuestion()?.metric) =>
  `≈ ${(metric?.format ?? formatSpeed)(speed)}`;

function getWakeCategory(item) {
  const value = displayText(item?.wake_category).toLowerCase();
  const categories = {
    l: 'Light',
    light: 'Light',
    m: 'Medium',
    medium: 'Medium',
    h: 'Heavy',
    heavy: 'Heavy',
    j: 'Super',
    super: 'Super',
  };
  return categories[value] ?? '';
}

// ============================================================================
// 9. Pool Selection & Filtering
// ============================================================================
function populateCategories() {
  const categories = [
    ...new Set(
      aircraft.map((item) => displayText(item.category)).filter(Boolean),
    ),
  ].sort((first, second) => first.localeCompare(second));
  categorySelect.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = 'All';
  allOption.textContent = 'All';
  categorySelect.appendChild(allOption);
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  }
}

function getSelectedAircraftPool() {
  const category = categorySelect.value;
  if (!category || category === 'All') return [...aircraft];
  return aircraft.filter((item) => displayText(item.category) === category);
}

function itemHasRequiredValue(item, type) {
  if (type === 'photo') return getAircraftImages(item).length > 0;
  return Boolean(getAnswerValue(item, type));
}

function filterPoolForCombination(pool) {
  const questionType = getQuestionType();
  if (isSpeedKind('compare', questionType)) {
    return pool.filter(
      (item) =>
        getSpeedValue(item) != null &&
        Boolean(
          getAnswerValue(item, getAnswerMode() === 'icao' ? 'icao' : 'name'),
        ),
    );
  }
  if (isSpeedKind('estimate', questionType)) {
    return pool.filter(
      (item) =>
        getAircraftImages(item).length > 0 &&
        getSpeedValue(item) != null &&
        Boolean(
          getAnswerValue(item, getAnswerMode() === 'icao' ? 'icao' : 'name'),
        ),
    );
  }
  if (questionType === 'wake') {
    return pool.filter(
      (item) =>
        getAircraftImages(item).length > 0 &&
        Boolean(getWakeCategory(item)) &&
        Boolean(
          getAnswerValue(item, getAnswerMode() === 'icao' ? 'icao' : 'name'),
        ),
    );
  }
  const answerSemantic = getAnswerSemanticType();
  return pool.filter((item) => {
    if (!itemHasRequiredValue(item, questionType)) return false;
    if (answerSemantic === 'photo') return getAircraftImages(item).length > 0;
    return Boolean(getAnswerValue(item, answerSemantic));
  });
}

function getValidAircraftPool() {
  return filterPoolForCombination(getSelectedAircraftPool());
}

function chooseAircraft(excludedKey = '') {
  const pool = getValidAircraftPool().filter(
    (item) => getAircraftTypeKey(item) !== excludedKey,
  );
  if (!pool.length) return null;
  const aircraftByType = new Map();
  for (const item of pool) {
    const key = getAircraftTypeKey(item);
    if (!key) continue;
    if (!aircraftByType.has(key)) aircraftByType.set(key, []);
    aircraftByType.get(key).push(item);
  }
  if (!aircraftByType.size) return null;

  const cooldown = Math.min(
    MAX_COOLDOWN,
    Math.floor(aircraftByType.size * COOLDOWN_RATIO),
  );
  const cooling = new Set(recentAircraftKeys.slice(-cooldown || Infinity));
  if (!cooldown) cooling.clear();
  let candidates = [...aircraftByType.keys()].filter(
    (key) => !cooling.has(key),
  );
  if (!candidates.length) candidates = [...aircraftByType.keys()];

  const weights = candidates.map(getAircraftWeight);
  let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  let chosen = candidates[candidates.length - 1];
  for (let i = 0; i < candidates.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) {
      chosen = candidates[i];
      break;
    }
  }
  return randomItem(aircraftByType.get(chosen));
}

function getAircraftWeight(key) {
  const stat = aircraftStats[key];
  if (!stat) return 2;
  const unseen = Math.min((questionCounter - stat.lastSeen) / 50, 1);
  return Math.max(0.2, stat.weight) * (1 + unseen);
}

function recordAircraftShown(item) {
  const key = getAircraftTypeKey(item);
  if (!key) return;
  questionCounter += 1;
  recentAircraftKeys.push(key);
  if (recentAircraftKeys.length > MAX_COOLDOWN) recentAircraftKeys.shift();
  const stat = aircraftStats[key] ?? { weight: 1, lastSeen: 0 };
  stat.lastSeen = questionCounter;
  aircraftStats[key] = stat;
}

function recordAircraftResult(item, points) {
  const key = getAircraftTypeKey(item);
  const stat = aircraftStats[key];
  if (!stat) return;
  stat.weight =
    points >= 1
      ? Math.max(0.2, stat.weight * 0.7)
      : Math.min(8, stat.weight * 2 + (points > 0 ? 0 : 0.5));
}

// ============================================================================
// 10. Question Building & Rendering
// ============================================================================
function buildTextAnswerChoices(correctAircraft, answerType) {
  const correctAnswer = getAnswerValue(correctAircraft, answerType);
  const correctAnswerKey = correctAnswer.toLowerCase();
  const correctAircraftKey = getAircraftTypeKey(correctAircraft);
  const usableAircraft = getValidAircraftPool().filter((item) =>
    getAnswerValue(item, answerType),
  );
  const uniqueAircraft = uniqueBy(usableAircraft, (item) =>
    getAnswerValue(item, answerType).toLowerCase(),
  );
  const distractors = uniqueAircraft.filter((item) => {
    const answer = getAnswerValue(item, answerType).toLowerCase();
    return (
      answer !== correctAnswerKey &&
      getAircraftTypeKey(item) !== correctAircraftKey
    );
  });
  const sameCategory = shuffle(
    distractors.filter(
      (item) =>
        displayText(item.category) === displayText(correctAircraft.category),
    ),
  );
  const otherCategories = shuffle(
    distractors.filter(
      (item) =>
        displayText(item.category) !== displayText(correctAircraft.category),
    ),
  );
  const chosenDistractors = [...sameCategory, ...otherCategories].slice(0, 3);
  return shuffle([
    { aircraft: correctAircraft, text: correctAnswer },
    ...chosenDistractors.map((item) => ({
      aircraft: item,
      text: getAnswerValue(item, answerType),
    })),
  ]);
}

function buildPhotoChoices(correctAircraft) {
  const correctKey = getAircraftTypeKey(correctAircraft);
  const category = displayText(correctAircraft.category);
  const available = uniqueBy(
    getValidAircraftPool().filter(
      (item) =>
        getAircraftImages(item).length > 0 &&
        Boolean(getAnswerValue(item, 'name')),
    ),
    getAircraftTypeKey,
  ).filter((item) => getAircraftTypeKey(item) !== correctKey);
  const sameCategory = shuffle(
    available.filter((item) => displayText(item.category) === category),
  );
  const otherCategories = shuffle(
    available.filter((item) => displayText(item.category) !== category),
  );
  return shuffle([
    correctAircraft,
    ...[...sameCategory, ...otherCategories].slice(0, 3),
  ]).map((item) => ({
    aircraft: item,
    text: getAnswerValue(item, getQuestionType() === 'icao' ? 'icao' : 'name'),
  }));
}

function getIndefiniteArticleForCode(code) {
  return /^[aefhilmnorsx8]/i.test(displayText(code).trim()) ? 'an' : 'a';
}

function getIndefiniteArticle(value) {
  const text = displayText(value).trim();
  if (
    /^(airbus|embraer|atr\b|antonov|ilyushin|a\d|f-?\d|m-?\d|x-?\d|e-?\d)/i.test(
      text,
    )
  )
    return 'an';
  return /^[aeiou]/i.test(text) ? 'an' : 'a';
}

function appendCategoryHint(container, category, labelPrefix = 'Category') {
  const text = displayText(category);
  if (!text) return;
  const hint = document.createElement('span');
  hint.className = 'category-hint';
  hint.textContent = text;
  hint.setAttribute('aria-label', `${labelPrefix}: ${text}`);
  container.appendChild(hint);
}

function displayQuestion() {
  promptElement.replaceChildren();
  const questionType = getQuestionType();
  const answerMode = getAnswerMode();
  const name = getAnswerValue(currentAircraft, 'name');
  const code = getAnswerValue(currentAircraft, 'icao');
  let text = '';
  if (questionType === 'photo') {
    text =
      getAnswerSemanticType(answerMode) === 'icao'
        ? 'What is its ICAO code?'
        : 'Which aircraft is this?';
  } else if (questionType === 'name') {
    text =
      answerMode === 'photo'
        ? `Which photo shows ${getIndefiniteArticle(name)} ${name}?`
        : `What is the ICAO code for ${getIndefiniteArticle(name)} ${name}?`;
  } else if (questionType === 'icao') {
    text =
      answerMode === 'photo'
        ? `Which photo shows ${getIndefiniteArticleForCode(code)} ${code}?`
        : `Which aircraft has ICAO code ${code}?`;
  }
  promptElement.appendChild(document.createTextNode(text));
  appendCategoryHint(promptElement, currentAircraft?.category);
}

// ============================================================================
// 11. Layout, UI States, and Visibility
// ============================================================================
function setRevealed(element, show, animate) {
  element.getAnimations?.().forEach((running) => running.cancel());
  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  if (!animate || reduceMotion || !element.animate) {
    element.hidden = !show;
    return Promise.resolve();
  }
  if (show) element.hidden = false;
  else if (element.hidden) return Promise.resolve();
  const parentStyle = getComputedStyle(element.parentElement);
  const isRow =
    parentStyle.display.includes('flex') &&
    parentStyle.flexDirection.startsWith('row');
  const gap = parseFloat(isRow ? parentStyle.columnGap : parentStyle.rowGap) || 0;
  const rect = element.getBoundingClientRect();
  const full = {
    height: `${rect.height}px`,
    width: `${rect.width}px`,
    opacity: 1,
    transform: 'none',
    marginBottom: '0px',
    marginRight: '0px',
  };
  const collapsed = {
    height: '0px',
    paddingTop: '0px',
    paddingBottom: '0px',
    borderWidth: '0px',
    minHeight: '0px',
    opacity: 0,
    transform: 'translateY(-0.6rem)',
    marginBottom: isRow ? '0px' : `${-gap}px`,
    marginRight: isRow ? `${-gap}px` : '0px',
    width: isRow ? '0px' : `${rect.width}px`,
  };
  const previousOverflow = element.style.overflow;
  element.style.overflow = 'hidden';
  const animation = element.animate(show ? [collapsed, full] : [full, collapsed], {
    duration: show ? 320 : 220,
    easing: show ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
  });
  animation.onfinish = () => {
    element.style.overflow = previousOverflow;
    if (!show) element.hidden = true;
  };
  animation.oncancel = () => {
    element.style.overflow = previousOverflow;
  };
  return animation.finished.then(
    () => {},
    () => {},
  );
}

function updatePhotoVisibility(animate = false) {
  const questionType = getQuestionType();
  const isSpecial = isSpecialQuestionType(questionType);
  const showPhotos = isSpecial && photosVisible;
  const comparison = imageContainer.querySelector('.speed-comparison');
  const ranking = byId('speed-ranking');
  photoToggleButton.hidden = !isSpecial;
  updatePhotoToggleContents(photosVisible);
  photoToggleButton.setAttribute('aria-pressed', String(photosVisible));
  photoToggleButton.setAttribute(
    'aria-label',
    photosVisible ? 'Hide aircraft photos' : 'Show aircraft photos',
  );
  const isRank = isSpeedKind('rank', questionType);
  photoToggleButton.setAttribute(
    'aria-controls',
    isRank ? 'speed-ranking-list' : 'image-container',
  );

  // Toggle layout first so the animation measures the final width.
  appElement.classList.toggle(
    'no-image',
    isRank ||
      (isSpecial && !photosVisible) ||
      (!isSpecial && questionType !== 'photo' && getAnswerMode() !== 'photo'),
  );

  // While animating out, the container hides these once it has collapsed.
  const keepForExit = animate && !showPhotos;
  if (isSpeedKind('compare', questionType) && comparison && !keepForExit)
    comparison.hidden = !showPhotos;
  if (ranking) ranking.hidden = !isRank;
  const slides = [];
  if (isRank) {
    byId('speed-ranking-list')
      ?.querySelectorAll('.ranking-photo-wrap')
      .forEach((wrap) => {
        slides.push(setRevealed(wrap, photosVisible, animate));
      });
  }
  if (questionType === 'wake' && !keepForExit)
    imageElement.hidden = !showPhotos;
  const showContainer = !isRank && !(isSpecial && !photosVisible);
  slides.push(
    setRevealed(imageContainer, showContainer, animate && isSpecial && !isRank),
  );
  // Fetch right away so spinners show while the slide runs.
  loadDeferredPhotos();
}

photoToggleButton.addEventListener('click', () => {
  photosVisible = !photosVisible;
  updatePhotoVisibility(true);
});

const settingsToggleButton = byId('settings-toggle');
const settingsPanel = byId('quiz-settings');

let settingsAnimation = null;

function animateSettings(open) {
  settingsAnimation?.cancel();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (open) settingsPanel.hidden = false;
  if (reduceMotion || !settingsPanel.animate) {
    settingsPanel.hidden = !open;
    return;
  }
  const gap = parseFloat(getComputedStyle(settingsPanel.parentElement).rowGap) || 0;
  const full = {
    height: `${settingsPanel.getBoundingClientRect().height}px`,
    opacity: 1,
    transform: 'none',
    marginBottom: '0px',
  };
  const collapsed = {
    height: '0px',
    paddingTop: '0px',
    paddingBottom: '0px',
    borderWidth: '0px',
    opacity: 0,
    transform: 'translateY(-0.6rem)',
    marginBottom: `${-gap}px`,
  };
  settingsPanel.style.overflow = 'hidden';
  settingsAnimation = settingsPanel.animate(open ? [collapsed, full] : [full, collapsed], {
    duration: open ? 320 : 220,
    easing: open ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
  });
  const animation = settingsAnimation;
  animation.onfinish = () => {
    settingsPanel.style.overflow = '';
    if (!open) settingsPanel.hidden = true;
    settingsAnimation = null;
  };
  animation.oncancel = () => {
    settingsPanel.style.overflow = '';
  };
}

settingsToggleButton.addEventListener('click', () => {
  const open = settingsToggleButton.getAttribute('aria-expanded') !== 'true';
  settingsToggleButton.setAttribute('aria-expanded', String(open));
  animateSettings(open);
});

function setLoading(loading) {
  imageElement.classList.toggle('loading', loading);
  loadingMessage.classList.toggle('hidden', !loading);
  if (!loading) return;
  answerButtons.forEach((button) => {
    button.disabled = true;
  });
  typeAnswerInput.disabled = true;
  submitAnswerButton.disabled = true;
  nextButton.disabled = true;
}

function resetAnswerUI() {
  imageContainer.querySelector('.speed-comparison')?.remove();
  speedSlider.hidden = true;
  byId('speed-slider-answer').hidden = true;
  speedSlider.classList.remove('correct', 'partial', 'incorrect');
  speedSliderInput.disabled = true;
  speedSliderSubmit.disabled = true;
  const ranking = byId('speed-ranking');
  const rankingList = byId('speed-ranking-list');
  if (ranking) ranking.hidden = true;
  if (rankingList) rankingList.replaceChildren();
  const checkRanking = byId('check-ranking');
  if (checkRanking) checkRanking.disabled = false;
  imageElement.hidden = false;
  answerButtons.forEach((button, index) => {
    button.disabled = true;
    button.hidden = false;
    button.classList.remove('correct', 'incorrect');
    const optionText = button.querySelector('.option-text');
    if (optionText) optionText.textContent = '';
    delete button.dataset.answer;
    delete button.dataset.correct;
    button.removeAttribute('aria-hidden');
    button.setAttribute('aria-label', `Answer option ${index + 1}`);
  });
  answerContainer.classList.remove('reverse', 'speed-comparison-answers');
  answerContainer.hidden = false;
  typeAnswerContainer.hidden = true;
  typeAnswerContainer.classList.remove('correct', 'partial', 'incorrect');
  typeAnswerInput.value = '';
  typeAnswerInput.disabled = true;
  typeAnswerInput.classList.remove('correct', 'partial', 'incorrect');
  submitAnswerButton.disabled = true;
  feedbackElement.replaceChildren();
  feedbackElement.classList.remove(
    'correct-feedback',
    'partial-feedback',
    'incorrect-feedback',
  );
  imageContainer.hidden = false;
}

function configureAnswerMode() {
  const questionType = getQuestionType();
  const answerMode = getAnswerMode();
  appElement.classList.remove('reverse-mode', 'no-image');
  if (isSpecialQuestionType(questionType)) {
    imageContainer.hidden = false;
    answerContainer.hidden = false;
    typeAnswerContainer.hidden = true;
    updatePhotoVisibility();
    return;
  }
  photoToggleButton.hidden = true;
  if (questionType === 'photo') {
    imageContainer.hidden = false;
    const typed = isTypedAnswer(answerMode);
    answerContainer.hidden = typed;
    typeAnswerContainer.hidden = !typed;
    return;
  }
  if (isPhotoAnswer(answerMode)) {
    imageContainer.hidden = true;
    answerContainer.hidden = false;
    typeAnswerContainer.hidden = true;
    appElement.classList.add('reverse-mode');
    return;
  }
  if (isTypedAnswer(answerMode)) {
    imageContainer.hidden = true;
    answerContainer.hidden = true;
    typeAnswerContainer.hidden = false;
    appElement.classList.add('no-image');
    return;
  }
  imageContainer.hidden = true;
  answerContainer.hidden = false;
  typeAnswerContainer.hidden = true;
  appElement.classList.add('no-image');
}

function updateScore() {
  const percentage = total ? Math.round((score / total) * 100) : 0;
  const displayScore = Math.round(score * 100) / 100;
  scoreElement.textContent = `Score: ${displayScore}/${total} (${percentage}%)`;
}

function setFeedback(type, resultText, detailText = '', answerText = '') {
  feedbackElement.replaceChildren();
  feedbackElement.classList.remove(
    'correct-feedback',
    'partial-feedback',
    'incorrect-feedback',
  );
  if (type) feedbackElement.classList.add(`${type}-feedback`);
  const result = document.createElement('span');
  result.className = 'feedback-result';
  result.textContent = resultText;
  feedbackElement.appendChild(result);
  if (detailText) {
    const detail = document.createElement('span');
    detail.className = 'feedback-detail';
    detail.textContent = detailText;
    feedbackElement.appendChild(detail);
  }
  if (answerText) {
    const answer = document.createElement('span');
    answer.className = 'feedback-answer';
    answer.textContent = answerText;
    feedbackElement.appendChild(answer);
  }
}

// Reserve one inline feedback row so showing feedback doesn't resize the
// footer; it only grows when the answer text wraps onto extra lines.
function reserveFeedbackSpace() {
  const statusElement = feedbackElement.parentElement;
  statusElement.style.minHeight = '';
  const probe = document.createElement('div');
  probe.className = 'feedback partial-feedback';
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;' +
    `width:${statusElement.clientWidth}px`;
  for (const [className, content] of [
    ['feedback-result', 'Incorrect'],
    ['feedback-detail', 'Correct answer:'],
    ['feedback-answer', 'A320'],
  ]) {
    const part = document.createElement('span');
    part.className = className;
    part.textContent = content;
    probe.appendChild(part);
  }
  statusElement.appendChild(probe);
  const height = probe.offsetHeight;
  probe.remove();
  if (height) statusElement.style.minHeight = `${Math.ceil(height)}px`;
}
let reserveFeedbackWidth = 0;
new ResizeObserver(() => {
  const width = feedbackElement.parentElement.clientWidth;
  if (width === reserveFeedbackWidth) return;
  reserveFeedbackWidth = width;
  reserveFeedbackSpace();
}).observe(feedbackElement.parentElement);

function revealCorrectPhotoNames() {
  answerContainer.querySelectorAll('.photo-choice-name').forEach((name) => {
    name.classList.remove('hidden-name');
    name.style.setProperty('display', 'block', 'important');
    name.style.setProperty('visibility', 'visible', 'important');
    name.style.setProperty('opacity', '1', 'important');
    name.style.setProperty('max-height', 'none', 'important');
    name.style.setProperty('color', 'inherit', 'important');
  });
}

function finishAnswer() {
  if (currentAircraft && !specialQuestionData)
    recordAircraftResult(currentAircraft, score - scoreAtQuestionStart);
  updateScore();
  nextButton.disabled = false;
  nextButton.focus();
}

// ============================================================================
// 12. Displaying Answer Choices
// ============================================================================
function displayTextAnswerChoices(choices, disabled = false) {
  answerContainer.classList.remove('reverse', 'speed-comparison-answers');
  answerContainer.hidden = false;
  answerButtons.forEach((button, index) => {
    const choice = choices[index];
    if (!choice) {
      button.disabled = true;
      button.hidden = true;
      button.setAttribute('aria-hidden', 'true');
      return;
    }
    button.hidden = false;
    button.removeAttribute('aria-hidden');

    let span = button.querySelector('.option-text');
    if (!span) {
      span = document.createElement('span');
      span.className = 'option-text';
    }
    span.textContent = choice.text;

    button.replaceChildren(span);
    button.dataset.answer = choice.text;
    button.dataset.correct = String(choice.aircraft === currentAircraft);
    button.disabled = disabled;
    button.setAttribute('aria-label', choice.text);
  });
}

function displaySpecialChoices(choices, correctAnswer, disabled = false) {
  answerContainer.classList.remove('reverse');
  answerContainer.classList.toggle(
    'speed-comparison-answers',
    specialQuestionData?.type &&
      isSpeedKind('compare', specialQuestionData.type),
  );
  answerContainer.hidden = false;
  answerButtons.forEach((button, index) => {
    const choice = choices[index];
    button.classList.remove('correct', 'incorrect');
    if (!choice) {
      button.hidden = true;
      button.disabled = true;
      button.setAttribute('aria-hidden', 'true');
      return;
    }
    button.hidden = false;
    button.removeAttribute('aria-hidden');

    let span = button.querySelector('.option-text');
    if (!span) {
      span = document.createElement('span');
      span.className = 'option-text';
    }
    span.textContent = choice;

    button.replaceChildren(span);
    button.dataset.answer = choice;
    button.dataset.correct = String(choice === correctAnswer);
    button.disabled = disabled;
    button.setAttribute('aria-label', choice);
  });
}

async function displayPhotoAnswerChoices(choices) {
  answerContainer.classList.remove('speed-comparison-answers');
  answerContainer.classList.add('reverse');
  answerContainer.hidden = false;
  const photoOptions = [];
  answerButtons.forEach((button, index) => {
    const choice = choices[index];
    if (!choice) {
      button.replaceChildren();
      button.disabled = true;
      button.hidden = true;
      button.setAttribute('aria-hidden', 'true');
      return;
    }
    button.hidden = false;
    button.removeAttribute('aria-hidden');

    const imgWrap = document.createElement('div');
    imgWrap.className = 'photo-choice-img-wrap';

    const spinner = document.createElement('span');
    spinner.className = 'loading-message';
    imgWrap.appendChild(spinner);

    const name = document.createElement('span');
    name.className = 'photo-choice-name hidden-name';
    name.textContent = choice.text;

    button.replaceChildren(imgWrap, name);
    button.dataset.answer = choice.text;
    button.dataset.correct = String(choice.aircraft === currentAircraft);
    button.disabled = true;
    button.setAttribute('aria-label', `Photo option ${index + 1}, loading`);
    button.setAttribute('aria-keyshortcuts', String(index + 1));

    const imagePath = getRandomImagePath(choice.aircraft);
    photoOptions.value = photoOptions.value || [];
    photoOptions.push({ button, choice, index, imagePath, imgWrap });
  });

  try {
    const loadedOptions = await Promise.all(
      photoOptions.map(
        ({ imagePath, index }) =>
          new Promise((resolve, reject) => {
            if (!imagePath) {
              reject(
                new Error(
                  `No image is available for photo option ${index + 1}.`,
                ),
              );
              return;
            }
            const image = new Image();
            image.alt = `Aircraft photo option ${index + 1}`;
            image.draggable = false;
            image.onload = () => resolve({ index, image });
            image.onerror = () =>
              reject(
                new Error('One or more option photos could not be loaded.'),
              );
            image.src = imagePath;
          }),
      ),
    );

    loadedOptions.forEach(({ index, image }) => {
      const { button, choice, imgWrap } = photoOptions.find(
        (option) => option.index === index,
      );
      image.style.animation = 'photoFadeIn 0.25s ease-out forwards';
      imgWrap.replaceChildren(image);

      const name = button.querySelector('.photo-choice-name');
      if (name) name.textContent = choice.text;

      button.setAttribute('aria-label', `Photo option ${index + 1}`);
    });

    photoOptions.forEach(({ button }) => {
      button.disabled = false;
    });
    return true;
  } catch (error) {
    photoOptions.forEach(({ button }) => {
      button.disabled = true;
    });
    feedbackElement.textContent = error.message;
    nextButton.disabled = false;
    return false;
  }
}

// ============================================================================
// 13. Special Questions (Cruise Speed, Wake, Comparisons, Rankings)
// ============================================================================

const speedSlider = byId('speed-slider');
const speedSliderInput = byId('speed-slider-input');
const speedSliderValue = byId('speed-slider-value');
const speedSliderSubmit = byId('speed-slider-submit');

function getSpeedSliderRange(metric) {
  const speeds = aircraft
    .map((item) => getSpeedValue(item, metric))
    .filter((speed) => speed != null && speed <= (metric.maxEstimate ?? Infinity));
  return {
    min: Math.round(Math.min(...speeds)),
    max: Math.round(Math.max(...speeds)),
  };
}

// Slider stops use the metric's step; Mach metrics switch to 0.01 Mach steps above the threshold.
let speedSliderStops = [];
let speedSliderMetric = SPEED_METRICS.cruise;

function buildSpeedSliderStops(metric, min, max) {
  const stops = [];
  const { step } = metric;
  const start = Math.floor(min / step) * step;
  const limit = metric.mach ? MACH_THRESHOLD_KT : Infinity;
  for (let value = start; value < limit && value <= max; value += step) {
    stops.push(value);
  }
  if (metric.mach && max >= MACH_THRESHOLD_KT) {
    const first = Math.max(70, Math.floor(min / KT_PER_MACH * 100));
    const last = Math.ceil(max / KT_PER_MACH * 100 - 1e-9);
    for (let hundredths = first; hundredths <= last; hundredths += 1) {
      stops.push((hundredths / 100) * KT_PER_MACH);
    }
  }
  return stops;
}

const getNearestStopIndex = (speed) =>
  speedSliderStops.reduce(
    (best, stop, index) =>
      Math.abs(stop - speed) < Math.abs(speedSliderStops[best] - speed)
        ? index
        : best,
    0,
  );

function getSpeedSliderTolerance(speed) {
  const index = getNearestStopIndex(speed);
  const below = speedSliderStops[index] - (speedSliderStops[index - 1] ?? Infinity);
  const above = (speedSliderStops[index + 1] ?? Infinity) - speedSliderStops[index];
  const step = Math.min(below, above);
  return Number.isFinite(step) ? step / 2 : speedSliderMetric.step / 2;
}

function getSpeedSliderGuess() {
  return speedSliderStops[Number(speedSliderInput.value)] ?? 0;
}

function updateSpeedSliderReadout() {
  speedSliderValue.textContent = speedSliderMetric.format(getSpeedSliderGuess());
}

function scoreSpeedGuess(guess, actual) {
  const error = Math.abs(guess - actual);
  const tolerance = getSpeedSliderTolerance(actual) + 0.5;
  if (error <= tolerance) return 1;
  const zeroError = Math.max(speedSliderMetric.zeroError, tolerance * 4);
  const points = 1 - (error - tolerance) / (zeroError - tolerance);
  return Math.max(0, Math.round(points * 100) / 100);
}

function submitSpeedGuess() {
  if (
    answered ||
    !specialQuestionData ||
    !isSpeedKind('estimate', specialQuestionData.type)
  )
    return;
  const guess = getSpeedSliderGuess();
  const points = scoreSpeedGuess(guess, specialQuestionData.speed);
  answered = true;
  total += 1;
  score = Math.round((score + points) * 100) / 100;
  speedSliderInput.disabled = true;
  speedSliderSubmit.disabled = true;
  const answerMarker = byId('speed-slider-answer');
  const answerPosition =
    getNearestStopIndex(specialQuestionData.speed) /
    (speedSliderStops.length - 1);
  answerMarker.style.setProperty(
    '--answer-position',
    String(Math.min(1, Math.max(0, answerPosition))),
  );
  answerMarker.dataset.label = speedSliderMetric.format(specialQuestionData.speed);
  answerMarker.hidden = false;
  const feedbackType =
    points === 1 ? 'correct' : points > 0 ? 'partial' : 'incorrect';
  speedSlider.classList.add(feedbackType);
  if (points === 1) {
    setFeedback(
      'correct',
      'Correct!',
      'Answer:',
      specialQuestionData.feedbackAnswer,
    );
  } else {
    setFeedback(
      feedbackType,
      points > 0 ? 'Partially correct' : 'Incorrect',
      'Correct answer:',
      specialQuestionData.feedbackAnswer,
    );
  }
  finishAnswer();
}

function displaySpeedEstimateQuestion(item) {
  const { metric } = getSpeedQuestion();
  const speed = getSpeedValue(item);
  const imagePath = getRandomImagePath(item);
  if (speed == null || speed > (metric.maxEstimate ?? Infinity) || !imagePath) {
    setLoading(false);
    promptElement.textContent = `Unable to create a ${metric.noun} question.`;
    feedbackElement.textContent = `Check that ${metric.field} values are available in manifest.json.`;
    return false;
  }
  const { min, max } = getSpeedSliderRange(metric);
  speedSliderMetric = metric;
  speedSliderStops = buildSpeedSliderStops(metric, min, max);
  const roundedSpeed = speedSliderStops[getNearestStopIndex(speed)];
  specialQuestionData = {
    type: getQuestionType(),
    speed: roundedSpeed,
    feedbackAnswer: formatApproxSpeed(roundedSpeed, metric),
  };
  promptElement.replaceChildren();
  const identifier = getSpecialAircraftIdentifier(item);
  promptElement.appendChild(
    document.createTextNode(
      `What is the ${metric.noun} of ${getSpecialArticle(identifier)} ${identifier}?`,
    ),
  );
  appendCategoryHint(promptElement, item.category, 'Category');
  speedSliderInput.min = '0';
  speedSliderInput.max = String(speedSliderStops.length - 1);
  speedSliderInput.step = '1';
  speedSliderInput.value = String(Math.round((speedSliderStops.length - 1) / 2));
  byId('speed-slider-min').textContent = metric.format(speedSliderStops[0]);
  byId('speed-slider-max').textContent = metric.format(speedSliderStops.at(-1));
  updateSpeedSliderReadout();
  answerContainer.hidden = true;
  speedSlider.hidden = false;
  speedSliderInput.disabled = true;
  speedSliderSubmit.disabled = true;
  loadQuestionImageWhenRevealed(imagePath, `${metric.noun} question image`)
    .then(() => {
      setLoading(false);
      speedSliderInput.disabled = false;
      speedSliderSubmit.disabled = false;
    })
    .catch((error) => {
      setLoading(false);
      feedbackElement.textContent = error.message;
    });
  return true;
}

function getSpeedComparisonPair() {
  const { words } = getSpeedQuestion().metric;
  const pool = getValidAircraftPool().flatMap((item) => {
    const speed = getSpeedValue(item);
    return speed ? [{ item, speed }] : [];
  });
  const pairs = [];
  const sameSpeedPairs = [];
  for (let firstIndex = 0; firstIndex < pool.length; firstIndex += 1) {
    const first = pool[firstIndex];
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < pool.length;
      secondIndex += 1
    ) {
      const second = pool[secondIndex];
      if (getRankingItemKey(first.item) === getRankingItemKey(second.item))
        continue;
      const firstName = getAnswerValue(first.item, 'name').trim().toLowerCase();
      const secondName = getAnswerValue(second.item, 'name')
        .trim()
        .toLowerCase();
      if (firstName && firstName === secondName) continue;
      if (first.speed === second.speed) {
        sameSpeedPairs.push({
          first: first.item,
          second: second.item,
          answer: words.same,
          feedback: `${words.same} (${formatApproxSpeed(first.speed)})`,
        });
      } else {
        const answer =
          first.speed > second.speed ? words.higher : words.lower;
        pairs.push({
          first: first.item,
          second: second.item,
          answer,
          feedback: `${answer} (${formatApproxSpeed(first.speed)} vs ${formatApproxSpeed(second.speed)})`,
        });
      }
    }
  }
  const availableSameSpeedPairs = sameSpeedPairs.filter(
    (pair) =>
      !isRepeatedQuestion(
        getQuestionType(),
        [pair.first, pair.second],
        true,
        getSpeedComparisonPrompt(pair.first, pair.second),
      ),
  );
  const availablePairs = pairs.filter(
    (pair) =>
      !isRepeatedQuestion(
        getQuestionType(),
        [pair.first, pair.second],
        true,
        getSpeedComparisonPrompt(pair.first, pair.second),
      ),
  );
  if (
    availableSameSpeedPairs.length &&
    (!availablePairs.length || Math.random() < 0.5)
  )
    return randomItem(availableSameSpeedPairs);
  return availablePairs.length ? randomItem(availablePairs) : null;
}

function displaySpeedComparison(pair) {
  imageContainer.querySelector('.speed-comparison')?.remove();
  imageElement.hidden = true;
  loadingMessage.classList.add('hidden');
  const comparison = document.createElement('div');
  comparison.className = 'speed-comparison';
  comparison.setAttribute('aria-label', 'Compare aircraft');
  const entries = [
    { item: pair.first, label: getSpecialAircraftIdentifier(pair.first) },
    { item: pair.second, label: getSpecialAircraftIdentifier(pair.second) },
  ];
  for (const { item, label } of entries) {
    const card = document.createElement('div');
    card.className = 'speed-aircraft';
    const photoArea = document.createElement('div');
    photoArea.className = 'speed-aircraft-photo';
    const image = document.createElement('img');
    image.alt = label;
    image.draggable = false;
    image.hidden = true;

    const placeholder = document.createElement('span');
    placeholder.className = 'loading-message';

    image.addEventListener(
      'load',
      () => {
        image.hidden = false;
        placeholder.remove();
      },
      { once: true },
    );
    image.addEventListener(
      'error',
      () => {
        placeholder.className = 'loading-error';
        placeholder.textContent = 'Unable to load';
      },
      { once: true },
    );
    photoArea.append(image, placeholder);
    setDeferredImageSource(image, getRandomImagePath(item));
    card.append(photoArea);
    comparison.appendChild(card);
  }
  imageContainer.appendChild(comparison);
  updatePhotoVisibility();
  promptElement.textContent = getSpeedComparisonPrompt(pair.first, pair.second);
  const { words } = getSpeedQuestion().metric;
  displaySpecialChoices([words.higher, words.lower, words.same], pair.answer);
}

function getWakeFeedbackAnswer(item, category) {
  const leading = getWakeCategory({
    wake_category: item?.wake_category_when_leading,
  });
  const leadingNote =
    leading && leading !== category ? ` · ${leading} when leading` : '';
  const mtow = Number(item?.mtow_kg);
  if (Number.isFinite(mtow) && mtow > 0) {
    // Below 10,000 kg, rounding to 1,000 would be too coarse to be useful.
    const step = mtow >= 10000 ? 1000 : 100;
    const rounded = Math.round(mtow / step) * step;
    return `${category} (MTOW ≈ ${rounded.toLocaleString('en-US')} kg)${leadingNote}`;
  }
  const info = WAKE_CATEGORY_INFO[category];
  return (info ? `${category} (${info})` : category) + leadingNote;
}

async function displayWakeQuestion(item) {
  const imagePath = getRandomImagePath(item);
  const correctCategory = getWakeCategory(item);
  if (!imagePath || !correctCategory) {
    setLoading(false);
    promptElement.textContent = 'Unable to create a wake category question.';
    feedbackElement.textContent =
      'Check that this aircraft has an image and a valid wake_category in manifest.json.';
    return;
  }
  specialQuestionData = {
    type: 'wake',
    correctAnswer: WAKE_CATEGORY_CHOICE_LABELS[correctCategory],
    feedbackAnswer: getWakeFeedbackAnswer(item, correctCategory),
  };
  promptElement.replaceChildren();
  promptElement.appendChild(
    document.createTextNode(
      `What is the wake category of ${getSpecialArticle(getSpecialAircraftIdentifier(item))} ${getSpecialAircraftIdentifier(item)}?`,
    ),
  );
  displaySpecialChoices(
    WAKE_CATEGORIES.map((category) => WAKE_CATEGORY_CHOICE_LABELS[category]),
    WAKE_CATEGORY_CHOICE_LABELS[correctCategory],
    true,
  );
  try {
    await loadQuestionImageWhenRevealed(
      imagePath,
      'Aircraft wake category question image',
    );
    setLoading(false);
    answerButtons.forEach((button) => {
      if (!button.hidden) button.disabled = false;
    });
    focusFirstAnswer();
  } catch (error) {
    setLoading(false);
    feedbackElement.textContent = error.message;
    answerButtons.forEach((button) => {
      button.disabled = true;
    });
  }
}

function getRankingItemKey(item) {
  const key = displayText(item?.key);
  if (key) return `key:${key}`;
  const folder = displayText(item?.folder);
  if (folder) return `folder:${folder.toLowerCase()}`;
  return getAircraftTypeKey(item);
}

function getSpeedRankingItems() {
  const entries = getSelectedAircraftPool().flatMap((item) => {
    const speed = getSpeedValue(item);
    if (!speed || !getRankingItemKey(item)) return [];
    return [{ item, speed }];
  });
  if (entries.length < 4) return null;

  let selectionPool = entries;
  if (
    previousQuestion?.type === getQuestionType() &&
    previousQuestion.answerMode === getAnswerMode()
  ) {
    const previousKeyInPool = previousQuestion.keys.find((key) =>
      entries.some((entry) => getRankingItemKey(entry.item) === key),
    );
    if (entries.length > 4 && previousKeyInPool) {
      selectionPool = entries.filter(
        (entry) => getRankingItemKey(entry.item) !== previousKeyInPool,
      );
    }
  }
  const selectedEntries = shuffle(selectionPool).slice(0, 4);
  return isRepeatedQuestion(
    getQuestionType(),
    selectedEntries.map((entry) => entry.item),
  )
    ? null
    : selectedEntries;
}

function getSpeedRankingResults(entries, actualKeys) {
  const actualPosition = new Map(actualKeys.map((key, index) => [key, index]));
  const results = new Map();
  for (const entry of entries) {
    const key = getRankingItemKey(entry.item);
    const position = actualPosition.get(key);
    let correct = true;
    let slowerCount = 0;
    let fasterCount = 0;
    for (const other of entries) {
      if (entry === other) continue;
      const otherPosition = actualPosition.get(getRankingItemKey(other.item));
      if (other.speed < entry.speed) {
        slowerCount += 1;
        correct = correct && otherPosition < position;
      } else if (other.speed > entry.speed) {
        fasterCount += 1;
        correct = correct && otherPosition > position;
      }
    }
    results.set(key, {
      correct,
      firstRank: slowerCount + 1,
      lastRank: entries.length - fasterCount,
    });
  }
  return results;
}

function animateRankingReorder(list, mutate, excludeRow = null) {
  const before = new Map(
    [...list.children].map((row) => [row, row.getBoundingClientRect()]),
  );
  mutate();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  [...list.children].forEach((row) => {
    if (row === excludeRow) return;
    const oldRect = before.get(row);
    if (!oldRect) return;
    const newRect = row.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    row.animate(
      [
        { transform: `translate3d(${dx}px, ${dy}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: 210, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
    );
  });
}

function moveRankingItem(item, target, after = false) {
  if (!item || !target || item === target || answered) return;
  const list = byId('speed-ranking-list');
  animateRankingReorder(list, () => {
    if (after) target.after(item);
    else target.before(item);
  });
  updateRankingMoveButtons();
}

function updateRankingPointerDrag(drag) {
  if (rankingPointerDrag !== drag || !drag.active || answered) return;
  const { clientX, clientY } = drag.latestPointer;
  if (drag.ghost) {
    drag.ghost.style.transform =
      `translate3d(${clientX - drag.offsetX - drag.ghostLeft}px, ` +
      `${clientY - drag.offsetY - drag.ghostTop}px, 0) scale(1.02)`;
  }
  const rows = drag.rowSlots;
  if (!rows.length) return;
  let target = rows.find(
    ({ top, bottom }) => clientY >= top && clientY <= bottom,
  );
  if (!target) {
    target = rows.reduce((best, slot) => {
      const distance = Math.abs(clientY - slot.center);
      return !best || distance < best.distance ? { slot, distance } : best;
    }, null)?.slot;
  }
  if (!target) return;
  const list = byId('speed-ranking-list');
  const insertAfter = clientY > target.center;
  const needsMove = insertAfter
    ? target.row.nextElementSibling !== drag.item
    : target.row !== drag.item.nextElementSibling;
  if (!needsMove) return;
  if (insertAfter) list.insertBefore(drag.item, target.row.nextElementSibling);
  else list.insertBefore(drag.item, target.row);
  updateRankingMoveButtons();
  drag.rowSlots = [...list.querySelectorAll('.ranking-item')]
    .filter((row) => row !== drag.item)
    .map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        row,
        top: rect.top,
        bottom: rect.bottom,
        center: rect.top + rect.height / 2,
      };
    });
}

function handleRankingPointerMove(event) {
  const drag = rankingPointerDrag;
  if (!drag || drag.pointerId !== event.pointerId || answered) return;
  if (
    !drag.active &&
    Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4
  )
    return;
  event.preventDefault();
  if (!drag.active) {
    drag.active = true;
    const rect = drag.item.getBoundingClientRect();
    drag.offsetX = event.clientX - rect.left;
    drag.offsetY = event.clientY - rect.top;
    drag.ghostLeft = rect.left;
    drag.ghostTop = rect.top;
    drag.ghost = drag.item.cloneNode(true);
    drag.ghost.classList.remove(
      'ranking-dragging',
      'ranking-drop-target',
      'correct',
      'incorrect',
    );
    drag.ghost.classList.add('ranking-drag-ghost');
    drag.ghost.setAttribute('aria-hidden', 'true');
    drag.ghost.style.width = `${rect.width}px`;
    drag.ghost.style.height = `${rect.height}px`;
    drag.ghost.style.left = `${rect.left}px`;
    drag.ghost.style.top = `${rect.top}px`;
    document.body.append(drag.ghost);
    drag.item.classList.add('ranking-placeholder');
    drag.item.setAttribute('aria-grabbed', 'true');
    document.body.classList.add('ranking-is-dragging');
    drag.rowSlots = [
      ...byId('speed-ranking-list').querySelectorAll('.ranking-item'),
    ]
      .filter((row) => row !== drag.item)
      .map((row) => {
        const rowRect = row.getBoundingClientRect();
        return {
          row,
          top: rowRect.top,
          bottom: rowRect.bottom,
          center: rowRect.top + rowRect.height / 2,
        };
      });
  }
  drag.latestPointer = { clientX: event.clientX, clientY: event.clientY };
  if (drag.frame !== null) return;
  drag.frame = requestAnimationFrame(() => {
    drag.frame = null;
    updateRankingPointerDrag(drag);
  });
}

function finishRankingPointerDrag(event) {
  if (!rankingPointerDrag || rankingPointerDrag.pointerId !== event.pointerId)
    return;
  const drag = rankingPointerDrag;
  drag.latestPointer = { clientX: event.clientX, clientY: event.clientY };
  if (drag.frame !== null) {
    cancelAnimationFrame(drag.frame);
    drag.frame = null;
  }
  updateRankingPointerDrag(drag);
  drag.item.classList.remove('ranking-dragging');
  drag.item.removeAttribute('aria-grabbed');
  document.body.classList.remove('ranking-is-dragging');
  updateRankingMoveButtons();
  rankingPointerDrag = null;
  if (drag.ghost && drag.active) {
    const ghost = drag.ghost;
    const from = ghost.getBoundingClientRect();
    const to = drag.item.getBoundingClientRect();
    ghost.style.left = `${from.left}px`;
    ghost.style.top = `${from.top}px`;
    const settle = ghost.animate(
      [
        {
          left: `${from.left}px`,
          top: `${from.top}px`,
          transform: 'scale(1.025) rotate(0.35deg)',
          opacity: 0.98,
        },
        {
          left: `${to.left}px`,
          top: `${to.top}px`,
          transform: 'scale(1) rotate(0deg)',
          opacity: 1,
        },
      ],
      {
        duration: window.matchMedia?.('(prefers-reduced-motion: reduce)')
          .matches
          ? 0
          : 240,
        easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)',
        fill: 'forwards',
      },
    );
    settle.onfinish = () => {
      ghost.remove();
      drag.item.classList.remove('ranking-placeholder');
    };
    settle.oncancel = () => {
      ghost.remove();
      drag.item.classList.remove('ranking-placeholder');
    };
  } else {
    drag.item.classList.remove('ranking-placeholder');
    drag.ghost?.remove();
  }
}

document.addEventListener('pointermove', handleRankingPointerMove, {
  passive: false,
});
document.addEventListener('pointerup', finishRankingPointerDrag);
document.addEventListener('pointercancel', finishRankingPointerDrag);

function displaySpeedRanking(entries) {
  const section = byId('speed-ranking');
  const list = byId('speed-ranking-list');
  if (!section || !list) return;
  list.replaceChildren();
  if (
    rankingPointerDrag?.frame !== null &&
    rankingPointerDrag?.frame !== undefined
  )
    cancelAnimationFrame(rankingPointerDrag.frame);
  if (rankingPointerDrag?.ghost) rankingPointerDrag.ghost.remove();
  rankingPointerDrag = null;
  document.body.classList.remove('ranking-is-dragging');
  const ordered = shuffle([...entries]);
  ordered.forEach((entry, index) => {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    li.dataset.rankingKey = getRankingItemKey(entry.item);
    li.draggable = false;
    li.setAttribute(
      'aria-label',
      `${getSpecialAircraftIdentifier(entry.item)}, position ${index + 1}. Drag to reorder.`,
    );

    const position = document.createElement('span');
    position.className = 'ranking-position';
    position.setAttribute('aria-hidden', 'true');
    position.textContent = String(index + 1);

    const details = document.createElement('div');
    details.className = 'ranking-details';

    const photoWrap = document.createElement('span');
    photoWrap.className = 'ranking-photo-wrap';
    photoWrap.hidden = !photosVisible;

    const img = document.createElement('img');
    img.className = 'ranking-photo';
    img.alt = getSpecialAircraftIdentifier(entry.item);
    img.hidden = true;

    const placeholder = document.createElement('span');
    placeholder.className = 'loading-message';

    img.addEventListener(
      'load',
      () => {
        img.hidden = false;
        placeholder.remove();
      },
      { once: true },
    );
    img.addEventListener(
      'error',
      () => {
        placeholder.className = 'loading-error';
        placeholder.textContent = 'Unable to load';
      },
      { once: true },
    );
    photoWrap.append(img, placeholder);
    setDeferredImageSource(img, getRandomImagePath(entry.item) || '');

    const name = document.createElement('span');
    name.className = 'ranking-name';
    name.textContent = getSpecialAircraftIdentifier(entry.item);
    details.append(photoWrap, name);

    const controls = document.createElement('div');
    controls.className = 'ranking-controls';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.setAttribute('aria-label', `Move ${name.textContent} up`);
    up.disabled = index === 0;
    up.addEventListener('click', () => {
      if (li.previousElementSibling)
        moveRankingItem(li, li.previousElementSibling, false);
    });

    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.setAttribute('aria-label', `Move ${name.textContent} down`);
    down.disabled = index === ordered.length - 1;
    down.addEventListener('click', () => {
      if (li.nextElementSibling)
        moveRankingItem(li, li.nextElementSibling, true);
    });

    controls.append(up, down);
    li.append(position, details, controls);

    li.addEventListener('pointerdown', (event) => {
      if (
        answered ||
        !event.isPrimary ||
        (event.pointerType === 'mouse' && event.button !== 0) ||
        event.target.closest('button')
      )
        return;
      rankingPointerDrag = {
        item: li,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        frame: null,
      };
    });
    list.append(li);
  });
  section.hidden = false;
  answerContainer.hidden = true;
  byId('check-ranking').disabled = false;
  const { metric } = getSpeedQuestion();
  promptElement.textContent =
    metric.key === 'cruise'
      ? 'Rank these aircraft from slowest to fastest.'
      : `Rank these aircraft from ${metric.words.low} to ${metric.words.high} ${metric.noun}.`;
  feedbackElement.replaceChildren();
}

function updateRankingMoveButtons() {
  const rows = [...byId('speed-ranking-list').children];
  rows.forEach((row, i) => {
    const rank = String(i + 1);
    row.querySelector('.ranking-position').textContent = rank;
    row.setAttribute(
      'aria-label',
      `${row.querySelector('.ranking-name')?.textContent || 'Aircraft'}, position ${i + 1}. Drag to reorder.`,
    );
    const buttons = row.querySelectorAll('button');
    buttons[0].disabled = answered || i === 0;
    buttons[1].disabled = answered || i === rows.length - 1;
  });
  if (rankingPointerDrag?.ghost && rankingPointerDrag.item) {
    const index = rows.indexOf(rankingPointerDrag.item);
    if (index < 0) return;
    const ghost = rankingPointerDrag.ghost;
    const rank = index + 1;
    const ghostRank = ghost.querySelector('.ranking-position');
    const ghostButtons = ghost.querySelectorAll('.ranking-controls button');
    if (ghostRank) ghostRank.textContent = String(rank);
    if (ghostButtons.length === 2) {
      ghostButtons[0].disabled = answered || index === 0;
      ghostButtons[1].disabled = answered || index === rows.length - 1;
    }
  }
}

function checkSpeedRanking() {
  if (
    answered ||
    !specialQuestionData ||
    !isSpeedKind('rank', specialQuestionData.type)
  )
    return;
  const rows = [...byId('speed-ranking-list').children];
  const actual = rows.map((row) => row.dataset.rankingKey);
  const rankingResults = getSpeedRankingResults(
    specialQuestionData.entries,
    actual,
  );
  const correctPositions = [...rankingResults.values()].filter(
    (result) => result.correct,
  ).length;
  const correct = correctPositions === rows.length;
  answered = true;
  total += 1;
  score = Math.round((score + correctPositions * 0.25) * 100) / 100;

  rows.forEach((row) => {
    const result = rankingResults.get(row.dataset.rankingKey);
    row.classList.remove('correct', 'incorrect');
    row.offsetHeight; // Force reflow to re-trigger animation
    row.classList.add(result.correct ? 'correct' : 'incorrect');
    row.draggable = false;
    const correctRank =
      result.firstRank === result.lastRank
        ? String(result.firstRank)
        : `${result.firstRank}-${result.lastRank}`;
    row.querySelector('.ranking-position').textContent = correctRank;
    row.setAttribute(
      'aria-label',
      `${row.querySelector('.ranking-name')?.textContent || 'Aircraft'}, correct rank ${correctRank}.`,
    );
    row.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    const speedEntry = specialQuestionData.entries.find(
      (entry) => getRankingItemKey(entry.item) === row.dataset.rankingKey,
    );
    if (speedEntry && !row.querySelector('.ranking-speed')) {
      const speedLabel = document.createElement('span');
      speedLabel.className = 'ranking-speed';
      speedLabel.textContent = formatApproxSpeed(speedEntry.speed);
      row.querySelector('.ranking-details')?.append(speedLabel);
    }
  });

  byId('check-ranking').disabled = true;
  const feedbackType = correct
    ? 'correct'
    : correctPositions > 0
      ? 'partial'
      : 'incorrect';
  const feedbackResult = correct
    ? 'Correct'
    : correctPositions > 0
      ? 'Partially correct'
      : 'Incorrect';
  setFeedback(
    feedbackType,
    feedbackResult,
    'Correct positions:',
    `${correctPositions}/${rows.length}`,
  );
  finishAnswer();
}

// ============================================================================
// 14. Scoring & Submitting Answers
// ============================================================================
function calculatePartialScore(typedAnswer, correctAnswer) {
  const typedWords = normaliseAnswer(typedAnswer);
  const correctWords = normaliseAnswer(correctAnswer);
  if (!typedWords.length || !correctWords.length) return 0;
  if (typedWords.join(' ') === correctWords.join(' ')) return 1;
  const matchedIndexes = new Set();
  for (const [index, word] of typedWords.entries()) {
    if (index < correctWords.length && word === correctWords[index]) {
      matchedIndexes.add(index);
    }
  }
  for (const word of typedWords) {
    const index = correctWords.findIndex(
      (correctWord, correctIndex) =>
        correctWord === word && !matchedIndexes.has(correctIndex),
    );
    if (index !== -1) matchedIndexes.add(index);
  }
  return Math.min(matchedIndexes.size / correctWords.length, 1);
}

const formatPoints = (points) =>
  points === 1
    ? '1'
    : points === 0
      ? '0'
      : Number(points.toFixed(2)).toString();
const formatPointsWithGrammar = (points) =>
  formatPoints(points) === '1' ? '1 point' : `${formatPoints(points)} points`;

// Loose name marking: full marks if the typed words include the shortened name,
// or any words from the full name that no other aircraft also contains
// (e.g. "Skyhawk", "Cessna 172", "172"). Extra words are ignored.
function scoreTypedName(typed, item) {
  const typedWords = new Set(normaliseAnswer(typed));
  if (!typedWords.size) return 0;
  const shortScore = calculatePartialScore(typed, getCodeFreeName(item));
  if (shortScore === 1) return 1;
  const fullWords = new Set(normaliseAnswer(getFullAircraftName(item)));
  const matched = [...typedWords].filter((word) => fullWords.has(word));
  if (matched.length) {
    const ambiguous = aircraft.some(
      (other) => {
        if (other === item) return false;
        const otherWords = new Set(normaliseAnswer(getFullAircraftName(other)));
        return matched.every((word) => otherWords.has(word));
      },
    );
    if (!ambiguous) return 1;
  }
  return Math.max(shortScore, calculatePartialScore(typed, getFullAircraftName(item)));
}

function submitTypedAnswer() {
  if (answered || !currentAircraft || !isTypedAnswer()) return;
  const correctAnswer = getTypedAnswerValue(currentAircraft);
  if (!correctAnswer) return;
  const feedbackAnswer = getFeedbackDisplayAnswer(currentAircraft);
  const points =
    getAnswerMode() === 'enter-name'
      ? scoreTypedName(typeAnswerInput.value, currentAircraft)
      : calculatePartialScore(typeAnswerInput.value, correctAnswer);
  answered = true;
  total += 1;
  score = Math.round((score + points) * 100) / 100;
  typeAnswerInput.classList.remove('correct', 'partial', 'incorrect');
  typeAnswerContainer.classList.remove('correct', 'partial', 'incorrect');
  if (points === 1) {
    typeAnswerInput.classList.add('correct');
    typeAnswerContainer.classList.add('correct');
    setFeedback('correct', 'Correct!', 'Correct answer:', feedbackAnswer);
  } else if (points > 0) {
    typeAnswerInput.classList.add('partial');
    typeAnswerContainer.classList.add('partial');
    setFeedback(
      'partial',
      `◐ Partial · ${formatPointsWithGrammar(points)}`,
      'Correct answer:',
      feedbackAnswer,
    );
  } else {
    typeAnswerInput.classList.add('incorrect');
    typeAnswerContainer.classList.add('incorrect');
    setFeedback('incorrect', 'Incorrect', 'Correct answer:', feedbackAnswer);
  }
  typeAnswerInput.disabled = true;
  submitAnswerButton.disabled = true;
  finishAnswer();
}

function answerSpecialQuestion(button) {
  if (answered || !currentAircraft || !specialQuestionData) return;
  const isCorrect = button.dataset.correct === 'true';
  answered = true;
  total += 1;
  if (isCorrect) {
    score += 1;
    button.classList.add('correct');
    setFeedback(
      'correct',
      'Correct!',
      'Answer:',
      specialQuestionData.feedbackAnswer,
    );
  } else {
    button.classList.add('incorrect');
    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true')
        answerButton.classList.add('correct');
    });
    setFeedback(
      'incorrect',
      'Incorrect',
      'Correct answer:',
      specialQuestionData.feedbackAnswer,
    );
  }
  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;
  });
  finishAnswer();
}

function answerMultipleChoice(button) {
  if (answered || !currentAircraft) return;
  const isCorrect = button.dataset.correct === 'true';
  const feedbackAnswer = getFeedbackDisplayAnswer(currentAircraft);
  answered = true;
  total += 1;
  if (isCorrect) {
    score += 1;
    button.classList.add('correct');
    setFeedback('correct', 'Correct!', 'Answer:', feedbackAnswer);
  } else {
    button.classList.add('incorrect');
    setFeedback('incorrect', 'Incorrect', 'Correct answer:', feedbackAnswer);
    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true')
        answerButton.classList.add('correct');
    });
  }
  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;
  });
  finishAnswer();
}

function answerReversePhoto(button) {
  if (answered || !currentAircraft) return;
  const isCorrect = button.dataset.correct === 'true';
  const feedbackAnswer = getFeedbackDisplayAnswer(currentAircraft);
  answered = true;
  total += 1;
  revealCorrectPhotoNames();
  if (isCorrect) {
    score += 1;
    button.classList.add('correct');
    setFeedback('correct', 'Correct!', 'Answer:', feedbackAnswer);
  } else {
    button.classList.add('incorrect');
    setFeedback('incorrect', 'Incorrect', 'Correct photo:', feedbackAnswer);
    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true')
        answerButton.classList.add('correct');
    });
  }
  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;
  });
  finishAnswer();
}

function answerQuestion(button) {
  if (isTypedAnswer()) return;
  if (specialQuestionData) {
    answerSpecialQuestion(button);
  } else if (isPhotoAnswer()) {
    answerReversePhoto(button);
  } else {
    answerMultipleChoice(button);
  }
}

// ============================================================================
// 15. Round Progression & Manifest Loading
// ============================================================================
async function nextQuestion() {
  answered = false;
  scoreAtQuestionStart = score;
  currentChoices = [];
  currentAircraft = null;
  specialQuestionData = null;
  feedbackElement.replaceChildren();
  syncAnswerOptions();
  resetAnswerUI();
  configureAnswerMode();
  setLoading(true);

  const questionType = getQuestionType();
  if (!QUESTION_TYPES.has(questionType)) {
    setLoading(false);
    promptElement.textContent = 'Choose a valid question type.';
    return;
  }

  if (isSpeedKind('rank', questionType)) {
    const entries = getSpeedRankingItems();
    if (!entries) {
      setLoading(false);
      const repeatedRanking =
        previousQuestion?.type === questionType &&
        previousQuestion.answerMode === getAnswerMode();
      promptElement.textContent = repeatedRanking
        ? 'No different ranking is available.'
        : 'Not enough aircraft have usable speed data for ranking.';
      feedbackElement.textContent = repeatedRanking
        ? 'The selected category has no different lineup of four aircraft with usable speed data.'
        : 'At least four aircraft need usable values for this measure.';
      return;
    }
    rememberQuestion(
      questionType,
      entries.map((entry) => entry.item),
    );
    currentAircraft = entries[0].item;
    specialQuestionData = { type: questionType, entries };
    displaySpeedRanking(entries);
    setLoading(false);
    return;
  }

  if (isSpeedKind('compare', questionType)) {
    const pair = getSpeedComparisonPair();
    if (!pair) {
      setLoading(false);
      const repeatedComparison =
        previousQuestion?.type === questionType &&
        previousQuestion.answerMode === getAnswerMode();
      promptElement.textContent = repeatedComparison
        ? 'No different speed comparison is available.'
        : 'No suitable speed comparisons available.';
      feedbackElement.textContent = repeatedComparison
        ? 'The selected category has no other distinct aircraft comparison.'
        : 'Check that manifest.json has at least two aircraft with comparable speed ranges.';
      return;
    }
    rememberQuestion(
      questionType,
      [pair.first, pair.second],
      true,
      getSpeedComparisonPrompt(pair.first, pair.second),
    );
    currentAircraft = pair.first;
    specialQuestionData = {
      type: questionType,
      correctAnswer: pair.answer,
      feedbackAnswer: pair.feedback,
    };
    displaySpeedComparison(pair);
    setLoading(false);
    focusFirstAnswer();
    return;
  }

  let item = null;
  const repeatedAircraftKey =
    getPreviousSingleQuestionAircraftKey(questionType);
  if (isSpeedKind('estimate', questionType)) {
    const noun = getSpeedQuestion().metric.noun;
    const maxAttempts = Math.max(1, getValidAircraftPool().length);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = chooseAircraft(repeatedAircraftKey);
      if (!candidate) break;
      if (!getSpeedSegment(candidate) || !getAircraftImages(candidate).length)
        continue;
      item = candidate;
      break;
    }
    if (!item) {
      setLoading(false);
      promptElement.textContent = repeatedAircraftKey
        ? `No different aircraft is available for a ${noun} question.`
        : `No suitable aircraft available for a ${noun} question.`;
      feedbackElement.textContent = repeatedAircraftKey
        ? `The selected category has no other aircraft with a usable image and valid ${noun}.`
        : `Skipping aircraft without a usable image and valid ${noun}.`;
      return;
    }
  } else {
    item = chooseAircraft(repeatedAircraftKey);
    if (!item) {
      setLoading(false);
      promptElement.textContent = repeatedAircraftKey
        ? 'No different aircraft question is available.'
        : 'Not enough aircraft available.';
      feedbackElement.textContent = repeatedAircraftKey
        ? 'The selected category has no other aircraft for this question mode.'
        : 'Check that the manifest contains enough aircraft with required data.';
      return;
    }
  }

  rememberQuestion(questionType, [item]);
  currentAircraft = item;
  recordAircraftShown(item);
  if (isSpeedKind('estimate', questionType)) {
    displaySpeedEstimateQuestion(item);
    return;
  }
  if (questionType === 'wake') {
    await displayWakeQuestion(item);
    return;
  }

  const answerMode = getAnswerMode();
  const answerSemantic = getAnswerSemanticType(answerMode);
  const answerType =
    answerSemantic === 'name'
      ? 'name'
      : answerSemantic === 'icao'
        ? 'icao'
        : questionType === 'name'
          ? 'name'
          : 'icao';
  displayQuestion();

  if (questionType === 'photo') {
    const imagePath = getRandomImagePath(currentAircraft);
    if (!imagePath) {
      setLoading(false);
      feedbackElement.textContent = 'No image is available for this aircraft.';
      return;
    }
    if (isTypedAnswer(answerMode)) {
      try {
        await loadQuestionImage(
          imagePath,
          'Aircraft recognition question image',
        );
        setLoading(false);
        typeAnswerInput.disabled = false;
        submitAnswerButton.disabled = false;
        typeAnswerInput.focus();
      } catch (error) {
        setLoading(false);
        feedbackElement.textContent = error.message;
      }
      return;
    }
    currentChoices = buildTextAnswerChoices(currentAircraft, answerType);
    displayTextAnswerChoices(currentChoices, true);
    try {
      await loadQuestionImage(imagePath, 'Aircraft recognition question image');
      setLoading(false);
      answerButtons.forEach((button) => {
        if (!button.hidden) button.disabled = false;
      });
      focusFirstAnswer();
    } catch (error) {
      setLoading(false);
      feedbackElement.textContent = error.message;
      answerButtons.forEach((button) => {
        button.disabled = true;
      });
    }
    return;
  }

  if (isPhotoAnswer(answerMode)) {
    currentChoices = buildPhotoChoices(currentAircraft);
    const photosLoaded = await displayPhotoAnswerChoices(currentChoices);
    setLoading(false);
    if (photosLoaded) {
      answerButtons.forEach((button) => {
        if (!button.hidden) button.disabled = false;
      });
      focusFirstAnswer();
    }
    return;
  }

  if (isTypedAnswer(answerMode)) {
    setLoading(false);
    typeAnswerInput.disabled = false;
    submitAnswerButton.disabled = false;
    typeAnswerInput.focus();
    return;
  }

  currentChoices = buildTextAnswerChoices(currentAircraft, answerType);
  displayTextAnswerChoices(currentChoices);
  setLoading(false);
  focusFirstAnswer();
}

async function loadManifest() {
  const response = await fetch(MANIFEST_PATH);
  if (!response.ok)
    throw new Error(`Unable to load manifest (${response.status}).`);
  const manifest = await response.json();
  if (!manifest || !Array.isArray(manifest.aircraft)) {
    throw new Error('Invalid manifest: expected an aircraft array.');
  }
  aircraft = manifest.aircraft.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const hasFolder = Boolean(displayText(item.folder));
    const hasImages =
      (Array.isArray(item.images) && item.images.some(Boolean)) ||
      Boolean(displayText(item.image_path));
    return hasFolder && hasImages;
  });
  if (!aircraft.length)
    throw new Error('Manifest contains no usable aircraft.');
  try {
    const namesResponse = await fetch(CODE_FREE_NAMES_PATH);
    if (namesResponse.ok) {
      codeFreeNameOverrides = new Map(
        Object.entries(await namesResponse.json()).filter(
          ([, value]) => typeof value === 'string' && value.trim(),
        ),
      );
    }
  } catch {
    // Optional file: automatic stripping is used when it is missing or invalid.
  }
}

// ============================================================================
// 16. Keyboard Navigation & Accessibility Setup
// ============================================================================
const getAvailableAnswerButtons = () =>
  answerButtons.filter(
    (button) =>
      !button.disabled && !button.hidden && button.offsetParent !== null,
  );

const focusFirstAnswer = () => getAvailableAnswerButtons()[0]?.focus();
const focusLastAnswer = () => {
  const buttons = getAvailableAnswerButtons();
  buttons[buttons.length - 1]?.focus();
};

function moveAnswerFocus(direction) {
  const buttons = getAvailableAnswerButtons();
  const current = document.activeElement;
  if (!buttons.includes(current)) return false;
  const rect = current.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  let bestButton = null;
  let bestScore = Infinity;
  for (const button of buttons) {
    if (button === current) continue;
    const otherRect = button.getBoundingClientRect();
    const dx = otherRect.left + otherRect.width / 2 - x;
    const dy = otherRect.top + otherRect.height / 2 - y;
    let primary, secondary;
    if (direction === 'left' || direction === 'right') {
      if (direction === 'left' && dx >= -1) continue;
      if (direction === 'right' && dx <= 1) continue;
      primary = Math.abs(dx);
      secondary = Math.abs(dy);
    } else {
      if (direction === 'up' && dy >= -1) continue;
      if (direction === 'down' && dy <= 1) continue;
      primary = Math.abs(dy);
      secondary = Math.abs(dx);
    }
    const candidateScore = primary * 1000 + secondary;
    if (candidateScore < bestScore) {
      bestScore = candidateScore;
      bestButton = button;
    }
  }
  if (!bestButton) return false;
  bestButton.focus();
  return true;
}

const isTypingTarget = (target) =>
  target instanceof Element &&
  target.matches('input, textarea, select, [contenteditable="true"]');
const isNativeInteractiveTarget = (target) =>
  target instanceof Element &&
  target.matches(
    'input, textarea, select, button, a, [contenteditable="true"]',
  );

function handleKeyboard(event) {
  if (isTypingTarget(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (
    key === 'n' &&
    !nextButton.disabled &&
    !isNativeInteractiveTarget(event.target)
  ) {
    event.preventDefault();
    nextQuestion();
    return;
  }
  if (answered && (event.key === 'Enter' || event.key === ' ')) {
    if (!isNativeInteractiveTarget(event.target)) {
      event.preventDefault();
      nextQuestion();
    }
    return;
  }
  if (!answered && /^[1-4]$/.test(event.key)) {
    const button = answerButtons[Number(event.key) - 1];
    if (button && !button.disabled && !button.hidden) {
      event.preventDefault();
      button.click();
    }
    return;
  }
  if (answered) return;
  const direction = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  }[event.key];
  if (direction && moveAnswerFocus(direction)) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Home' && getAvailableAnswerButtons().length) {
    event.preventDefault();
    focusFirstAnswer();
  } else if (event.key === 'End' && getAvailableAnswerButtons().length) {
    event.preventDefault();
    focusLastAnswer();
  }
}

function setupAccessibility() {
  appElement.setAttribute('aria-describedby', 'keyboard-shortcuts-help');
  promptElement.setAttribute('aria-live', 'polite');
  promptElement.setAttribute('aria-atomic', 'true');
  promptElement.setAttribute('tabindex', '-1');
  feedbackElement.setAttribute('aria-live', 'polite');
  feedbackElement.setAttribute('aria-atomic', 'true');
  scoreElement.setAttribute('aria-live', 'polite');
  scoreElement.setAttribute('aria-atomic', 'true');
  loadingMessage.setAttribute('role', 'status');
  loadingMessage.setAttribute('aria-live', 'polite');
  loadingMessage.setAttribute('aria-atomic', 'true');
  answerContainer.setAttribute('aria-label', 'Answer choices');
  let help = byId('keyboard-shortcuts-help');
  if (!help) {
    help = document.createElement('div');
    help.id = 'keyboard-shortcuts-help';
    help.className = 'visually-hidden';
    help.textContent = KEYBOARD_HELP;
    document.body.appendChild(help);
  }
  answerButtons.forEach((button, index) => {
    button.setAttribute('aria-keyshortcuts', String(index + 1));
  });
  nextButton.setAttribute('aria-keyshortcuts', 'Enter Space N');
  submitAnswerButton.setAttribute('aria-keyshortcuts', 'Enter');
}

// ============================================================================
// 17. Event Listeners Setup & Startup
// ============================================================================
answerButtons.forEach((button) => {
  button.addEventListener('click', () => answerQuestion(button));
});
submitAnswerButton.addEventListener('click', submitTypedAnswer);
typeAnswerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !submitAnswerButton.disabled) {
    event.preventDefault();
    submitTypedAnswer();
  }
});
byId('check-ranking')?.addEventListener('click', checkSpeedRanking);
speedSliderInput.addEventListener('input', updateSpeedSliderReadout);
speedSliderInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !speedSliderSubmit.disabled) {
    event.preventDefault();
    submitSpeedGuess();
  }
});
speedSliderSubmit.addEventListener('click', submitSpeedGuess);
nextButton.addEventListener('click', () => {
  if (!nextButton.disabled) nextQuestion();
});
categorySelect.addEventListener('change', () => {
  nextQuestion();
});
function onQuestionSettingChange() {
  if (isSpeedKind('rank')) photosVisible = false;
  syncSpeedModeVisibility();
  syncAnswerOptions();
  nextQuestion();
}
questionTypeSelect.addEventListener('change', onQuestionSettingChange);
speedModeSelect.addEventListener('change', onQuestionSettingChange);
answerTypeSelect.addEventListener('change', () => {
  nextQuestion();
});
document.addEventListener('keydown', handleKeyboard);
imageElement.addEventListener('dragstart', (event) => event.preventDefault());

async function start() {
  try {
    ensureAnswerTypeOptions();
    setupAccessibility();
    setLoading(true);
    await loadManifest();
    populateCategories();
    syncSpeedModeVisibility();
    syncAnswerOptions();
    updateScore();
    reserveFeedbackSpace();
    await nextQuestion();
  } catch (error) {
    console.error(error);
    setLoading(false);
    promptElement.textContent = 'Unable to load aircraft data.';
    feedbackElement.textContent =
      error instanceof Error ? error.message : String(error);
    answerButtons.forEach((button) => {
      button.disabled = true;
    });
    typeAnswerInput.disabled = true;
    submitAnswerButton.disabled = true;
    nextButton.disabled = true;
    promptElement.focus();
  }
}

// The footer is sticky; give it a background only while content scrolls beneath it.
function updateFooterStuck() {
  const bottom = document.querySelector('.bottom');
  if (!bottom) return;
  const root = document.documentElement;
  const pinned =
    getComputedStyle(bottom).position === 'sticky' &&
    window.scrollY + window.innerHeight < root.scrollHeight - 1;
  bottom.classList.toggle('is-stuck', pinned);
}
window.addEventListener('scroll', updateFooterStuck, { passive: true });
window.addEventListener('resize', updateFooterStuck);
new ResizeObserver(updateFooterStuck).observe(document.body);
updateFooterStuck();

start();
