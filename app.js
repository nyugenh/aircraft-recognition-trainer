'use strict';

// ============================================================
// Configuration
// ============================================================

const MANIFEST_PATH = 'manifest.json';
const ASSET_FOLDER = '';

const ANSWER_MODES = [
  { value: 'name', label: 'Choose name', semantic: 'name' },
  { value: 'icao', label: 'Choose ICAO', semantic: 'icao' },
  { value: 'photo', label: 'Choose photo', semantic: 'photo' },
  { value: 'enter-name', label: 'Type name', semantic: 'name' },
  { value: 'enter-icao', label: 'Type ICAO', semantic: 'icao' },
];

const QUESTION_TYPES = new Set([
  'photo',
  'name',
  'icao',
  'cruise-speed',
  'speed',
  'wake',
]);
const WAKE_CATEGORIES = ['Light', 'Medium', 'Heavy', 'Super'];
const KEYBOARD_HELP =
  'Keyboard shortcuts: 1 through 4 select an answer. ' +
  'Arrow keys move between answer choices. ' +
  'Home selects the first answer and End selects the last. ' +
  'Enter submits a typed answer. N moves to the next question.';

// ============================================================
// DOM references
// ============================================================

const $ = (selector) => document.querySelector(selector);
const byId = (id) => document.getElementById(id);

const appElement = $('.app');
const categorySelect = byId('category');
const questionTypeSelect = byId('question-type');
let answerTypeSelect = byId('answer-type');
let answerTypeLabel = byId('answer-type-label');
let answerTypeCaption = null;

// Create the answer-type control if the HTML page does not include it.
// This is also relabelled to "Aircraft identifier" for speed and wake questions.
if (!answerTypeSelect) {
  const controlsElement = $('.controls');
  if (controlsElement) {
    if (!answerTypeLabel) {
      answerTypeLabel = document.createElement('label');
      answerTypeLabel.id = 'answer-type-label';
      answerTypeLabel.textContent = 'Answer type';
      controlsElement.appendChild(answerTypeLabel);
    }

    answerTypeSelect = document.createElement('select');
    answerTypeSelect.id = 'answer-type';
    answerTypeSelect.name = 'answer-type';
    answerTypeSelect.setAttribute('aria-label', 'Answer type');
    answerTypeLabel.appendChild(answerTypeSelect);
  }
}

// Keep the label text separate from the select. Updating label.textContent
// would remove the nested select element from the DOM.
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

// Keep the eye icon and label as separate elements so updating the label
// never removes the icon from the button.
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
  photoToggleIcon.innerHTML = visible
    ? '<path d="M2 2l20 20"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.3 4.5 9.5 6.3a1.2 1.2 0 0 1 0 1.4 16 16 0 0 1-3.1 3.4"></path><path d="M6.2 6.2a16 16 0 0 0-3.7 5.1 1.2 1.2 0 0 0 0 1.4C3.7 14.5 7 19 12 19a10 10 0 0 0 3-.5"></path>'
    : '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>';
}
updatePhotoToggleContents(false);

// ============================================================
// Application state
// ============================================================

let aircraft = [];
let currentAircraft = null;
let currentChoices = [];
let aircraftQueue = [];
let score = 0;
let total = 0;
let answered = false;
let specialQuestionData = null;
let photosVisible = false;

// ============================================================
// General utilities
// ============================================================

function displayText(value) {
  return value == null ? '' : String(value).trim();
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function randomItem(items) {
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}

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

// ============================================================
// Question and answer modes
// ============================================================

function getQuestionType() {
  return questionTypeSelect.value;
}

function getAnswerMode() {
  return answerTypeSelect.value;
}

function isSpecialQuestionType(type = getQuestionType()) {
  return type === 'speed' || type === 'wake' || type === 'cruise-speed';
}

function getAnswerSemanticType(mode = getAnswerMode()) {
  return ANSWER_MODES.find((item) => item.value === mode)?.semantic ?? '';
}

function isTypedAnswer(mode = getAnswerMode()) {
  return mode === 'enter-name' || mode === 'enter-icao';
}

function isPhotoAnswer(mode = getAnswerMode()) {
  return mode === 'photo';
}

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
  const cruiseSpeedQuestion = questionType === 'cruise-speed';

  if (answerTypeLabel) {
    answerTypeLabel.hidden = false;
    if (answerTypeCaption) {
      answerTypeCaption.textContent = specialQuestion
        ? 'Identifier'
        : answerTypeLabel.dataset.defaultLabel || 'Answer';
    }
  }

  answerTypeSelect.disabled = false;

  for (const option of answerTypeSelect.options) {
    const definition = ANSWER_MODES.find((item) => item.value === option.value);
    const invalid = specialQuestion
      ? !['name', 'icao'].includes(option.value)
      : getAnswerSemanticType(option.value) === questionType;

    option.disabled = invalid;
    option.hidden = invalid;

    if (definition) {
      option.textContent = specialQuestion
        ? ({ name: 'Aircraft name', icao: 'ICAO code' }[option.value] ??
          definition.label)
        : definition.label;
    }
  }

  if (specialQuestion) {
    if (!['name', 'icao'].includes(answerTypeSelect.value)) {
      answerTypeSelect.value = 'name';
    }
    return;
  }

  const selectedOption =
    answerTypeSelect.options[answerTypeSelect.selectedIndex];
  if (selectedOption && !selectedOption.disabled) return;

  const preferredModes = {
    photo: ['name', 'enter-name', 'icao', 'enter-icao'],
    name: ['photo', 'icao', 'enter-icao'],
    icao: ['photo', 'name', 'enter-name'],
  };

  for (const mode of preferredModes[questionType] ?? []) {
    const option = [...answerTypeSelect.options].find(
      (item) => item.value === mode && !item.disabled,
    );
    if (option) {
      answerTypeSelect.value = mode;
      return;
    }
  }

  const firstAvailable = [...answerTypeSelect.options].find(
    (option) => !option.disabled,
  );
  if (firstAvailable) answerTypeSelect.value = firstAvailable.value;
}

// ============================================================
// Aircraft data helpers
// ============================================================

function getAnswerValue(item, type) {
  if (!item) return '';

  if (type === 'Aircraft name' || type === 'name') {
    const name = displayText(item.label ?? item.name);
    return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  if (type === 'ICAO code' || type === 'icao') {
    return displayText(
      item.code ?? item.icao ?? item.icao_code ?? item.ICAO ?? item.icaoCode,
    );
  }

  return '';
}

function getFeedbackAnswer(item, type) {
  if (!item) return '';

  const name = getAnswerValue(item, 'name');
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
  const name = getAnswerValue(item, 'name');
  const code = getAnswerValue(item, 'icao');

  if (questionType === 'photo') {
    return getFeedbackAnswer(item, answerSemantic === 'icao' ? 'icao' : 'name');
  }

  if (questionType === 'name') {
    if (answerSemantic === 'icao') return code;
    if (answerSemantic === 'photo') {
      return name && code ? `${name} (${code})` : name || code;
    }
  }

  if (questionType === 'icao') {
    if (answerSemantic === 'name') return name;
    if (answerSemantic === 'photo') {
      return code && name ? `${code} (${name})` : code || name;
    }
  }

  return getFeedbackAnswer(item, answerSemantic === 'icao' ? 'icao' : 'name');
}

function getTypedAnswerValue(item, mode = getAnswerMode()) {
  if (mode === 'enter-name') return getAnswerValue(item, 'name');
  if (mode === 'enter-icao') return getAnswerValue(item, 'icao');
  return '';
}

function getAircraftTypeKey(item) {
  const code = displayText(
    item?.code ?? item?.icao ?? item?.icao_code ?? item?.ICAO ?? item?.icaoCode,
  ).toLowerCase();
  const name = displayText(item?.name ?? item?.label)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .toLowerCase();

  if (code) return `code:${code}`;
  if (name) return `name:${name}`;
  return '';
}

function getAircraftDisplayName(item) {
  return getAnswerValue(item, 'name') || getAnswerValue(item, 'icao');
}

function getSpecialAircraftIdentifier(item) {
  const type = getAnswerMode() === 'icao' ? 'icao' : 'name';
  return getAnswerValue(item, type) || getAircraftDisplayName(item);
}

// ============================================================
// Speed and wake-category helpers
// ============================================================

function getCruiseSpeedRange(item) {
  const speed = item?.cruise_speed_kt;
  if (!speed) return null;

  const min = Number(speed.min);
  const max = Number(speed.max);

  if (
    speed.min == null ||
    speed.max == null ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min < 0 ||
    min > max
  ) {
    return null;
  }

  return { min, max };
}

function getMachCruiseRange(item) {
  // Supported manifest fields: cruise_speed_mach, cruise_mach, or mach_cruise.
  const speed =
    item?.cruise_speed_mach ?? item?.cruise_mach ?? item?.mach_cruise;
  if (speed == null) return null;

  const min = Number(typeof speed === 'object' ? speed.min : speed);
  const max = Number(typeof speed === 'object' ? speed.max : speed);
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min <= 0 ||
    min > max ||
    max > 2
  )
    return null;
  return { min, max };
}

function getSpeedRange(item, unit) {
  return unit === 'mach' ? getMachCruiseRange(item) : getCruiseSpeedRange(item);
}

function getSpeedSegments(unit) {
  // Fixed, memorable bands that stay the same for every question.
  // Boundaries are lower-inclusive and upper-exclusive, except the final band.
  if (unit === 'mach') {
    return [
      { min: -Infinity, max: 0.5, label: 'Below Mach 0.5' },
      { min: 0.5, max: 0.7, label: 'Mach 0.5–0.7' },
      { min: 0.7, max: 0.85, label: 'Mach 0.7–0.85' },
      { min: 0.85, max: Infinity, label: 'Mach 0.85 and above' },
    ];
  }

  return [
    { min: -Infinity, max: 150, label: 'Below 150 kt' },
    { min: 150, max: 250, label: '150–250 kt' },
    { min: 250, max: 350, label: '250–350 kt' },
    { min: 350, max: Infinity, label: '350 kt and above' },
  ];
}

function getSpeedSegment(item, unit) {
  const range = getSpeedRange(item, unit);
  if (!range) return null;

  const speed = (range.min + range.max) / 2;
  const segments = getSpeedSegments(unit);
  return (
    segments.find((segment, index) =>
      index === segments.length - 1
        ? speed >= segment.min
        : speed >= segment.min && speed < segment.max,
    ) || null
  );
}

function getSpeedChoices(unit) {
  return getSpeedSegments(unit).map((segment) => segment.label);
}

function displayCruiseSpeedQuestion(item, unit) {
  const correctSegment = getSpeedSegment(item, unit);
  const imagePath = getRandomImagePath(item);
  const choices = getSpeedChoices(unit);
  if (!correctSegment || !imagePath || choices.length !== 4) {
    setLoading(false);
    promptElement.textContent = 'Unable to create a cruise speed question.';
    feedbackElement.textContent =
      unit === 'mach'
        ? 'Check that cruise_speed_mach ranges are available in manifest.json.'
        : 'Check that cruise-speed ranges are available in manifest.json.';
    return false;
  }

  const correctAnswer = correctSegment.label;
  specialQuestionData = {
    type: 'cruise-speed',
    correctAnswer,
    feedbackAnswer: correctAnswer,
  };
  promptElement.replaceChildren();
  promptElement.appendChild(
    document.createTextNode(
      unit === 'mach'
        ? `What is the typical cruise Mach number of the ${getSpecialAircraftIdentifier(item)}?`
        : `What is the cruise speed of the ${getSpecialAircraftIdentifier(item)}?`,
    ),
  );
  appendCategoryHint(promptElement, item.category, 'Aircraft category');
  displaySpecialChoices(choices, correctAnswer, true);

  loadQuestionImage(imagePath, 'Cruise speed question image')
    .then(() => {
      setLoading(false);
      answerButtons.forEach((button) => {
        if (!button.hidden) button.disabled = false;
      });
      focusFirstAnswer();
    })
    .catch((error) => {
      setLoading(false);
      feedbackElement.textContent = error.message;
      answerButtons.forEach((button) => {
        button.disabled = true;
      });
    });
  return true;
}

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

// Only compare aircraft when their cruise-speed ranges do not overlap.
function getSpeedComparisonPair() {
  const pool = getValidAircraftPool();
  const pairs = [];

  for (let firstIndex = 0; firstIndex < pool.length; firstIndex += 1) {
    const first = pool[firstIndex];
    const firstSpeed = getCruiseSpeedRange(first);
    if (!firstSpeed) continue;

    for (
      let secondIndex = firstIndex + 1;
      secondIndex < pool.length;
      secondIndex += 1
    ) {
      const second = pool[secondIndex];
      const secondSpeed = getCruiseSpeedRange(second);
      if (!secondSpeed) continue;

      if (firstSpeed.min > secondSpeed.max) {
        pairs.push({ first, second, answer: 'Faster' });
      } else if (firstSpeed.max < secondSpeed.min) {
        pairs.push({ first, second, answer: 'Slower' });
      }
    }
  }

  return randomItem(pairs);
}

// ============================================================
// Image paths
// ============================================================

function cleanPath(value) {
  return displayText(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
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

function getRandomImagePath(item) {
  return randomItem(getAircraftImages(item)) ?? '';
}

// ============================================================
// Category selection and aircraft pool
// ============================================================

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

  if (questionType === 'speed') {
    return pool.filter(
      (item) =>
        (Boolean(getCruiseSpeedRange(item)) ||
          Boolean(getMachCruiseRange(item))) &&
        Boolean(
          getAnswerValue(item, getAnswerMode() === 'icao' ? 'icao' : 'name'),
        ),
    );
  }

  if (questionType === 'cruise-speed') {
    return pool.filter(
      (item) =>
        getAircraftImages(item).length > 0 &&
        (Boolean(getCruiseSpeedRange(item)) ||
          Boolean(getMachCruiseRange(item))) &&
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

function hasEnoughDistinctAnswers(pool) {
  if (isSpecialQuestionType() || isTypedAnswer()) return pool.length > 0;
  if (isPhotoAnswer()) return uniqueBy(pool, getAircraftTypeKey).length >= 4;

  const answerType = getAnswerSemanticType();
  return (
    uniqueBy(pool, (item) => getAnswerValue(item, answerType).toLowerCase())
      .length >= 4
  );
}

function getValidAircraftPool() {
  const selectedPool = filterPoolForCombination(getSelectedAircraftPool());

  if (isSpecialQuestionType() || isTypedAnswer()) return selectedPool;
  if (hasEnoughDistinctAnswers(selectedPool)) return selectedPool;

  // Fall back to all categories if the selected category has too few answers.
  return filterPoolForCombination(aircraft);
}

// ============================================================
// Question rotation: each aircraft type appears once per cycle
// ============================================================

function chooseAircraft() {
  const pool = getValidAircraftPool();
  if (!pool.length) return null;

  const aircraftByType = new Map();
  for (const item of pool) {
    const key = getAircraftTypeKey(item);
    if (!key) continue;
    if (!aircraftByType.has(key)) aircraftByType.set(key, []);
    aircraftByType.get(key).push(item);
  }

  if (!aircraftByType.size) return null;

  const availableKeys = new Set(aircraftByType.keys());
  aircraftQueue = aircraftQueue.filter((item) =>
    availableKeys.has(getAircraftTypeKey(item)),
  );

  if (!aircraftQueue.length) {
    aircraftQueue = shuffle(
      [...aircraftByType.values()].map((entries) => entries[0]),
    );
  }

  const representative = aircraftQueue.pop();
  const entries = aircraftByType.get(getAircraftTypeKey(representative));
  return randomItem(entries) ?? representative;
}

// ============================================================
// Build answer choices
// ============================================================

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
  ]).map((item) => ({ aircraft: item, text: getFeedbackDisplayAnswer(item) }));
}

// ============================================================
// Prompt construction
// ============================================================

function getIndefiniteArticle(value) {
  return /^[aeiou]/i.test(displayText(value)) ? 'an' : 'a';
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
        ? 'What is the ICAO code?'
        : 'Which aircraft is this?';
  } else if (questionType === 'name') {
    text =
      answerMode === 'photo'
        ? `Which photo is ${getIndefiniteArticle(name)} ${name}?`
        : `What is the ICAO code for ${getIndefiniteArticle(name)} ${name}?`;
  } else if (questionType === 'icao') {
    text =
      answerMode === 'photo'
        ? `Which photo is ${code}?`
        : `Which aircraft has ICAO code ${code}?`;
  }

  promptElement.appendChild(document.createTextNode(text));
  appendCategoryHint(promptElement, currentAircraft?.category);
}

// ============================================================
// Layout and loading state
// ============================================================

function updatePhotoVisibility() {
  const questionType = getQuestionType();
  const isSpecial = isSpecialQuestionType(questionType);
  const showPhotos = isSpecial && photosVisible;
  const comparison = imageContainer.querySelector('.speed-comparison');

  photoToggleButton.hidden = !isSpecial;
  updatePhotoToggleContents(photosVisible);
  photoToggleButton.setAttribute('aria-pressed', String(photosVisible));
  photoToggleButton.setAttribute(
    'aria-label',
    photosVisible ? 'Hide aircraft photos' : 'Show aircraft photos',
  );
  photoToggleButton.setAttribute('aria-controls', 'image-container');

  if (questionType === 'speed' && comparison) comparison.hidden = !showPhotos;
  if (questionType === 'wake') imageElement.hidden = !showPhotos;

  imageContainer.hidden = isSpecial && !photosVisible;
  appElement.classList.toggle(
    'no-image',
    (isSpecial && !photosVisible) ||
      (!isSpecial && questionType !== 'photo' && getAnswerMode() !== 'photo'),
  );
}

photoToggleButton.addEventListener('click', () => {
  photosVisible = !photosVisible;
  updatePhotoVisibility();
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
  imageElement.hidden = false;

  answerButtons.forEach((button, index) => {
    button.disabled = true;
    button.hidden = false;
    button.classList.remove('correct', 'incorrect');
    button.replaceChildren();
    delete button.dataset.answer;
    delete button.dataset.correct;
    button.removeAttribute('aria-hidden');
    button.setAttribute('aria-label', `Answer option ${index + 1}`);
  });

  answerContainer.classList.remove('reverse');
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
  scoreElement.textContent = `Score: ${score}/${total} (${percentage}%)`;
}

// ============================================================
// Feedback and answer completion
// ============================================================

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

function revealCorrectPhotoNames() {
  answerButtons.forEach((button) => {
    button.querySelector('.photo-choice-name')?.classList.remove('hidden-name');
  });
}

function finishAnswer() {
  updateScore();
  nextButton.disabled = false;
  nextButton.focus();
}

// ============================================================
// Render answer choices
// ============================================================

function displayTextAnswerChoices(choices, disabled = false) {
  answerContainer.classList.remove('reverse');
  answerContainer.hidden = false;

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
    button.replaceChildren();
    button.textContent = choice.text;
    button.dataset.answer = choice.text;
    button.dataset.correct = String(choice.aircraft === currentAircraft);
    button.disabled = disabled;
    button.setAttribute('aria-label', `Option ${index + 1}: ${choice.text}`);
    button.setAttribute('aria-keyshortcuts', String(index + 1));
  });
}

function displayPhotoAnswerChoices(choices) {
  answerContainer.classList.add('reverse');
  answerContainer.hidden = false;

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
    button.replaceChildren();

    const image = document.createElement('img');
    image.src = getRandomImagePath(choice.aircraft);
    image.alt = `Aircraft photo option ${index + 1}`;
    image.draggable = false;

    const name = document.createElement('span');
    name.className = 'photo-choice-name hidden-name';
    name.textContent = choice.text;
    button.append(image, name);

    button.dataset.answer = choice.text;
    button.dataset.correct = String(choice.aircraft === currentAircraft);
    button.disabled = false;
    button.setAttribute('aria-label', `Photo option ${index + 1}`);
    button.setAttribute('aria-keyshortcuts', String(index + 1));
  });
}

function displaySpecialChoices(choices, correctAnswer, disabled = false) {
  answerContainer.classList.remove('reverse');
  answerContainer.hidden = false;

  answerButtons.forEach((button, index) => {
    const choice = choices[index];
    button.replaceChildren();
    button.classList.remove('correct', 'incorrect');

    if (!choice) {
      button.hidden = true;
      button.disabled = true;
      button.setAttribute('aria-hidden', 'true');
      return;
    }

    button.hidden = false;
    button.removeAttribute('aria-hidden');
    button.textContent = choice;
    button.dataset.answer = choice;
    button.dataset.correct = String(choice === correctAnswer);
    button.disabled = disabled;
    button.setAttribute('aria-label', `Option ${index + 1}: ${choice}`);
    button.setAttribute('aria-keyshortcuts', String(index + 1));
  });
}

// ============================================================
// Special question rendering
// ============================================================

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

    const image = document.createElement('img');
    image.src = getRandomImagePath(item);
    image.alt = label;
    image.draggable = false;

    const name = document.createElement('p');
    name.className = 'speed-aircraft-name';
    name.textContent = label;
    card.append(image, name);
    comparison.appendChild(card);
  }

  imageContainer.appendChild(comparison);
  updatePhotoVisibility();
  promptElement.textContent =
    `Is the ${getSpecialAircraftIdentifier(pair.first)} faster or slower than ` +
    `the ${getSpecialAircraftIdentifier(pair.second)}?`;
  displaySpecialChoices(['Faster', 'Slower'], pair.answer);
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
    correctAnswer: correctCategory,
    feedbackAnswer: correctCategory,
  };

  promptElement.replaceChildren();
  promptElement.appendChild(
    document.createTextNode(
      `What is the wake turbulence category of the ${getSpecialAircraftIdentifier(item)}?`,
    ),
  );
  appendCategoryHint(promptElement, item.category, 'Aircraft category');
  displaySpecialChoices([...WAKE_CATEGORIES], correctCategory, true);

  try {
    await loadQuestionImage(imagePath, 'Aircraft wake category question image');
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

// ============================================================
// Typed-answer scoring
// ============================================================

function calculatePartialScore(typedAnswer, correctAnswer) {
  const typedWords = normaliseAnswer(typedAnswer);
  const correctWords = normaliseAnswer(correctAnswer);
  if (!typedWords.length || !correctWords.length) return 0;

  if (typedWords.join(' ') === correctWords.join(' ')) return 1;

  // Match words without counting the same expected word more than once.
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

function formatPoints(points) {
  if (points === 1) return '1';
  if (points === 0) return '0';
  return Number(points.toFixed(2)).toString();
}

function formatPointsWithGrammar(points) {
  const value = formatPoints(points);
  return value === '1' ? '1 point' : `${value} points`;
}

// ============================================================
// Answer submission
// ============================================================

function submitTypedAnswer() {
  if (answered || !currentAircraft || !isTypedAnswer()) return;

  const correctAnswer = getTypedAnswerValue(currentAircraft);
  if (!correctAnswer) return;

  const feedbackAnswer = getFeedbackDisplayAnswer(currentAircraft);
  const points = calculatePartialScore(typeAnswerInput.value, correctAnswer);

  answered = true;
  total += 1;
  score = Math.round((score + points) * 100) / 100;

  typeAnswerInput.classList.remove('correct', 'partial', 'incorrect');
  typeAnswerContainer.classList.remove('correct', 'partial', 'incorrect');

  if (points === 1) {
    typeAnswerInput.classList.add('correct');
    typeAnswerContainer.classList.add('correct');
    setFeedback('correct', '✓ Correct!', 'Correct answer:', feedbackAnswer);
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
    setFeedback('incorrect', '✕ Incorrect', 'Correct answer:', feedbackAnswer);
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
      '✓ Correct!',
      'Answer:',
      specialQuestionData.feedbackAnswer,
    );
  } else {
    button.classList.add('incorrect');
    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true') {
        answerButton.classList.add('correct');
      }
    });
    setFeedback(
      'incorrect',
      '✕ Incorrect',
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
    setFeedback('correct', '✓ Correct!', 'Answer:', feedbackAnswer);
  } else {
    button.classList.add('incorrect');
    setFeedback('incorrect', '✕ Incorrect', 'Correct answer:', feedbackAnswer);
    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true') {
        answerButton.classList.add('correct');
      }
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
    setFeedback('correct', '✓ Correct!', 'Answer:', feedbackAnswer);
  } else {
    button.classList.add('incorrect');
    setFeedback('incorrect', '✕ Incorrect', 'Correct photo:', feedbackAnswer);
    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true') {
        answerButton.classList.add('correct');
      }
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

// ============================================================
// Image loading
// ============================================================

function loadQuestionImage(path, altText) {
  return new Promise((resolve, reject) => {
    imageElement.onload = () => resolve();
    imageElement.onerror = () => {
      reject(new Error(`Unable to load aircraft image: ${path}`));
    };
    imageElement.alt = altText;
    imageElement.src = path;
  });
}

// ============================================================
// Advance to the next question
// ============================================================

async function nextQuestion() {
  answered = false;
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

  // Special question: compare two aircraft by cruise-speed ranges.
  if (questionType === 'speed') {
    const pair = getSpeedComparisonPair();
    if (!pair) {
      setLoading(false);
      promptElement.textContent = 'No suitable speed comparisons available.';
      feedbackElement.textContent =
        'Check that the selected category has at least two aircraft with non-overlapping cruise-speed ranges.';
      return;
    }

    currentAircraft = pair.first;
    specialQuestionData = {
      type: 'speed',
      correctAnswer: pair.answer,
      feedbackAnswer: pair.answer,
    };

    displaySpeedComparison(pair);
    setLoading(false);
    focusFirstAnswer();
    return;
  }

  const item = chooseAircraft();
  if (!item) {
    setLoading(false);
    promptElement.textContent = 'Not enough aircraft available.';
    feedbackElement.textContent =
      'Check that the manifest contains enough aircraft with the required data for the selected question type.';
    return;
  }

  currentAircraft = item;

  if (questionType === 'cruise-speed') {
    const availableUnits = [
      ...(getCruiseSpeedRange(item) ? ['kt'] : []),
      ...(getMachCruiseRange(item) ? ['mach'] : []),
    ];
    const unit =
      availableUnits[Math.floor(Math.random() * availableUnits.length)] || 'kt';
    displayCruiseSpeedQuestion(item, unit);
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

  // Photo question: identify the displayed aircraft.
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

  // Text question: choose the correct aircraft photo.
  if (isPhotoAnswer(answerMode)) {
    currentChoices = buildPhotoChoices(currentAircraft);
    displayPhotoAnswerChoices(currentChoices);
    setLoading(false);
    answerButtons.forEach((button) => {
      if (!button.hidden) button.disabled = false;
    });
    focusFirstAnswer();
    return;
  }

  // Text question: type the answer.
  if (isTypedAnswer(answerMode)) {
    setLoading(false);
    typeAnswerInput.disabled = false;
    submitAnswerButton.disabled = false;
    typeAnswerInput.focus();
    return;
  }

  // Text question: select a text answer.
  currentChoices = buildTextAnswerChoices(currentAircraft, answerType);
  displayTextAnswerChoices(currentChoices);
  setLoading(false);
  focusFirstAnswer();
}

// ============================================================
// Load aircraft manifest
// ============================================================

async function loadManifest() {
  const response = await fetch(MANIFEST_PATH);
  if (!response.ok) {
    throw new Error(`Unable to load manifest (${response.status}).`);
  }

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

  if (!aircraft.length) {
    throw new Error('Manifest contains no usable aircraft.');
  }

  console.info(`Loaded ${aircraft.length} aircraft from manifest.`);
}

// ============================================================
// Keyboard navigation
// ============================================================

function getAvailableAnswerButtons() {
  return answerButtons.filter(
    (button) =>
      !button.disabled && !button.hidden && button.offsetParent !== null,
  );
}

function focusFirstAnswer() {
  getAvailableAnswerButtons()[0]?.focus();
}

function focusLastAnswer() {
  const buttons = getAvailableAnswerButtons();
  buttons[buttons.length - 1]?.focus();
}

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
    let primary;
    let secondary;

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

function isTypingTarget(target) {
  return (
    target instanceof Element &&
    target.matches('input, textarea, select, [contenteditable="true"]')
  );
}

function isNativeInteractiveTarget(target) {
  return (
    target instanceof Element &&
    target.matches(
      'input, textarea, select, button, a, [contenteditable="true"]',
    )
  );
}

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

// ============================================================
// Accessibility setup
// ============================================================

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

// ============================================================
// Event listeners
// ============================================================

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

nextButton.addEventListener('click', () => {
  if (!nextButton.disabled) nextQuestion();
});

categorySelect.addEventListener('change', () => {
  aircraftQueue = [];
  nextQuestion();
});

questionTypeSelect.addEventListener('change', () => {
  aircraftQueue = [];
  syncAnswerOptions();
  nextQuestion();
});

answerTypeSelect.addEventListener('change', () => {
  aircraftQueue = [];
  nextQuestion();
});

document.addEventListener('keydown', handleKeyboard);
imageElement.addEventListener('dragstart', (event) => event.preventDefault());

// ============================================================
// Startup
// ============================================================

async function start() {
  try {
    ensureAnswerTypeOptions();
    setupAccessibility();
    setLoading(true);
    await loadManifest();
    populateCategories();
    syncAnswerOptions();
    updateScore();
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

start();
